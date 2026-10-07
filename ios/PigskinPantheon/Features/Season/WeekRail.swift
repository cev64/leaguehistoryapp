import SwiftUI

/// The week wheel (ui.js SeasonNav, the touch wheel), in Liquid Glass.
///
/// As on the site's phone layout: weeks are progress rings (a played week's
/// ring closed, a week to come an open track, the playoff weeks gold, a
/// dashed hairline before the first of them, a red dot under the next week to
/// be played). It's an iOS-picker-style wheel: the week under the centre line
/// is magnified and the rest fade with distance, it snaps into place, and a
/// week is chosen only once the swipe settles; a tick marks each week that
/// passes the centre. A navy disc glides to the chosen week (and follows the
/// centre while you swipe). A tap chooses a week outright.
///
/// `compact` is the site's pinned state, shown while the page scrolls down
/// with the tab bar minimised: smaller rings, no dots, less padding.
struct WeekRail: View {
    let weeks: [RailWeek]
    let selected: Int
    /// Along the bottom (a phone held upright) or down the side (beside a
    /// side rail).
    var axis: Axis = .horizontal
    var compact: Bool = false
    /// Drawn inside the tab bar's accessory, which brings its own glass:
    /// the smallest rings, and no capsule of its own.
    var inAccessory: Bool = false
    let onSelect: (Int) -> Void

    /// The week under the centre line, live as the wheel moves.
    @State private var centred: Int?
    /// The week under the disc while swiping (nil: the chosen week).
    @State private var visWeek: Int?
    @State private var swiping = false
    @State private var length: CGFloat = 0
    @State private var position = ScrollPosition()
    /// Shown once its week is on the centre line: before it knows its own
    /// width the wheel can't place it, and would be seen jumping there.
    @State private var placed = false

