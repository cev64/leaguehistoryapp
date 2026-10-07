import SwiftUI

/// The week in review (season.html's renderRecapPanel / recapHtml): the
/// lead with its headline and a way to share the recap, every game with its
/// story, the power rankings, the week by the numbers, its players, the
/// front office, the playoff race and what's next.
struct RecapPanel: View {
    @Environment(LeagueSession.self) private var session
    let info: SeasonInfo
    let season: Season
    let week: Int

    @State private var recap: WeekRecap?
    @State private var failed = false

    var body: some View {
        Group {
            if let recap, recap.week == week, recap.year == season.year {
                RecapContent(recap: recap, season: season, source: info.source)
            } else if failed {
                Card {
                    ContentUnavailableView {
                        Label("The recap couldn't be written", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text("\(info.source) didn't answer. Try again in a moment.")
                    } actions: {
                        Button("Try again") { Task { await load() } }
                            .buttonStyle(.glass)
                    }
                    .padding(.vertical, 8)
                }
            } else {
                LoadingCard(title: "Writing the week \(week) recap", detail: "Reading every lineup and every move…")
            }
        }
        .task(id: "\(season.year)-\(week)") { await load() }
    }

    private func load() async {
        failed = false
        do {
            let r = try await session.engine.call(WeekRecap.self, "Bridge.recap.week(year, week)", ["year": season.year, "week": week])
            withAnimation(.smooth(duration: 0.3)) { recap = r }
        } catch {
            if !Task.isCancelled { failed = true }
        }
    }
}

// MARK: - The recap

private struct RecapContent: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    let recap: WeekRecap
    let season: Season
    let source: String

    var body: some View {
        RecapLead(recap: recap, season: season)
        RecapGamesCard(recap: recap, season: season)
        if sizeClass == .regular {
            // The desktop page's cards, two to a row where there's room.
            AdaptiveGrid(minWidth: 440) { cards }
        } else {
            cards
        }
    }

    @ViewBuilder private var cards: some View {
        if let power = recap.power {
            RecapPowerCard(power: power, season: season)
        }
        RecapNumbersCard(tiles: recap.tiles)
        if let players = recap.players {
            RecapPlayersCard(players: players)
        }
        if !recap.office.isEmpty {
            RecapOfficeCard(items: recap.office, week: recap.week, season: season)
        }
        if let race = recap.race {
            RecapRaceCard(race: race, season: season)
        }
        if let next = recap.next, !(next.games.isEmpty && next.gotw == nil) {
            RecapNextCard(next: next, season: season)
        }
    }
}

// MARK: Lead

private struct RecapLead: View {
    let recap: WeekRecap
    let season: Season
    @State private var bundle: RecapShareBundle?
    @State private var preparing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(recap.lead.kicker)
                .font(.system(size: 11.5, weight: .heavy))
                .tracking(0.9)
                .textCase(.uppercase)
                .foregroundStyle(Theme.gold)
            if let title = recap.lead.title {
                Text(title)
                    .displayStyle(36)
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
                    .padding(.bottom, 6)
            }
            if let dek = recap.lead.dek {
                Text(dek)
                    .font(.system(size: 15))
                    .foregroundStyle(Color(hex: 0xDBE5EE, alpha: 0.82))
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !recap.lead.also.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(recap.lead.also, id: \.self) { line in
                        HStack(alignment: .firstTextBaseline, spacing: 9) {
                            Circle().fill(Color(hex: 0xD71920)).frame(width: 6, height: 6).alignmentGuide(.firstTextBaseline) { $0[.bottom] }
                            Text(line).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color(hex: 0xDBE5EE, alpha: 0.9))
                .padding(.top, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .top) { Rectangle().fill(.white.opacity(0.12)).frame(height: 1) }
                .padding(.top, 14)
            }
            Button {
                share()
            } label: {
                HStack(spacing: 7) {
                    if preparing {
                        ProgressView().controlSize(.small).tint(Theme.navy)
                    } else {
                        Image(systemName: "square.and.arrow.up")
                    }
                    Text("Share the recap")
                }
                .font(.subheadline.weight(.bold))
                .foregroundStyle(Theme.navy)
            }
            .buttonStyle(.glassProminent)
            .tint(.white)
            .disabled(preparing)
            .padding(.top, 16)
        }
        .padding(.horizontal, 20)
        .padding(.top, 20)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(stops: [.init(color: Color(hex: 0x102B43), location: 0), .init(color: Color(hex: 0x071827), location: 0.7)],
                           startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
        )
        .sheet(item: $bundle) { bundle in
            RecapShareSheet(bundle: bundle)
        }
        .sensoryFeedback(.impact(weight: .light), trigger: bundle?.id)
    }

    private func share() {
        preparing = true
        // Let the button show it's working before the pictures are drawn.
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(30))
            bundle = RecapShareBundle.make(recap: recap, season: season)
            preparing = false
        }
    }
}

