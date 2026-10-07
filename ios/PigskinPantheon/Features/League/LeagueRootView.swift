import SwiftUI

/// The tabs of a league, as the site's pages: the season, the record book,
/// the front office, the trophy room, and player search.
enum LeagueTab: Hashable {
    /// The season screen on a phone (its own season menu picks the year).
    case season
    /// One season in the sidebar of a wide screen.
    case year(Int)
    case records
    case office
    case trophy
    case search
}

/// A league, once opened. On a phone (and the folded iPhone Duo) it's a tab
/// bar of Liquid Glass; on a wide screen (the unfolded Duo, an iPad) the same
/// tabs become a sidebar that also lists every season, like the site's
/// desktop layout with its league panel down the left.
struct LeagueRootView: View {
    @Environment(AppModel.self) private var app
    @Bindable var session: LeagueSession

    var body: some View {
        Group {
            switch session.phase {
            case .loading(let done, let total):
                LeagueLoadingView(session: session, done: done, total: total)
            case .failed(let message):
                LeagueFailedView(session: session, message: message)
            case .ready:
                if let summary = session.summary {
                    LeagueTabs(session: session, summary: summary)
                }
            }
        }
        .environment(session)
        // the league is read and open; or it couldn't be
        .sensoryFeedback(trigger: session.phase) { _, phase in
            switch phase {
            case .ready: return .success
            case .failed: return .error
            case .loading: return nil
            }
        }
        .sheet(item: $session.sheet) { sheet in
            switch sheet {
            case .chat:
                ChatScreen()
                    .environment(session)
                    .environment(app)
            case .account:
                AccountScreen()
                    .environment(app)
            }
        }
    }
}

