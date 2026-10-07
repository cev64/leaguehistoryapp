import SwiftUI

/// A team's season (season.html's team drawer, openTeam): the team in its
/// colours with its record, points and seed, every week of its schedule
/// with the box scores, its playoff games, and everyone it started with a
/// cell per week. An opponent opens that team's season in its place (the
/// site's swapTeam), as does the team menu.
struct TeamSeasonView: View {
    @Environment(LeagueSession.self) private var session
    @Environment(\.horizontalSizeClass) private var sizeClass
    let year: Int
    let teamId: String

    @State private var current: String?
    @State private var loaded: [String: TeamSeason] = [:]
    @State private var error: String?
    @State private var forward = true

    private var shownId: String { current ?? teamId }
    private var season: Season? { session.summary?.season(year) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let season, let team = season.team(shownId) {
                    Group {
                        if let data = loaded[shownId] {
                            TeamSeasonContent(data: data, season: season, team: team) { swap(to: $0) }
                        } else if let error {
                            TeamHero(team: team, yearLine: "\(String(year)) season", ownerLine: team.owner, stats: [], ownerId: team.ownerId)
                            EmptyCard(title: "This season couldn't be read", detail: error, symbol: "exclamationmark.triangle")
                        } else {
                            TeamHero(team: team, yearLine: "\(String(year)) season", ownerLine: team.owner, stats: [], ownerId: team.ownerId)
                            LoadingCard(title: "Reading \(team.name)'s season")
                        }
                    }
                    .id(shownId)
                    .transition(.asymmetric(
                        insertion: .opacity.combined(with: .offset(x: forward ? 22 : -22)),
                        removal: .opacity.combined(with: .offset(x: forward ? -22 : 22))))
                } else {
                    EmptyCard(title: "No such team", detail: "There is no team \(shownId) in \(String(year)).", symbol: "person.crop.circle.badge.questionmark")
                }
            }
            .padding(.horizontal, Theme.gutter)
            .padding(.vertical, 12)
            .frame(maxWidth: sizeClass == .regular ? 900 : .infinity)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.page)
        .navigationTitle(season?.team(shownId)?.name ?? "Team")
        .navigationSubtitle("\(String(year)) season")
        .toolbarTitleDisplayMode(.inline)
        .toolbar {
            if let season, season.teams.count > 1 {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("Team", selection: Binding(get: { shownId }, set: { swap(to: $0) })) {
                            ForEach(season.teamIds, id: \.self) { id in
                                if let t = season.team(id) {
                                    Text(t.name).tag(id)
                                }
                            }
                        }
                    } label: {
                        Label("Teams", systemImage: "person.2")
                    }
                    .accessibilityLabel("Another team's season")
                }
            }
        }
        .sensoryFeedback(.selection, trigger: shownId)
        .task(id: shownId) { await load(shownId) }
    }

    private func swap(to id: String) {
        guard id != shownId, let season else { return }
        let ids = season.teamIds
        forward = (ids.firstIndex(of: id) ?? 0) >= (ids.firstIndex(of: shownId) ?? 0)
        withAnimation(.spring(duration: 0.35, bounce: 0.1)) { current = id }
    }

    private func load(_ id: String) async {
        guard loaded[id] == nil else { return }
        error = nil
        do {
            let data = try await session.engine.call(TeamSeason.self, "Bridge.recap.team(year, teamId)", ["year": year, "teamId": id])
            withAnimation(.smooth(duration: 0.25)) { loaded[id] = data }
        } catch {
            if !Task.isCancelled { self.error = error.localizedDescription }
        }
    }
}

private struct TeamSeasonContent: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    let data: TeamSeason
    let season: Season
    let team: Team
    let swap: (String) -> Void

    var body: some View {
        TeamHero(team: team, yearLine: data.yearLine, ownerLine: data.ownerLine, stats: data.stats, ownerId: data.ownerId)
        TeamScheduleSection(title: "Regular Season Schedule", items: data.schedule, post: false, data: data, season: season, swap: swap)
        if !data.post.isEmpty {
            TeamScheduleSection(title: data.postTitle, items: data.post, post: true, data: data, season: season, swap: swap)
        }
        if let roster = data.roster {
            TeamStartersSection(roster: roster, team: team)
        }
    }
}

