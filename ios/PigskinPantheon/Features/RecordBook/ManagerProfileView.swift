import SwiftUI
import Charts

/// A manager's whole history (alltime.html's profile drawer): the hero
/// with their record, playoffs, titles and last places; Highlights;
/// Season History (each season opens that team's season); Regular-Season
/// Wins; Most-Started Players; and Head-to-Head against every other
/// manager.
struct ManagerProfileView: View {
    let ownerId: String

    @Environment(LeagueSession.self) private var session
    @Environment(\.horizontalSizeClass) private var sizeClass

    @State private var profile: BookProfile?
    @State private var error: String?
    @State private var starters: BookStarters?
    @State private var startersFailed = false
    @State private var h2hSort = BookSort(key: "pct", direction: "desc")

    var body: some View {
        PageScroll {
            if let profile {
                BookProfileHero(profile: profile)
                if sizeClass == .regular {
                    // The desktop drawer's sections, two to a row.
                    HStack(alignment: .top, spacing: 14) {
                        VStack(spacing: 14) {
                            BookHighlightsCard(profile: profile, columns: 3)
                            BookWinsChartCard(profile: profile)
                            BookStartersCard(profile: profile, starters: starters, failed: startersFailed)
                        }
                        VStack(spacing: 14) {
                            BookSeasonHistoryCard(profile: profile)
                        }
                    }
                    // A table wants the page's whole width.
                    BookHeadToHeadCard(profile: profile, sort: $h2hSort)
                } else {
                    BookHighlightsCard(profile: profile, columns: 2)
                    BookSeasonHistoryCard(profile: profile)
                    BookWinsChartCard(profile: profile)
                    BookStartersCard(profile: profile, starters: starters, failed: startersFailed)
                    BookHeadToHeadCard(profile: profile, sort: $h2hSort)
                }
            } else if let error {
                EmptyCard(title: "This manager couldn't be opened", detail: error, symbol: "person.crop.circle.badge.exclamationmark")
            } else {
                LoadingCard(title: "Opening the team history")
            }
        }
        .navigationTitle(profile?.currentTeam ?? "Manager")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: ownerId) {
            do {
                let p = try await session.engine.call(BookProfile.self, "Bridge.records.profile(id)", ["id": ownerId])
                withAnimation(.smooth) {
                    profile = p
                    h2hSort = p.h2hStart
                }
            } catch {
                self.error = error.localizedDescription
                return
            }
            do {
                let s = try await session.engine.call(BookStarters.self, "Bridge.records.starters(id)", ["id": ownerId])
                withAnimation(.smooth) { starters = s }
            } catch {
                startersFailed = true
            }
        }
    }
}

// MARK: Hero

private struct BookProfileHero: View {
    let profile: BookProfile

    private var tint: Color { Color(css: profile.color) ?? Theme.navy2 }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                TeamBadge(bookFace: profile, size: 64)
                    .shadow(color: .black.opacity(0.3), radius: 8, y: 4)
                VStack(alignment: .leading, spacing: 3) {
                    Text("All-time")
                        .font(.system(size: 11, weight: .heavy))
                        .tracking(1.4)
                        .textCase(.uppercase)
                        .foregroundStyle(Theme.gold)
                    Text(profile.currentTeam)
                        .displayStyle(30)
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                    Text(profile.ownerLine)
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.8))
                }
            }
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) {
                    ForEach(profile.stats, id: \.label) { stat in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(stat.label)
                                .font(.system(size: 9.5, weight: .bold))
                                .textCase(.uppercase)
                                .tracking(0.5)
                                .foregroundStyle(.white.opacity(0.72))
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                            Text(stat.value)
                                .font(.system(size: 19, weight: .heavy))
                                .foregroundStyle(.white)
                                .monospacedDigit()
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .glassEffect(.regular.tint(.white.opacity(0.06)), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(
            LinearGradient(colors: [tint, Theme.navy], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
        )
    }
}

// MARK: Highlights

private struct BookHighlightsCard: View {
    let profile: BookProfile
    let columns: Int

    var body: some View {
        Card {
            CardHead(title: "Highlights", symbol: "star")
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: columns), spacing: 8) {
                ForEach(profile.highlights) { BookHighlightTile(tile: $0) }
            }
            .padding(12)
        }
    }
}

private struct BookHighlightTile: View {
    let tile: BookHighlight

