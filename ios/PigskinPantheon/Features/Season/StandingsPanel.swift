import SwiftUI

// MARK: Data (Bridge.season.standings / finalStandings)

/// A week's standings tables (standingsCards) and their legend.
struct StandingsData: Decodable {
    let asOf: Int
    /// False before a week has been played: every record 0–0, nobody ranked.
    let live: Bool
    let hasDivisions: Bool
    let cards: [Table]
    let legend: [LegendKey]

    struct Table: Decodable, Identifiable {
        let title: String
        /// "shield" (a division) or "standings" (the league's one table)
        let chip: String
        let rows: [Row]
        var id: String { title }
    }

    struct Row: Decodable, Identifiable, Hashable {
        let id: String
        let rank: String
        let record: String
        let gb: String
        let pct: String
        let pf: String
        let pa: String
        let div: String?
        /// "seed-div", "seed-wc", "seed-toilet" or ""
        let rowClass: String
        let seed: SeedLabel?
        let flag: ClinchFlag?
        let why: WhyInfo?

        /// The seed's rule down the row's leading edge.
        var rule: Color? {
            switch rowClass {
            case "seed-div": return Theme.accent
            case "seed-wc": return Theme.gold
            case "seed-toilet": return Color(light: 0xC3CAD5, dark: 0x4A5A74)
            default: return nil
            }
        }
    }
}

/// A finished season's final table (renderFinalStandings).
struct FinalRow: Decodable, Identifiable, Hashable {
    let id: String
    let rank: Int?
    let name: String
    let wins: Int
    let losses: Int
    let ties: Int
    let record: String
    let pf: Double
    let pa: Double
    let pfg: Double
    let pag: Double
    let diff: Double
    let pfText: String
    let paText: String
    let pfgText: String
    let pagText: String
    let diffText: String
}

// MARK: Standings

/// The standings as they stood after a week (renderStandingsPanel), the
/// regular season's last for a playoff week, and a finished season's
/// "Regular Season" view (renderDivisions): a table per division, or one
/// for the league, then the legend.
struct StandingsPanel: View {
    let info: SeasonInfo
    let season: Season
    let payload: WeekPayload

    private var view: String { payload.week == 0 && info.finished ? "regular" : "panel-standings" }

    var body: some View {
        PanelLoader(expression: "Bridge.season.standings(year, week, view)",
                    arguments: ["year": season.year, "week": payload.week, "view": view],
                    loadingTitle: "Reading the standings",
                    failureTitle: "The standings couldn't be read") { (data: StandingsData) in
            VStack(alignment: .leading, spacing: 14) {
                ForEach(data.cards) { table in
                    StandingsTableCard(season: season, table: table, live: data.live, hasDivisions: data.hasDivisions)
                }
                if data.live && !data.legend.isEmpty {
                    StandingsLegendView(keys: data.legend)
                }
            }
        }
    }
}

/// One division's card. On a phone each team is a row with its numbers
/// under the name (the page's mobile stat strip); with room, a table.
private struct StandingsTableCard: View {
    let season: Season
    let table: StandingsData.Table
    let live: Bool
    let hasDivisions: Bool

    var body: some View {
        Card {
            CardHead(title: table.title, symbol: table.chip == "shield" ? CardIcon.shield : CardIcon.standings)
            ViewThatFits(in: .horizontal) {
                wide.frame(minWidth: 620, idealWidth: 620, maxWidth: .infinity)
                compact
            }
        }
    }

    private var compact: some View {
        VStack(spacing: 0) {
            ForEach(Array(table.rows.enumerated()), id: \.element.id) { index, row in
                if index > 0 { Divider().overlay(Theme.line) }
                StandingsPhoneRow(season: season, row: row, hasDivisions: hasDivisions)
            }
        }
    }

    private var wide: some View {
        VStack(spacing: 0) {
            StandingsWideHeader(hasDivisions: hasDivisions)
            ForEach(table.rows) { row in
                Divider().overlay(Theme.line)
                StandingsWideRow(season: season, row: row, hasDivisions: hasDivisions)
            }
        }
    }
}

/// A phone row: rank, the logo down the left, the name with its markers,
/// and W–L / GB / PF / PA (/ DIV) under it.
private struct StandingsPhoneRow: View {
    let season: Season
    let row: StandingsData.Row
    let hasDivisions: Bool