// MARK: Hero

private struct TeamHero: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    let team: Team
    let yearLine: String
    let ownerLine: String
    let stats: [TeamSeason.Stat]
    let ownerId: String

    private var tint: Color { Color(css: team.color) ?? Theme.navy2 }

    /// The phone puts the seed (or final place) second, as the site's does.
    private var ordered: [TeamSeason.Stat] {
        guard sizeClass != .regular, stats.count == 4 else { return stats }
        return [stats[0], stats[3], stats[1], stats[2]]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 15) {
                TeamBadge(team: team, size: 58, corner: 16)
                VStack(alignment: .leading, spacing: 4) {
                    Text(yearLine)
                        .font(.system(size: 10, weight: .heavy)).tracking(1).textCase(.uppercase)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .background(.white.opacity(0.16), in: Capsule())
                    NavigationLink(value: LeagueRoute.manager(ownerId: ownerId)) {
                        Text(team.name)
                            .font(.system(size: 25, weight: .bold))
                            .tracking(-0.6)
                            .foregroundStyle(.white)
                            .lineLimit(2)
                            .minimumScaleFactor(0.7)
                            .multilineTextAlignment(.leading)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens \(team.owner)'s career")
                    Text(ownerLine).font(.system(size: 13)).foregroundStyle(.white.opacity(0.72))
                }
                Spacer(minLength: 0)
            }
            if !stats.isEmpty {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: sizeClass == .regular ? 4 : 2), spacing: 8) {
                    ForEach(ordered, id: \.self) { s in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(s.label)
                                .font(.system(size: 9.5, weight: .heavy)).tracking(0.9).textCase(.uppercase)
                                .foregroundStyle(.white.opacity(0.63))
                                .lineLimit(1)
                            Text(s.value)
                                .font(.system(size: 20, weight: .bold))
                                .monospacedDigit()
                                .foregroundStyle(.white)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                                .contentTransition(.numericText())
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .frosted(RoundedRectangle(cornerRadius: 12, style: .continuous), opacity: 0.10)
                    }
                }
            }
            NavigationLink(value: LeagueRoute.manager(ownerId: ownerId)) {
                Label("\(team.owner)'s career", systemImage: "person.crop.circle")
                    .font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.bordered)
            .tint(.white)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            ZStack(alignment: .topTrailing) {
                LinearGradient(colors: [tint, Color(hex: 0x0B1220)], startPoint: .topLeading, endPoint: .bottomTrailing)
                Circle().fill(.white.opacity(0.08)).frame(width: 260, height: 260).offset(x: 120, y: -110)
            }
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .environment(\.colorScheme, .dark)
    }
}

// MARK: Schedule