private struct LeagueTabs: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Bindable var session: LeagueSession
    let summary: LeagueSummary
    @State private var tab: LeagueTab = DebugLaunch.tab ?? .season
    @State private var seasonPath = NavigationPath(DebugLaunch.routes(for: .season))
    @State private var recordsPath = NavigationPath(DebugLaunch.routes(for: .records))
    @State private var officePath = NavigationPath(DebugLaunch.routes(for: .office))
    @State private var searchPath = NavigationPath(DebugLaunch.routes(for: .search))
    /// The season screen's week wheel, which tucks into the tab bar.
    @State private var wheel = WeekWheelState()

    var body: some View {
        Group {
            if sizeClass == .regular {
                // An iPad, the unfolded Duo, a large iPhone sideways: the
                // league's sidebar, always open, like the site's desktop panel.
                WideLeagueLayout(session: session, summary: summary, tab: $tab)
            } else {
                GeometryReader { geometry in
                    let rail = SideRailLayout.applies(sizeClass: sizeClass, size: geometry.size)
                    HStack(spacing: 0) {
                        if rail {
                            SideRail(tab: $tab)
                                .transition(.move(edge: .leading).combined(with: .opacity))
                        }
                        tabs(rail: rail)
                            .environment(\.sideRail, rail)
                    }
                    .animation(.smooth(duration: 0.3), value: rail)
                }
            }
        }
        .onAppear {
            adapt(to: sizeClass)
            if let sheet = DebugLaunch.sheet { session.sheet = sheet }
        }
        .onChange(of: sizeClass) { _, new in adapt(to: new) }
        // a tick for each tab, rail item or sidebar row chosen
        .sensoryFeedback(.selection, trigger: tab)
        .onChange(of: tab) { _, new in
            if case .year(let y) = new { session.year = y }
        }
    }

    /// A phone's tabs: a Liquid Glass tab bar, or a side rail when the
    /// screen is wide and short. The tabs show their icons only, which
    /// keeps the bar clean; each still has its name for VoiceOver.
    private func tabs(rail: Bool) -> some View {
        TabView(selection: $tab) {
            Tab(value: LeagueTab.season) {
                NavigationStack(path: $seasonPath) {
                    SeasonScreen(year: nil)
                        .leagueDestinations()
                }
                .environment(\.leagueTab, .season)
                .sideRailHidesTabBar(rail)
            } label: {
                TabIcon("Season", "calendar")
            }

            Tab(value: LeagueTab.records) {
                NavigationStack(path: $recordsPath) {
                    RecordBookScreen()
                        .leagueDestinations()
                }
                .environment(\.leagueTab, .records)
                .sideRailHidesTabBar(rail)
            } label: {
                TabIcon("Record Book", "book.closed")
            }

            Tab(value: LeagueTab.office) {
                NavigationStack(path: $officePath) {
                    FrontOfficeScreen()
                        .leagueDestinations()
                }
                .environment(\.leagueTab, .office)
                .sideRailHidesTabBar(rail)
            } label: {
                TabIcon("Front Office", "briefcase")
            }

            Tab(value: LeagueTab.trophy) {
                TrophyRoomScreen()
                    .environment(\.leagueTab, .trophy)
                    .sideRailHidesTabBar(rail)
            } label: {
                TabIcon("Trophy Room", "trophy")
            }

            Tab(value: LeagueTab.search, role: .search) {
                NavigationStack(path: $searchPath) {
                    PlayerSearchScreen()
                        .leagueDestinations()
                }
                .environment(\.leagueTab, .search)
                .sideRailHidesTabBar(rail)
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        // scrolled down, the week wheel tucks into the tab bar as a pill
        // between the minimised tabs and the search button
        .tabViewBottomAccessory(isEnabled: !rail && wheel.hasWheel(tab, atRoot: atRoot(tab))) {
            WeekAccessory(tab: tab, atRoot: atRoot(tab))
        }
        .environment(wheel)
    }

    /// The tab is on its own first page, with nothing pushed on top.
    private func atRoot(_ tab: LeagueTab) -> Bool {
        switch tab {
        case .season: return seasonPath.isEmpty
        case .records: return recordsPath.isEmpty
        case .office: return officePath.isEmpty
        case .search: return searchPath.isEmpty
        default: return true
        }
    }

    /// The season tab is one tab on a phone and a tab per season in a
    /// sidebar: keep the person on the same season when the screen changes
    /// size (folding or unfolding the Duo, resizing on an iPad).
    private func adapt(to sizeClass: UserInterfaceSizeClass?) {
        switch (sizeClass, tab) {
        case (.regular, .season):
            tab = .year(session.year)
        case (.compact, .year(let y)):
            session.year = y
            tab = .season
        default:
            break
        }
    }
}

/// The wide layout: a sidebar beside the content rather than over it, in
/// either orientation, headed by the league like the site's desktop panel,
/// with the league's places and every season. The system's sidebar button
/// (beside the page's title once it's folded) folds it away to give a page (a bracket, a table) the whole width; the
/// Trophy Room opens with it folded, the hall wanting the room.
private struct WideLeagueLayout: View {
    @Bindable var session: LeagueSession
    let summary: LeagueSummary
    @Binding var tab: LeagueTab
    @State private var columns: NavigationSplitViewVisibility

    init(session: LeagueSession, summary: LeagueSummary, tab: Binding<LeagueTab>) {
        self.session = session
        self.summary = summary
        _tab = tab
        _columns = State(initialValue: tab.wrappedValue == .trophy || DebugLaunch.sidebarHidden ? .detailOnly : .all)
    }

    private var selection: Binding<LeagueTab?> {
        Binding(get: { tab }, set: { if let new = $0 { tab = new } })
    }

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            List(selection: selection) {
                Section {
                    LeagueSidebarHeader(summary: summary)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .selectionDisabled()
                }
                Section {
                    Label("Record Book", systemImage: "book.closed").tag(LeagueTab.records)
                    Label("Front Office", systemImage: "briefcase").tag(LeagueTab.office)
                    Label("Trophy Room", systemImage: "trophy").tag(LeagueTab.trophy)
                    Label("Search Players", systemImage: "magnifyingglass").tag(LeagueTab.search)
                }
                Section("Seasons") {
                    ForEach(summary.years, id: \.self) { year in
                        Label(String(year), systemImage: summary.season(year)?.finished == false ? "calendar.badge.clock" : "calendar")
                            .tag(LeagueTab.year(year))
                    }
                }
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(min: 250, ideal: 280, max: 320)
        } detail: {
            detail
                .id(tab)
                .environment(\.sidebar, SidebarControl(hidden: columns == .detailOnly))
        }
        .navigationSplitViewStyle(.balanced)
        .onChange(of: tab) { _, new in
            if new == .trophy { withAnimation(.smooth) { columns = .detailOnly } }
        }
    }

    @ViewBuilder private var detail: some View {
        switch tab {
        case .season, .year:
            NavigationStack {
                SeasonScreen(year: tab.year ?? session.year)
                    .leagueDestinations()
            }
        case .records:
            NavigationStack {
                RecordBookScreen()
                    .leagueDestinations()
            }
        case .office:
            NavigationStack {
                FrontOfficeScreen()
                    .leagueDestinations()
            }
        case .trophy:
            TrophyRoomScreen()
        case .search:
            NavigationStack {
                PlayerSearchScreen()
                    .leagueDestinations()
            }
        }
    }
}

