import SwiftUI

// League pick'em on the season screen. The picks themselves are made on
// the pick week's Matchups view, in its games card (WeekGamesCard.swift);
// once a week has been played, this card shows how the league picked each
// game, everyone's score and the week's winner.

/// A played week's pick'em, graded. Nothing at all where there's nothing
/// to show (a week nobody picked, or one still open).
struct PickemCard: View {
    @Environment(LeagueSession.self) private var session
    @Environment(AppModel.self) private var app
    let season: Season
    let week: Int

    @State private var data: PickemWeek?

    private var store: ClubhouseStore { session.clubhouse }

    private var key: String {
        "\(store.revision)|\(app.account.user?.id ?? "-")|\(season.year)|\(week)"
    }

    var body: some View {
        VStack(spacing: 0) {
            if let data, data.week == week, shows(data) {
                PickemGradedCard(season: season, data: data)
            } else {
                Color.clear.frame(height: 0)
            }
        }
        .task(id: key) {
            await store.prepare(year: season.year)
            let answer = await store.week(year: season.year, week: week)
            // A new board (a save, another device): the same card, quietly.
            if answer != data { data = answer }
        }
    }

    private func shows(_ data: PickemWeek) -> Bool {
        if data.games.isEmpty || data.open { return false }
        // A locked or played week: once anyone's picks are on the board.
        return !data.rows.isEmpty
    }
}

// MARK: - A week locked or played

private struct PickemGradedCard: View {
    @Environment(LeagueSession.self) private var session
    @Environment(\.horizontalSizeClass) private var sizeClass
    let season: Season
    let data: PickemWeek

    private var store: ClubhouseStore { session.clubhouse }
    private var meRow: PickemWeek.Row? { data.rows.first { $0.owner == store.me } }

