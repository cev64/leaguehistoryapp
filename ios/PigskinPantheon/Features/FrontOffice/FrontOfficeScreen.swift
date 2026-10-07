import SwiftUI

/// The front office (moves.html): lineups, trades, waivers and draft picks,
/// judged in hindsight (insights.js). The tabs sit in a segmented control
/// under the navigation bar and the seasons on a glass wheel along the
/// bottom, ALL first where a tab has an all-time view, as the site's
/// capsule has them. Each tab keeps its own season.
///
/// Launch straight onto a tab and season with PP_OFFICE=<tab>/<season>
/// (e.g. trades/all, lineups/2024, picks/2028), as the site's #<tab>/<season>.
struct FrontOfficeScreen: View {
    @Environment(LeagueSession.self) private var session
    @State private var store: OfficeStore?

    var body: some View {
        Group {
            if let store {
                OfficeContent(store: store)
            } else {
                PageScroll {
                    DemoBanner()
                    LoadingCard(title: "Opening the front office", detail: "Reading every season from \(session.summary?.source ?? "Sleeper")…")
                }
                .navigationTitle("Front Office")
                .leagueToolbar()
            }
        }
        .task(id: session.id) {
            let s = OfficeStore(engine: session.engine, source: session.summary?.source ?? "Sleeper")
            store = s
            await s.start()
        }
    }
}

private struct OfficeContent: View {
    @Environment(LeagueSession.self) private var session
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Bindable var store: OfficeStore
    @State private var pushed: OfficePush?
    @State private var scroll = ScrollMinimizer()

    var body: some View {
        PageScroll(onScroll: scroll.update) {
            DemoBanner()
            if sizeClass == .regular {
                OfficeIntro()
            }
            panelBody
        }
        .navigationTitle(store.title)
        .navigationSubtitle("Front Office")
        .toolbarTitleDisplayMode(.inlineLarge)
        .leagueToolbar()
        .safeAreaBar(edge: .top) {
            if let tabs = store.nav?.tabs, tabs.count > 1 {
                Picker("Front office", selection: Binding(get: { store.tab }, set: { store.select(tab: $0) })) {
                    ForEach(tabs) { tab in
                        Text(tabs.count > 3 ? tab.shortLabel : tab.label).tag(tab.id)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, Theme.gutter)
                .padding(.vertical, 6)
                .frame(maxWidth: 640)
            }
        }
        // the seasons' wheel, which tucks into the tab bar as the page scrolls
        .wheelBar(kind: .seasons, weeks: store.wheel ?? [], selected: store.year,
                  minimized: scroll.minimized, identity: store.tab,
                  expand: { withAnimation(.spring(response: 0.5, dampingFraction: 0.82)) { scroll.expand() } },
                  select: { store.select(year: $0) })
        .sensoryFeedback(.selection, trigger: store.tab)
        .navigationDestination(item: $pushed) { push in
            LeagueRouteView(route: push.route)
        }
        .environment(\.officePush) { route in pushed = OfficePush(route: route) }
    }

    @ViewBuilder private var panelBody: some View {
        if let nav = store.nav, !nav.hasGames {
            OfficeEmpty(text: "No games have been played in this league yet.")
        } else if let error = store.error {
            OfficeEmpty(text: error)
        } else if store.showsSpinner || store.panel == nil {
            LoadingCard(title: store.loadingTitle, detail: "Working through every week…")
        } else if let panel = store.panel {
            OfficePanelView(panel: panel, store: store)
                .id("\(panel.tab)/\(panel.year)")
                .opacity(store.busy ? 0.45 : 1)
                .allowsHitTesting(!store.busy)
                .animation(.smooth(duration: 0.2), value: store.busy)
                .transition(.opacity)
        }
    }
}

/// The hero beside the page on the site's desktop: what the front office is.
private struct OfficeIntro: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Front Office").displayStyle(30).foregroundStyle(Theme.ink)
            Text("Who sets the best lineups, who wins their trades, who works the waiver wire.")
                .font(.subheadline)
                .foregroundStyle(Theme.ink2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 2)
    }
}

/// One tab's cards: one column on a phone; on a wide screen the main table
/// on the left and the rest beside it, as the site's desktop reads.
private struct OfficePanelView: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    let panel: OfficePanel
    let store: OfficeStore

    var body: some View {
        if let empty = panel.empty {
            OfficeEmpty(text: empty)
        } else if sizeClass == .regular, panel.cards.count > 1, let first = panel.cards.first {
            HStack(alignment: .top, spacing: 16) {
                OfficeCardView(card: first, store: store)
                    .frame(maxWidth: .infinity)
                VStack(spacing: 16) {
                    ForEach(panel.cards.dropFirst()) { card in
                        OfficeCardView(card: card, store: store)
                    }
                }
                .frame(maxWidth: .infinity)
            }
        } else {
            VStack(spacing: 16) {
                ForEach(panel.cards) { card in
                    OfficeCardView(card: card, store: store)
                }
            }
        }
    }
}