    /// The tile's colour (`.hl-gold`, `.hl-red`…): its chips and label.
    private var tint: Color {
        switch tile.kind {
        case "gold": Color(light: 0xC99A1C, dark: 0xE7B73C)
        case "red": Color(light: 0xC73535, dark: 0xF06B63)
        case "green": Color(light: 0x16834A, dark: 0x47CD89)
        case "fire": Color(light: 0xB4540F, dark: 0xF39A56)
        case "blue": Color(light: 0x0F56BD, dark: 0x6FA6FF)
        case "purple": Color(light: 0x5B3FB8, dark: 0xA690F5)
        default: Color(light: 0x102B43, dark: 0x9FB3CC)
        }
    }

    private var ink: Color {
        switch tile.kind {
        case "gold": Color(light: 0x8A6500, dark: 0xF6C661)
        case "red": Color(light: 0xA62F2B, dark: 0xFF8A80)
        default: tint
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(tile.label)
                .font(.system(size: 9.5, weight: .heavy))
                .tracking(0.8)
                .textCase(.uppercase)
                .foregroundStyle(ink)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            if let chips = tile.chips, !chips.isEmpty {
                BookFlowChips(years: chips, tint: tint)
            } else {
                Text(tile.value)
                    .font(.system(size: 18, weight: .heavy))
                    .foregroundStyle(Theme.ink)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Spacer(minLength: 0)
            if let meta = tile.meta {
                Text(meta)
                    .font(.system(size: 10.5, weight: .semibold))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 84, alignment: .topLeading)
        .padding(10)
        .background(alignment: .topTrailing) {
            Text(tile.icon)
                .font(.system(size: 44))
                .opacity(0.16)
                .offset(x: 6, y: -4)
                .accessibilityHidden(true)
        }
        .background(
            LinearGradient(colors: [Theme.card, tint.opacity(0.14)], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(tint.opacity(0.3)))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Years as little filled capsules, wrapping.
private struct BookFlowChips: View {
    let years: [Int]
    let tint: Color

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 4) { chips(years) }
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(stride(from: 0, to: years.count, by: 3)), id: \.self) { i in
                    HStack(spacing: 4) { chips(Array(years[i..<min(i + 3, years.count)])) }
                }
            }
        }
    }

    private func chips(_ list: [Int]) -> some View {
        ForEach(list, id: \.self) { year in
            Text(String(year))
                .font(.system(size: 11, weight: .heavy))
                .foregroundStyle(.white)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(tint, in: Capsule())
        }
    }
}

// MARK: Season History

private struct BookSeasonHistoryCard: View {
    let profile: BookProfile

    var body: some View {
        Card {
            CardHead(title: "Season History", symbol: CardIcon.schedule)
            ForEach(Array(profile.seasons.enumerated()), id: \.element.id) { index, season in
                NavigationLink(value: LeagueRoute.team(year: season.year, teamId: season.teamId)) {
                    HStack(spacing: 12) {
                        Text(String(season.year))
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(Theme.ink3)
                            .monospacedDigit()
                            .frame(width: 40, alignment: .leading)
                        BookPlacePill(season: season)
                        Text(season.teamName)
                            .font(.system(size: 14.5, weight: .semibold))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                        Spacer(minLength: 6)
                        Text(season.record)
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Theme.ink)
                            .monospacedDigit()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Theme.ink3)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(season.teamName), \(season.year): open that season")
                if index < profile.seasons.count - 1 { Divider().overlay(Theme.line).padding(.leading, 14) }
            }
        }
    }
}

/// The finish in a circle: gold, silver and bronze for the podium, red
/// for last, grey between, a live dot for a season being played.
private struct BookPlacePill: View {
    let season: BookProfileSeason

    private var fill: Color {
        switch season.place {
        case "1": Color(hex: 0xC99A1C)
        case "2": Color(hex: 0x8A97A6)
        case "3": Color(hex: 0xB0703A)
        case "last": Color(hex: 0xC73535)
        case "live": Theme.redSoft
        default: Color(light: 0xD5DCE4, dark: 0x2C3E5C)
        }
    }

    var body: some View {
        ZStack {
            Circle().fill(fill)
            if season.live {
                Circle().fill(Theme.red).frame(width: 8, height: 8)
                    .background(Circle().fill(Theme.red.opacity(0.18)).frame(width: 14, height: 14))
            } else if let rank = season.finalRank {
                Text("\(rank)")
                    .font(.system(size: 12, weight: .heavy))
                    .foregroundStyle(season.place == "mid" ? Color(light: 0x4B5866, dark: 0xC2CAD6) : .white)
                    .monospacedDigit()
            }
        }
        .frame(width: 26, height: 26)
        .help(season.live ? "In progress" : "")
    }
}

// MARK: Regular-Season Wins

private struct BookWinsChartCard: View {
    let profile: BookProfile

    private var tint: Color { Color(css: profile.color) ?? Theme.accent }

