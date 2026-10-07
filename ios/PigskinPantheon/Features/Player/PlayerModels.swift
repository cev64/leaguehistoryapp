import SwiftUI

// What Bridge.player answers (Engine/bridge-player.js), and the small
// pieces the card and the search share.

/// A fantasy team as the player index names it, in one season.
struct PCTeam: Decodable, Hashable {
    let id: String
    let name: String
    let ownerId: String
    let owner: String
    let color: String?
    let season: Int
}

/// `Bridge.player.card(id)`: a card, or why there is none.
struct PlayerCardAnswer: Decodable {
    let found: Bool
    let message: String?
    let card: PlayerCardData?

    private enum Keys: String, CodingKey { case found, message }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        found = try c.decode(Bool.self, forKey: .found)
        message = try c.decodeIfPresent(String.self, forKey: .message)
        card = found ? try PlayerCardData(from: decoder) : nil
    }
}

struct PlayerCardData: Decodable {
    let id: String
    let name: String
    let pos: String
    let isDst: Bool
    let photo: String?
    let club: String
    let heroColor: String
    /// Seasons he won the championship game in the starting lineup.
    let titles: [Int]
    let managerCount: Int
    let managersTag: String
    let tiles: Tiles
    let leadColor: String
    /// Weeks across the timeline (the longest season's), and the regular
    /// season's length for the week labels over it.
    let columns: Int
    let labelReg: Int
    /// Newest season first.
    let timeline: [TimelineRow]
    let managers: [Manager]
    let top: [TopGame]
    /// Oldest first.
    let seasons: [Int]
    let latest: Int
    /// season -> rows, newest week first
    let log: [String: [LogRow]]

    struct Tiles: Decodable {
        let starts: Int
        let perStart: String
        let best: String
        let bestDetail: String
        let bestGame: GameRef?
        let record: String
    }

    struct GameRef: Decodable, Hashable {
        let season: Int
        let week: Int
        let a: String
        let b: String
    }

    struct TimelineRow: Decodable, Identifiable {
        let season: Int
        let reg: Int
        let cells: [Cell]
        let owners: [PCTeam]
        let more: Int
        let moreNames: String
        var id: Int { season }
    }

    struct Cell: Decodable, Hashable {
        let week: Int
        /// start | bench | none (his team had no game) | empty (not on a roster) | future
        let kind: String
        let color: String?
        let tip: String
    }

    struct Manager: Decodable, Identifiable {
        let ownerId: String
        let owner: String
        let color: String?
        let team: PCTeam
        let names: [String]
        let seasons: String
        let starts: Int
        let weeks: Int
        let pts: String
        let record: String
        var id: String { ownerId }
    }

    struct TopGame: Decodable, Identifiable {
        let rank: Int
        let title: String
        let detail: String
        let pts: String
        let season: Int
        let week: Int
        let team: PCTeam
        let opp: PCTeam?
        var id: Int { rank }
    }

    struct LogRow: Decodable, Identifiable, Hashable {
        let gap: Bool
        let season: Int
        let week: Int
        let playoff: Bool
        let team: PCTeam?
        let label: String
        let tip: String
        let started: Bool?
        let ptsText: String?
        /// How deep the chip's fill is, on his own scale (his best start is 1).
        let fill: Double?
        /// The opponent's team id, for the box score.
        let opp: String?
        var id: String { "\(season)-\(week)" }
    }

    func log(for season: Int) -> [LogRow] { log[String(season)] ?? [] }
    /// Every season, newest first.
    var allLog: [LogRow] { seasons.reversed().flatMap { log(for: $0) } }
}

/// A search hit (`Bridge.player.search`, `.popular`, `.brief`).
struct PlayerHit: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let pos: String
    let club: String
    let photo: String?
    let starts: Int
    let pts: String
    let seasons: [Int]
    let years: String
    let detail: String
    let teams: [PCTeam]
}

// MARK: Shared pieces