extension LeagueTab {
    var year: Int? {
        if case .year(let y) = self { return y }
        return nil
    }
}

/// The league at the top of the sidebar, as on the site's desktop panel.
private struct LeagueSidebarHeader: View {
    @Environment(AppModel.self) private var app
    @Environment(LeagueSession.self) private var session
    let summary: LeagueSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                LeagueAvatar(summary: summary, size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text(summary.name)
                        .font(.system(size: 11, weight: .bold))
                        .tracking(1.6)
                        .textCase(.uppercase)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    BrandWordmark(size: 19)
                        .minimumScaleFactor(0.7)
                }
                Spacer(minLength: 0)
                Menu {
                    LeagueMenuItems()
                } label: {
                    Image(systemName: "ellipsis")
                        .frame(width: 22, height: 22)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .accessibilityLabel("League menu")
            }
            Button {
                session.sheet = .chat
            } label: {
                Label("Ask the League", systemImage: "sparkles")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .tint(Theme.gold)
        }
        .padding(.vertical, 6)
    }
}

/// "PIGSKIN PANTHEON", the second word in gold.
struct BrandWordmark: View {
    var size: CGFloat = 20
    var body: some View {
        Text("\(Text("Pigskin ").foregroundStyle(.primary))\(Text("Pantheon").foregroundStyle(Theme.gold))")
            .displayStyle(size)
            .lineLimit(1)
    }
}

/// The league's own avatar, or the site's crest.
struct LeagueAvatar: View {
    let summary: LeagueSummary
    var size: CGFloat = 32

    var body: some View {
        Group {
            if let avatar = summary.avatar, avatar.hasPrefix("http"), let url = URL(string: avatar) {
                RemoteImage(url: url) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() } else { crest }
                }
            } else if summary.demo {
                TeamBadge(name: summary.name, icon: "SS", color: "#0f2a4a", logo: nil, size: size)
            } else {
                crest
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private var crest: some View {
        Image("Crest").resizable().scaledToFit()
    }
}

/// What every league screen's menu offers: switching league, the account,
/// and sharing the league's link.
struct LeagueMenuItems: View {
    @Environment(AppModel.self) private var app
    @Environment(LeagueSession.self) private var session

    var body: some View {
        if let summary = session.summary {
            Section(summary.name) {
                ShareLink(item: shareURL(summary), subject: Text(summary.name)) {
                    Label("Share this league", systemImage: "square.and.arrow.up")
                }
            }
        }
        Button {
            session.sheet = .account
        } label: {
            Label(app.account.isSignedIn ? "Account" : "Sign in", systemImage: "person.crop.circle")
        }
        Button {
            app.closeLeague()
        } label: {
            Label("Switch league", systemImage: "arrow.left.arrow.right")
        }
    }

