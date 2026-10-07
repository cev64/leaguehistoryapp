import Foundation

/// A league and every season before it, as sleeper.js builds it
/// (`League.load`) and engine-core.js hands it over (`Bridge.load`).
/// Team ids are Sleeper's roster ids as "r<id>", the same on every platform.
struct LeagueSummary: Decodable, Identifiable {
    let leagueId: String
    let name: String
    let avatar: String?
    let platform: String?
    let demo: Bool
    /// The platform's name, for words on screen ("Sleeper", "ESPN").
    let source: String
    let owners: [String: Owner]
    let currentYear: Int?
    let openingYear: Int?
    let nflSeason: Int?
    let nflWeek: Int?
    /// Oldest first.
    let seasons: [Season]

    var id: String { leagueId }

    func season(_ year: Int) -> Season? { seasons.first { $0.year == year } }
    var newest: Season? { seasons.last }
    var opening: Season? { openingYear.flatMap(season) ?? newest }
    /// Newest first, for menus.
    var years: [Int] { seasons.map(\.year).sorted(by: >) }
}

struct Owner: Decodable, Hashable {
    let name: String
    let currentTeam: String
    let icon: String
    let color: String?
    let logo: String?
    let lastYear: Int?
}

struct Season: Decodable, Identifiable {
    let year: Int
    let leagueId: String
    let name: String
    let avatar: String?
    let status: String?
    let finished: Bool
    let live: Bool
    let preseason: Bool
    let unplayed: Bool?
    let settings: SeasonSettings
    let teams: [String: Team]
    /// week -> pairings [[a, b]]
    let schedule: [String: [[String]]]
    /// week -> games with scores (regular season, final weeks only)
    let results: [String: [GameResult]]
    /// week -> team -> "W" / "L" / "T", where the league plays the median
    let medianResults: [String: [String: String]]
    let playedWeeks: [Int]
    let lastFinal: Int
    let postseason: [PostGame]
    let champion: String?
    let runnerUp: String?
    let lastPlace: String?
    let titleGame: PostGame?
    let lastPlaceGame: PostGame?
    /// Regular-season order (seeds), division leaders first.
    let standing: [String]

    var id: Int { year }

    func team(_ id: String?) -> Team? { id.flatMap { teams[$0] } }
    func results(week: Int) -> [GameResult] { results[String(week)] ?? [] }
    func schedule(week: Int) -> [[String]] { schedule[String(week)] ?? [] }
    var teamIds: [String] { teams.keys.sorted { (teams[$0]?.rosterId ?? 0) < (teams[$1]?.rosterId ?? 0) } }
    var lastPlayedWeek: Int { playedWeeks.last ?? 0 }
}

struct SeasonSettings: Decodable {
    let numTeams: Int
    let startWeek: Int
    let regularWeeks: Int
    let playoffWeekStart: Int
    let playoffTeams: Int
    let playoffRoundType: Int
    let playoffType: Int
    let rounds: Int
    let lastWeek: Int
    let median: Bool
    let divisions: [String]
    let rosterPositions: [String]
    let leagueType: Int
    let waiverType: Int
    let waiverBudget: Int
    let draftRounds: Int
    let byes: Int
    let toiletBowl: Bool?
}

struct Team: Decodable, Hashable {
    let rosterId: Int
    let name: String
    let ownerId: String
    let owner: String
    let division: String?
    let logo: String?
    let icon: String
    let wins: Int
    let losses: Int
    let ties: Int
    let pf: Double
    let pa: Double
    let color: String?
    let regularRank: Int?
    let finalRank: Int?

    var record: String { ties > 0 ? "\(wins)–\(losses)–\(ties)" : "\(wins)–\(losses)" }
}

struct GameResult: Decodable, Hashable {
    let a: String
    let `as`: Double
    let b: String
    let bs: Double
}

/// A bracket game, as played or still to be played.
struct PostGame: Decodable, Hashable {
    /// "W" (winners bracket) or "L" (losers / consolation)
    let bracket: String
    let m: Int
    let r: Int
    let p: Int?
    let titlePath: Bool
    let label: String
    let weeks: [Int]
    let week: Int
    let a: String?
    let b: String?
    let aScore: Double?
    let bScore: Double?
    let winner: String?
    let loser: String?
    let advanced: String?
    let played: Bool
    let from: Feed?

    /// Where each side comes from: { w: m } the winner of game m, { l: m } its loser.
    struct Feed: Decodable, Hashable {
        let a: Source?
        let b: Source?
    }
    struct Source: Decodable, Hashable {
        let w: Int?
        let l: Int?
    }
}

/// Any JSON, for answers the app passes along without reading closely.
enum JSONValue: Decodable, Hashable {
    case null, bool(Bool), number(Double), string(String), array([JSONValue]), object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    var string: String? { if case .string(let s) = self { return s }; return nil }
    var number: Double? { if case .number(let n) = self { return n }; return nil }
    subscript(key: String) -> JSONValue? { if case .object(let o) = self { return o[key] }; return nil }
}
