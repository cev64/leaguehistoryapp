import Foundation
import UIKit

/// The trophy room as `Bridge.trophy.hall()` answers it (bridge-trophy.js):
/// trophy/accolades.js's wings and exhibits, the rail they stand on, and a
/// team locker for every manager. Plain data; the hall is sculpted natively.
struct TrophyHall: Decodable {
    let name: String
    /// ownerId -> the team's logo (an http URL, or a data: URL for the demo).
    let logos: [String: String]
    let wings: [TrophyWing]
    /// Every exhibit, in walking order across every wing.
    let rail: [TrophyExhibit]
    let lockers: [String: TrophyLocker]
    let summary: TrophySummary
}

struct TrophyWing: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let kicker: String
    let accent: String
    let blurb: String
    /// Rail index of the wing's first exhibit.
    let start: Int
    let count: Int
}

struct TrophySummary: Decodable, Hashable {
    let seasons: Int
    let firstYear: Int
    let lastYear: Int
    let managers: Int
    let titles: Int
    let games: Int

    /// The site's line under the wing chips.
    var line: String {
        "\(titles) titles · \(managers) managers · \(seasons) seasons on record · \(games) games played"
    }
}

struct TrophyStat: Decodable, Hashable {
    let label: String
    let value: String
}

/// A link on an exhibit's record. The bridge writes the site's two pages as
/// app routes: "season:<year>" and "manager:<ownerId>".
struct TrophyLink: Decodable, Hashable {
    let label: String
    let href: String

    var route: LeagueRoute? {
        if href.hasPrefix("season:"), let year = Int(href.dropFirst(7)) { return .season(year: year, week: nil) }
        if href.hasPrefix("manager:") { return .manager(ownerId: String(href.dropFirst(8))) }
        return nil
    }
}

/// One holder of a shared mark: their crest goes on the plaque beside the others.
struct TrophyHolder: Decodable, Hashable {
    let ownerId: String?
    let color: String?
    let icon: String?
    let name: String?
}

/// One thing on a pedestal: a cup, a hall-of-fame shield, a record plaque or
/// the cellar's throne (`kind`: cup, pillar, plaque, toilet).
struct TrophyExhibit: Decodable, Identifiable, Hashable {
    let id: String
    let kind: String
    let year: Int?
    let title: String
    let subtitle: String?
    let owner: String?
    let ownerId: String?
    let icon: String?
    let color: String?
    let plate: String?
    let blurb: String?
    let stats: [TrophyStat]
    let links: [TrophyLink]
    let rings: Int?
    let tarnished: Bool?
    let bigValue: String?
    let meta: String?
    let holders: [TrophyHolder]?
    let wing: String
    let wingName: String
    let accent: String
    let wingIndex: Int
    let itemIndex: Int
    let railIndex: Int

    var tint: String { color ?? "#304f91" }
    var isTarnished: Bool { tarnished ?? false }
    /// A hall-of-fame shield is a door to its manager's locker.
    var opensLocker: Bool { wing == "hall" && ownerId != nil }
}

/// One manager's locker: their flag, their berths, trophies and bests.
struct TrophyLocker: Decodable, Identifiable, Hashable {
    let ownerId: String
    let name: String
    let team: String
    let icon: String?
    let color: String?
    let summary: String
    let titles: [Int]
    let wall: LockerWall

    var id: String { ownerId }
    var tint: String { color ?? "#304f91" }
}

struct LockerWall: Decodable, Hashable {
    let flag: LockerMeta
    let since: Int?
    /// One per playoff berth (with that season's star and ribbon pinned to
    /// it), then any honour whose season never reached the bracket.
    let pennants: [LockerPiece]
    let trophies: [LockerPiece]
    let plaques: [LockerPiece]
}

/// A piece of a locker wall: pennant, star, ribbon, title (a league trophy),
/// bowl (silver or bronze) or plaque.
struct LockerPiece: Decodable, Hashable {
    let kind: String
    let year: Int?
    let division: Bool?
    let badges: [LockerBadge]?
    let metal: String?
    let place: Int?
    let bigValue: String?
    /// A plaque's small line ("Week 14 · 2025").
    let line: String?
    let meta: LockerMeta
}

/// A star (side -1, left post) or ribbon (side 1, right post) pinned to a pennant.
struct LockerBadge: Decodable, Hashable {
    let side: Int
    let piece: LockerHonour
}

struct LockerHonour: Decodable, Hashable {
    let kind: String
    let year: Int?
    let meta: LockerMeta
}

/// The words a locker piece says when it is tapped.
struct LockerMeta: Decodable, Hashable {
    let id: String
    let kind: String
    let title: String
    let subtitle: String?
    let blurb: String?
    let stats: [TrophyStat]
    let links: [TrophyLink]
    let meta: String?
}

