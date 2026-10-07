import SwiftUI

/// One game's box score (season.html's openBox): both lineups side by side,
/// one row per lineup slot with the slot running down the middle and each
/// team's points tucked against it, then the bench and injured reserve.
/// The same grid serves every width, as on the site.
struct BoxScoreView: View {
    @Environment(LeagueSession.self) private var session
    let year: Int
    let week: Int
    let a: String
    let b: String

    @State private var box: BoxScore?
    @State private var state: LoadState = .loading

    private enum LoadState { case loading, ready, missing, failed(String) }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                switch state {
                case .loading:
                    LoadingCard(title: "Reading the lineups")
                case .missing:
                    EmptyCard(title: "No box score for this game",
                              detail: "\(session.summary?.source ?? "The platform") has no lineups for Week \(week) of \(String(year)).",
                              symbol: "tablecells")
                case .failed(let message):
                    EmptyCard(title: "The box score couldn't be read", detail: message, symbol: "exclamationmark.triangle")
                case .ready:
                    if let box, let season = session.summary?.season(year) {
                        BoxScoreCard(box: box, season: season)
                            .transition(.opacity.combined(with: .scale(scale: 0.98)))
                    }
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 12)
            .frame(maxWidth: 860)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.page)
        .navigationTitle("\(String(year)) · Week \(week)")
        .navigationSubtitle(box?.sub ?? "")
        .toolbarTitleDisplayMode(.inline)
        .task(id: "\(year)-\(week)-\(a)-\(b)") { await load() }
    }

    private func load() async {
        do {
            let result = try await session.engine.call(BoxScore.self, "Bridge.recap.box(year, week, a, b)",
                                                       ["year": year, "week": week, "a": a, "b": b])
            withAnimation(.smooth(duration: 0.3)) {
                box = result
                state = .ready
            }
        } catch EngineError.empty {
            // The week has no lineups (the bridge answers null).
            state = .missing
        } catch {
            if !Task.isCancelled { state = .failed(error.localizedDescription) }
        }
    }
}

