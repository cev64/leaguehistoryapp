import SwiftUI

// What If (season.html's What If switch): pick the coming week's winners
// and watch the standings and the brackets move. A card with a switch sits
// above the Standings and Playoffs views of the latest week; on, it opens
// the week's games, one small card each, a side to tap for the winner.
// The engine counts the picks into every record (Bridge.season.whatIf,
// and the `picks` of Bridge.season.standings and .bracket).

// MARK: Data (Bridge.season.whatIf)

/// The switch's card for a week's tab: the coming week's games, each side
/// with its record and seed as the picks would leave them.
struct WhatIfBar: Decodable, Equatable {
    struct Side: Decodable, Hashable, Identifiable {
        let id: String
        let record: String
        /// A pick has changed this record.
        let recordMoved: Bool
        let seed: SeedLabel?
        /// "up" or "down" where a pick moved the seed.
        let move: String?
        /// The seed it moved from ("#8").
        let was: String?
    }
    struct Game: Decodable, Hashable, Identifiable {
        /// The game's place on the week's slate, the key of its pick.
        let index: Int
        /// The division of a division game, "Cross-division", or "Game 1".
        let kind: String
        /// The team picked to win it, or nil.
        let pick: String?
        let sides: [Side]
        var id: Int { index }
    }
    let week: Int
    let count: Int
    let total: Int
    /// "With your Week 9 picks", or "" with nothing picked.
    let note: String
    let games: [Game]
}

// MARK: State

/// One season's What If: the switch, the week it picks and the picks, kept
/// on the device (UserDefaults "pp-whatif-<league>-<year>") so they last
/// from one visit to the next and between the Standings and Playoffs views.
/// Picks for a week that has since been played are dropped.
@MainActor
@Observable
final class WhatIfStore {
    private(set) var isOn = false
    /// The week the picks are for (Bridge.season.info's pickWeek).
    private(set) var week: Int?
    /// Slate index → the team picked to win.
    private(set) var picks: [Int: String] = [:]
    @ObservationIgnored private let key: String

    init(league: String, year: Int) {
        key = "pp-whatif-\(league)-\(year)"
    }

    private struct Saved: Codable {
        var on: Bool
        var week: Int?
        var picks: [String: String]
    }

    /// Read what was saved, once the season knows its pick week.
    func configure(pickWeek: Int?) {
        week = pickWeek
        var saved = UserDefaults.standard.data(forKey: key).flatMap { try? JSONDecoder().decode(Saved.self, from: $0) }
        if let launch = DebugLaunch.whatIf {
            saved = Saved(on: launch.on, week: pickWeek, picks: Dictionary(uniqueKeysWithValues: launch.picks.map { (String($0.key), $0.value) }))
        }
        isOn = saved?.on ?? false
        // The picks belong to their week: once it has been played they go.
        if let saved, saved.week == pickWeek, pickWeek != nil {
            picks = Dictionary(uniqueKeysWithValues: saved.picks.compactMap { k, v in Int(k).map { ($0, v) } })
        } else {
            picks = [:]
        }
        save()
    }

    func setOn(_ on: Bool) {
        guard on != isOn else { return }
        isOn = on
        save()
    }

    /// A tap on a side: its team picked to win, or unpicked if it was.
    func pick(game: Int, team: String) {
        if picks[game] == team { picks[game] = nil } else { picks[game] = team }
        save()
    }

    func clear() {
        guard !picks.isEmpty else { return }
        picks = [:]
        save()
    }

    /// Drops picks that name neither side of their game (a slate that changed).
    func keep(validFor games: [WhatIfBar.Game]) {
        let valid = picks.filter { i, team in games.first { $0.index == i }?.sides.contains { $0.id == team } == true }
        if valid.count != picks.count {
            picks = valid
            save()
        }
    }

    /// The picks as the bridge takes them, JSON with its keys in order (so
    /// the same picks always make the same panel key): `{"0":"r3","1":"r4"}`.
    var picksJSON: String {
        let body = picks.keys.sorted().map { "\"\($0)\":\(Self.quoted(picks[$0]!))" }.joined(separator: ",")
        return "{\(body)}"
    }

