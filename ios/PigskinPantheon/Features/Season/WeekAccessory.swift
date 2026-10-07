import Observation
import SwiftUI

/// What a wheel picks: a season's weeks (the Season tab) or the league's
/// seasons (the Front Office).
enum WheelKind {
    case weeks, seasons
}

/// The wheels of the phone's tabs, handed to the tab bar. A tab's wheel
/// lives in the tab view's bottom accessory, so it moves with the tab bar
/// exactly as iOS moves it: with the bar at full size the wheel rides in the
/// glass bar just above it; as the page scrolls and the bar minimises to the
/// left, the wheel becomes a pill for its week (or season) in the middle,
/// between the minimised tabs and the search button. Tapping the pill opens
/// the full wheel in a popover.
@MainActor
@Observable
final class WeekWheelState {
    struct Entry {
        /// The page that drew it (the one on top of its tab's stack).
        var owner: UUID
        var weeks: [RailWeek]
        var selected: Int
        var kind: WheelKind
        var select: (Int) -> Void

        var current: RailWeek? { weeks.first { $0.w == selected } }
    }

    /// The wheel of each tab's own first page.
    var roots: [LeagueTab: Entry] = [:]
    /// The wheel of a page pushed on a tab's stack (a season opened from a
    /// record, a team...): it takes the bar while it's on screen.
    var pushed: [LeagueTab: Entry] = [:]

    /// The wheel the bar shows: a pushed page's, or with nothing pushed the
    /// tab's own.
    func entry(_ tab: LeagueTab, atRoot: Bool) -> Entry? {
        pushed[tab] ?? (atRoot ? roots[tab] : nil)
    }

    func hasWheel(_ tab: LeagueTab, atRoot: Bool) -> Bool {
        (entry(tab, atRoot: atRoot)?.weeks.count ?? 0) > 1
    }
}

/// A page's wheel along the bottom, which tucks into the tab bar as the page
/// scrolls down (on a tab's own page) or tightens in place like the site's
/// pinned capsule (anywhere else: a season pushed from another page, the
/// wide layout).
struct WheelBar: ViewModifier {
    @Environment(WeekWheelState.self) private var shared: WeekWheelState?
    @Environment(\.sideRail) private var sideRail
    /// The tab whose stack the page is on (nil in the wide layout).
    @Environment(\.leagueTab) private var tab
    /// Pushed on a stack, rather than a tab's first page.
    @Environment(\.isPresented) private var isPushed
    @State private var owner = UUID()

    let kind: WheelKind
    let weeks: [RailWeek]
    let selected: Int
    /// The page has scrolled down (ScrollMinimizer).
    let minimized: Bool
    /// A new wheel (the Front Office's tabs each keep their own).
    var identity: AnyHashable = 0
    /// The pill was tapped: bring the wheel back.
    let expand: () -> Void
    let select: (Int) -> Void

    /// On a phone the wheel is the tab bar's, whichever tab's stack the page
    /// is on; in the wide layout it sits at the foot of the page and
    /// tightens as the page scrolls.
    private var tucks: Bool { tab != nil && shared != nil && !sideRail }
    /// The wheel's height, kept free at the foot of the page.
    @State private var height: CGFloat = 86

    func body(content: Content) -> some View {
        let shown = !tucks && !sideRail && weeks.count > 1
        content
            .safeAreaPadding(.bottom, shown ? height : 0)
            .overlay(alignment: .bottom) {
                if shown {
                    WeekRail(weeks: weeks, selected: selected, compact: minimized, onSelect: select)
                        .id(identity)
                        .padding(.horizontal, minimized ? 28 : 12)
                        .padding(.bottom, minimized ? 2 : 6)
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
                }
            }
            .onAppear(perform: publish)
            .onChange(of: selected) { _, _ in publish() }
            .onChange(of: weeks) { _, _ in publish() }
            .onChange(of: sideRail) { _, _ in publish() }
            .onDisappear {
                // a page pushed on top, or another tab: this page's wheel
                // leaves the bar (unless a newer page has already put its own)
                guard let tab, let shared else { return }
                if shared.pushed[tab]?.owner == owner { shared.pushed[tab] = nil }
                if shared.roots[tab]?.owner == owner { shared.roots[tab] = nil }
            }
    }