/// The scoreboard and the lineups.
private struct BoxScoreCard: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    let box: BoxScore
    let season: Season

    private var metrics: BoxMetrics { sizeClass == .regular ? .regular : .compact }

    var body: some View {
        VStack(spacing: 0) {
            scoreboard
            ForEach(box.groups) { group in
                BoxGroupHead(label: group.label, metrics: metrics)
                ForEach(Array(group.rows.enumerated()), id: \.offset) { _, row in
                    BoxRow(row: row, metrics: metrics)
                }
            }
            Text(box.foot)
                .font(.system(size: 11))
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Theme.surface2)
                .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
        }
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous).strokeBorder(Theme.line))
        .shadow(color: Color(hex: 0x101828, alpha: 0.05), radius: 1, y: 1)
    }

    private var scoreboard: some View {
        let aWon = box.a.score > box.b.score, bWon = box.b.score > box.a.score
        return HStack(spacing: 0) {
            side(box.a.id, trailing: false)
                .padding(.trailing, 8)
            total(box.a.score, won: aWon)
                .frame(width: metrics.total)
            Text("–").font(.caption.weight(.bold)).foregroundStyle(Theme.ink3)
                .frame(width: metrics.totalGap)
            total(box.b.score, won: bWon)
                .frame(width: metrics.total)
            side(box.b.id, trailing: true)
                .padding(.leading, 8)
        }
        .padding(.horizontal, metrics.inset)
        .padding(.vertical, 12)
        .background(Theme.card)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
        .accessibilityElement(children: .contain)
    }

    private func total(_ score: Double, won: Bool) -> some View {
        Text(Fmt.pts(score))
            .font(.system(size: metrics.totalFont, weight: .bold))
            .monospacedDigit()
            .foregroundStyle(won ? Theme.accentInk : Theme.ink3)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .accessibilityLabel("\(Fmt.pts(score))\(won ? ", won" : "")")
    }

    @ViewBuilder private func side(_ id: String, trailing: Bool) -> some View {
        if let team = season.team(id) {
            NavigationLink(value: LeagueRoute.team(year: season.year, teamId: id)) {
                Group {
                    if sizeClass == .regular {
                        HStack(spacing: 8) {
                            if trailing { name(team, trailing: true) }
                            TeamBadge(team: team, size: 30, corner: 9)
                            if !trailing { name(team, trailing: false) }
                        }
                    } else {
                        VStack(alignment: trailing ? .trailing : .leading, spacing: 5) {
                            TeamBadge(team: team, size: 30, corner: 9)
                            name(team, trailing: trailing)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: trailing ? .trailing : .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(team.name): season and schedule")
        } else {
            Text(id).frame(maxWidth: .infinity)
        }
    }

    private func name(_ team: Team, trailing: Bool) -> some View {
        VStack(alignment: trailing ? .trailing : .leading, spacing: 1) {
            Text(team.name).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.ink)
                .lineLimit(2).multilineTextAlignment(trailing ? .trailing : .leading)
            Text(team.owner).font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.ink3).lineLimit(1)
        }
    }
}

/// Column widths: the site's grid (1fr 52px 48px 52px 1fr), a touch
/// narrower on a phone so the names have room.
private struct BoxMetrics {
    let score: CGFloat
    let slot: CGFloat
    let total: CGFloat
    let totalGap: CGFloat
    let totalFont: CGFloat
    let inset: CGFloat
    let nameFont: CGFloat

    static let regular = BoxMetrics(score: 56, slot: 52, total: 76, totalGap: 32, totalFont: 22, inset: 16, nameFont: 13.5)
    static let compact = BoxMetrics(score: 46, slot: 40, total: 64, totalGap: 14, totalFont: 18, inset: 10, nameFont: 12.5)
}

private struct BoxGroupHead: View {
    let label: String
    let metrics: BoxMetrics

    var body: some View {
        HStack(spacing: 0) {
            Text(label)
                .font(.system(size: 9.5, weight: .heavy))
                .tracking(1.1)
                .textCase(.uppercase)
                .foregroundStyle(Theme.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
            Spacer().frame(width: metrics.score * 2 + metrics.slot)
            Spacer().frame(maxWidth: .infinity)
        }
        .padding(.horizontal, metrics.inset)
        .padding(.vertical, 6)
        .background(Theme.page)
        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
        .accessibilityAddTraits(.isHeader)
    }
}

private struct BoxRow: View {
    let row: BoxScore.Row
    let metrics: BoxMetrics

    var body: some View {
        HStack(spacing: 0) {
            BoxPlayerCell(player: row.l, trailing: false, metrics: metrics)
            BoxScoreCell(player: row.l).frame(width: metrics.score)
            Text(row.slot)
                .font(.system(size: 9.5, weight: .heavy))
                .tracking(0.3)
                .textCase(.uppercase)
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(width: metrics.slot)
                .frame(maxHeight: .infinity)
                .background(Theme.surface2)
            BoxScoreCell(player: row.r).frame(width: metrics.score)
            BoxPlayerCell(player: row.r, trailing: true, metrics: metrics)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, metrics.inset)
        .overlay(alignment: .top) { Rectangle().fill(Theme.line.opacity(0.6)).frame(height: 1) }
    }
}

private struct BoxScoreCell: View {
    let player: BoxPlayer?
    var body: some View {
        VStack(spacing: 1) {
            if let player {
                Text(Fmt.pts(player.pts))
                    .font(.system(size: 12.5, weight: .heavy))
                    .monospacedDigit()
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                if let proj = player.proj {
                    Text(Fmt.pts(proj)).font(.system(size: 9)).monospacedDigit().foregroundStyle(Theme.muted)
                }
            }
        }
        .padding(.vertical, 5)
    }
}

/// A player: his club on the outside edge, his name (first initial) inside,
/// opening his card.
private struct BoxPlayerCell: View {
    let player: BoxPlayer?
    let trailing: Bool
    let metrics: BoxMetrics

    var body: some View {
        Group {
            if let player {
                NavigationLink(value: LeagueRoute.player(id: player.id)) {
                    HStack(spacing: 6) {
                        if trailing {
                            name(player)
                            ClubTag(club: player.nfl)
                        } else {
                            ClubTag(club: player.nfl)
                            name(player)
                        }
                        if let injury = player.injury, let first = injury.first {
                            Text(String(first)).font(.system(size: 9, weight: .heavy)).foregroundStyle(Theme.red)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: trailing ? .trailing : .leading)
                    .padding(.vertical, 8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(player.name), \(player.pos), \(player.nfl), \(Fmt.pts(player.pts)) points")
                .contextMenu {
                    NavigationLink(value: LeagueRoute.player(id: player.id)) {
                        Label("\(player.name)'s history", systemImage: "person.text.rectangle")
                    }
                    Text("\(player.pos) · \(player.nfl) · \(Fmt.pts(player.pts)) pts")
                }
            } else {
                Color.clear.frame(height: 1)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(trailing ? .leading : .trailing, 6)
    }

    private func name(_ p: BoxPlayer) -> some View {
        Text(p.short)
            .font(.system(size: metrics.nameFont, weight: .bold))
            .foregroundStyle(Theme.ink)
            .lineLimit(1)
            .minimumScaleFactor(0.78)
            .truncationMode(.tail)
    }
}