    /// The picks the standings and brackets count: only with the switch on.
    var applied: String? { isOn && !picks.isEmpty ? picksJSON : nil }

    private static func quoted(_ s: String) -> String {
        let data = (try? JSONEncoder().encode(s)) ?? Data("\"\"".utf8)
        return String(decoding: data, as: UTF8.self)
    }

    private func save() {
        let saved = Saved(on: isOn, week: week, picks: Dictionary(uniqueKeysWithValues: picks.map { (String($0.key), $0.value) }))
        if let data = try? JSONEncoder().encode(saved) { UserDefaults.standard.set(data, forKey: key) }
    }
}

extension WhatIfStore {
    /// A panel's Bridge call, "Bridge.season.standings(year, week, view)",
    /// with the picks as its last argument while they apply. Its arguments
    /// (and so its PanelCache key) change with every pick.
    func call(_ expression: String, _ arguments: [String: Any]) -> (String, [String: Any]) {
        guard let picks = applied, expression.hasSuffix(")") else { return (expression, arguments) }
        var args = arguments
        args["picks"] = picks
        return (String(expression.dropLast()) + ", picks)", args)
    }
}

// MARK: The card

/// The switch, and the week's games it opens.
struct WhatIfCard: View {
    @Environment(LeagueSession.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let season: Season
    let week: Int
    @Bindable var whatIf: WhatIfStore

    @State private var bar: WhatIfBar?

    /// An answer kept in PanelCache, null (no switch on this tab) included.
    private struct Answer { let bar: WhatIfBar? }

    private var key: String {
        "\(session.engine.instance.uuidString)|whatIf|\(season.year)|\(week)|\(whatIf.picksJSON)"
    }

    private var motion: Animation? { reduceMotion ? nil : .smooth(duration: 0.35) }

    var body: some View {
        // Something to hang the read on even before there's a card (an
        // empty Group would carry no task). The card brings its own gap to
        // what's under it, so a tab without one has none.
        VStack(spacing: 0) {
            if let bar {
                content(bar)
                    .padding(.bottom, 14)
            } else {
                Color.clear.frame(height: 0)
            }
        }
        .task(id: key) { await read() }
    }

    private func read() async {
        if let hit = PanelCache[key] as? Answer {
            apply(hit.bar)
            return
        }
        do {
            let answer = try await session.engine.call(WhatIfBar.self, "Bridge.season.whatIf(year, week, picks)",
                                                       ["year": season.year, "week": week, "picks": whatIf.picksJSON])
            PanelCache.store(Answer(bar: answer), for: key)
            guard !Task.isCancelled else { return }
            apply(answer)
        } catch EngineError.empty {
            // null: this week's tab doesn't carry the switch.
            PanelCache.store(Answer(bar: nil), for: key)
            apply(nil)
        } catch {
            // The switch is an extra: without it the tab is as it was.
        }
    }

    private func apply(_ answer: WhatIfBar?) {
        withAnimation(bar == nil ? nil : motion) { bar = answer }
        if let answer { whatIf.keep(validFor: answer.games) }
    }

    private var isOn: Binding<Bool> {
        Binding(get: { whatIf.isOn }, set: { on in
            withAnimation(motion) { whatIf.setOn(on) }
        })
    }

    private func content(_ bar: WhatIfBar) -> some View {
        Card {
            Toggle(isOn: isOn) {
                header(bar)
                    .contentShape(Rectangle())
                    // The whole head flips the switch, as the site's does.
                    .onTapGesture { isOn.wrappedValue.toggle() }
            }
            .toggleStyle(.switch)
            .tint(Theme.accent)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .accessibilityLabel("What if: pick the Week \(bar.week) winners")
            .accessibilityHint("Shows the week's games to pick")
            .sensoryFeedback(.selection, trigger: whatIf.isOn)

            if whatIf.isOn {
                VStack(spacing: 0) {
                    Rectangle().fill(Theme.line).frame(height: 1)
                    WhatIfGames(season: season, bar: bar, whatIf: whatIf)
                    footer(bar)
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
    }

    private func header(_ bar: WhatIfBar) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "arrow.left.and.right")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 28, height: 28)
                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .accessibilityHidden(true)
            Text("What If · Week \(bar.week)")
                .displayStyle(20)
                .foregroundStyle(Theme.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func footer(_ bar: WhatIfBar) -> some View {
        let count = Text("\(bar.count) of \(bar.total) picked")
            .font(.footnote.weight(.medium))
            .foregroundStyle(Theme.ink3)
            .monospacedDigit()
            .contentTransition(.numericText())
            .accessibilityAddTraits(.updatesFrequently)
        let clear = Button("Clear picks") {
            withAnimation(motion) { whatIf.clear() }
        }
        .font(.footnote.weight(.semibold))
        .lineLimit(1)
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .controlSize(.small)
        .tint(Theme.ink2)
        .disabled(bar.count == 0)
        .sensoryFeedback(.impact(weight: .light), trigger: bar.count == 0)
        // Side by side, or the button under the count in the largest type.
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) {
                count.fixedSize()
                Spacer(minLength: 8)
                clear.fixedSize()
            }
            VStack(alignment: .leading, spacing: 8) {
                count
                clear
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 4)
        .padding(.bottom, 12)
    }
}

/// The week's games: a row to swipe through on a compact screen, the next
/// card peeking in; all of them in a grid where there's room. A grid that
/// would run past two rows (the unfolded Duo, a narrow iPad window) stays a
/// row, so the card never pushes the tables off the screen.
private struct WhatIfGames: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    let season: Season
    let bar: WhatIfBar
    @Bindable var whatIf: WhatIfStore
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .footnote) private var cardWidth: CGFloat = 236
    @State private var width: CGFloat = 0