    var body: some View {
        Card {
            CardHead(title: "Regular-Season Wins", symbol: "chart.xyaxis.line")
            if profile.chart.points.isEmpty {
                Text("No finished seasons yet.")
                    .font(.subheadline).foregroundStyle(Theme.ink3).padding(14)
            } else {
                Chart(profile.chart.points) { point in
                    LineMark(x: .value("Season", String(point.year)), y: .value("Wins", point.wins))
                        .foregroundStyle(tint)
                        .lineStyle(StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
                        .interpolationMethod(.linear)
                    PointMark(x: .value("Season", String(point.year)), y: .value("Wins", point.wins))
                        .symbol {
                            Circle()
                                .fill(Theme.card)
                                .overlay(Circle().strokeBorder(tint, lineWidth: 3))
                                .frame(width: 13, height: 13)
                        }
                        .annotation(position: .top, spacing: 4) {
                            Text("\(point.wins)")
                                .font(.system(size: 13, weight: .heavy))
                                .foregroundStyle(Theme.ink)
                        }
                }
                .chartYScale(domain: 0...max(1, profile.chart.maxWins))
                .chartYAxis {
                    AxisMarks(position: .leading, values: profile.chart.ticks) { _ in
                        AxisGridLine().foregroundStyle(Theme.line)
                        AxisValueLabel().font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.ink3)
                    }
                }
                .chartXAxis {
                    AxisMarks { _ in
                        AxisValueLabel().font(.system(size: 12, weight: .heavy)).foregroundStyle(Theme.muted)
                    }
                }
                .chartXScale(range: .plotDimension(padding: 24))
                .frame(height: 200)
                .padding(.horizontal, 14)
                .padding(.top, 22)
                .padding(.bottom, 12)
                .accessibilityLabel("Regular season wins by year")
            }
        }
    }
}

// MARK: Most-Started Players

private struct BookStartersCard: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    let profile: BookProfile
    let starters: BookStarters?
    let failed: Bool

    private var tint: Color { Color(css: profile.color) ?? Theme.accent }
    private var roomy: Bool { sizeClass == .regular }

    var body: some View {
        Card {
            CardHead(title: "Most-Started Players", symbol: "person.3")
            if let starters, starters.message == nil {
                table(starters)
            } else {
                Text(failed ? "Lineups could not be loaded." : starters?.message ?? "Loading lineups…")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink3)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(18)
            }
        }
    }

    private func table(_ s: BookStarters) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Text("#").frame(width: 16)
                Color.clear.frame(width: 30, height: 1)
                Text("Player").frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 3) {
                    ForEach(s.years, id: \.self) { y in
                        Text("’" + String(String(y).suffix(2))).frame(maxWidth: .infinity)
                    }
                }
                .frame(width: yearsWidth(s.years.count))
                Text("Starts").frame(width: 38, alignment: .trailing)
            }
            .font(.system(size: 9.5, weight: .bold))
            .foregroundStyle(Theme.ink3)
            .textCase(.uppercase)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Theme.surface2)

            ForEach(Array(s.players.enumerated()), id: \.element.id) { index, p in
                NavigationLink(value: LeagueRoute.player(id: p.id)) {
                    HStack(spacing: 6) {
                        Text("\(p.rank)")
                            .font(.system(size: 11, weight: .heavy))
                            .foregroundStyle(Theme.muted)
                            .frame(width: 16)
                        ClubChip(club: p.nfl).frame(width: 30)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(p.name)
                                .font(.system(size: roomy ? 13 : 12, weight: .bold))
                                .foregroundStyle(Theme.ink)
                                .lineLimit(1)
                                .minimumScaleFactor(0.85)
                            Text(p.pos)
                                .font(.system(size: 9.5, weight: .heavy))
                                .foregroundStyle(Theme.muted)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        HStack(spacing: 3) {
                            ForEach(p.cells) { cell in BookYearCell(cell: cell, tint: tint, roomy: roomy) }
                        }
                        .frame(width: yearsWidth(s.years.count))
                        Text("\(p.starts)")
                            .font(.system(size: 13, weight: .heavy))
                            .foregroundStyle(Theme.ink)
                            .monospacedDigit()
                            .frame(width: 38, alignment: .trailing)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(p.rank). \(p.name), \(p.pos), \(p.starts) starts")
                if index < s.players.count - 1 { Divider().overlay(Theme.line) }
            }
        }
    }

    /// Room for a cell per season: wider where there's space.
    private func yearsWidth(_ count: Int) -> CGFloat {
        CGFloat(count) * (roomy ? 44 : 27)
    }
}

/// A season's starts: the count on the team's colour, as strong as the
/// count is big; the club he started for underneath.
private struct BookYearCell: View {
    let cell: BookStarters.Cell
    let tint: Color
    let roomy: Bool

