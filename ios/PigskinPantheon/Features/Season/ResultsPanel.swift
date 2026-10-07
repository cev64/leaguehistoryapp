import SwiftUI

/// A week's results (renderResultsPanel): a card per game with the winner
/// tinted and ruled in blue, then the week's notes. A week still to come
/// shows its matchups with records going in, and next week's scenarios.
/// Week 0 of a season still being played is its whole schedule.
struct ResultsPanel: View {
    @Environment(LeagueSession.self) private var session
    @Bindable var store: SeasonStore
    let info: SeasonInfo
    let season: Season
    let payload: WeekPayload

    var body: some View {
        if payload.week == 0 {
            SchedulePanel(info: info, season: season)
        } else if !payload.games.isEmpty {
            AdaptiveGrid(minWidth: 330) {
                ForEach(Array(payload.games.enumerated()), id: \.offset) { _, game in
                    GameCard(season: season, week: payload.week, game: game)
                }
            }
            if let notes = payload.superlatives {
                WeekNotes(store: store, season: season, week: payload.week, notes: notes)
            }
        } else if !payload.matchups.isEmpty {
            if let scenarios = payload.scenarios, !scenarios.rows.isEmpty {
                ScenarioCard(season: season, scenarios: scenarios, median: info.median)
            }
            Card {
                CardHead(title: "Week \(payload.week) Matchups", symbol: CardIcon.versus, meta: "Not yet played")
                AdaptiveGrid(minWidth: 300, spacing: 10) {
                    ForEach(payload.matchups, id: \.self) { m in
                        UpcomingGame(season: season, week: payload.week, matchup: m)
                    }
                }
                .padding(12)
            }
        } else {
            EmptyCard(title: "No games in Week \(payload.week)",
                      detail: "\(info.source) has no matchups for this league this week.",
                      symbol: "calendar.badge.exclamationmark")
        }
    }
}

/// One game: both sides, the winner's tinted (gameCard).
struct GameCard: View {
    let season: Season
    let week: Int
    let game: WeekGame

    var body: some View {
        let a = game.as ?? 0, b = game.bs ?? 0
        Card {
            HStack {
                Text(game.label.isEmpty ? "Final" : game.label)
                Spacer()
                Text(a == b ? "Tie" : "Margin \(Fmt.pts(abs(a - b)))")
            }
            .font(.system(size: 11.5, weight: .bold))
            .tracking(0.8)
            .textCase(.uppercase)
            .foregroundStyle(Theme.ink3)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            Divider().overlay(Theme.line)
            GameSide(season: season, teamId: game.a, score: game.as, won: a > b, decided: a != b)
            Divider().overlay(Theme.line)
            GameSide(season: season, teamId: game.b, score: game.bs, won: b > a, decided: a != b)
            Divider().overlay(Theme.line)
            NavigationLink(value: LeagueRoute.boxScore(year: season.year, week: week, a: game.a, b: game.b)) {
                Label("Box score", systemImage: "tablecells")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.accentInk)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 11)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }
}

private struct GameSide: View {
    let season: Season
    let teamId: String
    let score: Double?
    let won: Bool
    let decided: Bool

