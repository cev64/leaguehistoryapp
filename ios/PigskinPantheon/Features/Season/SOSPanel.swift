import SwiftUI

// MARK: Data (Bridge.season.sos)

/// Strength of schedule (renderSosPanel): every team's slate rated on its
/// opponents' records the season before.
struct SOSData: Decodable {
    struct Notice: Decodable {
        let title: String
        let detail: String
    }
    struct Row: Decodable, Hashable, Identifiable {
        let id: String
        let rank: Int
        let wins: Int
        let losses: Int
        let games: Int
        let sos: Double
        let sosText: String
        let deviation: Double
        /// The deviation from .500 as a share of the league's widest.
        let magnitude: Double
        /// "tough", "easy" or "even"
        let side: String
        let record: String
        let aria: String
    }
    struct Note: Decodable, Hashable {
        let label: String
        let title: String
        let detail: String
    }

    let empty: Notice?
    let priorYear: Int?
    let meta: String?
    let rows: [Row]?
    let notes: [Note]?
}

private enum SOSColor {
    static let tough = Theme.red
    static let easy = Theme.accent
    static let even = Color(light: 0xB9C3CD, dark: 0x5A6780)
}

// MARK: Panel

/// The season's strength of schedule: bars diverging from a .500 baseline,
/// right for a harder slate than average, left for an easier one.
struct ScheduleStrengthPanel: View {
    let info: SeasonInfo
    let season: Season

    var body: some View {
        PanelLoader(expression: "Bridge.season.sos(year)",
                    arguments: ["year": season.year],
                    loadingTitle: "Rating the schedules",
                    failureTitle: "The schedules couldn't be rated") { (data: SOSData) in
            if let empty = data.empty {
                EmptyCard(title: empty.title, detail: empty.detail, symbol: "chart.bar.xaxis")
            } else {
                SOSContent(season: season, data: data)
            }
        }
    }
}

private struct SOSContent: View {
    let season: Season
    let data: SOSData
    @State private var wide = false
    @State private var shown = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Card {
                CardHead(title: "Strength of Schedule", symbol: CardIcon.schedule, meta: data.meta)
                PanelFlow(spacing: 16, lineSpacing: 8) {
                    key(SOSColor.tough, "Tougher than average")
                    key(SOSColor.easy, "Easier than average")
                    key(SOSColor.even, "Baseline .500")
                }
                .padding(.horizontal, wide ? 20 : 15)
                .padding(.top, wide ? 16 : 11)
                .padding(.bottom, 4)
                VStack(spacing: 0) {
                    ForEach(data.rows ?? []) { row in
                        SOSRowView(season: season, row: row, wide: wide, shown: shown)
                            .background(row.rank % 2 == 1 ? Theme.surface2 : Color.clear,
                                        in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                    }
                }
                .padding(.horizontal, wide ? 8 : 6)
                .padding(.top, wide ? 8 : 6)
                .padding(.bottom, wide ? 16 : 12)
            }
            .onGeometryChange(for: Bool.self) { $0.size.width > 700 } action: { wide = $0 }
            if let notes = data.notes {
                AdaptiveGrid(minWidth: 220, spacing: 10) {
                    ForEach(notes, id: \.self) { note in
                        Superlative(label: note.label, title: note.title, detail: note.detail)
                    }
                }
            }
        }
        .onAppear {
            withAnimation(.spring(duration: 0.7, bounce: 0.15).delay(0.1)) { shown = true }
        }
    }

    private func key(_ color: Color, _ text: String) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 3, style: .continuous).fill(color).frame(width: 11, height: 11)
            Text(text).font(.system(size: 12)).foregroundStyle(Theme.muted)
        }
    }
}

/// One team: rank, logo, name and manager, the bar, the rating.
private struct SOSRowView: View {
    let season: Season
    let row: SOSData.Row
    let wide: Bool
    let shown: Bool

    var body: some View {
        let team = season.team(row.id)
        NavigationLink(value: LeagueRoute.team(year: season.year, teamId: row.id)) {
            Group {
                if wide {
                    HStack(spacing: 11) {
                        rank
                        name(team)
                            .frame(minWidth: 168, maxWidth: .infinity, alignment: .leading)
                        SOSPlot(row: row, shown: shown)
                            .frame(minWidth: 120, maxWidth: .infinity)
                        value.frame(width: 74, alignment: .trailing)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                } else {
                    VStack(spacing: 8) {
                        HStack(spacing: 8) {
                            rank
                            name(team).frame(maxWidth: .infinity, alignment: .leading)
                            value
                        }
                        SOSPlot(row: row, shown: shown)
                    }
                    .padding(10)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(row.rank). \(team?.name ?? row.id), \(row.aria), opponents went \(row.record)")
        .accessibilityAddTraits(.isButton)
    }

    private var rank: some View {
        Text("\(row.rank)")
            .font(.system(size: 12.5, weight: .heavy))
            .foregroundStyle(Theme.ink3)
            .monospacedDigit()
            .frame(width: 20, alignment: .trailing)
    }

    @ViewBuilder private func name(_ team: Team?) -> some View {
        HStack(spacing: 10) {
            if let team { TeamBadge(team: team, size: 30, corner: 8) }
            VStack(alignment: .leading, spacing: 1) {
                Text(team?.name ?? row.id)
                    .font(.system(size: 14, weight: .heavy))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                if let team {
                    Text(team.owner).font(.system(size: 11.5)).foregroundStyle(Theme.muted).lineLimit(1)
                }
            }
        }
    }

    private var value: some View {
        VStack(alignment: .trailing, spacing: 1) {
            Text(row.sosText).font(.system(size: 14.5, weight: .black)).foregroundStyle(Theme.ink)
            Text(row.record).font(.system(size: 11)).foregroundStyle(Theme.muted)
        }
        .monospacedDigit()
    }
}

/// The bar: from the .500 baseline, right (red) for a tougher slate, left
/// (blue) for an easier one, its length scaled to the league's widest.
private struct SOSPlot: View {
    let row: SOSData.Row
    let shown: Bool

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let length = shown ? CGFloat(row.magnitude) * 0.46 * w : 0
            ZStack(alignment: .topLeading) {
                Rectangle()
                    .fill(SOSColor.even)
                    .frame(width: 1.5, height: geo.size.height + 4)
                    .offset(x: w / 2, y: -2)
                if row.side == "tough" {
                    UnevenRoundedRectangle(cornerRadii: .init(bottomTrailing: 4, topTrailing: 4), style: .continuous)
                        .fill(SOSColor.tough)
                        .frame(width: length, height: 10)
                        .offset(x: w / 2, y: 2)
                } else if row.side == "easy" {
                    UnevenRoundedRectangle(cornerRadii: .init(topLeading: 4, bottomLeading: 4), style: .continuous)
                        .fill(SOSColor.easy)
                        .frame(width: length, height: 10)
                        .offset(x: w / 2 - length, y: 2)
                }
            }
        }
        .frame(height: 14)
        .accessibilityHidden(true)
    }
}