    // The site's sizes: .sn-wkbar.lens (open) and .stuck (pinned).
    private var slot: CGFloat { axis == .vertical ? 52 : inAccessory ? 48 : 58 }
    private var ring: CGFloat { inAccessory ? 30 : compact ? 32 : 42 }
    private var dot: CGFloat { inAccessory ? 4 : (compact || axis == .vertical ? 0 : 5) }
    private var padLead: CGFloat { axis == .vertical ? 6 : inAccessory ? 7 : (compact ? 12 : 16) }
    private var padTrail: CGFloat { axis == .vertical ? 6 : inAccessory ? 3 : (compact ? 8 : 12) }
    private var shownWeek: Int { visWeek ?? selected }
    private var margin: CGFloat { max(0, (length - slot) / 2) }
    private var horizontal: Bool { axis == .horizontal }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(horizontal ? .horizontal : .vertical) {
                let stack = horizontal ? AnyLayout(HStackLayout(spacing: 0)) : AnyLayout(VStackLayout(spacing: 0))
                stack {
                    // spacers at both ends let the first and last weeks reach
                    // the centre line (as the site's .sn-track::before/after)
                    Color.clear.frame(width: horizontal ? margin : 1, height: horizontal ? 1 : margin)
                    ForEach(Array(weeks.enumerated()), id: \.element.id) { i, week in
                        slotView(week, first: week.playoff && !(i > 0 && weeks[i - 1].playoff))
                            .id(week.w)
                    }
                    Color.clear.frame(width: horizontal ? margin : 1, height: horizontal ? 1 : margin)
                }
            }
            .scrollPosition($position)
            .coordinateSpace(name: Self.space)
            .scrollIndicators(.hidden)
            // snaps a week onto the centre line, like scroll-snap-align: center
            .scrollTargetBehavior(SlotSnap(slot: slot, horizontal: horizontal))
            .onScrollPhaseChange { _, phase in
                switch phase {
                case .interacting:
                    swiping = true
                case .idle:
                    settle(proxy)
                default:
                    break
                }
            }
            .onChange(of: centred) { _, week in
                if swiping, let week { visWeek = week }
            }
            .sensoryFeedback(.selection, trigger: centred) { _, _ in swiping }
            .onChange(of: selected) { _, week in
                visWeek = nil
                withAnimation(.smooth(duration: 0.4)) { centre(week) }
            }
            // the wheel changed width (collapsing, rotating): keep the chosen
            // week on the centre line once the new spacers are laid out
            .onChange(of: length) { _, _ in
                DispatchQueue.main.async {
                    var still = Transaction()
                    still.disablesAnimations = true
                    withTransaction(still) { centre(selected) }
                    placed = true
                }
            }
            .onAppear { if length > 0 { centre(selected); placed = true } }
        }
        .onGeometryChange(for: CGFloat.self) { horizontal ? $0.size.width : $0.size.height } action: { length = $0 }
        // the edges fade where more weeks wait off the wheel
        .mask {
            LinearGradient(stops: [
                .init(color: .clear, location: 0),
                .init(color: .black, location: 0.09),
                .init(color: .black, location: 0.91),
                .init(color: .clear, location: 1),
            ], startPoint: horizontal ? .leading : .top, endPoint: horizontal ? .trailing : .bottom)
        }
        .opacity(placed ? 1 : 0)
        .frame(maxWidth: horizontal ? 760 : nil, maxHeight: horizontal ? nil : .infinity)
        .glassEffect(inAccessory ? .identity : .regular.interactive(), in: Capsule())
        .animation(.spring(response: 0.55, dampingFraction: 0.78), value: compact)
    }

    // MARK: One week

    private func slotView(_ week: RailWeek, first: Bool) -> some View {
        let on = week.w == shownWeek
        let mid = length / 2   // the centre line, in the wheel's own frame
        let space = Self.space
        let isHorizontal = horizontal
        let lift: CGFloat = inAccessory ? -4 : -12
        return VStack(spacing: dot * 1.2) {
            ringView(week, on: on)
                .frame(width: ring, height: ring)
                // magnified toward the centre line (ui.js lensUpdate)
                .visualEffect { content, geo in
                    let f = geo.frame(in: .named(space))
                    let d = (isHorizontal ? f.midX : f.midY) - mid
                    let s = 1 + 0.2 * exp(-(d * d) / (2 * 58 * 58))
                    return content
                        .scaleEffect(s)
                        .offset(y: isHorizontal ? (s - 1) * lift : 0)
                }
            Circle()
                .fill(week.now ? Theme.red : .clear)
                .frame(width: dot, height: dot)
                .scaleEffect(on ? 1.2 : 1)
        }
        .padding(isHorizontal ? .top : .leading, padLead)
        .padding(isHorizontal ? .bottom : .trailing, padTrail)
        .frame(width: isHorizontal ? slot : nil, height: isHorizontal ? nil : slot)
        .overlay(alignment: isHorizontal ? .topLeading : .topLeading) {
            if first {
                // a hairline between the regular season and the playoffs
                let line = ring * 0.64
                Path { p in
                    if isHorizontal {
                        p.move(to: CGPoint(x: 0, y: padLead + ring * 0.18)); p.addLine(to: CGPoint(x: 0, y: padLead + ring * 0.18 + line))
                    } else {
                        p.move(to: CGPoint(x: padLead + ring * 0.18, y: 0)); p.addLine(to: CGPoint(x: padLead + ring * 0.18 + line, y: 0))
                    }
                }
                .stroke(Theme.ink.opacity(0.16), style: StrokeStyle(lineWidth: 1.5, dash: [3, 3]))
            }
        }
        // fading with distance from the centre line
        .visualEffect { content, geo in
            let f = geo.frame(in: .named(space))
            let d = (isHorizontal ? f.midX : f.midY) - mid
            return content.opacity(0.4 + 0.6 * exp(-(d * d) / (2 * 120 * 120)))
        }
        // which week sits on the centre line, as the wheel moves
        .onGeometryChange(for: Bool.self) { geo in
            let f = geo.frame(in: .named(space))
            return abs((isHorizontal ? f.midX : f.midY) - mid) < slot / 2
        } action: { isCentred in
            if isCentred { centred = week.w }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            if week.w != selected { UISelectionFeedbackGenerator().selectionChanged() }
            visWeek = nil
            onSelect(week.w)
        }
        .accessibilityElement()
        .accessibilityLabel(week.label)
        .accessibilityAddTraits(week.w == selected ? [.isButton, .isSelected] : .isButton)
    }

    private func ringView(_ week: RailWeek, on: Bool) -> some View {
        let progress: Color = week.playoff ? Theme.gold : (on ? .white : Theme.ink)
        let track: Color = on ? .white.opacity(0.18) : (week.playoff && !week.played ? Theme.gold.opacity(0.35) : Theme.line)
        let txt = week.num.count > 2
        return ZStack {
            if on {
                // the gliding disc
                Circle()
                    .fill(Theme.navy)
                    .shadow(color: Theme.navy.opacity(0.26), radius: compact ? 3 : 5, y: compact ? 2 : 4)
                    .matchedGeometryEffect(id: "disc", in: discSpace)
            }
            Circle().stroke(track, lineWidth: 3)
            Circle()
                .trim(from: 0, to: week.played ? 1 : 0)
                .stroke(progress, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .opacity(week.played ? 1 : 0)
            Text(week.num)
                .font(.system(size: ring * (txt ? 0.26 : 0.37), weight: .heavy))
                .tracking(txt ? ring * 0.26 * 0.02 : 0)
                .monospacedDigit()
                .foregroundStyle(on ? Color.white : (week.played ? Theme.ink : Theme.muted))
        }
        .animation(swiping ? .easeOut(duration: 0.22) : .spring(response: 0.6, dampingFraction: 0.72), value: shownWeek)
    }

    /// Week w on the centre line: with the spacers, the i-th week is
    /// centred at an offset of exactly i slots, whatever the wheel's width.
    private func centre(_ w: Int) {
        guard let i = weeks.firstIndex(where: { $0.w == w }) else { return }
        let offset = CGFloat(i) * slot
        if horizontal { position.scrollTo(x: offset) } else { position.scrollTo(y: offset) }
    }

    @Namespace private var discSpace
    private static let space = "week-wheel"

    // MARK: Settling

    /// The swipe is over (finger up, momentum and snapping done): the week on
    /// the centre line is chosen. A wheel that moved without the person
    /// swiping is brought back to the chosen week.
    private func settle(_ proxy: ScrollViewProxy) {
        let was = swiping
        swiping = false
        guard let week = centred else { return }
        if was && week != selected {
            UISelectionFeedbackGenerator().selectionChanged()
            onSelect(week)
            return
        }
        visWeek = nil
        if week != selected {
            withAnimation(.smooth(duration: 0.4)) { centre(selected) }
        }
    }
}

/// Lands the wheel with a week's centre on the centre line. With a spacer
/// of half the wheel less half a slot at each end, week i is centred at an
/// offset of exactly i slots.
private struct SlotSnap: ScrollTargetBehavior {
    let slot: CGFloat
    let horizontal: Bool

    func updateTarget(_ target: inout ScrollTarget, context: TargetContext) {
        if horizontal {
            target.rect.origin.x = (target.rect.origin.x / slot).rounded() * slot
        } else {
            target.rect.origin.y = (target.rect.origin.y / slot).rounded() * slot
        }
    }
}