    var body: some View {
        Group {
            if cell.n == 0 {
                Text("·")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.line2)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
            } else {
                VStack(spacing: 1) {
                    if roomy, let club = cell.clubs.first {
                        ClubChip(club: club).scaleEffect(0.8)
                    } else if let club = cell.clubs.first {
                        RoundedRectangle(cornerRadius: 1)
                            .fill(Color(css: NFLClub.colors[club]) ?? Theme.ink3)
                            .frame(height: 3)
                            .padding(.horizontal, 4)
                    }
                    Text("\(cell.n)")
                        .font(.system(size: roomy ? 11 : 10, weight: .heavy))
                        .foregroundStyle(Theme.ink)
                        .monospacedDigit()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.card.mix(with: tint, by: cell.fill), in: RoundedRectangle(cornerRadius: 5, style: .continuous))
            }
        }
        .frame(height: roomy ? 34 : 28)
        .help(cell.title)
    }
}

// MARK: Head-to-Head

private struct BookHeadToHeadCard: View {
    let profile: BookProfile
    @Binding var sort: BookSort
    /// The card's width: the table needs room for a name beside its five
    /// columns, else each opponent is a row of mini stats as on a phone.
    @State private var width: CGFloat = 0
    private var table: Bool { width >= 540 }

    private var rows: [BookH2HLine] {
        let byId = Dictionary(uniqueKeysWithValues: profile.h2h.map { ($0.ownerId, $0) })
        return (profile.h2hOrders[sort.id] ?? profile.h2h.map(\.ownerId)).compactMap { byId[$0] }
    }

    var body: some View {
        Card {
            BookCardHead(title: "Head-to-Head", symbol: CardIcon.versus) {
                BookSortControl(options: BookSortOptions.h2h, state: $sort, defaults: profile.h2hDefaults)
            }
            if table { wideHeader }
            if rows.isEmpty {
                Text("No games against the league yet.")
                    .font(.subheadline).foregroundStyle(Theme.ink3).padding(14)
            }
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                NavigationLink(value: LeagueRoute.manager(ownerId: row.ownerId)) {
                    Group {
                        if table { wideRow(row) } else { phoneRow(row) }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if index < rows.count - 1 { Divider().overlay(Theme.line).padding(.leading, 14) }
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .animation(.snappy, value: sort)
    }

    private func phoneRow(_ row: BookH2HLine) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                BookManagerLabel(face: row)
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.ink3)
            }
            HStack(spacing: 6) {
                BookMiniStat(label: "W–L", value: row.record)
                BookMiniStat(label: "PCT", value: row.pct)
                BookMiniStat(label: "PF", value: row.pf)
                BookMiniStat(label: "PA", value: row.pa)
                BookMiniStat(label: "Diff", value: row.diffText, color: .bookDiff(row.diff))
            }
            .accessibilityElement(children: .combine)
        }
    }

    private var wideHeader: some View {
        HStack(spacing: 8) {
            BookSortHeader(title: "Opponent", key: "team", state: $sort, defaults: profile.h2hDefaults, alignment: .leading)
                .frame(maxWidth: .infinity)
            BookSortHeader(title: "Record", key: "wins", state: $sort, defaults: profile.h2hDefaults).frame(width: 52)
            BookSortHeader(title: "PCT", key: "pct", state: $sort, defaults: profile.h2hDefaults).frame(width: 44)
            BookSortHeader(title: "PF", key: "pf", state: $sort, defaults: profile.h2hDefaults).frame(width: 70)
            BookSortHeader(title: "PA", key: "pa", state: $sort, defaults: profile.h2hDefaults).frame(width: 70)
            BookSortHeader(title: "Diff", key: "diff", state: $sort, defaults: profile.h2hDefaults).frame(width: 66)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Theme.surface2)
    }

    private func wideRow(_ row: BookH2HLine) -> some View {
        HStack(spacing: 8) {
            BookManagerLabel(face: row, size: 28).frame(maxWidth: .infinity, alignment: .leading)
            Group {
                Text(row.record).fontWeight(.bold).frame(width: 52, alignment: .trailing)
                Text(row.pct).frame(width: 44, alignment: .trailing)
                Text(row.pf).frame(width: 70, alignment: .trailing)
                Text(row.pa).frame(width: 70, alignment: .trailing)
                Text(row.diffText).foregroundStyle(Color.bookDiff(row.diff)).frame(width: 66, alignment: .trailing)
            }
            .font(.system(size: 12.5, weight: .medium))
            .foregroundStyle(Theme.ink)
            .monospacedDigit()
        }
    }
}