    var body: some View {
        let team = season.team(row.id)
        HStack(spacing: 12) {
            Text(row.rank)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.ink3)
                .monospacedDigit()
                .frame(width: 20)
                .allowsHitTesting(false)
            HStack(spacing: 10) {
                if let team { TeamBadge(team: team, size: 48, corner: 12).allowsHitTesting(false) }
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 8) {
                        Text(team?.name ?? row.id)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .allowsHitTesting(false)
                        TeamMarkers(teamName: team?.name ?? row.id, seed: row.seed, flag: row.flag, why: row.why)
                    }
                    StandingsStatStrip(cells: cells)
                        .allowsHitTesting(false)
                }
            }
        }
        .padding(.leading, 8)
        .padding(.trailing, 10)
        .padding(.vertical, 11)
        .overlay(alignment: .leading) {
            if let rule = row.rule { Rectangle().fill(rule).frame(width: 3) }
        }
        .rowLink(.team(year: season.year, teamId: row.id), label: "\(team?.name ?? row.id), \(row.record)")
    }

    private var cells: [StandingsStatStrip.Cell] {
        var out: [StandingsStatStrip.Cell] = [
            .init(label: "W–L", value: row.record, weight: 0.8, strong: true),
            .init(label: "GB", value: row.gb, weight: 0.55),
            .init(label: "PF", value: row.pf, weight: 1.2),
            .init(label: "PA", value: row.pa, weight: 1.2),
        ]
        if hasDivisions, let div = row.div { out.append(.init(label: "DIV", value: div, weight: 0.7)) }
        return out
    }
}

/// The numbers under a team's name: a label over each value, in columns
/// that line up down the card (the page's grid of fractions).
struct StandingsStatStrip: View {
    struct Cell: Hashable {
        let label: String
        let value: String
        var weight: CGFloat = 1
        var strong: Bool = false
        var tint: Color? = nil
    }
    let cells: [Cell]

    var body: some View {
        let total = cells.reduce(0) { $0 + $1.weight }
        GeometryReader { geo in
            let gap: CGFloat = 6
            let room = max(0, min(geo.size.width, 440) - gap * CGFloat(cells.count - 1))
            HStack(alignment: .top, spacing: gap) {
                ForEach(cells, id: \.self) { cell in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(cell.label)
                            .font(.system(size: 9.5, weight: .semibold))
                            .tracking(0.6)
                            .textCase(.uppercase)
                            .foregroundStyle(Theme.ink3)
                        Text(cell.value)
                            .font(.system(size: 12.5, weight: cell.strong ? .bold : .medium))
                            .foregroundStyle(cell.tint ?? (cell.strong ? Theme.ink : Theme.ink2))
                            .monospacedDigit()
                            .lineLimit(1)
                            .minimumScaleFactor(0.85)
                    }
                    .frame(width: room * cell.weight / total, alignment: .leading)
                }
            }
        }
        .frame(height: 28)
        .accessibilityElement(children: .combine)
    }
}

// MARK: The wide table

/// The wide table's columns: narrow enough that an iPad beside its
/// sidebar gets the table, not the phone's rows.
private enum StandingsColumns {
    static let rank: CGFloat = 44
    static let record: CGFloat = 70
    static let gb: CGFloat = 50
    static let pct: CGFloat = 60
    static let points: CGFloat = 96
    static let div: CGFloat = 66
}

private enum FinalColumns {
    static let place: CGFloat = 52
    static let record: CGFloat = 66
    static let points: CGFloat = 88
    static let perGame: CGFloat = 58
}

private struct StandingsWideHeader: View {
    let hasDivisions: Bool
    var body: some View {
        HStack(spacing: 0) {
            Text("RK").frame(width: StandingsColumns.rank, alignment: .center)
            Text("Team").frame(maxWidth: .infinity, alignment: .leading)
            Text("W–L").frame(width: StandingsColumns.record, alignment: .trailing)
            Text("GB").frame(width: StandingsColumns.gb, alignment: .trailing)
            Text("PCT").frame(width: StandingsColumns.pct, alignment: .trailing)
            Text("PF").frame(width: StandingsColumns.points, alignment: .trailing)
            Text("PA").frame(width: StandingsColumns.points, alignment: .trailing)
            if hasDivisions { Text("DIV").frame(width: StandingsColumns.div, alignment: .trailing) }
        }
        .font(.system(size: 10.5, weight: .bold))
        .tracking(0.7)
        .textCase(.uppercase)
        .foregroundStyle(Theme.ink3)
        .padding(.trailing, 14)
        .padding(.vertical, 9)
        .background(Theme.surface2)
    }
}

