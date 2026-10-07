import Foundation

// What Bridge.recap answers (Engine/bridge-recap.js): the week's recap, a
// game's box score and a team's season, as season.html draws them.

/// A player as the recap names him: tappable to his card.
struct RecapPlayer: Decodable, Hashable {
    let id: String
    let name: String
    let pos: String
    let nfl: String
    let pts: Double
    let teamId: String?
}

/// The week in review (`Bridge.recap.week`): recapHtml's sections, in order.
struct WeekRecap: Decodable {
    let year: Int
    let week: Int
    let league: String
    let playoff: Bool
    let hasBox: Bool
    let lead: Lead
    let games: [Game]
    let power: Power?
    let tiles: [Tile]
    let players: Players?
    let office: [OfficeItem]
    let race: Race?
    let next: Next?
    /// recapText: the recap for a group chat.
    let text: String
    /// What recapImages draws.
    let share: ShareData

    struct Lead: Decodable {
        let kicker: String
        let title: String?
        let dek: String?
        let also: [String]
    }

    struct Game: Decodable, Hashable {
        let a: String
        let `as`: Double
        let b: String
        let bs: Double
        let w: String
        let l: String
        let ws: Double
        let ls: Double
        let tie: Bool
        let label: String
        let aWon: Bool
        let bWon: Bool
        let line: String
        let notes: [String]
        let stars: [RecapPlayer]
    }

    struct Power: Decodable {
        let meta: String
        let rows: [Row]
        let foot: String
        struct Row: Decodable, Hashable {
            let id: String
            let rank: Int
            let move: Int
            let record: String
            let apRecord: String
            let pfg: String
            let bar: Double
        }
    }

    struct Tile: Decodable, Hashable {
        let label: String
        let title: String
        let detail: String
        let teamId: String?
    }

    struct Players: Decodable {
        let mvp: RecapPlayer
        let mvpFor: String
        let items: [Item]
        struct Item: Decodable, Hashable {
            let tag: String
            /// "", "soft" or "bad"
            let tone: String
            let player: RecapPlayer
            let note: String
            let pts: Double
        }
    }

    struct OfficeItem: Decodable, Hashable {
        let tag: String
        let tone: String
        let lines: [Line]
        struct Line: Decodable, Hashable {
            let teamId: String?
            let text: String
        }
    }

    struct Race: Decodable {
        let meta: String
        let seeds: [Seed]
        let foot: String?
        let stakes: [Stake]
        struct Stake: Decodable, Hashable { let id: String; let lines: [String] }
        struct Seed: Decodable, Hashable {
            let id: String
            let seed: Int
            let record: String
            let flag: String
            let `in`: Bool
            let cut: Bool
        }
    }

    struct Next: Decodable {
        let week: Int
        let title: String
        let gotw: GameOfWeek?
        let games: [Pair]
        struct GameOfWeek: Decodable {
            let a: String
            let b: String
            let aNote: String
            let bNote: String
            let series: String
        }
        struct Pair: Decodable, Hashable {
            let a: String
            let b: String
            let sa: String
            let sb: String
        }
    }

    struct ShareData: Decodable {
        let league: String
        let host: String
        let title: String
        let fileBase: String
        let week: WeekSheet
        let table: TableSheet?
    }

    struct ShareTile: Decodable, Hashable {
        let label: String
        let title: String
        let detail: String
    }

    struct WeekSheet: Decodable {
        let kicker: String
        let title: String
        let headline: Headline?
        let also: [String]
        let games: [SheetGame]
        let tiles: [ShareTile]
        struct Headline: Decodable { let title: String; let dek: String }
        struct SheetGame: Decodable, Hashable {
            let w: String
            let ws: Double
            let l: String
            let ls: Double
            let tie: Bool
            let note: String
        }
    }

    struct TableSheet: Decodable {
        let kicker: String
        let title: String
        let rows: [Row]
        let tiles: [ShareTile]
        let foot: String
        struct Row: Decodable, Hashable {
            let id: String
            let rank: Int
            let move: Int
            let record: String
            let apRecord: String
            let bar: Double
        }
    }
}

/// One game's box score (`Bridge.recap.box`), the columns in the order asked.
struct BoxScore: Decodable {
    let year: Int
    let week: Int
    let title: String
    let sub: String
    let a: Side
    let b: Side
    let groups: [Group]
    let foot: String

    struct Side: Decodable { let id: String; let score: Double }
    struct Group: Decodable, Identifiable {
        let label: String
        let rows: [Row]
        var id: String { label }
    }
    struct Row: Decodable {
        let slot: String
        let l: BoxPlayer?
        let r: BoxPlayer?
    }
}

struct BoxPlayer: Decodable, Hashable {
    let id: String
    let name: String
    let short: String
    let pos: String
    let nfl: String
    let pts: Double
    let proj: Double?
    let injury: String?
}

/// A team's season (`Bridge.recap.team`): the site's team drawer.
struct TeamSeason: Decodable {
    let year: Int
    let teamId: String
    let ownerId: String
    let yearLine: String
    let name: String
    let ownerLine: String
    let stats: [Stat]
    let schedule: [ScheduleItem]
    let post: [ScheduleItem]
    let postTitle: String
    let boxWeeks: [Int]
    let roster: Roster?

    struct Stat: Decodable, Hashable { let label: String; let value: String }

    struct ScheduleItem: Decodable, Hashable, Identifiable {
        let week: Int
        let label: String
        let opponent: String
        let teamScore: Double?
        let oppScore: Double?
        /// "W", "L", "T", or nil before it's played.
        let result: String?
        let played: Bool
        var id: String { "\(week)-\(label)-\(opponent)" }
    }

    struct Roster: Decodable {
        let regularWeeks: Int
        let weeks: [Int]
        let count: String
        let players: [Player]
    }

    struct Player: Decodable, Identifiable {
        let id: String
        let name: String
        let pos: String
        let clubs: [String]
        let starts: Int
        let pts: Double
        let cells: [Cell]
    }

    struct Cell: Decodable, Hashable {
        let w: Int
        /// "start", "bench", "empty" (not on the team), "none" (no game), "future"
        let kind: String
        let fill: Double?
        let pts: Double?
        let club: String?
        let title: String
    }
}
