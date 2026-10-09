import SwiftUI

// What Bridge.records answers (Engine/bridge-records.js).

/// The record book (`Bridge.records.book`): the hero's badge, the title
/// tables, and the all-time standings with every order they sort into.
struct RecordBook: Decodable {
    let name: String?
    /// "Through 2026 · Week 8", or "4 seasons".
    let badge: String
    let managers: [BookAllTimeLine]
    let champions: [BookTitleLine]
    let lastPlaces: [BookTitleLine]
    /// Each column's first direction (`allTimeDefaults`).
    let defaults: [String: String]
    /// "key:direction" -> owner ids in that order.
    let orders: [String: [String]]
    let start: BookSort

    func manager(_ id: String) -> BookAllTimeLine? { managers.first { $0.ownerId == id } }
}

struct BookSort: Decodable, Hashable {
    var key: String
    var direction: String

    var ascending: Bool { direction == "asc" }
    var id: String { "\(key):\(direction)" }
    var arrow: String { ascending ? "↑" : "↓" }
}

/// A manager as a row shows them: their current team, their badge.
protocol BookFace {
    var ownerId: String { get }
    var name: String { get }
    var currentTeam: String { get }
    var icon: String { get }
    var color: String? { get }
    var logo: String? { get }
}

struct BookAllTimeLine: Decodable, Hashable, Identifiable, BookFace {
    let ownerId: String
    let name: String
    let currentTeam: String
    let icon: String
    let color: String?
    let logo: String?
    let wins: Int
    let losses: Int
    let pf: Double
    let pa: Double
    let pfg: Double
    let diff: Double
    let record: String
    let pct: String
    let pfText: String
    let paText: String
    let pfgText: String
    let diffText: String
    let seasons: Int

    var id: String { ownerId }
}

/// A row of the Champions or Last Places table.
struct BookTitleLine: Decodable, Hashable, Identifiable {
    let rank: Int
    let ownerId: String
    let count: Int
    /// "🏆🏆 2"
    let marks: String
    /// "2023, 2024"
    let years: String

    var id: String { ownerId }
}

/// A manager's history (`Bridge.records.profile`): the drawer of alltime.html.
struct BookProfile: Decodable, BookFace {
    let ownerId: String
    let name: String
    let currentTeam: String
    let icon: String
    let color: String?
    let logo: String?
    /// "GridironGreg · 5 seasons"
    let ownerLine: String
    let stats: [BookProfileStat]
    let highlights: [BookHighlight]
    let seasons: [BookProfileSeason]
    let chart: BookWinsChart
    let h2h: [BookH2HLine]
    let h2hDefaults: [String: String]
    let h2hOrders: [String: [String]]
    let h2hStart: BookSort
}

struct BookProfileStat: Decodable, Hashable {
    let label: String
    let value: String
}

/// A highlight tile (`highlightTiles`).
struct BookHighlight: Decodable, Hashable, Identifiable {
    /// gold, red, green, fire, blue, purple, navy
    let kind: String
    let icon: String
    let label: String
    let value: String
    let meta: String?
    /// Years as chips (titles, last places), in place of a value.
    let chips: [Int]?

    var id: String { label }
}

/// A row of Season History (`seasonRows`).
struct BookProfileSeason: Decodable, Hashable, Identifiable {
    let year: Int
    let teamId: String
    let teamName: String
    let record: String
    let finalRank: Int?
    let live: Bool
    /// "1", "2", "3", "last", "mid" or "live"
    let place: String

    var id: Int { year }
}

/// Regular-season wins by year (`renderWinsChart`), finished seasons only.
struct BookWinsChart: Decodable {
    let maxWins: Int
    let ticks: [Int]
    let points: [Point]

    struct Point: Decodable, Hashable, Identifiable {
        let year: Int
        let wins: Int
        var id: Int { year }
    }
}

struct BookH2HLine: Decodable, Hashable, Identifiable, BookFace {
    let ownerId: String
    let name: String
    let currentTeam: String
    let icon: String
    let color: String?
    let logo: String?
    let wins: Int
    let losses: Int
    let games: Int
    let record: String
    let pct: String
    let pf: String
    let pa: String
    let diff: Double
    let diffText: String

    var id: String { ownerId }
}

/// Most-started players (`Bridge.records.starters`).
struct BookStarters: Decodable {
    /// Set when there is nothing to show: "No box scores for this manager yet."
    let message: String?
    let years: [Int]
    let players: [Starter]

    struct Starter: Decodable, Hashable, Identifiable {
        let rank: Int
        let id: String
        let name: String
        let pos: String
        let nfl: String
        let starts: Int
        let cells: [Cell]
    }

    struct Cell: Decodable, Hashable, Identifiable {
        let year: Int
        let n: Int
        let clubs: [String]
        let fill: Double
        let title: String
        var id: Int { year }
    }
}

/// A row of the player search (`Bridge.records.search`).
struct BookPlayerHit: Decodable, Hashable, Identifiable {
    let id: String
    let name: String
    let pos: String
    let club: String
    let photo: String?
    let starts: Int
    /// "WR · MIN · 2022–26"
    let line: String
}