private struct StandingsWideRow: View {
    let season: Season
    let row: StandingsData.Row
    let hasDivisions: Bool

    var body: some View {
        let team = season.team(row.id)
        HStack(spacing: 0) {
            Text(row.rank)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.ink3)
                .frame(width: StandingsColumns.rank)
                .allowsHitTesting(false)
            HStack(spacing: 10) {
                Group {
                    if let team { TeamBadge(team: team, size: 30, corner: 8) }
                    Text(team?.name ?? row.id)
                        .font(.system(size: 13.5, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .allowsHitTesting(false)
                TeamMarkers(teamName: team?.name ?? row.id, seed: row.seed, flag: row.flag, why: row.why)
                    .padding(.trailing, 10)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Group {
                Text(row.record).fontWeight(.bold).foregroundStyle(Theme.ink).frame(width: StandingsColumns.record, alignment: .trailing)
                Text(row.gb).frame(width: StandingsColumns.gb, alignment: .trailing)
                Text(row.pct).frame(width: StandingsColumns.pct, alignment: .trailing)
                Text(row.pf).frame(width: StandingsColumns.points, alignment: .trailing)
                Text(row.pa).frame(width: StandingsColumns.points, alignment: .trailing)
                if hasDivisions { Text(row.div ?? "").frame(width: StandingsColumns.div, alignment: .trailing) }
            }
            .font(.system(size: 13.5, weight: .medium))
            .foregroundStyle(Theme.ink2)
            .monospacedDigit()
            .allowsHitTesting(false)
        }
        .padding(.trailing, 14)
        .padding(.vertical, 10)
        .overlay(alignment: .leading) {
            if let rule = row.rule { Rectangle().fill(rule).frame(width: 3) }
        }
        .rowLink(.team(year: season.year, teamId: row.id), label: "\(team?.name ?? row.id), \(row.record)")
    }
}

// MARK: Final standings

/// What the final table sorts on: the page's sort buttons, the same
/// defaults (finalSortDefaults).
enum FinalSortKey: String, CaseIterable, Identifiable {
    case finalRank, team, record, pf, pa, pfg, diff
    var id: String { rawValue }

    /// The phone's sort menu (mobileFinalSort).
    var menuLabel: String {
        switch self {
        case .finalRank: return "Place"
        case .team: return "Team"
        case .record: return "Record"
        case .pf: return "Points For"
        case .pa: return "Points Against"
        case .pfg: return "PF per Game"
        case .diff: return "Point Differential"
        }
    }

    var ascendingByDefault: Bool {
        switch self {
        case .finalRank, .team, .pa: return true
        default: return false
        }
    }
}

/// A finished season's final standings, sortable as the page's table is.
struct FinalStandingsPanel: View {
    let info: SeasonInfo
    let season: Season

    var body: some View {
        PanelLoader(expression: "Bridge.season.finalStandings(year)",
                    arguments: ["year": season.year],
                    loadingTitle: "Reading the final standings",
                    failureTitle: "The final standings couldn't be read") { (rows: [FinalRow]) in
            FinalStandingsCard(season: season, rows: rows)
        }
    }
}

private struct FinalStandingsCard: View {
    let season: Season
    let rows: [FinalRow]
    @State private var key: FinalSortKey = .finalRank
    @State private var ascending = true

    private var sorted: [FinalRow] {
        rows.sorted { a, b in
            let c = compare(a, b)
            if c != 0 { return ascending ? c < 0 : c > 0 }
            if key == .record && a.losses != b.losses { return a.losses < b.losses }
            return (a.rank ?? 99) < (b.rank ?? 99)
        }
    }

    /// finalSortValue, compared.
    private func compare(_ a: FinalRow, _ b: FinalRow) -> Int {
        func cmp(_ x: Double, _ y: Double) -> Int { x < y ? -1 : x > y ? 1 : 0 }
        switch key {
        case .team:
            switch a.name.lowercased().localizedCompare(b.name.lowercased()) {
            case .orderedAscending: return -1
            case .orderedDescending: return 1
            case .orderedSame: return 0
            }
        case .finalRank: return cmp(Double(a.rank ?? 99), Double(b.rank ?? 99))
        case .record: return cmp(Double(a.wins) + Double(a.ties) / 2, Double(b.wins) + Double(b.ties) / 2)
        case .pf: return cmp(a.pf, b.pf)
        case .pa: return cmp(a.pa, b.pa)
        case .pfg: return cmp(a.pfg, b.pfg)
        case .diff: return cmp(a.diff, b.diff)
        }
    }

    private func sort(by newKey: FinalSortKey) {
        withAnimation(.smooth(duration: 0.3)) {
            if key == newKey {
                ascending.toggle()
            } else {
                key = newKey
                ascending = newKey.ascendingByDefault
            }
        }
    }

    var body: some View {
        Card {
            head
            ViewThatFits(in: .horizontal) {
                wide.frame(minWidth: 640, idealWidth: 640, maxWidth: .infinity)
                compact
            }
        }
        .sensoryFeedback(.selection, trigger: "\(key.rawValue)\(ascending)")
    }

    /// The card head with the phone's sort control: a menu of what to sort
    /// on, and the direction beside it.
    private var head: some View {
        HStack(spacing: 10) {
            Image(systemName: CardIcon.standings)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 24, height: 24)
                .background(Theme.ink, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            Text("Final Standings")
                .displayStyle(20)
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 8)
            Menu {
                Picker("Sort", selection: Binding(get: { key }, set: { newKey in
                    withAnimation(.smooth(duration: 0.3)) {
                        key = newKey
                        ascending = newKey.ascendingByDefault
                    }
                })) {
                    ForEach(FinalSortKey.allCases) { k in
                        Text(k.menuLabel).tag(k)
                    }
                }
                Section {
                    Picker("Direction", selection: Binding(get: { ascending }, set: { v in withAnimation(.smooth(duration: 0.3)) { ascending = v } })) {
                        Label("Ascending", systemImage: "arrow.up").tag(true)
                        Label("Descending", systemImage: "arrow.down").tag(false)
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Text("Sort").foregroundStyle(Theme.ink3)
                    Text(key.menuLabel).foregroundStyle(Theme.ink)
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.ink3)
                }
                .font(.system(size: 12.5, weight: .semibold))
                .lineLimit(1)
            }
            .buttonStyle(.glass)
            .accessibilityLabel("Sort final standings")
            Button {
                withAnimation(.smooth(duration: 0.3)) { ascending.toggle() }
            } label: {
                Image(systemName: ascending ? "arrow.up" : "arrow.down")
                    .font(.system(size: 12, weight: .bold))
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .accessibilityLabel(ascending ? "Sort ascending" : "Sort descending")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private var compact: some View {
        VStack(spacing: 0) {
            ForEach(Array(sorted.enumerated()), id: \.element.id) { index, row in
                if index > 0 { Divider().overlay(Theme.line) }
                FinalPhoneRow(season: season, row: row)
            }
        }
    }

    private var wide: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                sortHeader(.finalRank, "Place").frame(width: FinalColumns.place, alignment: .leading).padding(.leading, 12)
                sortHeader(.team, "Team").frame(maxWidth: .infinity, alignment: .leading)
                sortHeader(.record, "Record").frame(width: FinalColumns.record, alignment: .trailing)
                sortHeader(.pf, "PF").frame(width: FinalColumns.points, alignment: .trailing)
                sortHeader(.pa, "PA").frame(width: FinalColumns.points, alignment: .trailing)
                sortHeader(.pfg, "PF/G").frame(width: FinalColumns.perGame, alignment: .trailing)
                Text("PA/G").frame(width: FinalColumns.perGame, alignment: .trailing)
                sortHeader(.diff, "Diff").frame(width: FinalColumns.perGame, alignment: .trailing)
            }
            .font(.system(size: 10.5, weight: .bold))
            .tracking(0.7)
            .textCase(.uppercase)
            .foregroundStyle(Theme.ink3)
            .padding(.trailing, 14)
            .padding(.vertical, 8)
            .background(Theme.surface2)
            ForEach(sorted) { row in
                Divider().overlay(Theme.line)
                FinalWideRow(season: season, row: row)
            }
        }
    }

    private func sortHeader(_ k: FinalSortKey, _ title: String) -> some View {
        Button { sort(by: k) } label: {
            HStack(spacing: 3) {
                Text(title)
                if key == k {
                    Image(systemName: ascending ? "arrow.up" : "arrow.down").font(.system(size: 9, weight: .heavy))
                }
            }
            .foregroundStyle(key == k ? Theme.accentInk : Theme.ink3)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Sort by \(title)")
        .accessibilityAddTraits(key == k ? .isSelected : [])
    }
}

private let placeMedals = ["🏆", "🥈", "🥉"]

private struct FinalPhoneRow: View {
    let season: Season
    let row: FinalRow

    var body: some View {
        let team = season.team(row.id)
        let champion = row.rank == 1
        NavigationLink(value: LeagueRoute.team(year: season.year, teamId: row.id)) {
            HStack(spacing: 12) {
                VStack(spacing: 1) {
                    if let rank = row.rank, rank >= 1, rank <= 3 {
                        Text(placeMedals[rank - 1]).font(.system(size: 13))
                    }
                    Text(row.rank.map(String.init) ?? "–")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.ink3)
                        .monospacedDigit()
                }
                .frame(width: 20)
                HStack(spacing: 10) {
                    if let team { TeamBadge(team: team, size: 48, corner: 12) }
                    VStack(alignment: .leading, spacing: 5) {
                        Text(team?.name ?? row.name)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        StandingsStatStrip(cells: [
                            .init(label: "W–L", value: row.record, weight: 0.8, strong: true),
                            .init(label: "PF", value: row.pfText, weight: 1.2),
                            .init(label: "PA", value: row.paText, weight: 1.2),
                            .init(label: "PF/G", value: row.pfgText, weight: 0.85),
                            .init(label: "Diff", value: row.diffText, weight: 0.85, tint: row.diff >= 0 ? Theme.green : Theme.red),
                        ])
                    }
                }
            }
            .padding(.leading, 8)
            .padding(.trailing, 10)
            .padding(.vertical, 11)
            .background(champion ? Theme.gold.opacity(0.09) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(PanelRowPressStyle())
    }
}

private struct FinalWideRow: View {
    let season: Season
    let row: FinalRow

    var body: some View {
        let team = season.team(row.id)
        let champion = row.rank == 1
        NavigationLink(value: LeagueRoute.team(year: season.year, teamId: row.id)) {
            HStack(spacing: 0) {
                HStack(spacing: 4) {
                    if let rank = row.rank, rank >= 1, rank <= 3 { Text(placeMedals[rank - 1]).font(.system(size: 13)) }
                    Text(row.rank.map(String.init) ?? "–").foregroundStyle(Theme.ink3)
                }
                .font(.system(size: 13, weight: .semibold))
                .frame(width: FinalColumns.place, alignment: .leading)
                .padding(.leading, 12)
                HStack(spacing: 10) {
                    if let team { TeamBadge(team: team, size: 30, corner: 8) }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(team?.name ?? row.name).font(.system(size: 13.5, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                        if let team { Text(team.owner).font(.system(size: 11.5, weight: .medium)).foregroundStyle(Theme.ink3).lineLimit(1) }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Group {
                    Text(row.record).fontWeight(.bold).foregroundStyle(Theme.ink).frame(width: FinalColumns.record, alignment: .trailing)
                    Text(row.pfText).frame(width: FinalColumns.points, alignment: .trailing)
                    Text(row.paText).frame(width: FinalColumns.points, alignment: .trailing)
                    Text(row.pfgText).frame(width: FinalColumns.perGame, alignment: .trailing)
                    Text(row.pagText).frame(width: FinalColumns.perGame, alignment: .trailing)
                    Text(row.diffText).fontWeight(.semibold).foregroundStyle(row.diff >= 0 ? Theme.green : Theme.red).frame(width: FinalColumns.perGame, alignment: .trailing)
                }
                .font(.system(size: 13.5, weight: .medium))
                .foregroundStyle(Theme.ink2)
                .monospacedDigit()
            }
            .padding(.trailing, 14)
            .padding(.vertical, 10)
            .background(champion ? Theme.gold.opacity(0.09) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(PanelRowPressStyle())
    }
}