    var body: some View {
        if let team = season.team(teamId) {
            NavigationLink(value: LeagueRoute.team(year: season.year, teamId: teamId)) {
                HStack(spacing: 12) {
                    TeamBadge(team: team, size: 30, corner: 9)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(team.name)
                            .font(.system(size: 15.5, weight: won ? .bold : (decided ? .medium : .semibold)))
                            .foregroundStyle(won ? Theme.accentInk : (decided ? Theme.ink2 : Theme.ink))
                            .lineLimit(1)
                        Text(team.owner).font(.system(size: 12.5, weight: .medium)).foregroundStyle(Theme.ink3).lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    Text(Fmt.pts(score))
                        .font(.system(size: 21, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(won ? Theme.accentInk : (decided ? Theme.ink3 : Theme.ink))
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.line2)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(won ? Theme.accentSoft.opacity(0.6) : Color.clear)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(team.name), \(Fmt.pts(score))\(won ? ", won" : "")")
        }
    }
}

/// A week to come: both teams with their records going in.
private struct UpcomingGame: View {
    let season: Season
    let week: Int
    let matchup: Matchup

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Week \(week)").font(.system(size: 11, weight: .bold)).textCase(.uppercase).tracking(0.8).foregroundStyle(Theme.ink3)
            side(matchup.a, matchup.ar)
            side(matchup.b, matchup.br)
        }
        .padding(12)
        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    @ViewBuilder private func side(_ id: String, _ record: String) -> some View {
        if let team = season.team(id) {
            NavigationLink(value: LeagueRoute.team(year: season.year, teamId: id)) {
                HStack(spacing: 10) {
                    TeamBadge(team: team, size: 26, corner: 8)
                    Text(team.name).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                    Spacer()
                    Text(record).font(.subheadline.weight(.semibold)).monospacedDigit().foregroundStyle(Theme.ink2)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }
}

/// "What's at stake": next week's playoff scenarios (scenarioCard).
struct ScenarioCard: View {
    let season: Season
    let scenarios: Scenarios
    let median: Bool

    var body: some View {
        Card {
            CardHead(title: "What's at stake · Week \(scenarios.week)", symbol: CardIcon.shield, meta: "Playoff scenarios")
            VStack(alignment: .leading, spacing: 0) {
                ForEach(scenarios.rows, id: \.self) { row in
                    if let team = season.team(row.id) {
                        HStack(alignment: .top, spacing: 10) {
                            TeamBadge(team: team, size: 24, corner: 7)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(team.name).font(.subheadline.weight(.bold)).foregroundStyle(Theme.ink)
                                ForEach(row.lines, id: \.self) { line in
                                    Text("\(line).").font(.footnote).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                        .padding(.vertical, 10)
                        .padding(.horizontal, 14)
                        Divider().overlay(Theme.line)
                    }
                }
                Text("Only results that settle it outright are listed. A tie on record goes to points for\(median ? ", and the median game is still to be played," : ",") which can't be known in advance, so a team can also get in on points.")
                    .font(.caption)
                    .foregroundStyle(Theme.ink3)
                    .padding(14)
            }
        }
    }
}

/// The week's notes (weekSuperlatives), with its bench blunder read on its own.
private struct WeekNotes: View {
    @Environment(LeagueSession.self) private var session
    @Bindable var store: SeasonStore
    let season: Season
    let week: Int
    let notes: WeekSuperlatives
    @State private var blunder: WeekBlunder?
    @State private var blunderFailed = false

    private func name(_ id: String) -> String { season.team(id)?.name ?? id }

    var body: some View {
        Card {
            CardHead(title: "Week \(week) Notes", symbol: CardIcon.notes)
            AdaptiveGrid(minWidth: 150, spacing: 10) {
                Superlative(label: "High score", title: name(notes.high.id), detail: Fmt.pts(notes.high.score))
                Superlative(label: "Low score", title: name(notes.low.id), detail: Fmt.pts(notes.low.score))
                Superlative(label: "Biggest blowout", title: "\(name(notes.blowout.winner)) over \(name(notes.blowout.loser))", detail: "by \(Fmt.pts(notes.blowout.margin))")
                Superlative(label: "Closest game", title: "\(name(notes.closest.winner)) over \(name(notes.closest.loser))", detail: "by \(Fmt.pts(notes.closest.margin))")
                Superlative(label: "League average", title: "\(Fmt.one(notes.average)) per team", detail: "\(Fmt.pts(notes.total)) total points")
                if !blunderFailed {
                    blunderTile
                }
            }
            .padding(12)
            HStack(spacing: 10) {
                Button {
                    withAnimation { store.view = "panel-recap" }
                } label: {
                    Label("Read the week \(week) recap", systemImage: "text.bubble")
                        .font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.bordered)
            }
            .padding([.horizontal, .bottom], 12)
        }
        .task(id: week) {
            do {
                blunder = try await session.engine.call(WeekBlunder.self, "Bridge.season.blunder(year, week)", ["year": season.year, "week": week])
            } catch {
                blunderFailed = true
            }
        }
    }

    @ViewBuilder private var blunderTile: some View {
        if let blunder {
            if blunder.perfect {
                Superlative(label: "Bench blunder", title: "Every lineup was perfect", detail: "")
            } else if let teamId = blunder.teamId, let benched = blunder.benched {
                Superlative(
                    label: "Bench blunder",
                    title: "\(name(teamId)) benched \(benched.name)",
                    detail: "\(Fmt.pts(benched.pts)) on the bench\(blunder.started.map { ", started \($0.name) (\(Fmt.pts($0.pts)))" } ?? "")\(blunder.costGame == true ? " · cost the game" : "")"
                )
            }
        } else {
            Superlative(label: "Bench blunder", title: "Checking lineups…", detail: "")
        }
    }
}

/// A season's whole schedule (week 0 of a season being played).
private struct SchedulePanel: View {
    @Environment(LeagueSession.self) private var session
    let info: SeasonInfo
    let season: Season
    @State private var weeks: [ScheduleWeek]?

    var body: some View {
        Group {
            if let weeks {
                if weeks.isEmpty {
                    EmptyCard(title: season.unplayed == true ? "This season wasn't played" : "No schedule yet",
                              detail: season.unplayed == true
                                ? "\(info.source) closed it before any matchups were scored, so there is nothing to show."
                                : "\(info.source) draws the season's matchups once the league has its teams. They will appear here as soon as it does.",
                              symbol: "calendar")
                } else {
                    Card {
                        CardHead(title: "\(String(season.year)) Schedule", symbol: CardIcon.schedule,
                                 meta: "\(weeks.count) weeks · \(weeks.reduce(0) { $0 + $1.games.count }) games")
                        AdaptiveGrid(minWidth: 260, spacing: 10) {
                            ForEach(weeks) { week in
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text("Week \(week.week)")
                                        Spacer()
                                        Text(week.played ? "Final" : "Upcoming")
                                    }
                                    .font(.system(size: 11, weight: .bold)).textCase(.uppercase).tracking(0.6).foregroundStyle(Theme.ink3)
                                    ForEach(week.games, id: \.self) { g in
                                        HStack {
                                            Text(season.team(g.a)?.name ?? g.a).frame(maxWidth: .infinity, alignment: .leading)
                                            Text("VS").font(.caption2.weight(.heavy)).foregroundStyle(Theme.ink3)
                                            Text(season.team(g.b)?.name ?? g.b).frame(maxWidth: .infinity, alignment: .trailing)
                                        }
                                        .font(.footnote.weight(.medium))
                                        .foregroundStyle(Theme.ink2)
                                        .lineLimit(1)
                                    }
                                }
                                .padding(12)
                                .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            }
                        }
                        .padding(12)
                    }
                }
            } else {
                LoadingCard(title: "Reading the schedule")
            }
        }
        .task {
            weeks = (try? await session.engine.call([ScheduleWeek].self, "Bridge.season.schedule(year)", ["year": season.year])) ?? []
        }
    }
}