private struct TeamScheduleSection: View {
    let title: String
    let items: [TeamSeason.ScheduleItem]
    let post: Bool
    let data: TeamSeason
    let season: Season
    let swap: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.ink).padding(.horizontal, 2)
                .accessibilityAddTraits(.isHeader)
            VStack(spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.element.id) { i, g in
                    row(g)
                        .overlay(alignment: .bottom) {
                            if i < items.count - 1 { Rectangle().fill(Theme.line).frame(height: 1) }
                        }
                }
            }
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.line))
        }
    }

    /// The result, then the week (or the round) over the opponent, then the
    /// score: the score never wraps and the opponent keeps the room.
    @ViewBuilder private func row(_ g: TeamSeason.ScheduleItem) -> some View {
        HStack(spacing: 10) {
            pill(g)
            VStack(alignment: .leading, spacing: 2) {
                weekLabel(g.label)
                opponent(g)
            }
            Spacer(minLength: 6)
            score(g)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
    }

    private func weekLabel(_ s: String) -> some View {
        Text(s).font(.system(size: 10, weight: .heavy)).tracking(0.5).textCase(.uppercase).foregroundStyle(Theme.muted)
    }

    private func pill(_ g: TeamSeason.ScheduleItem) -> some View {
        let color: Color = !g.played ? Color(light: 0xB9C3CD, dark: 0x3A4A62)
            : g.result == "W" ? Color(hex: 0x15803D) : g.result == "L" ? Color(hex: 0xDC2626) : Color(hex: 0x8693A1)
        return Text(g.played ? (g.result ?? "–") : "–")
            .font(.system(size: 11, weight: .black))
            .foregroundStyle(.white)
            .frame(width: 27, height: 27)
            .background(color, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            .accessibilityLabel(g.result == "W" ? "Won" : g.result == "L" ? "Lost" : g.result == "T" ? "Tied" : "Not played")
    }

    @ViewBuilder private func opponent(_ g: TeamSeason.ScheduleItem) -> some View {
        let name = season.team(g.opponent)?.name ?? g.opponent
        Button {
            swap(g.opponent)
        } label: {
            Text("vs \(name)")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .underline(pattern: .dot, color: Theme.accent.opacity(0.55))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(name): season and schedule")
    }

    @ViewBuilder private func score(_ g: TeamSeason.ScheduleItem) -> some View {
        if g.played, let mine = g.teamScore, let theirs = g.oppScore {
            let text = "\(Fmt.pts(mine))–\(Fmt.pts(theirs))"
            if data.boxWeeks.contains(g.week) {
                NavigationLink(value: LeagueRoute.boxScore(year: data.year, week: g.week, a: data.teamId, b: g.opponent)) {
                    HStack(spacing: 3) {
                        Text(text).foregroundStyle(Theme.accentInk)
                        Text("›").foregroundStyle(Theme.ink3)
                    }
                    .font(.system(size: 13.5, weight: .bold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .fixedSize()
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Box score, week \(g.week): \(text)")
            } else {
                Text(text).font(.system(size: 13.5, weight: .bold)).monospacedDigit().foregroundStyle(Theme.ink).lineLimit(1).fixedSize()
            }
        } else {
            Text("Not played").font(.system(size: 11)).foregroundStyle(Theme.ink3)
        }
    }
}

// MARK: Starters

private struct TeamStartersSection: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    let roster: TeamSeason.Roster
    let team: Team
    @State private var showHelp = false

    private var tint: Color { Color(css: team.color) ?? Theme.navy2 }
    private var wide: Bool { sizeClass == .regular }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Starters").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
                Button {
                    showHelp.toggle()
                } label: {
                    Image(systemName: "info.circle")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.ink3)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("What the week cells mean")
                .popover(isPresented: $showHelp) {
                    TeamStripHelp(tint: tint)
                        .presentationCompactAdaptation(.popover)
                }
                Spacer()
                Text(roster.count).font(.system(size: 11)).foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 2)

            VStack(spacing: 0) {
                header
                ForEach(roster.players) { p in
                    playerRow(p)
                        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
                }
            }
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.line))
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            if wide {
                Color.clear.frame(width: 34, height: 1)
                Text("Player").frame(width: 170, alignment: .leading)
            } else {
                Color.clear.frame(width: 34, height: 1)
            }
            strip { w in
                Text("\(w)")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(maxWidth: .infinity)
            }
            if wide {
                Text("GS").frame(width: 30, alignment: .trailing)
                Text("Pts").frame(width: 62, alignment: .trailing)
            }
        }
        .font(.system(size: 10, weight: .heavy))
        .textCase(.uppercase)
        .foregroundStyle(Theme.muted)
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 6)
        .background(Theme.surface2)
    }

    @ViewBuilder private func playerRow(_ p: TeamSeason.Player) -> some View {
        if wide {
            HStack(spacing: 10) {
                ClubTag(club: p.clubs.first ?? "FA").frame(width: 34, alignment: .leading)
                name(p).frame(width: 170, alignment: .leading)
                cells(p)
                Text("\(p.starts)").font(.system(size: 13, weight: .bold)).frame(width: 30, alignment: .trailing)
                Text(Fmt.pts(p.pts)).font(.system(size: 13, weight: .bold)).frame(width: 62, alignment: .trailing)
            }
            .monospacedDigit()
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
        } else {
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 10) {
                    ClubTag(club: p.clubs.first ?? "FA").frame(width: 34, alignment: .leading)
                    name(p)
                    Spacer(minLength: 6)
                    Text("\(Text("\(p.starts)").font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.ink))\(Text(" GS").font(.system(size: 9.5, weight: .bold)).foregroundStyle(Theme.ink3))")
                        .monospacedDigit()
                }
                HStack(spacing: 10) {
                    Color.clear.frame(width: 34, height: 1)
                    cells(p)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
    }

    private func name(_ p: TeamSeason.Player) -> some View {
        NavigationLink(value: LeagueRoute.player(id: p.id)) {
            Group {
                if wide {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(p.name).font(.system(size: 13.5, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                        Text("\(p.pos) · \(p.clubs.joined(separator: " → "))").font(.system(size: 10.5, weight: .semibold)).foregroundStyle(Theme.ink3).lineLimit(1)
                    }
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: 7) {
                        Text(p.name).font(.system(size: 13.5, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                        Text("\(p.pos) · \(p.clubs.joined(separator: " → "))").font(.system(size: 10.5, weight: .semibold)).foregroundStyle(Theme.ink3).lineLimit(1).fixedSize()
                    }
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(p.name), \(p.pos), \(p.starts) starts, \(Fmt.pts(p.pts)) points")
    }

    private func cells(_ p: TeamSeason.Player) -> some View {
        strip { w in
            if let cell = p.cells.first(where: { $0.w == w }) {
                TeamStripCell(cell: cell, tint: tint)
            } else {
                Color.clear
            }
        }
        .frame(height: 15)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(p.cells.filter { $0.kind == "start" || $0.kind == "bench" }.map(\.title).joined(separator: ". "))
    }

    /// One cell per week, the playoff weeks set slightly apart.
    private func strip<Cell: View>(@ViewBuilder _ cell: @escaping (Int) -> Cell) -> some View {
        HStack(spacing: 2) {
            ForEach(roster.weeks, id: \.self) { w in
                if w == roster.regularWeeks + 1 { Color.clear.frame(width: 3) }
                cell(w)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

private struct TeamStripCell: View {
    let cell: TeamSeason.Cell
    let tint: Color

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 3, style: .continuous)
        Group {
            switch cell.kind {
            case "start":
                shape.fill(Theme.card).overlay(shape.fill(tint.opacity(cell.fill ?? 1)))
            case "bench":
                shape.fill(Theme.card).overlay(shape.strokeBorder(tint.opacity(0.45), lineWidth: 1.5))
            case "none":
                Color.clear
            case "future":
                shape.strokeBorder(Theme.line, lineWidth: 1)
            default:
                shape.fill(Color(light: 0xF1F4F7, dark: 0x1B2A42))
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// What the week cells mean (the strip's (i)).
private struct TeamStripHelp: View {
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("A strip with one cell per week:").font(.subheadline.weight(.semibold))
            item(TeamStripCell(cell: .init(w: 0, kind: "start", fill: 0.8, pts: nil, club: nil, title: ""), tint: tint),
                 "Filled in the team's color: he started, and a darker cell means he scored more.")
            item(TeamStripCell(cell: .init(w: 0, kind: "bench", fill: nil, pts: nil, club: nil, title: ""), tint: tint),
                 "Outlined: he was on the bench.")
            item(TeamStripCell(cell: .init(w: 0, kind: "empty", fill: nil, pts: nil, club: nil, title: ""), tint: tint),
                 "Empty grey: he wasn't on the team.")
            item(RoundedRectangle(cornerRadius: 3).strokeBorder(Theme.line2, style: StrokeStyle(lineWidth: 1.5, dash: [3, 2])),
                 "Playoff weeks sit slightly apart. A week the team had no game, like a playoff bye, is left blank.")
            item(TeamStripCell(cell: .init(w: 0, kind: "future", fill: nil, pts: nil, club: nil, title: ""), tint: tint),
                 "Faintly outlined: a week not played yet.")
            Text("GS is games started; Pts is his points as a starter.")
                .font(.caption).foregroundStyle(Theme.ink3)
        }
        .font(.footnote)
        .foregroundStyle(Theme.ink2)
        .padding(16)
        .frame(width: 320)
    }

    private func item<V: View>(_ swatch: V, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            swatch.frame(width: 14, height: 14).padding(.top, 1)
            Text(text).fixedSize(horizontal: false, vertical: true)
        }
    }
}