/// What the record sheet shows for whatever is being inspected (the site's
/// fillSheet), for an exhibit and for a piece of a locker alike.
struct TrophyRecord: Hashable {
    var kicker: String
    var accent: String
    var title: String
    var lead: String
    var rest: String?
    var blurb: String
    var stats: [TrophyStat]
    var links: [TrophyLink]
    /// Extra native links (the team's season), opened as league routes.
    var routes: [RouteLink] = []

    struct RouteLink: Hashable {
        let label: String
        let route: LeagueRoute
    }

    init(exhibit item: TrophyExhibit) {
        kicker = item.wingName
        accent = item.accent
        if item.kind == "plaque" {
            title = item.bigValue ?? item.title
            lead = item.title
            rest = item.subtitle
        } else {
            title = item.title
            lead = item.subtitle ?? ""
            rest = (item.owner != nil && item.owner != item.subtitle) ? item.owner : nil
        }
        blurb = item.blurb ?? ""
        stats = item.stats
        links = item.links
    }

    init(locker: TrophyLocker, meta: LockerMeta) {
        kicker = locker.team
        accent = locker.tint
        if meta.kind == "plaque" {
            title = meta.subtitle ?? meta.title
            lead = meta.title
            rest = meta.meta
        } else {
            title = meta.title
            lead = meta.subtitle ?? ""
            rest = nil
        }
        blurb = meta.blurb ?? ""
        stats = meta.stats
        links = meta.links
    }
}

// MARK: Colours

extension UIColor {
    /// "#304f91" (or "#3a5") as the engine writes team colours.
    convenience init(trophyHex css: String?, fallback: UInt32 = 0x304F91) {
        var value = fallback
        if let css, css.hasPrefix("#") {
            var hex = String(css.dropFirst())
            if hex.count == 3 { hex = hex.map { "\($0)\($0)" }.joined() }
            if let v = UInt32(hex.prefix(6), radix: 16) { value = v }
        }
        self.init(red: CGFloat((value >> 16) & 0xFF) / 255,
                  green: CGFloat((value >> 8) & 0xFF) / 255,
                  blue: CGFloat(value & 0xFF) / 255, alpha: 1)
    }

    convenience init(trophyRGB value: UInt32, alpha: CGFloat = 1) {
        self.init(red: CGFloat((value >> 16) & 0xFF) / 255,
                  green: CGFloat((value >> 8) & 0xFF) / 255,
                  blue: CGFloat(value & 0xFF) / 255, alpha: alpha)
    }

    /// textures.js `mix`: a toward b by t.
    func mixed(with other: UIColor, _ t: CGFloat) -> UIColor {
        var r1: CGFloat = 0, g1: CGFloat = 0, b1: CGFloat = 0, a1: CGFloat = 0
        var r2: CGFloat = 0, g2: CGFloat = 0, b2: CGFloat = 0, a2: CGFloat = 0
        getRed(&r1, green: &g1, blue: &b1, alpha: &a1)
        other.getRed(&r2, green: &g2, blue: &b2, alpha: &a2)
        return UIColor(red: r1 + (r2 - r1) * t, green: g1 + (g2 - g1) * t, blue: b1 + (b2 - b1) * t, alpha: a1 + (a2 - a1) * t)
    }

    func scaled(_ k: CGFloat) -> UIColor {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        getRed(&r, green: &g, blue: &b, alpha: &a)
        return UIColor(red: min(1, r * k), green: min(1, g * k), blue: min(1, b * k), alpha: a)
    }

    func withAlpha(_ a: CGFloat) -> UIColor { withAlphaComponent(a) }
}

// MARK: Launch settings

/// Opening the trophy room at a given place, for screenshots and checks:
///
///   SIMCTL_CHILD_PP_TROPHY=wing:records          walk to a wing
///   SIMCTL_CHILD_PP_TROPHY=champ-2025            walk to an exhibit
///   SIMCTL_CHILD_PP_TROPHY=focus:rec-high-week   inspect an exhibit
///   SIMCTL_CHILD_PP_TROPHY=focus:champ-2025:link …and follow its record's first link
///   SIMCTL_CHILD_PP_TROPHY=locker:<ownerId>      open a manager's locker
///   SIMCTL_CHILD_PP_TROPHY=locker:<ownerId>:3    …and inspect its fourth piece
///   SIMCTL_CHILD_PP_TROPHY=locker:<ownerId>:back …and go back to the hall
///   SIMCTL_CHILD_PP_TROPHY_LAYOUT=corridor|shaft force the hall's shape
enum TrophyLaunch {
    static var target: String? { ProcessInfo.processInfo.environment["PP_TROPHY"] }
    static var layout: String? { ProcessInfo.processInfo.environment["PP_TROPHY_LAYOUT"] }
}
