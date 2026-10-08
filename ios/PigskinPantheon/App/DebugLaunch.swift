import Foundation

/// Launch settings for opening the app straight onto a screen, for
/// screenshots and checks without tapping through:
///
///   SIMCTL_CHILD_PP_LEAGUE=demo            open a league
///   SIMCTL_CHILD_PP_TAB=records            season | records | office | trophy | search
///   SIMCTL_CHILD_PP_ROUTE=player:4046      pushed onto that tab's stack; also
///                                          team:<year>:<teamId>, manager:<ownerId>,
///                                          box:<year>:<week>:<a>:<b>, season:<year>:<week>
///   SIMCTL_CHILD_PP_WEEK=9                 the season screen's week
///   SIMCTL_CHILD_PP_VIEW=panel-standings   the season screen's view (a panel id)
///   SIMCTL_CHILD_PP_SHEET=chat             chat | account
///
/// e.g. SIMCTL_CHILD_PP_LEAGUE=demo xcrun simctl launch <device> com.pigskinpantheon.app
enum DebugLaunch {
    /// Read in debug builds only, so a release build always opens normally.
    private static let env: [String: String] = {
        #if DEBUG
        return ProcessInfo.processInfo.environment
        #else
        return [:]
        #endif
    }()

    static var league: String? { env["PP_LEAGUE"] }

    static var tab: LeagueTab? {
        switch env["PP_TAB"] {
        case "season": return .season
        case "records": return .records
        case "office": return .office
        case "trophy": return .trophy
        case "search": return .search
        case let raw?: return Int(raw).map { .year($0) }   // a season, in the wide layout
        default: return nil
        }
    }

    static var week: Int? { env["PP_WEEK"].flatMap(Int.init) }
    static var view: String? { env["PP_VIEW"] }
    /// SIMCTL_CHILD_PP_RAIL=1 draws the side rail whatever the screen's shape.
    static var forceSideRail: Bool { env["PP_RAIL"] == "1" }
    /// SIMCTL_CHILD_PP_SIDEBAR=hidden opens the wide layout with its sidebar folded.
    static var sidebarHidden: Bool { env["PP_SIDEBAR"] == "hidden" }
    static var sheet: LeagueSheet? { env["PP_SHEET"].flatMap(LeagueSheet.init(rawValue:)) }

    /// The route to push on a tab's stack at launch, if it's that tab's.
    static func routes(for tab: LeagueTab) -> [LeagueRoute] {
        guard (self.tab ?? .season) == tab, let raw = env["PP_ROUTE"] else { return [] }
        let p = raw.split(separator: ":").map(String.init)
        switch p.first {
        case "player" where p.count >= 2: return [.player(id: p[1])]
        case "team" where p.count >= 3: return Int(p[1]).map { [.team(year: $0, teamId: p[2])] } ?? []
        case "manager" where p.count >= 2: return [.manager(ownerId: p[1])]
        case "box" where p.count >= 5:
            guard let y = Int(p[1]), let w = Int(p[2]) else { return [] }
            return [.boxScore(year: y, week: w, a: p[3], b: p[4])]
        case "season" where p.count >= 2: return Int(p[1]).map { [.season(year: $0, week: p.count > 2 ? Int(p[2]) : nil)] } ?? []
        default: return []
        }
    }
}