    private func publish() {
        guard let tab, let shared else { return }
        let entry: WeekWheelState.Entry? = tucks ? .init(owner: owner, weeks: weeks, selected: selected, kind: kind, select: select) : nil
        if isPushed {
            if entry != nil || shared.pushed[tab]?.owner == owner { shared.pushed[tab] = entry }
        } else {
            if entry != nil || shared.roots[tab]?.owner == owner { shared.roots[tab] = entry }
        }
    }
}

extension EnvironmentValues {
    /// The tab whose navigation stack a page is on, on a phone.
    @Entry var leagueTab: LeagueTab? = nil
}

extension View {
    func wheelBar(kind: WheelKind, weeks: [RailWeek], selected: Int, minimized: Bool,
                  identity: AnyHashable = 0, expand: @escaping () -> Void, select: @escaping (Int) -> Void) -> some View {
        modifier(WheelBar(kind: kind, weeks: weeks, selected: selected, minimized: minimized,
                          identity: identity, expand: expand, select: select))
    }
}

/// The tab bar's accessory: the wheel itself above a full-size tab bar, a
/// pill for the chosen week (or season) beside a minimised one. The pill
/// opens the full wheel in a popover, which closes once a week is chosen.
struct WeekAccessory: View {
    @Environment(WeekWheelState.self) private var wheel
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement
    let tab: LeagueTab
    let atRoot: Bool
    @State private var open = false

    var body: some View {
        if let entry = wheel.entry(tab, atRoot: atRoot) {
            if placement == .inline {
                pill(entry)
            } else {
                WeekRail(weeks: entry.weeks, selected: entry.selected, inAccessory: true, onSelect: entry.select)
            }
        }
    }

    private func pill(_ entry: WeekWheelState.Entry) -> some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            open = true
        } label: {
            HStack(spacing: 8) {
                if let week = entry.current {
                    disc(week)
                    Text(title(week, entry.kind))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                        .contentTransition(.numericText())
                }
                Image(systemName: "chevron.up")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Theme.ink3)
            }
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(entry.current.map { title($0, entry.kind) } ?? "Week"). Show the wheel")
        .animation(.smooth, value: entry.selected)
        .popover(isPresented: $open, arrowEdge: .bottom) {
            WeekRail(weeks: entry.weeks, selected: entry.selected) { w in
                entry.select(w)
                // let the disc land before the popover goes
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { open = false }
            }
            .frame(width: 340)
            .padding(6)
            .presentationCompactAdaptation(.popover)
        }
    }

    private func title(_ week: RailWeek, _ kind: WheelKind) -> String {
        switch kind {
        case .seasons:
            return week.num == "ALL" ? "All seasons" : "\(week.num) season"
        case .weeks:
            if week.w == 0 { return week.num == "SZN" ? "Season" : "Preseason" }
            return week.playoff ? "Week \(week.w) · Playoffs" : "Week \(week.w)"
        }
    }

    private func disc(_ week: RailWeek) -> some View {
        ZStack {
            Circle().fill(Theme.navy)
            Circle().stroke(week.playoff ? Theme.gold : .white.opacity(0.9), lineWidth: 1.5).padding(2)
            Text(week.num.count == 4 && Int(week.num) != nil ? "’" + week.num.suffix(2) : week.num)
                .font(.system(size: week.num.count > 2 && Int(week.num) == nil ? 8.5 : 12, weight: .heavy))
                .monospacedDigit()
                .foregroundStyle(.white)
        }
        .frame(width: 28, height: 28)
        .overlay(alignment: .bottom) {
            if week.now {
                Circle().fill(Theme.red).frame(width: 5, height: 5).offset(y: 5)
            }
        }
    }
}
