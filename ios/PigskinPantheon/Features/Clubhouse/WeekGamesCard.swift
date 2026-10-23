import SwiftUI

// A week still to be played, on the Matchups view: one "Week N Matchups"
// card with a tile per game. On the pick week the tiles are the league's
// pick'em too (as on the site): a tap on a team picks it to win, again
// clears it, each game has its Lock of the Week, and a pick'em bar under the
// title carries who has picked, the Lock's rule, the save and the Leaderboard.
// Once the week has locked, each team shows how many picked it. Every tile
// keeps its way into the rivalry preview ("Rivalry & stakes").
//
// Picking is local and instant: a tap changes the store's draft (synchronous,
// no engine call), the save runs in the background a moment later, and the
// board it reads afterwards is applied only where it differs, without an
// animation. Every state of a tile is the same size: a tap changes colour
// and opacity only, never a font weight, a width or a line count.

struct WeekGamesCard: View {
    @Environment(LeagueSession.self) private var session
    @Environment(AppModel.self) private var app
    @Bindable var store: SeasonStore
    let info: SeasonInfo
    let season: Season
    let payload: WeekPayload

    @State private var pickem: PickemWeek?

    private var club: ClubhouseStore { session.clubhouse }
    private var isPickWeek: Bool { payload.week == info.pickWeek }

    private var key: String {
        "\(club.revision)|\(app.account.user?.id ?? "-")|\(season.year)|\(payload.week)"
    }

    /// The week's pick'em, once read (the pick week only).
    private var week: PickemWeek? {
        guard isPickWeek, let pickem, pickem.week == payload.week, pickem.year == season.year, !pickem.games.isEmpty else { return nil }
        return pickem
    }

    private var mode: WeekGameTile.Mode {
        guard let week else { return .plain }
        if week.open { return club.isMember ? .pick : .plain }
        return week.games.contains(where: { !$0.picks.values.allSatisfy(\.isEmpty) }) ? .locked : .plain
    }

    var body: some View {
        let week = self.week
        let mode = self.mode
        let picks = week.map { club.picks(for: $0) } ?? [:]
        Card {
            CardHead(title: "Week \(payload.week) Matchups", symbol: CardIcon.versus, meta: meta(week))
            if let week {
                PickemBar(season: season, data: week, picks: picks)
                Rectangle().fill(Theme.line).frame(height: 1)
            }
            AdaptiveGrid(minWidth: 300, spacing: 10) {
                ForEach(Array(payload.matchups.enumerated()), id: \.element) { i, m in
                    let game = week?.games.first { ($0.a == m.a && $0.b == m.b) || ($0.a == m.b && $0.b == m.a) }
                    WeekGameTile(season: season, week: payload.week, index: i, matchup: m,
                                 game: game, mode: game == nil ? .plain : mode,
                                 draft: game.flatMap { picks[$0.key] },
                                 onPick: { team in if let game, let week { club.pick(team, in: game, of: week) } },
                                 onLock: { if let game, let week { club.toggleLock(game, of: week) } })
                }
            }
            .padding(12)
            if let week, mode == .pick {
                Rectangle().fill(Theme.line).frame(height: 1)
                footer(week, picks)
            }
            if isPickWeek, payload.views.contains(where: { $0.id == "panel-picture" }) {
                Rectangle().fill(Theme.line).frame(height: 1)
                whatIfLink
            }
        }
        // One tap, one tick: the winners as a whole, and the lock.
        .sensoryFeedback(.selection, trigger: picks.values.map(\.winner).sorted())
        .sensoryFeedback(.impact(weight: .medium), trigger: picks.first { $0.value.lock }?.key)
        .task(id: key) {
            guard isPickWeek else { return }
            await club.prepare(year: season.year)
            let answer = await club.week(year: season.year, week: payload.week)
            // A save's new board, another device's: only what changed, and
            // never with an animation (the picks shown are the store's draft).
            if answer != pickem {
                var quiet = Transaction()
                quiet.disablesAnimations = true
                withTransaction(quiet) { pickem = answer }
            }
        }
    }

