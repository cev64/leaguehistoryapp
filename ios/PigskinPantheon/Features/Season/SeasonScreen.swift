import SwiftUI

/// One season of the league (season.html): a week at a time, with its
/// results, standings, playoff picture and recap, and a week rail of
/// Liquid Glass along the bottom to move between weeks.
struct SeasonScreen: View {
    @Environment(LeagueSession.self) private var session
    @Environment(\.horizontalSizeClass) private var sizeClass

    /// nil: the season the league session is on (the phone's Season tab,
    /// whose menu switches it). A year: that season (a sidebar entry, or a
    /// season pushed from elsewhere).
    let year: Int?
    var initialWeek: Int? = nil
    var isPushed: Bool = false

    @State private var store: SeasonStore?

    private var shownYear: Int { year ?? session.year }

    var body: some View {
        Group {
            if let store, store.year == shownYear {
                SeasonContent(store: store, showsSeasonMenu: year == nil)
            } else {
                PageScroll { LoadingCard(title: "Opening the \(String(shownYear)) season") }
            }
        }
        .task(id: shownYear) {
            let s = SeasonStore(engine: session.engine, year: shownYear)
            store = s
            await s.load(initialWeek: initialWeek)
        }
    }
}

private struct SeasonContent: View {
    @Environment(LeagueSession.self) private var session
    @Environment(\.sideRail) private var sideRail
    @Bindable var store: SeasonStore
    let showsSeasonMenu: Bool
    @State private var scroll = ScrollMinimizer()

    /// "Week 8", "Season", "Preseason": the year is on the season button
    /// beside it (or in the sidebar), so the title doesn't repeat it.
    private var title: String {
        guard let payload = store.payload else { return "" }
        if payload.week > 0 { return "Week \(payload.week)" }
        let season = session.summary?.season(store.year)
        if season?.finished == true { return "Season" }
        return season?.unplayed == true ? "Not played" : "Preseason"
    }

    /// The league, and the year where nothing else on screen shows it (a
    /// season pushed from another page).
    private var subtitle: String {
        let name = session.summary?.name ?? ""
        return showsSeasonMenu ? name : "\(name) · \(String(store.year))"
    }