// MARK: Every game

private struct RecapGamesCard: View {
    let recap: WeekRecap
    let season: Season

    var body: some View {
        Card {
            CardHead(title: "Every game", symbol: CardIcon.versus, meta: Fmt.plural(recap.games.count, "game"))
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 330), spacing: 0, alignment: .top)], spacing: 0) {
                ForEach(Array(recap.games.enumerated()), id: \.offset) { _, game in
                    RecapGame(game: game, recap: recap, season: season)
                }
            }
        }
    }
}

private struct RecapGame: View {
    let game: WeekRecap.Game
    let recap: WeekRecap
    let season: Season

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !game.label.isEmpty {
                Text(game.label)
                    .font(.system(size: 10.5, weight: .heavy)).tracking(0.6).textCase(.uppercase)
                    .foregroundStyle(Theme.muted)
            }
            line(game.a, game.as, won: game.aWon)
            line(game.b, game.bs, won: game.bWon)
            Text("\(Text("\(game.line).").foregroundStyle(Theme.ink).fontWeight(.semibold))\(Text(game.notes.isEmpty ? "" : " \(game.notes.joined(separator: ". ")).").foregroundStyle(Theme.muted).fontWeight(.medium))")
                .font(.system(size: 13.5))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
            if !game.stars.isEmpty {
                RecapFlow(spacing: 8, lineSpacing: 4) {
                    ForEach(Array(game.stars.enumerated()), id: \.offset) { i, p in
                        HStack(spacing: 4) {
                            if i > 0 { Text("·").foregroundStyle(Theme.muted.opacity(0.5)).padding(.trailing, 4) }
                            RecapPlayerChip(player: p)
                            Text(Fmt.pts(p.pts)).fontWeight(.bold).foregroundStyle(Theme.ink).monospacedDigit()
                        }
                    }
                }
                .font(.system(size: 12))
            }
            if recap.hasBox {
                NavigationLink(value: LeagueRoute.boxScore(year: recap.year, week: recap.week, a: game.a, b: game.b)) {
                    HStack(spacing: 6) {
                        Image(systemName: "tablecells")
                        Text("Box score")
                        Text("›")
                    }
                    .font(.system(size: 12.5, weight: .bold))
                    .foregroundStyle(Theme.accentInk)
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Box score: \(name(game.a)) versus \(name(game.b))")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
        .overlay(alignment: .trailing) { Rectangle().fill(Theme.line).frame(width: 1) }
    }

    private func name(_ id: String) -> String { season.team(id)?.name ?? id }

    private func line(_ id: String, _ score: Double, won: Bool) -> some View {
        HStack(spacing: 10) {
            RecapTeamLink(season: season, teamId: id, size: 22)
                .foregroundStyle(won ? Theme.ink : Theme.muted)
            Spacer(minLength: 6)
            Text(Fmt.pts(score))
                .font(.system(size: 15, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(won ? Theme.ink : Theme.muted)
        }
        .font(.system(size: 14))
    }
}

// MARK: Power rankings

private struct RecapPowerCard: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    let power: WeekRecap.Power
    let season: Season

    private var compact: Bool { sizeClass != .regular }

    var body: some View {
        Card {
            CardHead(title: "Power rankings", symbol: CardIcon.standings, meta: power.meta)
            HStack(spacing: compact ? 6 : 8) {
                Text("#").frame(width: compact ? 20 : 26)
                Text("").frame(width: compact ? 28 : 34)
                Text("Team").frame(maxWidth: .infinity, alignment: .leading)
                Text("Record").frame(width: compact ? 50 : 62, alignment: .trailing)
                Text("All-play").frame(width: compact ? 52 : 62, alignment: .trailing)
                    .help("Record against every team, every week")
                if !compact { Text("PF/G").frame(width: 52, alignment: .trailing) }
            }
            .font(.system(size: 10, weight: .heavy)).tracking(0.6).textCase(.uppercase)
            .foregroundStyle(Theme.muted)
            .padding(.horizontal, compact ? 12 : 16)
            .padding(.vertical, 8)
            .background(Theme.surface2)
            ForEach(power.rows, id: \.self) { p in
                HStack(spacing: compact ? 6 : 8) {
                    Text("\(p.rank)").fontWeight(.heavy).foregroundStyle(Theme.muted).frame(width: compact ? 20 : 26)
                    RecapMove(move: p.move).frame(width: compact ? 28 : 34)
                    VStack(alignment: .leading, spacing: 5) {
                        RecapTeamLink(season: season, teamId: p.id, size: 20)
                        GeometryReader { geo in
                            Capsule()
                                .fill(LinearGradient(colors: [Theme.gold, Color(hex: 0xE08A2E)], startPoint: .leading, endPoint: .trailing))
                                .frame(width: max(2, geo.size.width * p.bar), height: 3)
                        }
                        .frame(height: 3)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Text(p.record).frame(width: compact ? 50 : 62, alignment: .trailing)
                    Text(p.apRecord).frame(width: compact ? 52 : 62, alignment: .trailing)
                    if !compact { Text(p.pfg).frame(width: 52, alignment: .trailing) }
                }
                .font(.system(size: compact ? 12.5 : 13))
                .monospacedDigit()
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, compact ? 12 : 16)
                .padding(.vertical, 9)
                .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
            }
            RecapFoot(text: power.foot)
        }
    }
}

private struct RecapMove: View {
    let move: Int
    var body: some View {
        Group {
            if move > 0 {
                Text("▲\(move)").foregroundStyle(Color(light: 0x12804A, dark: 0x47CD89))
            } else if move < 0 {
                Text("▼\(-move)").foregroundStyle(Color(light: 0xC73535, dark: 0xFF6B5E))
            } else {
                Text("–").foregroundStyle(Theme.muted)
            }
        }
        .font(.system(size: 11, weight: .heavy))
        .accessibilityLabel(move > 0 ? "Up \(move)" : move < 0 ? "Down \(-move)" : "No change")
    }
}

// MARK: By the numbers

private struct RecapNumbersCard: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    let tiles: [WeekRecap.Tile]

    var body: some View {
        Card {
            CardHead(title: "By the numbers", symbol: CardIcon.notes, meta: "All-play and luck")
            Group {
                if sizeClass == .regular {
                    AdaptiveGrid(minWidth: 150, spacing: 10) { content }
                } else {
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 10, alignment: .top), GridItem(.flexible(), spacing: 10, alignment: .top)], spacing: 10) { content }
                }
            }
            .padding(12)
        }
    }

    private var content: some View {
        ForEach(tiles, id: \.self) { t in
            Superlative(label: t.label, title: t.title, detail: t.detail)
                .frame(maxHeight: .infinity, alignment: .top)
        }
    }
}