    private func meta(_ week: PickemWeek?) -> String {
        guard let week else { return isPickWeek ? "Next up" : "Not yet played" }
        if week.open { return PickemWords.locks(week.deadlineDate) }
        return week.locked ? "Locked" : "Not yet played"
    }

    /// "3 of 5 picked · Lock: Bijan Mustard".
    private func footer(_ week: PickemWeek, _ picks: [String: ClubhouseStore.Draft]) -> some View {
        let lock = picks.values.first { $0.lock }.map { PickemWords.name($0.winner, season) }
        return Text("\(picks.count) of \(week.games.count) picked · Lock: \(lock ?? "none yet")")
            .font(.footnote.weight(.semibold))
            .monospacedDigit()
            .foregroundStyle(picks.count == week.games.count ? Theme.green : Theme.ink2)
            .contentTransition(.numericText(value: Double(picks.count)))
            .animation(.snappy(duration: 0.2), value: picks.count)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
    }

    /// The way into What If: the Playoffs view, switch on.
    private var whatIfLink: some View {
        Button {
            store.whatIf.setOn(true)
            withAnimation { store.view = "panel-picture" }
            store.scrollToTop += 1
        } label: {
            // The arrow keeps to the last word where the line wraps.
            Text("What if? Pick the winners\u{00A0}\(Image(systemName: "arrow.right"))")
                .multilineTextAlignment(.center)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.accentInk)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .contentShape(Rectangle())
        }
        .buttonStyle(Felt(.plain))
        .accessibilityHint("Opens the Playoffs view with the What If switch on")
    }
}

// MARK: - The pick'em bar

/// Under the card's title: "Pick'em · 6 of 10 have picked" and the
/// Leaderboard; then the Lock's rule with the save on the right, or the
/// way in (sign in, choose a team), or that the week has locked.
private struct PickemBar: View {
    @Environment(LeagueSession.self) private var session
    @Environment(\.dynamicTypeSize) private var typeSize
    let season: Season
    let data: PickemWeek
    let picks: [String: ClubhouseStore.Draft]