    var body: some View {
        PageScroll(onScroll: { y in
            var next = scroll
            next.update(y)
            if next.minimized != scroll.minimized {
                withAnimation(.spring(response: 0.5, dampingFraction: 0.82)) { scroll = next }
            } else {
                scroll = next
            }
        }) {
            DemoBanner()
            if let info = store.info, let season = session.summary?.season(store.year) {
                // The season's header belongs to its overview (week 0): a
                // finished season's champion and last place, or where a live
                // one stands. A week shows its games straight away.
                if store.week == 0 {
                    SeasonHero(season: season, info: info)
                }
                if let error = store.error {
                    EmptyCard(title: "This week couldn't be read", detail: error, symbol: "exclamationmark.triangle")
                } else if let payload = store.payload {
                    SeasonPanel(store: store, info: info, season: season, payload: payload)
                        .id("\(payload.week)-\(store.view)")
                        .transition(.opacity)
                } else {
                    LoadingCard(title: "Reading week \(store.week)")
                }
            } else if let error = store.error {
                EmptyCard(title: "This season couldn't be read", detail: error, symbol: "exclamationmark.triangle")
            }
        }
        .animation(.smooth(duration: 0.25), value: store.view)
        .navigationTitle(title)
        .navigationSubtitle(subtitle)
        .toolbarTitleDisplayMode(.inlineLarge)
        .leagueToolbar()
        .toolbar {
            if showsSeasonMenu, let summary = session.summary, summary.seasons.count > 1 {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("Season", selection: Binding(get: { session.year }, set: { session.year = $0 })) {
                            ForEach(summary.years, id: \.self) { y in
                                Text(String(y)).tag(y)
                            }
                        }
                    } label: {
                        Label(String(session.year), systemImage: "calendar")
                            .labelStyle(.titleOnly)
                            .font(.body.weight(.semibold))
                    }
                    .accessibilityLabel("Choose season")
                }
            }
        }
        .safeAreaBar(edge: .top) {
            if let tabs = store.payload?.views, tabs.count > 1 {
                Picker("View", selection: $store.view) {
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
        .wheelBar(kind: .weeks, weeks: store.info?.weeks ?? [],
                  selected: store.week, minimized: scroll.minimized,
                  expand: { withAnimation(.spring(response: 0.5, dampingFraction: 0.82)) { scroll.expand() } },
                  select: { store.select(week: $0) })
        .safeAreaBar(edge: .trailing) {
            // Beside a side rail (a wide, short screen) the weeks run down
            // the other side, leaving the height to the games.
            if sideRail, let info = store.info, info.weeks.count > 1 {
                WeekRail(weeks: info.weeks, selected: store.week, axis: .vertical) { week in
                    store.select(week: week)
                }
                .padding(.trailing, 8)
                .padding(.vertical, 6)
            }
        }
    }
}

/// The season's header: where a live season stands, or a finished season's
/// champion and last place (renderHero).
private struct SeasonHero: View {
    let season: Season
    let info: SeasonInfo

    var body: some View {
        if season.finished {
            AdaptiveGrid(minWidth: 300) {
                if let champ = season.champion, let team = season.team(champ) {
                    OutcomeCard(kind: .champion, season: season, teamId: champ, team: team, game: season.titleGame)
                }
                if let last = season.lastPlace, let team = season.team(last) {
                    OutcomeCard(kind: .last, season: season, teamId: last, team: team, game: season.lastPlaceGame)
                }
            }
        } else {
            LiveHero(season: season, info: info)
        }
    }
}

private struct LiveHero: View {
    let season: Season
    let info: SeasonInfo

    private static let words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
                                "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"]
    private func word(_ n: Int) -> String { n < Self.words.count ? Self.words[n] : String(n) }
    private func capital(_ s: String) -> String { s.prefix(1).uppercased() + s.dropFirst() }

    private var badgeAndLine: (String, String) {
        let n = season.teams.count, p = info.playoffTeams
        let out = season.postseason.contains { $0.bracket == "L" } ? n - p : 0
        if info.latestWeek > info.regularWeeks {
            return ("Playoffs · Week \(info.latestWeek)", "The regular season is over. \(capital(word(p))) teams made the playoffs.")
        }
        if info.lastPlayedWeek > 0 {
            var line = "Week \(info.lastPlayedWeek) of \(info.regularWeeks)."
            if p > 0 { line += " \(capital(word(p))) make the playoffs\(out > 0 ? ", \(word(out)) play in the losers bracket" : "")." }
            return ("Through Week \(info.lastPlayedWeek)", line)
        }
        if season.unplayed == true {
            return ("Not played", "\(info.source) closed this season before a single game was scored.")
        }
        return ("Preseason", "\(capital(word(n))) teams. \(info.regularWeeks) weeks.\(p > 0 ? " \(capital(word(p))) make the playoffs." : "")")
    }

    var body: some View {
        let (badge, line) = badgeAndLine
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Circle().fill(Theme.red).frame(width: 7, height: 7)
                Text(badge).font(.system(size: 12, weight: .bold)).textCase(.uppercase).tracking(0.8)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .glassEffect(.regular.tint(.white.opacity(0.08)), in: Capsule())
            Text("\(String(season.year)) Season").displayStyle(38).foregroundStyle(.white)
            Text(line).font(.subheadline).foregroundStyle(.white.opacity(0.78))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(
            LinearGradient(colors: [Theme.navy, Theme.navy2], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
        )
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.red).frame(height: 3).clipShape(RoundedRectangle(cornerRadius: 2)).padding(.horizontal, 18)
        }
    }
}

/// A finished season's champion or last place, with the game that settled it.
struct OutcomeCard: View {
    enum Kind { case champion, last }
    let kind: Kind
    let season: Season
    let teamId: String
    let team: Team
    let game: PostGame?