// MARK: Players of the week

private struct RecapPlayersCard: View {
    let players: WeekRecap.Players

    var body: some View {
        Card {
            CardHead(title: "Players of the week", symbol: CardIcon.notes, meta: "Starters only")
            VStack(alignment: .leading, spacing: 4) {
                Text("Player of the week")
                    .font(.system(size: 10.5, weight: .heavy)).tracking(0.7).textCase(.uppercase)
                    .foregroundStyle(Theme.goldInk)
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    RecapPlayerChip(player: players.mvp)
                    Text(Fmt.pts(players.mvp.pts)).fontWeight(.bold).foregroundStyle(Theme.ink).monospacedDigit()
                }
                .font(.system(size: 20))
                Text(players.mvpFor).font(.system(size: 12.5)).foregroundStyle(Theme.muted)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(LinearGradient(colors: [Theme.goldSoft, Theme.card], startPoint: .topLeading, endPoint: .bottomTrailing))
            .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
            ForEach(Array(players.items.enumerated()), id: \.offset) { i, item in
                HStack(alignment: .top, spacing: 10) {
                    RecapTag(text: item.tag, tone: item.tone)
                    VStack(alignment: .leading, spacing: 3) {
                        RecapPlayerChip(player: item.player).font(.system(size: 13))
                        Text(item.note).font(.system(size: 12)).foregroundStyle(Theme.muted).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Text(Fmt.pts(item.pts)).font(.system(size: 13, weight: .bold)).monospacedDigit().foregroundStyle(Theme.ink)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .overlay(alignment: .bottom) {
                    if i < players.items.count - 1 { Rectangle().fill(Theme.line).frame(height: 1) }
                }
            }
        }
    }
}

// MARK: Front office

private struct RecapOfficeCard: View {
    let items: [WeekRecap.OfficeItem]
    let week: Int
    let season: Season

    var body: some View {
        Card {
            CardHead(title: "Front office", symbol: CardIcon.document, meta: "Week \(week) moves")
            ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                HStack(alignment: .top, spacing: 10) {
                    RecapTag(text: item.tag, tone: item.tone)
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(Array(item.lines.enumerated()), id: \.offset) { _, line in
                            lineText(line)
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.ink2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .overlay(alignment: .bottom) {
                    if i < items.count - 1 { Rectangle().fill(Theme.line).frame(height: 1) }
                }
            }
        }
    }

    private func lineText(_ line: WeekRecap.OfficeItem.Line) -> Text {
        if let id = line.teamId {
            return Text("\(Text(season.team(id)?.name ?? id).fontWeight(.bold).foregroundStyle(Theme.ink)) \(line.text)")
        }
        return Text(line.text)
    }
}

// MARK: The playoff race

private struct RecapRaceCard: View {
    let race: WeekRecap.Race
    let season: Season

    var body: some View {
        Card {
            CardHead(title: "The playoff race", symbol: CardIcon.shield, meta: race.meta)
            ForEach(race.seeds, id: \.self) { s in
                HStack(spacing: 10) {
                    Text("\(s.seed)").fontWeight(.heavy).foregroundStyle(Theme.muted).frame(width: 22)
                    RecapTeamLink(season: season, teamId: s.id, size: 20)
                    Spacer(minLength: 6)
                    if !s.flag.isEmpty { RecapFlag(flag: s.flag) }
                    Text(s.record).fontWeight(.bold).monospacedDigit().frame(minWidth: 48, alignment: .trailing)
                }
                .font(.system(size: 13))
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .opacity(s.in ? 1 : 0.6)
                .overlay(alignment: .bottom) {
                    if s.cut {
                        Line().stroke(Theme.line2, style: StrokeStyle(lineWidth: 2, dash: [5, 4])).frame(height: 2)
                    } else {
                        Rectangle().fill(Theme.line).frame(height: 1)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityHint(s.cut ? "The last playoff spot" : "")
            }
            if let foot = race.foot {
                RecapFoot(text: foot)
            }
            if !race.stakes.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(race.stakes, id: \.self) { row in
                        if let team = season.team(row.id) {
                            HStack(alignment: .top, spacing: 10) {
                                TeamBadge(team: team, size: 24, corner: 7)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(team.name).font(.subheadline.weight(.bold)).foregroundStyle(Theme.ink)
                                    ForEach(row.lines, id: \.self) { line in
                                        Text(line).font(.footnote).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                                    }
                                }
                            }
                            .padding(.vertical, 10)
                            .padding(.horizontal, 14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
                        }
                    }
                }
            }
        }
    }

    private struct Line: Shape {
        func path(in rect: CGRect) -> Path {
            var p = Path()
            p.move(to: CGPoint(x: 0, y: rect.midY))
            p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
            return p
        }
    }
}

private struct RecapFlag: View {
    let flag: String
    var body: some View {
        let good = flag == "z" || flag == "x"
        let bad = flag == "e"
        Text(flag.lowercased())
            .font(.system(size: 10, weight: .heavy))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .foregroundStyle(good ? Color(light: 0x12804A, dark: 0x47CD89) : bad ? Color(light: 0xB42318, dark: 0xFF8A80) : Color(light: 0x304F91, dark: 0x9DB8F0))
            .background(good ? Color(light: 0xE6F6EC, dark: 0x0F3321) : bad ? Theme.redSoft : Color(light: 0xE8EEF6, dark: 0x1B2A42),
                        in: RoundedRectangle(cornerRadius: 5, style: .continuous))
            .accessibilityLabel(flag == "z" ? "clinched a bye" : flag == "x" ? "clinched" : flag == "e" ? "eliminated" : flag)
    }
}

// MARK: Next up

private struct RecapNextCard: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    let next: WeekRecap.Next
    let season: Season

    var body: some View {
        Card {
            CardHead(title: next.title, symbol: CardIcon.versus, meta: "Game of the week first")
            if let g = next.gotw {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Game of the week")
                        .font(.system(size: 10.5, weight: .heavy)).tracking(0.7).textCase(.uppercase)
                        .foregroundStyle(Color(light: 0x304F91, dark: 0x9DB8F0))
                    HStack(alignment: .center, spacing: 10) {
                        VStack(alignment: .leading, spacing: 3) {
                            RecapTeamLink(season: season, teamId: g.a, size: 24)
                            Text(g.aNote).font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.muted)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Text("vs").font(.system(size: 12, weight: .semibold)).textCase(.uppercase).foregroundStyle(Theme.muted)
                        VStack(alignment: .trailing, spacing: 3) {
                            RecapTeamLink(season: season, teamId: g.b, size: 24, trailing: true)
                            Text(g.bNote).font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.muted)
                        }
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.ink)
                    Text(g.series).font(.system(size: 12.5)).foregroundStyle(Theme.muted)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(LinearGradient(colors: [Theme.accentSoft, Theme.card], startPoint: .topLeading, endPoint: .bottomTrailing))
                .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
            }
            ForEach(Array(next.games.enumerated()), id: \.offset) { i, x in
                if sizeClass != .regular {
                    // A phone has no room for two names side by side: the
                    // pairing reads down, each team with its record.
                    VStack(alignment: .leading, spacing: 6) {
                        compactLine(x.a, x.sa)
                        compactLine(x.b, x.sb)
                    }
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .overlay(alignment: .bottom) {
                        if i < next.games.count - 1 { Rectangle().fill(Theme.line).frame(height: 1) }
                    }
                    .accessibilityElement(children: .contain)
                } else {
                HStack(spacing: 6) {
                    HStack(spacing: 8) {
                        RecapTeamLink(season: season, teamId: x.a, size: 20)
                        Text(x.sa).font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.muted).fixedSize()
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Text("vs").font(.system(size: 11)).textCase(.uppercase).foregroundStyle(Theme.muted)
                    HStack(spacing: 8) {
                        RecapTeamLink(season: season, teamId: x.b, size: 20)
                        Text(x.sb).font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.muted).fixedSize()
                    }
                    .frame(maxWidth: .infinity, alignment: .trailing)
                }
                .font(.system(size: 13))
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .overlay(alignment: .bottom) {
                    if i < next.games.count - 1 { Rectangle().fill(Theme.line).frame(height: 1) }
                }
                }
            }
        }
    }