    var body: some View {
        Card {
            CardHead(title: "Week \(data.week) Pick'em", symbol: "checkmark.seal.fill",
                     meta: data.final ? "Final" : "Locked · \(Fmt.plural(data.rows.count, "player"))")
            // Each game's split is on its Results tile (PickemResults.swift).
            summary
            if hasSummary { Rectangle().fill(Theme.line).frame(height: 1).padding(.top, 12) }
            PickemWeekTable(season: season, data: data)
            Rectangle().fill(Theme.line).frame(height: 1)
            HStack {
                Spacer(minLength: 8)
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
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        }
    }

    private var hasSummary: Bool {
        (data.final && !data.best.compactMap { store.team(of: $0, in: season) }.isEmpty) || meRow != nil
    }

    /// The week's winner, and how the member did.
    @ViewBuilder private var summary: some View {
        let winners = data.best.compactMap { store.team(of: $0, in: season) }
        let top = data.rows.first
        if (data.final && !winners.isEmpty) || meRow != nil {
            VStack(alignment: .leading, spacing: 10) {
                if data.final, !winners.isEmpty, let top {
                    HStack(spacing: 10) {
                        Text("👑").font(.title3).accessibilityHidden(true)
                        HStack(spacing: -6) {
                            ForEach(winners.prefix(3), id: \.self) { id in
                                if let t = season.team(id) { TeamBadge(team: t, size: 28) }
                            }
                        }
                        VStack(alignment: .leading, spacing: 1) {
                            Text("Week winner").font(.caption2.weight(.bold)).textCase(.uppercase).tracking(0.8).foregroundStyle(Theme.goldInk)
                            Text(PickemWords.names(winners, season))
                                .font(.subheadline.weight(.bold))
                                .foregroundStyle(Theme.ink)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 8)
                        Text("\(top.correct) of \(data.games.count) · \(Fmt.plural(top.points, "pt"))")
                            .font(.footnote.weight(.semibold))
                            .monospacedDigit()
                            .foregroundStyle(Theme.ink2)
                            .fixedSize()
                    }
                    .accessibilityElement(children: .combine)
                }
                if let me = meRow {
                    let rank = (data.rows.firstIndex(of: me) ?? 0) + 1
                    HStack(spacing: 8) {
                        Image(systemName: "person.crop.circle.fill").foregroundStyle(Theme.accent)
                        Text(data.final
                             ? "You went \(Fmt.record(me.correct, me.wrong)) for \(Fmt.plural(me.points, "point")), \(Fmt.ordinal(rank)) of \(data.rows.count)."
                             : "You're \(Fmt.record(me.correct, me.wrong)) so far, \(Fmt.plural(me.points, "point")).")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Theme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.goldSoft.opacity(0.55), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(.horizontal, 12)
            .padding(.top, 12)
        }
    }
}

/// Everyone's week: rank, team, right–wrong and points.
private struct PickemWeekTable: View {
    @Environment(LeagueSession.self) private var session
    let season: Season
    let data: PickemWeek

    var body: some View {
        let store = session.clubhouse
        VStack(alignment: .leading, spacing: 0) {
            Text("The league's week")
                .font(.caption.weight(.bold))
                .textCase(.uppercase)
                .tracking(0.8)
                .foregroundStyle(Theme.ink3)
                .padding(.horizontal, 14)
                .padding(.top, 12)
                .padding(.bottom, 4)
                .accessibilityAddTraits(.isHeader)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 16, alignment: .top)], spacing: 0) {
                ForEach(Array(data.rows.enumerated()), id: \.element.owner) { i, row in
                    let team = store.team(of: row.owner, in: season)
                    let isMe = row.owner == store.me
                    let best = data.final && data.best.contains(row.owner)
                    HStack(spacing: 10) {
                        Text(best ? "👑" : "\(rank(of: i))")
                            .font(.footnote.weight(.bold))
                            .monospacedDigit()
                            .foregroundStyle(Theme.ink3)
                            .frame(width: 24)
                        if let team, let t = season.team(team) { TeamBadge(team: t, size: 24, corner: 7) }
                        Text(team.map { PickemWords.name($0, season) } ?? "A former manager")
                            .font(.subheadline.weight(isMe ? .bold : .medium))
                            .foregroundStyle(isMe ? Theme.accentInk : Theme.ink)
                            .lineLimit(1)
                        Spacer(minLength: 6)
                        Text(Fmt.record(row.correct, row.wrong))
                            .font(.footnote)
                            .foregroundStyle(Theme.ink3)
                            .monospacedDigit()
                        Text("\(row.points)")
                            .font(.subheadline.weight(.bold))
                            .monospacedDigit()
                            .foregroundStyle(Theme.ink)
                            .frame(minWidth: 22, alignment: .trailing)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(isMe ? Theme.accentSoft.opacity(0.7) : Color.clear)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(best ? "Week winner, " : "\(Fmt.ordinal(rank(of: i))), ")\(team.map { PickemWords.name($0, season) } ?? "A former manager")\(isMe ? ", you" : ""): \(row.correct) right, \(row.wrong) wrong, \(Fmt.plural(row.points, "point"))")
                }
            }
            .padding(.bottom, 6)
        }
    }

    /// A tie shares its place.
    private func rank(of i: Int) -> Int {
        let p = data.rows[i].points
        return (data.rows.firstIndex { $0.points == p } ?? i) + 1
    }
}

// MARK: - Pieces

/// What stands between the member and the clubhouse: an account, or their team.
struct ClubhouseGateBanner: View {
    @Environment(LeagueSession.self) private var session
    /// "vote", "play"
    let action: String

    var body: some View {
        let store = session.clubhouse
        switch store.access {
        case .signedOut:
            Button("Sign in to \(action)") { session.sheet = .clubhouseSignIn }
                .font(.footnote.weight(.bold))
                .buttonStyle(Felt(.borderedProminent))
                .buttonBorderShape(.capsule)
                .controlSize(.small)
                .fixedSize()
        case .unclaimed:
            banner(symbol: "person.fill.questionmark", text: "Which team is yours?", button: "Choose") { session.sheet = .claim }
        case .unavailable(let message):
            Label(message, systemImage: "exclamationmark.triangle")
                .font(.footnote)
                .foregroundStyle(Theme.ink3)
                .fixedSize(horizontal: false, vertical: true)
        default:
            EmptyView()
        }
    }

    private func banner(symbol: String, text: String, button: String, _ tap: @escaping () -> Void) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Theme.accent)
                .accessibilityHidden(true)
            Text(text)
                .font(.footnote.weight(.medium))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(button, action: tap)
                .font(.footnote.weight(.bold))
                .buttonStyle(Felt(.borderedProminent))
                .buttonBorderShape(.capsule)
                .controlSize(.small)
                .fixedSize()
        }
        .padding(10)
        .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

enum PickemWords {
    static func name(_ id: String, _ season: Season) -> String { season.team(id)?.name ?? id }

    /// "London Calling", "A & B", or "A and 2 others".
    static func names(_ ids: [String], _ season: Season) -> String {
        ids.count > 2 ? "\(name(ids[0], season)) and \(ids.count - 1) others" : ids.map { name($0, season) }.joined(separator: " & ")
    }

    /// "Locks Thu 8:15 PM" this week, "Locks Thu, Nov 5, 8:15 PM" further off,
    /// in the member's own time.
    static func locks(_ date: Date?) -> String {
        guard let date else { return "Open" }
        if date <= .now { return "Locked" }
        if date.timeIntervalSinceNow < 6 * 86_400 {
            return "Locks \(date.formatted(.dateTime.weekday(.abbreviated).hour().minute()))"
        }
        return "Locks \(date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute()))"
    }

    /// "Thu 8:15 PM" (or with the date, further off).
    static func when(_ date: Date?) -> String {
        guard let date else { return "" }
        if date.timeIntervalSinceNow < 6 * 86_400 && date > .now {
            return date.formatted(.dateTime.weekday(.abbreviated).hour().minute())
        }
        return date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute())
    }
}