    var body: some View {
        NavigationLink(value: LeagueRoute.team(year: season.year, teamId: teamId)) {
            VStack(alignment: .leading, spacing: 12) {
                Text(kind == .champion ? "🏆 \(String(season.year)) Champion" : "💩 \(String(season.year)) Last Place")
                    .font(.system(size: 12, weight: .heavy)).tracking(1).textCase(.uppercase)
                    .foregroundStyle(kind == .champion ? Theme.gold : Color(hex: 0xF4A3A3))
                HStack(spacing: 12) {
                    TeamBadge(team: team, size: 50)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(team.name).displayStyle(26).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.6)
                        Text("\(team.owner) · \(team.record) regular season").font(.footnote).foregroundStyle(.white.opacity(0.75))
                    }
                }
                if let game, let a = game.a, let b = game.b {
                    let mine = game.a == teamId ? game.aScore : game.bScore
                    let theirs = game.a == teamId ? game.bScore : game.aScore
                    let opp = a == teamId ? b : a
                    HStack {
                        VStack(alignment: .leading) {
                            Text(Fmt.pts(mine)).font(.title3.weight(.bold)).monospacedDigit()
                            Text(team.name).font(.caption2).lineLimit(1)
                        }
                        Spacer()
                        Text("FINAL").font(.caption2.weight(.heavy)).tracking(1).opacity(0.7)
                        Spacer()
                        VStack(alignment: .trailing) {
                            Text(Fmt.pts(theirs)).font(.title3.weight(.bold)).monospacedDigit()
                            Text(season.team(opp)?.name ?? "").font(.caption2).lineLimit(1)
                        }
                    }
                    .foregroundStyle(.white)
                    .padding(12)
                    .glassEffect(.regular.tint(.white.opacity(0.06)), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                LinearGradient(colors: kind == .champion ? [Color(hex: 0x1B2B4B), Theme.navy] : [Color(hex: 0x3A1A22), Theme.navy],
                               startPoint: .topLeading, endPoint: .bottomTrailing),
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
        }
        .buttonStyle(.plain)
    }
}

/// The view a week shows, by the site's panel id.
private struct SeasonPanel: View {
    @Bindable var store: SeasonStore
    let info: SeasonInfo
    let season: Season
    let payload: WeekPayload

    var body: some View {
        switch store.view {
        case "panel-results":
            ResultsPanel(store: store, info: info, season: season, payload: payload)
        case "panel-standings", "regular":
            StandingsPanel(info: info, season: season, payload: payload)
        case "final":
            FinalStandingsPanel(info: info, season: season)
        case "panel-picture":
            PlayoffPicturePanel(info: info, season: season, payload: payload)
        case "panel-playoffs", "bracket":
            BracketPanel(info: info, season: season, week: payload.week)
        case "panel-recap":
            RecapPanel(info: info, season: season, week: payload.week)
        case "panel-sos":
            ScheduleStrengthPanel(info: info, season: season)
        default:
            EmptyCard(title: "Nothing to show", detail: "This view isn't available for this week.")
        }
    }
}

/// The season a screen shows, the week it's on and the view, with every
/// week it has read kept (the site's own caches live in the engine too).
@MainActor
@Observable
final class SeasonStore {
    let engine: LeagueEngine
    let year: Int
    var info: SeasonInfo?
    var week: Int = 0
    var view: String = "panel-results"
    var payload: WeekPayload?
    var error: String?
    private var cache: [Int: WeekPayload] = [:]

    init(engine: LeagueEngine, year: Int) {
        self.engine = engine
        self.year = year
    }

    func load(initialWeek: Int?) async {
        do {
            let info = try await engine.call(SeasonInfo.self, "Bridge.season.info(year)", ["year": year])
            self.info = info
            let start = initialWeek ?? DebugLaunch.week ?? info.start.week
            view = DebugLaunch.view ?? (initialWeek == nil ? info.start.view : view)
            await show(week: start, keepView: initialWeek == nil || DebugLaunch.view != nil)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func select(week: Int) {
        guard week != self.week else { return }
        Task { await show(week: week, keepView: true) }
    }

    /// Moves to a week, keeping the view where the new week has it (as the
    /// site does), otherwise its first.
    private func show(week: Int, keepView: Bool) async {
        self.week = week
        error = nil
        if let hit = cache[week] {
            apply(hit, keepView: keepView)
            return
        }
        payload = nil
        do {
            let p = try await engine.call(WeekPayload.self, "Bridge.season.week(year, week)", ["year": year, "week": week])
            cache[week] = p
            if self.week == week { apply(p, keepView: keepView) }
        } catch {
            if self.week == week { self.error = error.localizedDescription }
        }
    }

    private func apply(_ p: WeekPayload, keepView: Bool) {
        payload = p
        if !(keepView && p.views.contains { $0.id == view }) {
            view = p.views.first?.id ?? "panel-results"
        }
    }
}