    private func compactLine(_ id: String, _ standing: String) -> some View {
        HStack(spacing: 8) {
            RecapTeamLink(season: season, teamId: id, size: 20)
            Spacer(minLength: 6)
            Text(standing).font(.system(size: 11.5, weight: .bold)).foregroundStyle(Theme.muted).monospacedDigit().fixedSize()
        }
    }
}

// MARK: - Pieces

/// A team in the recap (recapTeam): its mark and its name, opening its season.
struct RecapTeamLink: View {
    let season: Season
    let teamId: String
    var size: CGFloat = 22
    var trailing: Bool = false

    var body: some View {
        if let team = season.team(teamId) {
            NavigationLink(value: LeagueRoute.team(year: season.year, teamId: teamId)) {
                HStack(spacing: 8) {
                    if trailing {
                        Text(team.name).fontWeight(.bold).lineLimit(1)
                        TeamBadge(team: team, size: size, corner: size * 0.3)
                    } else {
                        TeamBadge(team: team, size: size, corner: size * 0.3)
                        Text(team.name).fontWeight(.bold).lineLimit(1)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(team.name): season and schedule")
        } else {
            Text(teamId)
        }
    }
}

/// A player in the recap (playerChip): his name and position, opening his card.
struct RecapPlayerChip: View {
    let player: RecapPlayer

    var body: some View {
        NavigationLink(value: LeagueRoute.player(id: player.id)) {
            Text("\(Text(player.name).fontWeight(.bold).foregroundStyle(Theme.ink))\(Text(player.pos.isEmpty ? "" : " \(player.pos)").font(.system(size: 10.5, weight: .bold)).foregroundStyle(Theme.muted))")
                .lineLimit(1)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            NavigationLink(value: LeagueRoute.player(id: player.id)) {
                Label("\(player.name)'s history", systemImage: "person.text.rectangle")
            }
            Text("\(player.pos) · \(player.nfl) · \(Fmt.pts(player.pts)) pts")
        }
    }
}

/// The recap's small label (rc-tag): navy, soft blue, or red.
struct RecapTag: View {
    let text: String
    var tone: String = ""

    var body: some View {
        Text(text)
            .font(.system(size: 9.5, weight: .heavy))
            .tracking(0.5)
            .textCase(.uppercase)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .foregroundStyle(tone == "soft" ? Color(light: 0x304F91, dark: 0x9DB8F0) : tone == "bad" ? Color(light: 0xB42318, dark: 0xFF8A80) : .white)
            .background(tone == "soft" ? Color(light: 0xE8EEF6, dark: 0x1B2A42) : tone == "bad" ? Theme.redSoft : Color(light: 0x071827, dark: 0x2C3E5C),
                        in: RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

private struct RecapFoot: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 12.5))
            .foregroundStyle(Theme.muted)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Views laid out in rows, wrapping to the next when a row is full.
struct RecapFlow: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, lineH: CGFloat = 0, maxX: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            let w = min(size.width, width)
            if x > 0 && x + w > width { x = 0; y += lineH + lineSpacing; lineH = 0 }
            x += w + spacing
            maxX = max(maxX, x - spacing)
            lineH = max(lineH, size.height)
        }
        return CGSize(width: proposal.width ?? maxX, height: y + lineH)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x: CGFloat = 0, y: CGFloat = 0, lineH: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            let w = min(size.width, bounds.width)
            if x > 0 && x + w > bounds.width { x = 0; y += lineH + lineSpacing; lineH = 0 }
            s.place(at: CGPoint(x: bounds.minX + x, y: bounds.minY + y), proposal: ProposedViewSize(width: w, height: size.height))
            x += w + spacing
            lineH = max(lineH, size.height)
        }
    }
}
