import Foundation

// What Bridge.clubhouse answers (Engine/bridge-clubhouse.js), worked out by
// the site's clubhouse.js from the league's results and the boards the app
// fetched (or, in the demo, made up on the device).

/// The league's clubhouse name and the managers who can be claimed
/// (`Bridge.clubhouse.info`).
struct ClubhouseInfo: Decodable {
    /// The league's lasting name in the database; nil for the demo.
    let key: String?
    let source: String
    let demo: Bool
    /// The newest season's league id (claim_manager's p_current_league_id).
    let leagueId: String
    /// The newest season's year.
    let season: Int?
    /// The week the newest season's picks are open for.
    let pickWeek: Int?
    let name: String
    let managers: [ClubhouseManager]
}

struct ClubhouseManager: Decodable, Hashable, Identifiable {
    let owner: String
    let team: String
    let name: String
    let manager: String
    let claimable: Bool
    var id: String { owner }
}

/// One week of pick'em (`Bridge.clubhouse.week`).
struct PickemWeek: Decodable, Equatable {
    let year: Int
    let week: Int
    let final: Bool
    /// The pick week, still before its lock.
    let open: Bool
    let locked: Bool
    /// When it locks (ISO 8601).
    let deadline: String
    let games: [Game]
    /// Everyone who picked the week, best first.
    let rows: [Row]
    /// The week's winners (owner ids), once it's final.
    let best: [String]
    /// Who has picked (owner ids).
    let picked: [String]
    /// How many members the league's clubhouse has.
    let members: Int
    let me: String?

    struct Game: Decodable, Hashable, Identifiable {
        let a: String
        let b: String
        let key: String
        let ar: String
        let br: String
        /// The winner's team id, "tie", or nil while it's to be played.
        let result: String?
        /// Team id → the owners who picked it (others' only once locked).
        let picks: [String: [String]]
        /// The owners who made this game their Lock of the Week.
        let locks: [String]
        let mine: String?
        let myLock: Bool
        var id: String { key }
    }

    struct Row: Decodable, Hashable, Identifiable {
        let owner: String
        let correct: Int
        let wrong: Int
        let points: Int
        let picked: Int
        var id: String { owner }
    }

    var deadlineDate: Date? { AccountStore.parseDate(deadline) }
}

/// The season's pick'em standings (`Bridge.clubhouse.grade`).
struct PickemStandings: Decodable, Equatable {
    let rows: [Row]
    let weeks: [Week]
    let members: [String]
    let me: String?

    struct Row: Decodable, Hashable, Identifiable {
        let owner: String
        let team: String?
        let correct: Int
        let wrong: Int
        let points: Int
        let picked: Int
        let perfect: Int
        let weeksWon: Int
        let streak: Int
        let rank: Int
        var id: String { owner }
    }

    struct Week: Decodable, Hashable, Identifiable {
        let week: Int
        let final: Bool
        let games: Int
        let best: [String]
        let rows: [PickemWeek.Row]
        var id: Int { week }
    }
}

/// One week's awards (`Bridge.clubhouse.awards`).
struct AwardsWeek: Decodable, Equatable {
    let week: Int
    /// Whether the Recap draws the card: a played regular-season week,
    /// while voting is open, or once closed if anyone voted.
    let show: Bool
    /// Voting is over (or never opened): the winners, not the ballot.
    let closed: Bool
    /// When voting closes (ISO 8601): the next week's first kickoff.
    let closes: String
    let awards: [Award]

    struct Award: Decodable, Hashable, Identifiable {
        let id: String
        let title: String
        let short: String
        let blurb: String
        let emoji: String
        let nominees: [Nominee]
        /// The member's own vote (a team id).
        let mine: String?
        /// How many have voted.
        let voters: Int
        /// Every nominee's votes, most first (once closed).
        let tally: [Tally]
        let winners: [String]
    }

    struct Nominee: Decodable, Hashable {
        let team: String
        let reason: String
    }

    struct Tally: Decodable, Hashable {
        let nominee: String
        let votes: Int
    }

    var closesDate: Date? { AccountStore.parseDate(closes) }
}

/// A closed week's winners (`Bridge.clubhouse.seasonAwards`).
struct SeasonAwardWeek: Decodable, Hashable, Identifiable {
    let week: Int
    let awards: [Winner]
    var id: Int { week }

    struct Winner: Decodable, Hashable, Identifiable {
        let id: String
        let title: String
        let short: String
        let emoji: String
        let winners: [String]
        let votes: Int
    }
}

/// The demo league's boards, as the database would answer them, in JSON.
struct ClubhouseDemoBoards: Decodable {
    let pickem: String
    let awards: String
}

/// What "Share the week" draws (`Bridge.clubhouse.share`).
struct WeekShareData: Decodable {
    let league: String
    let year: Int
    let week: Int
    let title: String
    let kicker: String
    let high: Score?
    let low: Score?
    let blowout: Margin?
    let closest: Margin?
    let standings: [Standing]
    let riser: Mover?
    let faller: Mover?
    let blunder: Blunder?
    let pickWinner: PickWinner?
    let awards: [AwardWinner]?
    let host: String

    struct Score: Decodable { let team: String; let score: String }
    struct Margin: Decodable { let winner: String; let loser: String; let margin: String }
    struct Standing: Decodable, Hashable { let team: String; let rank: Int; let record: String; let move: Int }
    struct Mover: Decodable { let team: String; let move: Int; let rank: Int }
    struct Blunder: Decodable { let team: String; let benched: String; let pts: String; let costGame: Bool; let started: String? }
    struct PickWinner: Decodable { let teams: [String]; let points: Int; let correct: Int; let games: Int }
    struct AwardWinner: Decodable, Hashable { let id: String; let title: String; let emoji: String; let teams: [String] }
}

/// What league_claims and claim_manager answer.
struct ClubhouseClaims: Decodable {
    let claimed: [String]
    let mine: Mine?

    struct Mine: Decodable, Equatable {
        let owner_id: String
        let notify_recap: Bool
        let notify_pickem: Bool
        let notify_awards: Bool
    }
}

/// A league the member has claimed a manager in (my_clubhouses).
struct MyClubhouse: Decodable, Identifiable, Hashable {
    let league_key: String
    let owner_id: String
    let notify_recap: Bool
    let notify_pickem: Bool
    let notify_awards: Bool
    let name: String?
    var id: String { league_key }
}

/// Which of a league's notifications the member wants.
struct ClubhouseNotify: Equatable {
    var recap: Bool
    var pickem: Bool
    var awards: Bool

    var any: Bool { recap || pickem || awards }

    static let off = ClubhouseNotify(recap: false, pickem: false, awards: false)
}