    var body: some View {
        Group {
            if sizeClass == .regular && rows <= 2 {
                grid
            } else {
                row
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }

    private var row: some View {
        ScrollView(.horizontal) {
            LazyHStack(alignment: .top, spacing: 8) {
                ForEach(bar.games) { game in
                    WhatIfGameCard(season: season, game: game, showsCheck: true, whatIf: whatIf)
                        .containerRelativeFrame(.horizontal) { length, _ in min(cardWidth, length * (typeSize.isAccessibilitySize ? 0.88 : 0.8)) }
                }
            }
            .scrollTargetLayout()
        }
        .scrollIndicators(.hidden)
        .scrollTargetBehavior(.viewAligned)
        .contentMargins(.horizontal, 14, for: .scrollContent)
        .scrollClipDisabled(false)
        .padding(.top, 12)
        .padding(.bottom, 6)
    }

    /// As many columns as fit at 180 points, spread so the rows come out
    /// even (five games: five across, or three and two, never four and one).
    private var rows: Int {
        let n = max(1, bar.games.count)
        // The grid's own side padding, 14 a side, comes off the width.
        let fit = max(1, Int((width - 28 + 8) / (180 + 8)))
        return Int((Double(n) / Double(min(n, fit))).rounded(.up))
    }

    private var columns: Int {
        Int((Double(max(1, bar.games.count)) / Double(rows)).rounded(.up))
    }

    private var grid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8, alignment: .top), count: columns), spacing: 8) {
            ForEach(bar.games) { game in
                // With them all in view the tint and rule say which side is
                // picked; the names get the check's room.
                WhatIfGameCard(season: season, game: game, showsCheck: columns < 5, whatIf: whatIf)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 12)
        .padding(.bottom, 6)
    }
}

/// One game: its kind and whether it's picked, then a button for each side.
private struct WhatIfGameCard: View {
    let season: Season
    let game: WhatIfBar.Game
    let showsCheck: Bool
    @Bindable var whatIf: WhatIfStore

