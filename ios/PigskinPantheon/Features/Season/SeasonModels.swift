import Foundation

// What Bridge.season answers (Engine/bridge-season.js).

/// A season's shape and its week rail (`Bridge.season.info`).
struct SeasonInfo: Decodable {
    let year: Int
    let finished: Bool
    let regularWeeks: Int
    let playoffTeams: Int
    let byes: Int
    let median: Bool
    let hasPlayoffs: Bool
    let hasDivisions: Bool
    let hasBracket: Bool
    let divisionNames: [String]
    let lastWeek: Int
    let latestWeek: Int
    let lastPlayedWeek: Int
    let priorYear: Int?
    let tieRule: String
    /// The views of week 0 (the season overview).
    let seasonViews: [SeasonViewTab]
    let homeView: String
    /// Where the season opens: a live season on its latest week, a finished
    /// one on its final standings (week 0).
    let start: Start
    let weeks: [RailWeek]
    let source: String

    struct Start: Decodable {
        let week: Int
        let view: String
    }
}

/// One of a week's views. The ids are the site's panel ids:
/// panel-results, panel-standings, panel-picture, panel-playoffs,
/// panel-recap, panel-sos, and for a finished season's overview
/// regular, final and bracket.
struct SeasonViewTab: Decodable, Hashable, Identifiable {
    let id: String
    let label: String
    let short: String?

    var shortLabel: String { short ?? label }
}

/// A ring on the week rail.
struct RailWeek: Decodable, Hashable, Identifiable {
    let w: Int
    let played: Bool
    let playoff: Bool
    let now: Bool
    let num: String
    let label: String
    var id: Int { w }
}

/// Everything one week shows (`Bridge.season.week`).
struct WeekPayload: Decodable {
    let year: Int
    let week: Int
    let title: String
    let views: [SeasonViewTab]
    let played: Bool
    let playoff: Bool
    /// The week the standings and picture are read from (the latest one
    /// played on or before this one).
    let asOf: Int
    /// Played games: the regular season's, or a playoff week's.
    let games: [WeekGame]
    /// A week still to come: its pairings, with records going in.
    let matchups: [Matchup]
    let picture: Picture
    /// Next week's playoff scenarios ("clinches with a win…").
    let scenarios: Scenarios?
    let superlatives: WeekSuperlatives?
}

struct WeekGame: Decodable, Hashable {
    let a: String
    let `as`: Double?
    let b: String
    let bs: Double?
    let label: String
}

struct Matchup: Decodable, Hashable {
    let a: String
    let b: String
    let ar: String
    let br: String
}

/// The standings and playoff picture after a week (season-engine's buildPicture).
struct Picture: Decodable {
    let week: Int
    let stats: [String: StatLine]
    /// Division (or "Standings") -> team ids in order.
    let divisions: [String: [String]]
    let seeds: [String]
    let leaders: [String]
    let seedLabels: [String: SeedLabel]
    /// "z" (bye / division), "x" (berth), "e" (eliminated), or null.
    let flags: [String: String?]
    let reasons: [String: [TieReason]]
    let playoffField: [String]
    let firstOut: String?

    func flag(_ id: String) -> String? { flags[id] ?? nil }
}

struct StatLine: Decodable, Hashable {
    let wins: Int
    let losses: Int
    let ties: Int
    let gp: Int
    let pf: Double
    let pa: Double
    let pct: Double
    let score: Double
    let record: String
    let divRecord: String
    let pfg: Double
    let pag: Double
    let diff: Double
    let form: [String]
    let gamesLeft: Int
}

struct SeedLabel: Decodable, Hashable {
    let chip: String
    /// "div", "wc" or "out"
    let kind: String
    let lead: Bool?
    let note: String
}

struct TieReason: Decodable, Hashable {
    let race: String
    let criterion: String
    let detail: String
    let over: String?
    let under: String?
    let note: String?
}

struct Scenarios: Decodable {
    let week: Int
    let rows: [Row]
    struct Row: Decodable, Hashable {
        let id: String
        let lines: [String]
    }
}

struct WeekSuperlatives: Decodable {
    struct Score: Decodable { let id: String; let score: Double }
    struct Margin: Decodable { let winner: String; let loser: String; let margin: Double }
    let high: Score
    let low: Score
    let blowout: Margin
    let closest: Margin
    let average: Double
    let total: Double
}

/// The week's costliest benching (`Bridge.season.blunder`).
struct WeekBlunder: Decodable {
    struct Player: Decodable { let pid: String; let name: String; let pts: Double }
    let perfect: Bool
    let teamId: String?
    let benched: Player?
    let started: Player?
    let costGame: Bool?
}

/// A week of the season's schedule (`Bridge.season.schedule`).
struct ScheduleWeek: Decodable, Identifiable {
    struct Pair: Decodable, Hashable { let a: String; let b: String }
    let week: Int
    let played: Bool
    let games: [Pair]
    var id: Int { week }
}
