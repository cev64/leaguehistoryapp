import Foundation

// What Bridge.office answers (Engine/bridge-office.js): the front office
// (moves.html) as plain data, every number and word already as the site
// writes it.

/// The tabs, and the season each opens on (`Bridge.office.nav`).
struct OfficeNav: Decodable {
    let tabs: [OfficeTab]
    /// tab id -> the season it starts on (0 is ALL).
    let start: [String: Int]
    let hasGames: Bool
    let seasons: Int
    let source: String
    let name: String
}

struct OfficeTab: Decodable, Hashable, Identifiable {
    let id: String
    let label: String
    let short: String?
    var shortLabel: String { short ?? label }
}

/// Everything a tab shows for a season (`Bridge.office.panel`).
struct OfficePanel: Decodable {
    let tab: String
    /// The season shown (0 is ALL): the one asked for, or where the wheel fell back to.
    let year: Int
    let title: String
    let wheel: [RailWeek]
    let cards: [OfficeCard]
    /// The whole tab's message when there's nothing to show.
    let empty: String?
}

struct OfficeCard: Decodable, Identifiable {
    let title: String
    let icon: String
    let meta: String?
    /// rows | items | trades
    let kind: String
    let rows: [OfficeRow]
    let items: [OfficeItem]
    let trades: [OfficeTrade]
    let note: String?
    let empty: String?

    var id: String { title }

    var symbol: String {
        switch icon {
        case "lineup": return "text.alignleft"
        case "trade": return "arrow.left.arrow.right"
        case "wire": return "plus"
        case "pick": return "list.bullet.clipboard"
        case "star": return "star.fill"
        default: return "circle"
        }
    }
}

/// A team as it was in a season (year and teamId set), or a manager across
/// all of them.
struct OfficeWho: Decodable, Hashable {
    let year: Int?
    let teamId: String?
    let ownerId: String
    let name: String
    let sub: String
    let icon: String
    let color: String?
    let logo: String?

    var route: LeagueRoute {
        if let year, let teamId { return .team(year: year, teamId: teamId) }
        return .manager(ownerId: ownerId)
    }
}

/// A ranked team or manager (`.fo-row`).
struct OfficeRow: Decodable, Identifiable {
    let rank: Int
    let who: OfficeWho
    let big: String
    let bigSub: String
    /// good | bad | nil
    let tone: String?
    /// The bar under the row, 0...1 of the best.
    let meter: Double?
    let stats: [OfficeStat]
    /// Draft picks: a line of chips per draft.
    let picks: [OfficePickYear]

    var id: String { "\(rank)-\(who.ownerId)" }
}

struct OfficeStat: Decodable, Hashable {
    let label: String
    let value: String
    let tone: String?
    /// Words after the value ("of 72").
    let tail: String?
}

struct OfficePickYear: Decodable, Hashable, Identifiable {
    let year: Int
    let chips: [OfficeChip]
    var id: Int { year }
}

struct OfficeChip: Decodable, Hashable {
    let round: Int
    let text: String
    /// own | got | lost
    let kind: String
    /// "Own pick", "From <team>", "Traded away"
    let hint: String
}

/// Text in pieces: the site's <em> and .muted, and a player where it names one.
struct OfficeSeg: Decodable, Hashable {
    let t: String
    let em: Bool
    let muted: Bool
    let pid: String?
}

/// A line of what happened, a number at the end (`.fo-item`): a benching,
/// a game the lineup cost, a pickup.
struct OfficeItem: Decodable, Identifiable {
    let title: String
    let tag: String?
    let tagSoft: Bool
    let line: [OfficeSeg]
    let big: String
    let bigSub: String
    let tone: String?
    /// The player the line is about (the benched man, the pickup).
    let pid: String?
    let team: OfficeWho
    let week: Int
    /// For a game the lineup cost: who it was lost to.
    let opponent: String?

    var id: String { "\(team.teamId ?? "")-\(week)-\(pid ?? "")-\(title)" }

    /// Every player the line names, in order, once each.
    var players: [(pid: String, name: String)] {
        var seen = Set<String>(), out: [(String, String)] = []
        if let pid, !title.isEmpty, line.allSatisfy({ $0.pid != pid }) { seen.insert(pid); out.append((pid, title)) }
        for s in line { if let p = s.pid, seen.insert(p).inserted { out.append((p, s.t)) } }
        return out
    }
}

/// A trade, one block per side (`.fo-trade`).
struct OfficeTrade: Decodable, Identifiable {
    let id: String
    let year: Int
    let week: Int
    let head: String
    let verdict: Verdict
    let sides: [Side]

    struct Verdict: Decodable, Hashable {
        let text: String
        let won: Bool
    }

    struct Side: Decodable, Identifiable {
        let who: OfficeWho
        let total: String
        let winner: Bool
        let got: [Got]
        var id: String { who.teamId ?? who.ownerId }
    }

    struct Got: Decodable, Identifiable {
        let label: [OfficeSeg]
        let value: String
        let valueMuted: Bool
        let pid: String?
        var id: String { label.map(\.t).joined() }
    }
}
