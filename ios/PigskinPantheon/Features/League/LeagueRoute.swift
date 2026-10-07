import SwiftUI

/// Every place in a league a screen can link to. Any NavigationStack in a
/// league registers them all (`.leagueDestinations()`), so a team, a player,
/// a manager or a box score opens the same way from wherever it's tapped:
/// pushed onto the stack the person is in.
enum LeagueRoute: Hashable {
    /// A player's whole history in the league (the site's player card).
    case player(id: String)
    /// A team's season: its schedule, results and starters (the site's team drawer).
    case team(year: Int, teamId: String)
    /// A manager's career (the record book's profile).
    case manager(ownerId: String)
    /// One game's box score, both lineups.
    case boxScore(year: Int, week: Int, a: String, b: String)
    /// A season, opened at a week (nil: where the season opens).
    case season(year: Int, week: Int?)
}

extension View {
    /// Registers every league destination on the enclosing NavigationStack.
    func leagueDestinations() -> some View {
        navigationDestination(for: LeagueRoute.self) { route in
            LeagueRouteView(route: route)
        }
    }
}

struct LeagueRouteView: View {
    let route: LeagueRoute

    var body: some View {
        switch route {
        case .player(let id):
            PlayerCardView(playerId: id)
        case .team(let year, let teamId):
            TeamSeasonView(year: year, teamId: teamId)
        case .manager(let ownerId):
            ManagerProfileView(ownerId: ownerId)
        case .boxScore(let year, let week, let a, let b):
            BoxScoreView(year: year, week: week, a: a, b: b)
        case .season(let year, let week):
            SeasonScreen(year: year, initialWeek: week, isPushed: true)
        }
    }
}

/// The sheets a league screen can raise from anywhere.
enum LeagueSheet: String, Identifiable {
    case chat, account
    var id: String { rawValue }
}
