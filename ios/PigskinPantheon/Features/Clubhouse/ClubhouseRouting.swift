import SwiftUI

// A tapped notification's way to its week (ClubhouseRouter): three steps,
// each where the state it moves lives.

extension View {
    /// RootView: opens the notification's league, unless it's the one open.
    func clubhouseLinks() -> some View { modifier(ClubhouseLinkOpener()) }

    /// A league's tabs: to the season tab (or the sidebar's season), at its root.
    func clubhouseTabLinks(session: LeagueSession, tab: Binding<LeagueTab>, seasonPath: Binding<NavigationPath>) -> some View {
        modifier(ClubhouseTabLinks(session: session, tab: tab, seasonPath: seasonPath))
    }

    /// The season screen: to the week and its view.
    func clubhouseWeekLinks(session: LeagueSession, store: SeasonStore) -> some View {
        modifier(ClubhouseWeekLinks(session: session, store: store))
    }
}

private struct ClubhouseLinkOpener: ViewModifier {
    @Environment(AppModel.self) private var app
    @State private var router = ClubhouseRouter.shared

    func body(content: Content) -> some View {
        content.onChange(of: router.pending, initial: true) { _, link in
            guard let link else { return }
            if let league = app.league, ClubhouseRouter.matches(link, league) { return }
            app.open(link.league)
        }
    }
}

private struct ClubhouseTabLinks: ViewModifier {
    @Environment(\.horizontalSizeClass) private var sizeClass
    let session: LeagueSession
    @Binding var tab: LeagueTab
    @Binding var seasonPath: NavigationPath
    @State private var router = ClubhouseRouter.shared

    func body(content: Content) -> some View {
        content.onChange(of: router.pending, initial: true) { _, link in
            guard let link, ClubhouseRouter.matches(link, session) else { return }
            if let year = link.season, session.summary?.season(year) != nil { session.year = year }
            seasonPath = NavigationPath()
            session.sheet = nil
            tab = sizeClass == .regular ? .year(session.year) : .season
        }
    }
}

private struct ClubhouseWeekLinks: ViewModifier {
    let session: LeagueSession
    let store: SeasonStore
    @State private var router = ClubhouseRouter.shared

    func body(content: Content) -> some View {
        content
            .onChange(of: router.pending, initial: true) { follow() }
            .onChange(of: store.info == nil) { follow() }
    }

    private func follow() {
        guard let link = router.pending, ClubhouseRouter.matches(link, session), store.info != nil,
              link.season == nil || link.season == store.year else { return }
        router.finish(link)
        if let view = link.view { store.view = view }
        if let week = link.week { store.select(week: week) }
    }
}
