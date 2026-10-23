import SwiftUI
import UIKit

/// The clubhouse's sheets (LeagueSheet .leaderboard, .claim, .clubhouseSignIn).
struct ClubhouseSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(LeagueSession.self) private var session
    let kind: LeagueSheet

    var body: some View {
        switch kind {
        case .claim:
            NavigationStack {
                ClaimView(closes: true)
            }
            .presentationDetents([.medium, .large])
            .presentationSizing(.form)
        case .clubhouseSignIn:
            AuthView(mode: app.account.hasSignedInBefore ? .signin : .signup,
                     reason: "Sign in to pick and vote.")
        default:
            NavigationStack {
                LeaderboardView()
            }
            .presentationDetents([.large])
            .presentationSizing(.page)
        }
    }
}

// MARK: - Which team is yours?

/// "Which team is yours?": the league's current managers, a team someone
/// else has claimed shown as taken. In the demo, any team, kept on the device.
struct ClaimView: View {
    @Environment(AppModel.self) private var app
    @Environment(LeagueSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    /// Raised as its own sheet (it closes), or pushed in the leaderboard (it pops).
    let closes: Bool

    @State private var busy: String?
    @State private var error: String?
    @State private var confirmRelease = false
    @State private var claimedOnce = 0

    private var store: ClubhouseStore { session.clubhouse }
    private var newest: Season? { session.summary?.newest }

    var body: some View {
        List {
            Section {
                ForEach(store.info?.managers ?? []) { m in
                    row(m)
                }
            } footer: {
                // Who sees a claim, and where demo picks live.
                Text(store.isDemo ? "Picks and votes stay on this device." : "Your league sees which team is yours.")
            }
            if let error {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(Theme.red)
                        .font(.footnote)
                }
            }
            if store.me != nil, let team = newest.flatMap({ s in store.myTeam(in: s).flatMap { s.team($0) } }) {
                Section {
                    Button("Let go of \(team.name)", role: .destructive) { confirmRelease = true }
                        .disabled(busy != nil)
                        .confirmationDialog("Let go of \(team.name)?", isPresented: $confirmRelease, titleVisibility: .visible) {
                            Button("Let go", role: .destructive) { release() }
                        } message: {
                            Text(store.isDemo ? "Your demo picks and votes go with it." : "Your picks and votes stay on your account, and count again once you claim a team.")
                        }
                }
            }
        }
        .navigationTitle("Which team is yours?")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if closes {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }
                }
            }
        }
        .sensoryFeedback(.success, trigger: claimedOnce)
        .task {
            await store.prepare(year: session.year)
            await store.refreshClaims()
        }
    }

    private func row(_ m: ClubhouseManager) -> some View {
        let mine = store.me == m.owner
        let taken = !mine && store.claimed.contains(m.owner)
        let team = newest?.team(m.team)
        return Button {
            claim(m)
        } label: {
            HStack(spacing: 12) {
                if let team { TeamBadge(team: team, size: 34) }
                VStack(alignment: .leading, spacing: 1) {
                    Text(m.name).font(.body.weight(.semibold)).foregroundStyle(taken ? Theme.ink3 : Theme.ink)
                    Text(m.manager).font(.footnote).foregroundStyle(Theme.ink3)
                }
                Spacer(minLength: 8)
                if busy == m.owner {
                    ProgressView()
                } else if mine {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.accent).font(.title3)
                } else if taken {
                    Text("Taken").font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink3)
                } else if !m.claimable {
                    Text("Open team").font(.footnote).foregroundStyle(Theme.ink3)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(taken || !m.claimable || busy != nil)
        .accessibilityLabel("\(m.name), managed by \(m.manager)")
        .accessibilityValue(mine ? "Yours" : taken ? "Taken" : "")
    }

    private func claim(_ m: ClubhouseManager) {
        guard store.me != m.owner else { finish(); return }
        busy = m.owner
        error = nil
        Task {
            do {
                try await store.claim(m.owner)
                claimedOnce += 1
                busy = nil
                finish()
            } catch {
                busy = nil
                self.error = error.localizedDescription
                await store.refreshClaims()
            }
        }
    }

    private func release() {
        busy = "-"
        Task {
            do {
                try await store.release()
            } catch {
                self.error = error.localizedDescription
            }
            busy = nil
        }
    }

    private func finish() {
        if closes { session.sheet = nil } else { dismiss() }
    }
}