    private func shareURL(_ summary: LeagueSummary) -> URL {
        var parts = URLComponents(url: LeagueEngine.siteURL.appendingPathComponent("alltime.html"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [URLQueryItem(name: "league", value: summary.leagueId)]
        return parts.url!
    }
}

extension View {
    /// The toolbar every league screen shares: the league's menu on the
    /// left, the league AI on the right.
    func leagueToolbar() -> some View {
        modifier(LeagueToolbar())
    }
}

/// The wide layout's sidebar, for the pages beside it: whether it's folded
/// away (and its league menu with it).
struct SidebarControl {
    var hidden: Bool
}

extension EnvironmentValues {
    @Entry var sidebar: SidebarControl? = nil
}

private struct LeagueToolbar: ViewModifier {
    @Environment(LeagueSession.self) private var session
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.sidebar) private var sidebar

    func body(content: Content) -> some View {
        content.toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    session.sheet = .chat
                } label: {
                    Label("Ask the League", systemImage: "sparkles")
                }
                .buttonStyle(.glassProminent)
                .tint(Theme.gold)
            }
            // The league's menu, as a plain "…" (the sidebar has its own on
            // a wide screen, while it's open). An icon, not the league's
            // avatar: a picture in a toolbar item is drawn full size if iOS
            // folds it into its overflow menu.
            if sizeClass != .regular || sidebar?.hidden == true {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        LeagueMenuItems()
                    } label: {
                        Label("League", systemImage: "ellipsis")
                    }
                    .accessibilityLabel("League menu")
                }
            }
        }
    }
}

/// The demo's note under the header: what it is, and the way to your own.
struct DemoBanner: View {
    @Environment(AppModel.self) private var app
    @Environment(LeagueSession.self) private var session

    var body: some View {
        if session.isDemo {
            HStack(spacing: 10) {
                Text("DEMO")
                    .font(.system(size: 11, weight: .heavy))
                    .tracking(1)
                    .foregroundStyle(Theme.navy)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(Theme.gold, in: Capsule())
                Text("You're exploring \(Text("Sunday Scaries").bold()), a made-up league.")
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.92))
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                Button("Open yours") { app.closeLeague() }
                    .font(.footnote.weight(.bold))
                    .lineLimit(1)
                    .fixedSize()
                    .buttonStyle(.glassProminent)
                    .tint(.white)
                    .foregroundStyle(Theme.navy)
            }
            .padding(12)
            .background(LinearGradient(colors: [Theme.navy, Theme.navy2], startPoint: .leading, endPoint: .trailing),
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }
}

// MARK: Loading and failure

private struct LeagueLoadingView: View {
    @Environment(AppModel.self) private var app
    let session: LeagueSession
    let done: Int
    let total: Int

    var body: some View {
        ZStack {
            LinearGradient(colors: [Theme.navy, Theme.navy2], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
            VStack(spacing: 18) {
                Image("Crest").resizable().scaledToFit().frame(width: 84, height: 84)
                    .shadow(color: .black.opacity(0.35), radius: 16, y: 8)
                BrandWordmark(size: 26).foregroundStyle(.white)
                VStack(spacing: 8) {
                    if total > 1 {
                        ProgressView(value: Double(min(done, total)), total: Double(total))
                            .tint(Theme.gold)
                            .frame(width: 200)
                        Text("Reading season \(min(done + 1, total)) of \(total)…")
                    } else {
                        ProgressView().tint(.white)
                        Text("Loading the league…")
                    }
                }
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.8))
            }
            .padding()
        }
        .overlay(alignment: .topLeading) {
            Button {
                app.closeLeague()
            } label: {
                Image(systemName: "xmark")
            }
            .buttonStyle(.glass)
            .padding()
        }
    }
}

private struct LeagueFailedView: View {
    @Environment(AppModel.self) private var app
    let session: LeagueSession
    let message: String

    var body: some View {
        NavigationStack {
            ContentUnavailableView {
                Label("This league couldn't be loaded", systemImage: "exclamationmark.triangle")
            } description: {
                Text(message)
            } actions: {
                Button("Try again") { session.retry() }
                    .buttonStyle(.glassProminent)
                Button("Choose a league") { app.closeLeague() }
                    .buttonStyle(.glass)
            }
            .background(Theme.page)
        }
    }
}

/// A tab bar item as its icon alone, named for VoiceOver and the large
/// content viewer (a long press with large text sizes).
private struct TabIcon: View {
    let title: String
    let symbol: String

    init(_ title: String, _ symbol: String) {
        self.title = title
        self.symbol = symbol
    }

    var body: some View {
        Label(title, systemImage: symbol)
            .labelStyle(.iconOnly)
            .accessibilityLabel(title)
    }
}