/// A fantasy team's mark (player-card.js `mark`): the manager's avatar where
/// there is one, otherwise the team's colour with its initial.
struct PCMark: View {
    @Environment(LeagueSession.self) private var session
    let team: PCTeam
    var size: CGFloat = 28
    var corner: CGFloat? = nil

    var body: some View {
        let seasonTeam = session.summary?.season(team.season)?.team(team.id)
        let owner = session.summary?.owners[team.ownerId]
        TeamBadge(name: team.name,
                  icon: seasonTeam?.icon ?? String(team.name.trimmingCharacters(in: .whitespaces).prefix(1)),
                  color: team.color,
                  logo: owner?.logo ?? seasonTeam?.logo,
                  size: size,
                  corner: corner ?? size * 0.28)
    }
}

/// An NFL club filling a circle: a defence's photo, and the stand-in for a
/// photo that won't load (player-card.js `bigClub`).
struct PCBigClub: View {
    let club: String
    var size: CGFloat

    var body: some View {
        let hex = NFLClub.colors[club]
        ZStack {
            if club != "FA", let hex {
                Circle().fill(Color(css: hex) ?? Theme.ink3)
                Text(club)
                    .font(.system(size: size * 0.26, weight: .black))
                    .tracking(size * 0.01)
                    .foregroundStyle(Color.readableInk(on: hex))
            } else {
                Circle().fill(Color(light: 0xE7EBEF, dark: 0x2A3A52))
                Image(systemName: "person.fill")
                    .font(.system(size: size * 0.42))
                    .foregroundStyle(Theme.ink3)
            }
        }
        .frame(width: size, height: size)
    }
}

/// A player's photo in a circle, fading in; his club where there is none.
struct PCPhoto: View {
    let photo: String?
    let club: String
    var size: CGFloat
    /// The white disc the site sets a photo on.
    var plate: Color = Color(light: 0xFFFFFF, dark: 0xF2F4F7)

    var body: some View {
        Group {
            if let photo, let url = URL(string: photo) {
                RemoteImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                            .frame(width: size, height: size, alignment: .top)
                            .background(plate)
                            .clipShape(Circle())
                            .transition(.opacity)
                    case .failure:
                        PCBigClub(club: club, size: size)
                    default:
                        Circle().fill(plate)
                    }
                }
            } else {
                PCBigClub(club: club, size: size)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The players a person opened lately, per league, newest first.
enum PCRecents {
    private static func key(_ league: String) -> String { "pp-recent-players-\(league)" }

    static func load(_ league: String) -> [String] {
        UserDefaults.standard.stringArray(forKey: key(league)) ?? []
    }

    static func add(_ id: String, league: String) {
        var list = load(league).filter { $0 != id }
        list.insert(id, at: 0)
        UserDefaults.standard.set(Array(list.prefix(8)), forKey: key(league))
    }

    static func remove(_ id: String, league: String) {
        UserDefaults.standard.set(load(league).filter { $0 != id }, forKey: key(league))
    }

    static func clear(_ league: String) {
        UserDefaults.standard.removeObject(forKey: key(league))
    }
}

extension Color {
    /// The ink for a points chip: the team colour laid at `fill` over the
    /// card (white in light mode, the card's navy in dark), as inkOn works.
    static func pcChipInk(_ hex: String?, fill: Double, dark: Bool) -> Color {
        guard let hex, hex.hasPrefix("#"), let n = UInt32(hex.dropFirst(), radix: 16) else { return .white }
        let base: (Double, Double, Double) = dark ? (16, 27, 43) : (255, 255, 255)
        func mix(_ c: UInt32, _ b: Double) -> Double { fill * Double(c) + (1 - fill) * b }
        let lum = (0.299 * mix((n >> 16) & 255, base.0) + 0.587 * mix((n >> 8) & 255, base.1) + 0.114 * mix(n & 255, base.2)) / 255
        return lum < 0.6 ? .white : Color(hex: 0x0B1726)
    }
}