    private func name(_ id: String) -> String { season.team(id)?.name ?? id }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text(game.kind)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Text(game.pick == nil ? "Pick" : "Picked")
                    .foregroundStyle(game.pick == nil ? Theme.ink3 : Theme.accentInk)
            }
            .font(.caption2.weight(.bold))
            .tracking(0.8)
            .textCase(.uppercase)
            .foregroundStyle(Theme.ink3)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .accessibilityHidden(true)
            ForEach(game.sides) { side in
                Rectangle().fill(Theme.line).frame(height: 1)
                WhatIfSideButton(season: season, gameIndex: game.index, side: side,
                                 picked: game.pick == side.id, passed: game.pick != nil && game.pick != side.id,
                                 showsCheck: showsCheck, whatIf: whatIf)
            }
        }
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.line))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(game.sides.count == 2 ? "\(name(game.sides[0].id)) versus \(name(game.sides[1].id))" : game.kind)
    }
}

/// A side of a game: the team, its record and seed as the picks leave
/// them, and a check. Picked, it's tinted and ruled in the accent; the
/// other side steps back.
private struct WhatIfSideButton: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    let season: Season
    let gameIndex: Int
    let side: WhatIfBar.Side
    let picked: Bool
    let passed: Bool
    let showsCheck: Bool
    @Bindable var whatIf: WhatIfStore

    var body: some View {
        let team = season.team(side.id)
        let name = team?.name ?? side.id
        Button {
            withAnimation(reduceMotion ? nil : .snappy(duration: 0.25)) {
                whatIf.pick(game: gameIndex, team: side.id)
            }
        } label: {
            HStack(spacing: 8) {
                if let team {
                    TeamBadge(team: team, size: 24, corner: 7)
                        .opacity(passed ? 0.5 : 1)
                        .saturation(passed ? 0.6 : 1)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(name)
                        .font(.footnote.weight(picked ? .bold : passed ? .medium : .semibold))
                        .foregroundStyle(picked ? Theme.accentInk : passed ? Theme.ink2 : Theme.ink)
                        // In the largest type a long name takes a second line.
                        .lineLimit(typeSize.isAccessibilitySize ? 2 : 1)
                        .truncationMode(.tail)
                    HStack(spacing: 6) {
                        Text(side.record)
                            .font(.caption2.weight(side.recordMoved ? .bold : .medium))
                            .foregroundStyle(side.recordMoved ? Theme.accentInk : Theme.ink3)
                            .monospacedDigit()
                            .contentTransition(.numericText())
                            .fixedSize()
                        if let seed = side.seed {
                            HStack(spacing: 3) {
                                SeedChip(seed)
                                if let move = side.move {
                                    Image(systemName: move == "up" ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill")
                                        .font(.system(size: 7, weight: .bold))
                                        .foregroundStyle(move == "up" ? Theme.green : Theme.red)
                                        .transition(.scale.combined(with: .opacity))
                                }
                            }
                            .fixedSize()
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if showsCheck {
                    check
                }
            }
            .padding(.leading, 10)
            .padding(.trailing, showsCheck ? 10 : 8)
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity, minHeight: 50, alignment: .leading)
            .background(picked ? Theme.accentSoft : Color.clear)
            .overlay(alignment: .leading) {
                if picked { Rectangle().fill(Theme.accent).frame(width: 3) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(PanelRowPressStyle())
        .sensoryFeedback(.selection, trigger: picked)
        .accessibilityLabel(label(name))
        .accessibilityValue(picked ? "Picked" : "")
        .accessibilityAddTraits(picked ? [.isToggle, .isSelected] : .isToggle)
        .accessibilityHint(picked ? "Double-tap to unpick" : "Double-tap to pick \(name) to win")
    }

    private func label(_ name: String) -> String {
        var s = "\(name) \(picked ? "picked to win" : "to win"), \(side.record)"
        if let seed = side.seed { s += ", \(seed.chip) seed, \(seed.note)" }
        if let move = side.move, let was = side.was { s += ", \(move == "up" ? "up" : "down") from \(was)" }
        return s
    }

    private var check: some View {
        ZStack {
            Circle()
                .strokeBorder(passed ? Theme.line : Theme.line2, lineWidth: 1.5)
            if picked {
                Circle().fill(Theme.accent)
                    .transition(.scale(scale: 0.6).combined(with: .opacity))
                Image(systemName: "checkmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.white)
                    .transition(.opacity)
            }
        }
        .frame(width: 20, height: 20)
        .accessibilityHidden(true)
    }
}