// MARK: - The leaderboard

/// The season's pick'em: the standings (the Oracle on top), each week's
/// winners, the season's award winners, who the member is in the league,
/// and the league's notifications.
struct LeaderboardView: View {
    @Environment(AppModel.self) private var app
    @Environment(LeagueSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass

    @State private var standings: PickemStandings?
    @State private var awards: [SeasonAwardWeek] = []
    @State private var loaded = false

    private var store: ClubhouseStore { session.clubhouse }
    private var year: Int { session.year }
    private var season: Season? { session.summary?.season(year) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let season {
                    youCard(season)
                    if sizeClass == .regular {
                        HStack(alignment: .top, spacing: 14) {
                            standingsCard(season).frame(maxWidth: .infinity)
                            VStack(spacing: 14) { side(season) }.frame(maxWidth: .infinity)
                        }
                    } else {
                        standingsCard(season)
                        side(season)
                    }
                }
            }
            .padding(.horizontal, Theme.gutter)
            .padding(.vertical, 12)
            .frame(maxWidth: 1100)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.page)
        .navigationTitle("Pick'em · \(String(year))")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(role: .close) { dismiss() }
            }
        }
        .navigationDestination(for: String.self) { _ in ClaimView(closes: false) }
        .task(id: "\(store.revision)|\(app.account.user?.id ?? "-")|\(year)") {
            await store.prepare(year: year)
            async let s = store.standings(year: year)
            async let a = store.seasonAwards(year: year)
            let (st, aw) = await (s, a)
            withAnimation(loaded ? .smooth(duration: 0.25) : nil) {
                standings = st
                awards = aw
                loaded = true
            }
        }
    }

    @ViewBuilder private func side(_ season: Season) -> some View {
        weeksCard(season)
        awardsCard(season)
        if !store.isDemo, store.isMember { NotifyCard() }
        if store.isDemo { demoNotifyNote }
    }

    // MARK: You

    @ViewBuilder private func youCard(_ season: Season) -> some View {
        switch store.access {
        case .member:
            if let id = store.myTeam(in: season) ?? session.summary?.newest.flatMap({ store.myTeam(in: $0) }),
               let team = season.team(id) ?? session.summary?.newest?.team(id) {
                Card {
                    HStack(spacing: 12) {
                        TeamBadge(team: team, size: 36)
                        Text("You're \(Text(team.name).fontWeight(.bold))")
                            .font(.subheadline)
                            .foregroundStyle(Theme.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        NavigationLink(value: "claim") {
                            Text("Change").font(.subheadline.weight(.semibold))
                        }
                        .buttonStyle(Felt(.bordered))
                        .buttonBorderShape(.capsule)
                        .controlSize(.small)
                    }
                    .padding(12)
                }
            }
        case .unknown:
            EmptyView()
        default:
            Card {
                ClubhouseGateBanner(action: "play")
                    .padding(12)
            }
        }
    }

    // MARK: Standings

    private func standingsCard(_ season: Season) -> some View {
        Card {
            CardHead(title: "Season standings", symbol: "list.number")
                .overlay(alignment: .trailing) {
                    InfoTip(label: "How pick'em is scored",
                            text: "1 point per right pick, 2 for a right Lock of the Week. A perfect week is every game right; 🔥 is weeks in a row at .500 or better. The top picker is the Oracle. Free bragging rights: no entry fee, no prizes.")
                        .padding(.trailing, 8)
                }
            if let standings {
                let rows = standings.rows.filter { $0.picked > 0 || $0.owner == store.me }
                if rows.isEmpty {
                    Text("No picks yet.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.ink2)
                        .padding(14)
                } else {
                    VStack(spacing: 0) {
                        ForEach(rows) { row in
                            standingRow(row, season: season)
                            if row.id != rows.last?.id { Rectangle().fill(Theme.line).frame(height: 1).padding(.leading, 14) }
                        }
                    }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(24)
            }
        }
    }

    private func standingRow(_ row: PickemStandings.Row, season: Season) -> some View {
        let team = row.team.flatMap { season.team($0) }
        let isMe = row.owner == store.me
        let oracle = row.rank == 1 && row.points > 0
        var bits: [String] = [Fmt.record(row.correct, row.wrong)]
        if row.perfect > 0 { bits.append(Fmt.plural(row.perfect, "perfect week")) }
        if row.weeksWon > 0 { bits.append("\(Fmt.plural(row.weeksWon, "week")) won") }
        // Each part whole where the line wraps.
        let detail = bits.map { $0.replacingOccurrences(of: " ", with: "\u{00A0}") }.joined(separator: " · ")
        return HStack(spacing: 12) {
            Text("\(row.rank)")
                .font(.subheadline.weight(.bold))
                .monospacedDigit()
                .foregroundStyle(oracle ? Theme.goldInk : Theme.ink3)
                .frame(width: 24)
            if let team {
                TeamBadge(team: team, size: 32)
                    .overlay(alignment: .topTrailing) {
                        if oracle { Text("👑").font(.system(size: 14)).offset(x: 6, y: -8).accessibilityHidden(true) }
                    }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(team?.name ?? "A former manager")
                    .font(.subheadline.weight(isMe ? .bold : .semibold))
                    .foregroundStyle(isMe ? Theme.accentInk : Theme.ink)
                    .lineLimit(1)
                if oracle || isMe {
                    HStack(spacing: 4) {
                        if oracle { Chip(text: "The Oracle", fill: Theme.gold, ink: Theme.navy) }
                        if isMe { Chip(text: "You", fill: Theme.accent, ink: .white) }
                    }
                }
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(Theme.ink3)
                    .monospacedDigit()
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if row.streak >= 2 {
                Text("🔥\(row.streak)")
                    .font(.caption.weight(.bold))
                    .monospacedDigit()
                    .foregroundStyle(Theme.red)
                    .accessibilityLabel("\(row.streak) week streak")
            }
            VStack(alignment: .trailing, spacing: 0) {
                Text("\(row.points)").font(.title3.weight(.bold)).monospacedDigit().foregroundStyle(Theme.ink)
                Text("pts").font(.caption2.weight(.semibold)).foregroundStyle(Theme.ink3)
            }
            .frame(minWidth: 36, alignment: .trailing)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(isMe ? Theme.accentSoft.opacity(0.6) : Color.clear)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(Fmt.ordinal(row.rank))\(oracle ? ", the Oracle" : ""): \(team?.name ?? "A former manager")\(isMe ? ", you" : ""), \(Fmt.plural(row.points, "point")), \(detail)\(row.streak >= 2 ? ", \(row.streak) week streak" : "")")
    }

    // MARK: Weeks

    private func weeksCard(_ season: Season) -> some View {
        let weeks = (standings?.weeks ?? []).filter { $0.final && !$0.best.isEmpty }.reversed()
        return Card {
            CardHead(title: "Weekly winners", symbol: "crown.fill")
            if weeks.isEmpty {
                Text(standings == nil ? "Reading the weeks…" : "No final weeks yet.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
                    .padding(14)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(weeks)) { w in
                        let teams = w.best.compactMap { store.team(of: $0, in: season) }
                        let top = w.rows.first
                        HStack(spacing: 10) {
                            Text("Week \(w.week)")
                                .font(.caption.weight(.bold))
                                .textCase(.uppercase)
                                .foregroundStyle(Theme.ink3)
                                .frame(width: 64, alignment: .leading)
                            HStack(spacing: -6) {
                                ForEach(teams.prefix(3), id: \.self) { id in
                                    if let t = season.team(id) { TeamBadge(team: t, size: 22) }
                                }
                            }
                            Text(PickemWords.names(teams, season))
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Theme.ink)
                                .lineLimit(2)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            if let top {
                                Text("\(top.correct)/\(w.games) · \(top.points) pts")
                                    .font(.caption.weight(.semibold))
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.ink2)
                                    .fixedSize()
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .accessibilityElement(children: .combine)
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }

    // MARK: Awards

    private func awardsCard(_ season: Season) -> some View {
        Card {
            CardHead(title: "The week's awards", symbol: "medal.fill")
            if awards.isEmpty {
                Text("No awards yet.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(14)
            } else {
                VStack(spacing: 0) {
                    ForEach(awards) { w in
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Week \(w.week)")
                                .font(.caption.weight(.bold))
                                .textCase(.uppercase)
                                .foregroundStyle(Theme.ink3)
                            ForEach(w.awards) { a in
                                HStack(spacing: 8) {
                                    Text(a.emoji).accessibilityHidden(true)
                                    Text(a.short)
                                        .font(.caption.weight(.bold))
                                        .foregroundStyle(Theme.ink2)
                                        .frame(width: 58, alignment: .leading)
                                    if let first = a.winners.first, let t = season.team(first) { TeamBadge(team: t, size: 20) }
                                    Text(a.winners.map { PickemWords.name($0, season) }.joined(separator: " & "))
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(Theme.ink)
                                        .lineLimit(1)
                                    Spacer(minLength: 4)
                                    Text(Fmt.plural(a.votes, "vote"))
                                        .font(.caption)
                                        .monospacedDigit()
                                        .foregroundStyle(Theme.ink3)
                                }
                                .accessibilityElement(children: .combine)
                                .accessibilityLabel("\(a.title): \(a.winners.map { PickemWords.name($0, season) }.joined(separator: " and ")), \(Fmt.plural(a.votes, "vote"))")
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        if w.id != awards.last?.id { Rectangle().fill(Theme.line).frame(height: 1).padding(.leading, 14) }
                    }
                }
            }
        }
    }

    private var demoNotifyNote: some View {
        Card {
            CardHead(title: "Notifications", symbol: "bell.fill")
            Text("In your own league: when a week is final, picks lock or the awards are in. Off until you turn them on.")
                .font(.subheadline)
                .foregroundStyle(Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(14)
        }
    }
}

/// A small capsule label ("Oracle", "You").
struct Chip: View {
    let text: String
    let fill: Color
    let ink: Color

    var body: some View {
        Text(text)
            .font(.system(size: 9.5, weight: .heavy))
            .textCase(.uppercase)
            .tracking(0.4)
            .foregroundStyle(ink)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(fill, in: Capsule())
            .fixedSize()
    }
}

/// The league's notifications, for the member: off until they ask, and
/// only then does iOS ask them. The switches are this league's, as the
/// server has them for the account (league_claims().mine.notify_*).
private struct NotifyCard: View {
    @Environment(LeagueSession.self) private var session
    @Environment(\.openURL) private var openURL
    @State private var push = PushCenter.shared
    @State private var busy = false

    private var store: ClubhouseStore { session.clubhouse }

    var body: some View {
        let shown = store.notify
        Card {
            CardHead(title: "Notify me", symbol: "bell.fill", meta: session.summary?.name)
            VStack(spacing: 0) {
                toggle("Week is final", "Tuesdays", shown.recap) { var n = shown; n.recap = $0; return n }
                Rectangle().fill(Theme.line).frame(height: 1).padding(.leading, 14)
                toggle("Picks lock tonight", "Thursdays, before kickoff", shown.pickem) { var n = shown; n.pickem = $0; return n }
                Rectangle().fill(Theme.line).frame(height: 1).padding(.leading, 14)
                toggle("Awards are in", "When voting closes", shown.awards) { var n = shown; n.awards = $0; return n }
            }
            if store.notOnThisDevice, store.notifyError == nil {
                HStack(spacing: 10) {
                    Label("On for your account, not this device yet.", systemImage: "iphone.badge.exclamationmark")
                        .font(.footnote)
                        .foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 6)
                    Button("Turn On Here") {
                        busy = true
                        Task {
                            // This device, then the league's switches as shown,
                            // sent again (set_league_notifications): the
                            // server's flags start off for a new member.
                            if await store.enableHere() { await store.setNotify(store.notify) }
                            busy = false
                        }
                    }
                    .font(.footnote.weight(.semibold))
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
                .padding(14)
            }
            if let error = store.notifyError ?? (push.denied ? "Notifications are off for Pigskin Pantheon in Settings." : nil) {
                HStack(spacing: 10) {
                    Label(error, systemImage: "bell.slash")
                        .font(.footnote)
                        .foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 6)
                    if push.denied {
                        Button("Settings") {
                            if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
                        }
                        .font(.footnote.weight(.semibold))
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                }
                .padding(14)
            }
        }
        .task {
            await push.refreshStatus()
            // The switches as the server has them now (changed on the site, say).
            await store.refreshClaims()
        }
        .disabled(busy)
    }

    private func toggle(_ title: String, _ detail: String, _ on: Bool, _ change: @escaping (Bool) -> ClubhouseNotify) -> some View {
        Toggle(isOn: Binding(get: { on }, set: { new in
            busy = true
            Task {
                await store.setNotify(change(new))
                busy = false
            }
        })) {
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                Text(detail).font(.caption).foregroundStyle(Theme.ink3)
            }
        }
        .tint(Theme.accent)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .sensoryFeedback(.selection, trigger: on)
    }
}