// MARK: Pushing from a menu

/// A place to open from a context menu, where a NavigationLink can't go.
struct OfficePush: Hashable, Identifiable {
    let route: LeagueRoute
    var id: Int { hashValue }
}

private struct OfficePushKey: EnvironmentKey {
    static let defaultValue: (LeagueRoute) -> Void = { _ in }
}

extension EnvironmentValues {
    var officePush: (LeagueRoute) -> Void {
        get { self[OfficePushKey.self] }
        set { self[OfficePushKey.self] = newValue }
    }
}

// MARK: State

/// The tab on screen, each tab's own season, and every view read so far
/// (insights.js keeps its own caches in the engine too).
@MainActor
@Observable
final class OfficeStore {
    static let all = 0

    let engine: LeagueEngine
    let source: String
    var nav: OfficeNav?
    var tab: String = "lineups"
    /// Each tab keeps its own season (0 is ALL).
    var years: [String: Int] = [:]
    var wheels: [String: [RailWeek]] = [:]
    var panel: OfficePanel?
    /// The next view is being worked out; what's on screen stays, dimmed.
    var busy = false
    /// A slow first read: the spinner replaces what was there.
    var showsSpinner = false
    var error: String?
    /// How many trades are shown (twenty more at a time).
    var shown = 20

    private var cache: [String: OfficePanel] = [:]
    private var drawId = 0

    init(engine: LeagueEngine, source: String) {
        self.engine = engine
        self.source = source
    }

    var year: Int { years[tab] ?? Self.all }
    var wheel: [RailWeek]? { wheels[tab] }

    var title: String {
        guard let label = nav?.tabs.first(where: { $0.id == tab })?.label else { return "Front Office" }
        let y = year
        return "\(label) · \(y == Self.all ? "All-time" : tab == "picks" ? "\(y) draft" : String(y))"
    }

    var loadingTitle: String {
        ["lineups": "Checking every lineup", "trades": "Reading every trade", "waivers": "Reading the waiver wire",
         "picks": "Counting draft picks"][tab] ?? "Opening the front office"
    }

    func start() async {
        do {
            let nav = try await engine.call(OfficeNav.self, "Bridge.office.nav()")
            self.nav = nav
            years = nav.start
            // PP_OFFICE=<tab>/<season>, as the site's #<tab>/<season>
            if let raw = ProcessInfo.processInfo.environment["PP_OFFICE"] {
                let parts = raw.split(separator: "/").map(String.init)
                if let t = parts.first, nav.tabs.contains(where: { $0.id == t }) { tab = t }
                if parts.count > 1 { years[tab] = parts[1] == "all" ? Self.all : Int(parts[1]) ?? years[tab] }
            }
            await show()
        } catch {
            self.error = "\(source) didn't answer. Try again in a moment."
        }
    }

    func select(tab: String) {
        guard tab != self.tab else { return }
        withAnimation(.smooth(duration: 0.25)) { self.tab = tab }
        shown = 20
        Task { await show() }
    }

    func select(year: Int) {
        guard year != self.year else { return }
        withAnimation(.smooth(duration: 0.25)) { years[tab] = year }
        shown = 20
        Task { await show() }
    }

    func showMore() {
        withAnimation(.smooth) { shown += 20 }
    }

    private func key(_ tab: String, _ year: Int) -> String { "\(tab)/\(year)" }

    /// Draws the tab's season: from what was read before, or read now with
    /// what's on screen kept (dimmed) meanwhile, and a spinner only if the
    /// read is slow.
    private func show() async {
        guard nav?.hasGames == true else { return }
        drawId += 1
        let id = drawId
        let tab = self.tab, year = self.year
        error = nil
        if wheels[tab] == nil {
            wheels[tab] = try? await engine.call([RailWeek].self, "Bridge.office.wheel(tab)", ["tab": tab])
        }
        if let hit = cache[key(tab, year)] {
            withAnimation(.smooth(duration: 0.25)) { apply(hit) }
            return
        }
        if panel == nil { showsSpinner = true } else { busy = true }
        let slow = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(900))
            guard let self, !Task.isCancelled, id == self.drawId else { return }
            withAnimation(.smooth(duration: 0.2)) { self.busy = false; self.showsSpinner = true }
        }
        defer { slow.cancel() }
        do {
            let p = try await engine.call(OfficePanel.self, "Bridge.office.panel(tab, year)", ["tab": tab, "year": year])
            cache[key(tab, year)] = p
            cache[key(tab, p.year)] = p
            wheels[tab] = p.wheel
            guard id == drawId else { return }
            withAnimation(.smooth(duration: 0.25)) { apply(p) }
        } catch {
            guard id == drawId else { return }
            busy = false
            showsSpinner = false
            self.error = "\(source) didn't answer. Try again in a moment."
        }
    }

    private func apply(_ p: OfficePanel) {
        if p.year != years[p.tab] { years[p.tab] = p.year }
        panel = p
        busy = false
        showsSpinner = false
    }
}