// MARK: Shared bits of the record book

/// The sort options of the standings and head-to-head menus, as the
/// site's mobile <select>s list them.
struct BookSortOption: Hashable {
    let key: String
    let label: String
    init(_ key: String, _ label: String) { self.key = key; self.label = label }
}

enum BookSortOptions {
    static let allTime: [BookSortOption] = [
        .init("wins", "Record"), .init("pct", "Win Percentage"), .init("pf", "Points For"), .init("pa", "Points Against"),
        .init("pfg", "PF per Game"), .init("diff", "Point Differential"), .init("team", "Team"),
    ]
    static let h2h: [BookSortOption] = [
        .init("wins", "Record"), .init("pct", "Win Percentage"), .init("pf", "Points For"), .init("pa", "Points Against"),
        .init("diff", "Point Differential"), .init("team", "Opponent"),
    ]

    /// A column header tapped: the same column flips, a new one starts on its default.
    static func tapped(_ key: String, current: BookSort, defaults: [String: String]) -> BookSort {
        current.key == key
            ? BookSort(key: key, direction: current.ascending ? "desc" : "asc")
            : BookSort(key: key, direction: defaults[key] ?? "desc")
    }
}

extension TeamBadge {
    init(bookFace face: some BookFace, size: CGFloat = 32, corner: CGFloat? = nil) {
        self.init(name: face.currentTeam, icon: face.icon, color: face.color, logo: face.logo, size: size, corner: corner)
    }
}

/// A manager in a row: badge, team, owner (the site's `teamButton`).
struct BookManagerLabel: View {
    let face: any BookFace
    var size: CGFloat = 30
    /// Lines the team name may take: two where its column is narrow.
    var teamLines = 1

    var body: some View {
        HStack(spacing: 10) {
            TeamBadge(name: face.currentTeam, icon: face.icon, color: face.color, logo: face.logo, size: size)
            VStack(alignment: .leading, spacing: 1) {
                Text(face.currentTeam)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(teamLines)
                    .fixedSize(horizontal: false, vertical: true)
                Text(face.name)
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.ink3)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// The small "W–L / 31–33" stat strip under a team on a phone.
struct BookMiniStat: View {
    let label: String
    let value: String
    var color: Color = Theme.ink

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.ink3).textCase(.uppercase)
            Text(value).font(.system(size: 12, weight: .semibold)).foregroundStyle(color).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The sort control in a card head: a menu of columns and the direction
/// button beside it (the site's mobile sort select and its arrow).
struct BookSortControl: View {
    let options: [BookSortOption]
    @Binding var state: BookSort
    let defaults: [String: String]

    /// The button's own label: the menu lists the full names, the button
    /// shows a short one that fits on a line beside the card's title.
    static func short(_ label: String) -> String {
        switch label {
        case "Win Percentage": return "Win %"
        case "Points For": return "PF"
        case "Points Against": return "PA"
        case "PF per Game": return "PF/G"
        case "PA per Game": return "PA/G"
        case "Point Differential": return "Diff"
        default: return label
        }
    }

    var body: some View {
        HStack(spacing: 6) {
            Menu {
                Picker("Sort", selection: Binding(
                    get: { state.key },
                    set: { key in state = BookSort(key: key, direction: defaults[key] ?? "desc") }
                )) {
                    ForEach(options, id: \.key) { Text($0.label).tag($0.key) }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(Self.short(options.first { $0.key == state.key }?.label ?? "Sort"))
                        .font(.system(size: 12.5, weight: .semibold))
                        .lineLimit(1)
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .bold))
                }
                .padding(.horizontal, 2)
                .fixedSize()
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .fixedSize()
            .accessibilityLabel("Sort by")

            Button {
                state = BookSort(key: state.key, direction: state.ascending ? "desc" : "asc")
            } label: {
                Image(systemName: state.ascending ? "arrow.up" : "arrow.down")
                    .font(.system(size: 11, weight: .bold))
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .accessibilityLabel(state.ascending ? "Sort ascending" : "Sort descending")
        }
        .sensoryFeedback(.selection, trigger: state)
    }
}

/// A tappable column header of a wide table, with its arrow when active.
struct BookSortHeader: View {
    let title: String
    let key: String
    @Binding var state: BookSort
    let defaults: [String: String]
    var alignment: Alignment = .trailing

    var body: some View {
        Button {
            withAnimation(.snappy) { state = BookSortOptions.tapped(key, current: state, defaults: defaults) }
        } label: {
            HStack(spacing: 2) {
                Text(title)
                if state.key == key { Text(state.arrow) }
            }
            .font(.system(size: 10.5, weight: .bold))
            .textCase(.uppercase)
            .foregroundStyle(state.key == key ? Theme.accentInk : Theme.ink3)
            .frame(maxWidth: .infinity, alignment: alignment)
        }
        .buttonStyle(.plain)
    }
}

extension Color {
    /// A diff's colour (`.positive` / `.negative`).
    static func bookDiff(_ value: Double) -> Color { value >= 0 ? Theme.green : Theme.red }
}