    private var store: ClubhouseStore { session.clubhouse }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 10) {
                headline
                    .frame(maxWidth: .infinity, alignment: .leading)
                leaderboard
            }
            if data.open {
                if store.isMember {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text("Your \(Text("Lock").fontWeight(.semibold)) counts double.")
                            .font(.footnote)
                            .foregroundStyle(Theme.ink2)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        PickemSaveSlot(year: data.year, week: data.week, games: data.games)
                    }
                } else {
                    prompt
                }
                if let soon = data.deadlineDate, soon.timeIntervalSinceNow < 86_400, soon.timeIntervalSinceNow > 0 {
                    Label { Text("Locks in \(Text(soon, style: .relative))") } icon: { Image(systemName: "clock") }
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.red)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// "PICK'EM · 6 of 10 have picked", or "PICK'EM · Locked · 8 managers picked".
    private var headline: some View {
        let made = picks.count
        let mine = made > 0 ? [store.me].compactMap { $0 } : []
        let picked = data.open ? Set(data.picked + mine).count : data.picked.count
        let members = max(data.members, picked)
        let rest: String = data.open
            ? (members > 0 ? "\(picked) of \(members) have picked" : "Pick every winner")
            : "Locked · \(Fmt.plural(picked, "manager")) picked"
        return Text("\(Text("Pick'em").font(.caption.weight(.heavy)).foregroundStyle(Theme.goldInk)) · \(rest)")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Theme.ink)
            .monospacedDigit()
            .contentTransition(.numericText(value: Double(picked)))
            .animation(.snappy(duration: 0.2), value: picked)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// What stands between the visitor and their picks: a button.
    @ViewBuilder private var prompt: some View {
        switch store.access {
        case .signedOut:
            promptButton("Sign in to play") { session.sheet = .clubhouseSignIn }
        case .unclaimed:
            promptButton(store.isDemo ? "Choose a team" : "Claim your team") { session.sheet = .claim }
        case .unavailable(let message):
            Label(message, systemImage: "exclamationmark.triangle")
                .font(.footnote)
                .foregroundStyle(Theme.ink3)
                .fixedSize(horizontal: false, vertical: true)
        default:
            EmptyView()
        }
    }

    private func promptButton(_ title: String, _ tap: @escaping () -> Void) -> some View {
        Button(title, action: tap)
            .font(.footnote.weight(.bold))
            .buttonStyle(Felt(.borderedProminent))
            .buttonBorderShape(.capsule)
            .controlSize(.small)
            .fixedSize()
    }

    private var leaderboard: some View {
        Button {
            session.sheet = .leaderboard
        } label: {
            Label("Leaderboard", systemImage: "list.number")
                .font(.footnote.weight(.semibold))
                .lineLimit(1)
        }
        .buttonStyle(Felt(.bordered))
        .buttonBorderShape(.capsule)
        .controlSize(.small)
        .fixedSize()
    }
}

/// The save, in a slot that keeps its size: "Saving…", then "✓ Saved"
/// (fading after a couple of seconds), or "Not saved" (a tap tries again).
/// Every wording is laid in the slot at once, only the one shown visible.
private struct PickemSaveSlot: View {
    @Environment(LeagueSession.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let year: Int
    let week: Int
    let games: [PickemWeek.Game]

    @State private var savedShown = false

    private enum Shown: Equatable { case none, saving, saved, failed }

    var body: some View {
        let store = session.clubhouse
        let state = store.saveState(year: year, week: week)
        let shown: Shown = switch state {
        case .saving: .saving
        case .failed: .failed
        case .saved: savedShown ? .saved : .none
        case .idle: .none
        }
        ZStack(alignment: .trailing) {
            Label("Saving…", systemImage: "arrow.triangle.2.circlepath")
                .foregroundStyle(Theme.ink3)
                .opacity(shown == .saving ? 1 : 0)
            Label("Saved", systemImage: "checkmark")
                .foregroundStyle(Theme.green)
                .opacity(shown == .saved ? 1 : 0)
            Button {
                store.retrySave(year: year, week: week, games: games)
            } label: {
                Label("Not saved", systemImage: "exclamationmark.triangle.fill")
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.red)
            .opacity(shown == .failed ? 1 : 0)
            .allowsHitTesting(shown == .failed)
            .accessibilityHint("Tap to try again")
        }
        .font(.caption.weight(.semibold))
        .lineLimit(1)
        .fixedSize()
        .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: shown)
        .task(id: state) {
            // "Saved" for a moment, then out of the way.
            guard state == .saved else { savedShown = false; return }
            savedShown = true
            try? await Task.sleep(for: .seconds(2.4))
            if !Task.isCancelled { savedShown = false }
        }
        .accessibilityElement(children: shown == .failed ? .contain : .ignore)
        .accessibilityLabel(shown == .saving ? "Saving" : shown == .saved ? "Saved" : shown == .failed ? "Not saved" : "")
        .accessibilityAddTraits(.updatesFrequently)
    }
}

// MARK: - A game

/// One game: both teams (badge, name, "3–5 · manager"), a tap on one to pick
/// it on the pick week, the game's Lock, and the rivalry preview. The tile is
/// the same shape in every mode, so nothing moves when the pick'em arrives or
/// a pick is made.
struct WeekGameTile: View {
    enum Mode { case plain, pick, locked }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let season: Season
    let week: Int
    let index: Int
    let matchup: Matchup
    let game: PickemWeek.Game?
    let mode: Mode
    let draft: ClubhouseStore.Draft?
    let onPick: (String) -> Void
    let onLock: () -> Void

    private var isLock: Bool { mode == .pick ? draft?.lock == true : (mode == .locked && game?.myLock == true) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("Game \(index + 1)")
                    .font(.caption2.weight(.bold))
                    .tracking(0.8)
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.ink3)
                    .accessibilityHidden(true)
                Spacer(minLength: 4)
                switch mode {
                case .pick: lockToggle
                case .locked where game?.myLock == true:
                    Label("Your lock", systemImage: "lock.fill")
                        .font(.caption2.weight(.bold))
                        .textCase(.uppercase)
                        .foregroundStyle(Theme.goldInk)
                default: EmptyView()
                }
            }
            .frame(minHeight: 24)
            VStack(spacing: 6) {
                side(matchup.a, matchup.ar)
                side(matchup.b, matchup.br)
            }
            Rectangle().fill(Theme.line).frame(height: 1)
            rivalryLink
        }
        .padding(10)
        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Game \(index + 1): \(PickemWords.name(matchup.a, season)) versus \(PickemWords.name(matchup.b, season))")
    }

    // MARK: A side

    @ViewBuilder private func side(_ id: String, _ record: String) -> some View {
        if let team = season.team(id) {
            switch mode {
            case .pick:
                let picked = draft?.winner == id
                let passed = draft != nil && !picked
                Button { onPick(id) } label: {
                    row(team: team, detail: "\(record) · \(team.owner)", picked: picked, gold: picked && draft?.lock == true, passed: passed) {
                        PickCheckMark(picked: picked, gold: draft?.lock == true)
                    }
                }
                .buttonStyle(PickSidePressStyle())
                .accessibilityLabel("\(team.name), \(team.owner), \(record)")
                .accessibilityValue(picked ? (draft?.lock == true ? "Picked to win, your Lock" : "Picked to win") : "")
                .accessibilityAddTraits(picked ? [.isButton, .isSelected] : .isButton)
                .accessibilityHint(picked ? "Double-tap to clear the pick" : "Double-tap to pick \(team.name) to win")
            case .locked:
                let count = game?.picks[id]?.count ?? 0
                let mine = game?.mine == id
                NavigationLink(value: LeagueRoute.team(year: season.year, teamId: id)) {
                    row(team: team, detail: Fmt.plural(count, "pick"), picked: mine, gold: mine && game?.myLock == true,
                        passed: game?.mine != nil && !mine, split: share(id)) {
                        if mine { YouTag() } else { Color.clear }
                    }
                }
                .buttonStyle(Felt(.plain))
                .accessibilityLabel("\(team.name), \(record): \(Fmt.plural(count, "pick"))\(mine ? ", your pick" : "")")
            case .plain:
                NavigationLink(value: LeagueRoute.team(year: season.year, teamId: id)) {
                    row(team: team, detail: "\(record) · \(team.owner)", picked: false, gold: false, passed: false) {
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Theme.line2)
                    }
                }
                .buttonStyle(Felt(.plain))
                .accessibilityLabel("\(team.name), \(team.owner), \(record)")
                .accessibilityHint("Opens the team's season")
            }
        }
    }

    /// The share of the league's picks a side got, once the week has locked.
    private func share(_ id: String) -> Double {
        guard let game else { return 0 }
        let total = (game.picks[game.a]?.count ?? 0) + (game.picks[game.b]?.count ?? 0)
        return total == 0 ? 0 : Double(game.picks[id]?.count ?? 0) / Double(total)
    }

    /// Badge, the name (always bold) over its line, and a fixed slot on the
    /// right: the same frame in every state. Picked is blue (a soft fill and
    /// a bar down the leading edge), the Lock's pick gold, the other side
    /// grey with its badge dimmed.
    private func row<Trailing: View>(team: Team, detail: String, picked: Bool, gold: Bool, passed: Bool,
                                     split: Double? = nil, @ViewBuilder trailing: () -> Trailing) -> some View {
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        let tint = gold ? PickTint.gold : Theme.accent
        let fill = gold ? PickTint.goldFill : Theme.accentSoft
        return HStack(spacing: 10) {
            TeamBadge(team: team, size: 30, corner: 9)
                .opacity(passed ? 0.55 : 1)
            VStack(alignment: .leading, spacing: 2) {
                Text(team.name)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(passed ? Theme.ink3 : Theme.ink)
                    .lineLimit(1)
                Text(detail)
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(Theme.ink3)
                    .lineLimit(1)
                if let split {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Theme.surface3)
                            Capsule().fill(picked ? tint : Theme.ink3.opacity(0.5))
                                .frame(width: max(3, geo.size.width * split))
                        }
                    }
                    .frame(height: 3)
                    .padding(.top, 2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing()
                .frame(width: 30, height: 22)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background {
            ZStack {
                shape.fill(Theme.card)
                shape.fill(fill).opacity(picked ? 1 : 0)
            }
        }
        .overlay(alignment: .leading) {
            UnevenRoundedRectangle(topLeadingRadius: 10, bottomLeadingRadius: 10)
                .fill(tint)
                .frame(width: 3)
                .opacity(picked ? 1 : 0)
        }
        .overlay(shape.strokeBorder(Theme.line))
        .clipShape(shape)
        .contentShape(shape)
        // Colour and opacity only, on this side alone.
        .animation(reduceMotion ? nil : .snappy(duration: 0.2), value: picked)
        .animation(reduceMotion ? nil : .snappy(duration: 0.2), value: passed)
        .animation(reduceMotion ? nil : .snappy(duration: 0.2), value: gold)
    }

    // MARK: The lock

    /// A fixed 72-point pill that always reads "Lock": dimmed until the game
    /// has a pick, gold when it's the Lock of the Week.
    private var lockToggle: some View {
        let on = draft?.lock == true
        return Button(action: onLock) {
            HStack(spacing: 4) {
                ZStack {
                    Image(systemName: "lock.fill").opacity(on ? 1 : 0)
                    Image(systemName: "lock.open").opacity(on ? 0 : 1)
                }
                Text("Lock")
            }
            .font(.caption2.weight(.bold))
            .textCase(.uppercase)
            .foregroundStyle(on ? Theme.navy : Theme.goldInk)
            .frame(width: 72, height: 24)
            .background(on ? PickTint.gold : Theme.goldSoft, in: Capsule())
            .opacity(draft == nil ? 0.45 : 1)
            .contentShape(Capsule())
            .animation(reduceMotion ? nil : .snappy(duration: 0.2), value: on)
        }
        .buttonStyle(PickSidePressStyle())
        .disabled(draft == nil)
        .accessibilityLabel("Lock of the Week")
        .accessibilityValue(on ? "On, worth two points" : "Off")
        .accessibilityHint(draft == nil ? "Pick a winner first" : "Your Lock counts double. One a week.")
    }

    // MARK: The rivalry

    /// The game against the league's history (RivalryView).
    private var rivalryLink: some View {
        NavigationLink(value: LeagueRoute.rivalry(year: season.year, week: week, a: matchup.a, b: matchup.b)) {
            HStack(spacing: 6) {
                Image(systemName: CardIcon.versus)
                Text("Rivalry & stakes")
                Image(systemName: "chevron.right").font(.caption.weight(.bold))
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Theme.accentInk)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(Felt(.plain))
        .accessibilityLabel("Rivalry preview: \(PickemWords.name(matchup.a, season)) versus \(PickemWords.name(matchup.b, season))")
        .accessibilityHint("The all-time series and the records within reach")
    }
}

/// The Lock's gold, as on the site (#e0a21b on #fff8e8).
enum PickTint {
    static let gold = Color(light: 0xE0A21B, dark: 0xE0A21B)
    static let goldFill = Color(light: 0xFFF8E8, dark: 0x33270B)
}

/// "YOU", on the member's own pick.
struct YouTag: View {
    var body: some View {
        Text("You")
            .font(.system(size: 9.5, weight: .heavy))
            .textCase(.uppercase)
            .foregroundStyle(.white)
            .padding(.horizontal, 5)
            .padding(.vertical, 1.5)
            .background(Theme.accent, in: Capsule())
            .fixedSize()
    }
}

/// Pressed, a side dips a little (no dip with Reduce Motion).
private struct PickSidePressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// The pick's circle: empty, or filled with a check (gold for the Lock).
private struct PickCheckMark: View {
    let picked: Bool
    let gold: Bool

    var body: some View {
        ZStack {
            Circle().strokeBorder(Theme.line2, lineWidth: 1.5)
            Circle().fill(gold ? PickTint.gold : Theme.accent)
                .scaleEffect(picked ? 1 : 0.5)
                .opacity(picked ? 1 : 0)
            Image(systemName: "checkmark")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.white)
                .opacity(picked ? 1 : 0)
        }
        .frame(width: 20, height: 20)
        .accessibilityHidden(true)
    }
}
