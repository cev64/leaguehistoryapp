import SwiftUI

/// Everything one player has done in this league (player-card.js): his
/// photo and club, his tiles, the ownership timeline, his managers, his top
/// performances and the game log. The numbers and words come from
/// Bridge.player.card, worked out as the site's card works them out.
struct PlayerCardView: View {
    @Environment(LeagueSession.self) private var session
    let playerId: String

    private enum Phase {
        case loading
        case ready(PlayerCardData)
        case missing(String)
        case failed
    }

    @State private var phase: Phase = .loading

    var body: some View {
        Group {
            switch phase {
            case .loading:
                PageScroll { LoadingCard(title: "Loading…") }
                    .navigationTitle("Player")
            case .ready(let card):
                PCPlayerCardContent(card: card)
            case .missing(let message):
                PageScroll { EmptyCard(title: "No history", detail: message, symbol: "person.crop.circle.badge.questionmark") }
                    .navigationTitle("Player")
            case .failed:
                PageScroll {
                    EmptyCard(title: "Couldn't load", detail: "Player history could not be loaded.", symbol: "exclamationmark.triangle")
                    Button("Try again") { Task { await load() } }
                        .buttonStyle(.glassProminent)
                        .frame(maxWidth: .infinity)
                }
                .navigationTitle("Player")
            }
        }
        .toolbarTitleDisplayMode(.inline)
        .task(id: playerId) { await load() }
    }

    private func load() async {
        // Coming back from a box score or a team re-runs the task: the card
        // on screen is already this player's, so keep it as it is.
        if case .ready(let shown) = phase, shown.id == playerId { return }
        phase = .loading
        do {
            let answer = try await session.engine.call(PlayerCardAnswer.self, "Bridge.player.card(id)", ["id": playerId])
            if let card = answer.card {
                withAnimation(.smooth(duration: 0.3)) { phase = .ready(card) }
                PCRecents.add(card.id, league: session.id)
            } else {
                phase = .missing(answer.message ?? "No league history for this player.")
            }
        } catch {
            phase = .failed
        }
    }
}

// MARK: The card

private struct PCPlayerCardContent: View {
    @Environment(LeagueSession.self) private var session
    @Environment(\.horizontalSizeClass) private var sizeClass
    let card: PlayerCardData
    @State private var folded = false

    private var wide: Bool { sizeClass == .regular }

    var body: some View {
        ScrollViewReader { reader in
            ScrollView {
                VStack(spacing: 0) {
                    PCPlayerHero(card: card, wide: wide)
                    VStack(spacing: wide ? 12 : 10) {
                        PCTilesRow(card: card, wide: wide)
                        PCTimelineCard(card: card, wide: wide)
                        if wide {
                            HStack(alignment: .top, spacing: 12) {
                                PCManagersCard(card: card).frame(maxWidth: .infinity).layoutPriority(1.1)
                                PCTopCard(card: card).frame(maxWidth: .infinity)
                            }
                            .id(PCSection.managers)
                        } else {
                            PCManagersCard(card: card).id(PCSection.managers)
                            PCTopCard(card: card).id(PCSection.top)
                        }
                        PCGameLogCard(card: card, wide: wide).id(PCSection.log)
                    }
                    .padding(.horizontal, wide ? 16 : 10)
                    .padding(.top, wide ? 14 : 10)
                    .padding(.bottom, 24)
                    .frame(maxWidth: 980)
                    .frame(maxWidth: .infinity)
                }
            }
            .task {
                #if DEBUG
                // SIMCTL_CHILD_PP_PLAYER_SCROLL=managers|top|log opens the
                // card scrolled to that section, for screenshots.
                if let raw = ProcessInfo.processInfo.environment["PP_PLAYER_SCROLL"], let section = PCSection(rawValue: raw) {
                    try? await Task.sleep(for: .milliseconds(400))
                    reader.scrollTo(section, anchor: .top)
                }
                #endif
            }
        }
        .background(Theme.page)
        .onScrollGeometryChange(for: Bool.self) { geo in
            geo.contentOffset.y + geo.contentInsets.top > (wide ? 96 : 76)
        } action: { _, new in
            withAnimation(.smooth(duration: 0.22)) { folded = new }
        }
        .navigationTitle(card.name)
        .toolbar {
            // The header folds into the bar: photo and name, as the site's
            // card folds to a slim bar while it scrolls.
            ToolbarItem(placement: .principal) {
                HStack(spacing: 8) {
                    PCPhoto(photo: card.photo, club: card.club, size: 26)
                    Text(card.name).font(.headline).lineLimit(1)
                }
                .opacity(folded ? 1 : 0)
                .offset(y: folded ? 0 : 6)
                .accessibilityHidden(!folded)
            }
            ToolbarItem(placement: .topBarTrailing) {
                ShareLink(item: shareText) {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("Share")
            }
        }
    }

    private var shareText: String {
        let league = session.summary?.name ?? "the league"
        var text = "\(card.name) (\(card.pos), \(card.club)) in \(league): \(Fmt.plural(card.tiles.starts, "start")), \(card.tiles.perStart) points per start, \(card.tiles.record) when started."
        if card.tiles.bestGame != nil { text += " Best game \(card.tiles.best) (\(card.tiles.bestDetail))." }
        if !card.titles.isEmpty { text += " Champion: \(card.titles.map(String.init).joined(separator: ", "))." }
        return text
    }
}

private enum PCSection: String { case managers, top, log }

// MARK: Header

/// The header in his current club's colour, lit from the top left; a
/// champion's name on gold with the winning years over it.
private struct PCPlayerHero: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let card: PlayerCardData
    let wide: Bool
    @State private var drift = false

    private var color: Color { Color(css: card.heroColor) ?? Theme.navy2 }
    private var photoSize: CGFloat { wide ? 84 : 68 }
    private var champ: Bool { !card.titles.isEmpty }

    var body: some View {
        HStack(spacing: wide ? 16 : 13) {
            ZStack(alignment: .bottomTrailing) {
                PCPhoto(photo: card.photo, club: card.club, size: photoSize)
                    .background(Circle().fill(.white.opacity(0.25)).padding(wide ? -4 : -3))
                    .shadow(color: .black.opacity(0.35), radius: 12, y: 8)
                if !card.isDst {
                    PCClubDisc(club: card.club, size: wide ? 34 : 26)
                        .offset(x: 5, y: 2)
                }
            }
            VStack(alignment: .leading, spacing: wide ? 7 : 5) {
                if champ {
                    Text("🏆 " + card.titles.map(String.init).joined(separator: " · "))
                        .font(.system(size: wide ? 11 : 10, weight: .black))
                        .tracking(0.7)
                        .textCase(.uppercase)
                        .foregroundStyle(Color(hex: 0xFBE08A))
                        .lineLimit(1)
                        .accessibilityLabel("Champion: \(card.titles.map(String.init).joined(separator: ", "))")
                }
                Text(card.name)
                    .font(.system(size: wide ? 28 : 22, weight: .heavy))
                    .tracking(-0.4)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                    .foregroundStyle(champ ? Color(hex: 0x2A2112) : .white)
                    .padding(.horizontal, champ ? 10 : 0)
                    .padding(.vertical, champ ? 2 : 0)
                    .background {
                        if champ {
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(LinearGradient(colors: [Color(hex: 0xFBE08A), Color(hex: 0xE0A82E)],
                                                     startPoint: .topLeading, endPoint: .bottomTrailing))
                                .shadow(color: Color(hex: 0xE0A82E, alpha: 0.35), radius: 6, y: 2)
                        }
                    }
                    .accessibilityAddTraits(.isHeader)
                HStack(spacing: 6) {
                    PCHeroTag(text: card.pos == "DST" ? "D/ST" : card.pos)
                    PCHeroTag(text: card.managersTag)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, wide ? 24 : 16)
        .padding(.top, wide ? 22 : 14)
        .padding(.bottom, wide ? 24 : 18)
        .frame(maxWidth: .infinity)
        .background {
            background.padding(.top, -900)
        }
    }

    private var background: some View {
        ZStack {
            LinearGradient(stops: [
                .init(color: color.mix(with: .white, by: 0.12), location: 0),
                .init(color: color, location: 0.4),
                .init(color: color.mix(with: Theme.navy, by: 0.45), location: 1),
            ], startPoint: .topLeading, endPoint: .bottomTrailing)
            GeometryReader { geo in
                Circle()
                    .fill(RadialGradient(colors: [.white.opacity(0.2), .white.opacity(0)], center: .center, startRadius: 0, endRadius: 120))
                    .frame(width: 240, height: 240)
                    .scaleEffect(drift ? 1.18 : 1)
                    .offset(x: drift ? -40 : 0, y: drift ? 26 : 0)
                    .position(x: geo.size.width - 60, y: geo.size.height - 120)
            }
            .allowsHitTesting(false)
        }
        .overlay(alignment: .bottom) { Rectangle().fill(.white.opacity(0.12)).frame(height: 1) }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 14).repeatForever(autoreverses: true)) { drift = true }
        }
    }
}

/// The club's badge on the photo: its letters on its colour, in a white ring.
private struct PCClubDisc: View {
    let club: String
    let size: CGFloat
    var body: some View {
        let hex = NFLClub.colors[club]
        Text(club)
            .font(.system(size: size * 0.29, weight: .heavy))
            .tracking(-0.1)
            .minimumScaleFactor(0.6)
            .foregroundStyle(Color.readableInk(on: hex))
            .frame(width: size - 4, height: size - 4)
            .background(Color(css: hex) ?? Theme.ink3, in: Circle())
            .padding(2)
            .background(.white, in: Circle())
            .shadow(color: .black.opacity(0.25), radius: 4, y: 2)
            .accessibilityLabel("NFL club \(club)")
    }
}

private struct PCHeroTag: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 10.5, weight: .heavy))
            .tracking(0.3)
            .foregroundStyle(.white)
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .glassEffect(.regular.tint(.white.opacity(0.12)), in: Capsule())
    }
}

// MARK: Tiles

private struct PCTilesRow: View {
    let card: PlayerCardData
    let wide: Bool

    var body: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: wide ? 8 : 6), count: wide ? 4 : 2)
        LazyVGrid(columns: columns, spacing: wide ? 8 : 6) {
            PCTile(label: "Starts", value: String(card.tiles.starts))
            PCTile(label: "Points per start", value: card.tiles.perStart)
            if let game = card.tiles.bestGame {
                NavigationLink(value: LeagueRoute.boxScore(year: game.season, week: game.week, a: game.a, b: game.b)) {
                    PCTile(label: "Best game", value: card.tiles.best, detail: card.tiles.bestDetail, linked: true)
                }
                .buttonStyle(PCPressStyle())
            } else {
                PCTile(label: "Best game", value: card.tiles.best, detail: card.tiles.bestDetail)
            }
            PCTile(label: "Record when started", value: card.tiles.record)
        }
    }
}

private struct PCTile: View {
    let label: String
    let value: String
    var detail: String? = nil
    var linked = false

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                Text(label)
                    .font(.system(size: 9, weight: .black))
                    .tracking(0.7)
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                if linked {
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.ink3)
                }
            }
            Text(value)
                .font(.system(size: 21, weight: .bold))
                .tracking(-0.4)
                .monospacedDigit()
                .foregroundStyle(Theme.ink)
                .contentTransition(.numericText())
            if let detail {
                Text(detail)
                    .font(.system(size: 10.5))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 58, alignment: .topLeading)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.line))
        .accessibilityElement(children: .combine)
    }
}

// MARK: Ownership timeline

/// A strip per season, a cell per week, in the colour of whichever team had
/// him that week, and that team's mark at the end.
private struct PCTimelineCard: View {
    let card: PlayerCardData
    let wide: Bool
    @State private var picked: PlayerCardData.Cell?

    private var yearWidth: CGFloat { wide ? 38 : 32 }
    private var whoWidth: CGFloat { wide ? 72 : 52 }
    private var lead: Color { Color(css: card.leadColor) ?? Theme.navy2 }

    var body: some View {
        Card {
            CardHead(title: "Ownership timeline", meta: "One cell per week")
            VStack(spacing: 0) {
                // Week numbers over the strips, on the same grid.
                HStack(spacing: wide ? 10 : 6) {
                    Color.clear.frame(width: yearWidth, height: 1)
                    strip(reg: card.labelReg) { w in
                        Text(String(w))
                            .font(.system(size: wide ? 8.5 : 7, weight: .heavy))
                            .monospacedDigit()
                            .foregroundStyle(Theme.ink3)
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)
                            .frame(maxWidth: .infinity)
                    }
                    Color.clear.frame(width: whoWidth, height: 1)
                }
                .padding(.horizontal, wide ? 14 : 10)
                .padding(.top, 6)
                .padding(.bottom, 2)

                ForEach(Array(card.timeline.enumerated()), id: \.element.id) { i, row in
                    if i > 0 { Rectangle().fill(Theme.line.opacity(0.6)).frame(height: 1) }
                    seasonRow(row)
                }
            }
            key
        }
        .sensoryFeedback(.selection, trigger: picked)
    }

    private func seasonRow(_ row: PlayerCardData.TimelineRow) -> some View {
        let cells = Dictionary(uniqueKeysWithValues: row.cells.map { ($0.week, $0) })
        return HStack(spacing: wide ? 10 : 6) {
            Text(String(row.season))
                .font(.system(size: wide ? 12 : 10.5, weight: .black))
                .monospacedDigit()
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(width: yearWidth, alignment: .leading)
            strip(reg: row.reg) { w in
                if let cell = cells[w] {
                    PCWeekCell(cell: cell, height: wide ? 16 : 13, picked: picked == cell)
                        .contentShape(Rectangle())
                        .onTapGesture {
                            withAnimation(.smooth(duration: 0.2)) { picked = picked == cell ? nil : cell }
                        }
                        .accessibilityLabel(cell.tip)
                } else {
                    Color.clear.frame(maxWidth: .infinity).frame(height: wide ? 16 : 13)
                }
            }
            HStack(spacing: wide ? 3 : 2) {
                ForEach(row.owners, id: \.ownerId) { team in
                    NavigationLink(value: LeagueRoute.team(year: row.season, teamId: team.id)) {
                        PCMark(team: team, size: wide ? 22 : 16, corner: wide ? 6 : 4)
                    }
                    .buttonStyle(PCPressStyle())
                    .accessibilityLabel("\(team.name), \(team.owner), \(String(row.season))")
                }
                if row.more > 0 {
                    Text("+\(row.more)")
                        .font(.system(size: wide ? 9 : 8, weight: .black))
                        .foregroundStyle(Theme.muted)
                        .frame(minWidth: wide ? 22 : 16, minHeight: wide ? 22 : 16)
                        .padding(.horizontal, 2)
                        .background(Theme.surface3, in: RoundedRectangle(cornerRadius: wide ? 6 : 4, style: .continuous))
                        .accessibilityLabel("and \(row.moreNames)")
                }
            }
            .frame(width: whoWidth, alignment: .leading)
        }
        .padding(.horizontal, wide ? 14 : 10)
        .padding(.vertical, wide ? 7 : 6)
    }

    /// One row's grid: the regular weeks, a narrow gap, the playoff weeks,
    /// a full league season wide whichever season it is.
    private func strip<Cell: View>(reg: Int, @ViewBuilder cell: @escaping (Int) -> Cell) -> some View {
        HStack(spacing: wide ? 2 : 1) {
            ForEach(1...max(1, card.columns), id: \.self) { w in
                if w == reg + 1 { Color.clear.frame(width: wide ? 3 : 1, height: 1) }
                cell(w)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var key: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let picked {
                Text(picked.tip)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
            PCFlow(spacing: 14, lineSpacing: 4) {
                PCKeyItem(text: "Started, in that team's colour") { RoundedRectangle(cornerRadius: 3).fill(lead) }
                PCKeyItem(text: "Bench") { RoundedRectangle(cornerRadius: 3).strokeBorder(lead, lineWidth: 1.5) }
                PCKeyItem(text: "Not on a roster") { RoundedRectangle(cornerRadius: 3).fill(Theme.surface3) }
                PCKeyItem(text: "Not played yet") { RoundedRectangle(cornerRadius: 3).strokeBorder(Theme.line2, lineWidth: 1) }
            }
        }
        .padding(.horizontal, wide ? 14 : 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
    }
}

private struct PCWeekCell: View {
    let cell: PlayerCardData.Cell
    let height: CGFloat
    let picked: Bool

    var body: some View {
        let c = Color(css: cell.color) ?? Theme.ink3
        let shape = RoundedRectangle(cornerRadius: height > 14 ? 3 : 2, style: .continuous)
        Group {
            switch cell.kind {
            case "start": shape.fill(c)
            case "bench": shape.fill(Theme.card).overlay(shape.strokeBorder(c, lineWidth: 1.5))
            case "future": shape.strokeBorder(Theme.line, lineWidth: 1)
            case "none": Color.clear
            default: shape.fill(Theme.surface3)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
        .overlay {
            if picked { shape.strokeBorder(Theme.ink, lineWidth: 1.5).padding(-1.5) }
        }
    }
}

private struct PCKeyItem<Swatch: View>: View {
    let text: String
    @ViewBuilder var swatch: Swatch
    var body: some View {
        HStack(spacing: 5) {
            swatch.frame(width: 11, height: 11)
            Text(text).font(.system(size: 10)).foregroundStyle(Theme.muted)
        }
    }
}

// MARK: By manager

private struct PCManagersCard: View {
    let card: PlayerCardData

    var body: some View {
        let most = max(1, card.managers.map(\.starts).max() ?? 1)
        Card {
            CardHead(title: "By manager")
            ForEach(Array(card.managers.enumerated()), id: \.element.id) { i, m in
                if i > 0 { Rectangle().fill(Theme.line.opacity(0.6)).frame(height: 1) }
                NavigationLink(value: LeagueRoute.manager(ownerId: m.ownerId)) {
                    PCManagerRow(manager: m, share: Double(m.starts) / Double(most))
                }
                .buttonStyle(PCRowPressStyle())
            }
        }
    }
}

private struct PCManagerRow: View {
    let manager: PlayerCardData.Manager
    let share: Double

    var body: some View {
        let c = Color(css: manager.color) ?? Theme.navy2
        VStack(spacing: 5) {
            HStack(spacing: 10) {
                PCMark(team: manager.team, size: 28, corner: 8)
                VStack(alignment: .leading, spacing: 1) {
                    Text(manager.owner)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    Text(manager.seasons)
                        .font(.system(size: 10.5))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                PCNum(value: String(manager.starts), label: "GS", minWidth: 28)
                PCNum(value: manager.pts, label: "Pts", minWidth: 50)
                PCNum(value: manager.record, label: "Rec", minWidth: 40)
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Theme.ink3)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.surface3)
                    Capsule().fill(c).frame(width: geo.size.width * share)
                }
            }
            .frame(height: 4)
            .padding(.leading, 38)
            .padding(.trailing, 18)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(manager.owner), \(manager.seasons): \(manager.starts) starts, \(manager.pts) points, record \(manager.record). Teams: \(manager.names.joined(separator: ", "))")
    }
}

private struct PCNum: View {
    let value: String
    let label: String
    let minWidth: CGFloat
    var body: some View {
        VStack(alignment: .trailing, spacing: 0) {
            Text(value)
                .font(.system(size: 13, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .fixedSize()
            Text(label)
                .font(.system(size: 8.5, weight: .heavy))
                .tracking(0.4)
                .textCase(.uppercase)
                .foregroundStyle(Theme.muted)
        }
        .frame(minWidth: minWidth, alignment: .trailing)
    }
}

// MARK: Top performances

private struct PCTopCard: View {
    let card: PlayerCardData

    var body: some View {
        Card {
            CardHead(title: "Top performances", meta: "As a starter")
            if card.top.isEmpty {
                Text("Never started.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity)
                    .padding(36)
            } else {
                VStack(spacing: 8) {
                    ForEach(card.top) { game in
                        if let opp = game.opp {
                            NavigationLink(value: LeagueRoute.boxScore(year: game.season, week: game.week, a: game.team.id, b: opp.id)) {
                                PCMedal(game: game)
                            }
                            .buttonStyle(PCPressStyle())
                        } else {
                            PCMedal(game: game)
                        }
                    }
                }
                .padding(12)
            }
        }
    }
}

private struct PCMedal: View {
    let game: PlayerCardData.TopGame

    private var tones: (Color, Color, Color) {
        switch game.rank {
        case 1: return (Color(hex: 0xFBE08A), Color(hex: 0xE0A82E), Color(hex: 0x2A2112))
        case 2: return (Color(hex: 0xF1F3F5), Color(hex: 0xB5BEC8), Color(hex: 0x1F2933))
        default: return (Color(hex: 0xF2C29B), Color(hex: 0xB8733F), Color(hex: 0x2B1809))
        }
    }

    var body: some View {
        let (a, b, ink) = tones
        HStack(spacing: 10) {
            Text(String(game.rank))
                .font(.system(size: 15, weight: .black))
                .frame(width: 34, height: 34)
                .background(.white.opacity(0.55), in: Circle())
                .overlay(Circle().strokeBorder(.black.opacity(0.08), lineWidth: 2))
            VStack(alignment: .leading, spacing: 1) {
                Text(game.title).font(.system(size: 12, weight: .bold)).lineLimit(1)
                Text(game.detail).font(.system(size: 10.5)).opacity(0.8).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(game.pts)
                .font(.system(size: 22, weight: .bold))
                .tracking(-0.4)
                .monospacedDigit()
        }
        .foregroundStyle(ink)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(LinearGradient(colors: [a, b], startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(.white.opacity(0.5), lineWidth: 0.5))
        .shadow(color: .black.opacity(0.08), radius: 1, y: 1)
        .accessibilityElement(children: .combine)
    }
}

// MARK: Game log

private struct PCGameLogCard: View {
    let card: PlayerCardData
    let wide: Bool
    /// A season, or 0 for every season.
    @State private var season: Int
    @State private var help = false

    init(card: PlayerCardData, wide: Bool) {
        self.card = card
        self.wide = wide
        _season = State(initialValue: card.latest)
    }

    private var all: Bool { season == 0 }
    private var rows: [PlayerCardData.LogRow] { all ? card.allLog : card.log(for: season) }
    private var lead: String { card.leadColor }

    var body: some View {
        Card {
            head
            if help { helpList.transition(.opacity.combined(with: .move(edge: .top))) }
            PCLogHeadRow(all: all, wide: wide)
            LazyVStack(spacing: 0) {
                ForEach(rows) { row in
                    if let team = row.team, let opp = row.opp, !row.gap {
                        NavigationLink(value: LeagueRoute.boxScore(year: row.season, week: row.week, a: team.id, b: opp)) {
                            PCLogRowView(row: row, all: all, wide: wide, linked: true)
                        }
                        .buttonStyle(PCRowPressStyle())
                    } else {
                        PCLogRowView(row: row, all: all, wide: wide, linked: false)
                    }
                }
            }
            .id(season)
            .transition(.opacity)
        }
        .sensoryFeedback(.selection, trigger: season)
        .animation(.smooth(duration: 0.25), value: season)
        .animation(.smooth(duration: 0.2), value: help)
    }

    private var head: some View {
        HStack(spacing: 8) {
            Text("Game log").displayStyle(20).foregroundStyle(Theme.ink)
            Button {
                help.toggle()
            } label: {
                Image(systemName: help ? "info.circle.fill" : "info.circle")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(help ? Theme.accent : Theme.ink3)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("What the points shading means")
            Spacer(minLength: 6)
            if wide && card.seasons.count <= 8 {
                Picker("Season", selection: $season) {
                    ForEach(card.seasons, id: \.self) { y in Text(String(y)).tag(y) }
                    Text("All").tag(0)
                }
                .pickerStyle(.segmented)
                .fixedSize()
            } else {
                Picker("Season", selection: $season) {
                    ForEach(card.seasons.reversed(), id: \.self) { y in Text(String(y)).tag(y) }
                    Text("All seasons").tag(0)
                }
                .pickerStyle(.menu)
                .tint(Theme.ink)
                .fixedSize()
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private var helpList: some View {
        VStack(alignment: .leading, spacing: 6) {
            helpLine(PCPtsChip(kind: .start, text: "24.00", color: lead, fill: 0.85, small: true),
                     "Started: filled in his team's colour, darker for a bigger score.")
            helpLine(PCPtsChip(kind: .start, text: "6.00", color: lead, fill: 0.3, small: true),
                     "A lighter fill is a quieter game.")
            helpLine(PCPtsChip(kind: .bench, text: "12.00", color: lead, fill: 0, small: true),
                     "Outlined: on the bench or IR, so the points did not count.")
            helpLine(PCPtsChip(kind: .off, text: "—", color: nil, fill: 0, small: true),
                     "Not on a roster that week, or his team had no game (a bye or knocked out).")
            helpLine((Text("15") + Text("P").font(.system(size: 7, weight: .heavy)).baselineOffset(4))
                        .font(.system(size: 10, weight: .heavy))
                        .foregroundStyle(Color(hex: 0xB8733F))
                        .frame(minWidth: 44, alignment: .leading),
                     "A P marks a playoff week.")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface2)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
    }

    private func helpLine(_ chip: some View, _ text: String) -> some View {
        HStack(spacing: 8) {
            chip
            Text(text).font(.system(size: 11)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct PCLogHeadRow: View {
    let all: Bool
    let wide: Bool
    var body: some View {
        HStack(spacing: wide ? 10 : 7) {
            Text("Wk").frame(width: PCwkWidth(all: all, wide: wide), alignment: .leading)
            Text("Team").frame(maxWidth: .infinity, alignment: .leading)
            Text("Pts")
            Color.clear.frame(width: 7, height: 1)
        }
        .font(.system(size: 8.5, weight: .black))
        .tracking(0.6)
        .textCase(.uppercase)
        .foregroundStyle(Theme.muted)
        .padding(.horizontal, 14)
        .padding(.vertical, 6)
        .background(Theme.surface2)
    }
}

private func PCwkWidth(all: Bool, wide: Bool) -> CGFloat {
    all ? (wide ? 78 : 56) : (wide ? 58 : 34)
}

private struct PCLogRowView: View {
    let row: PlayerCardData.LogRow
    let all: Bool
    let wide: Bool
    /// Opens the week's box score.
    let linked: Bool

    var body: some View {
        HStack(spacing: wide ? 10 : 7) {
            week.frame(width: PCwkWidth(all: all, wide: wide), alignment: .leading)
            HStack(spacing: 8) {
                if let team = row.team {
                    PCMark(team: team, size: wide ? 20 : 18, corner: 5)
                        .opacity(row.gap ? 0.45 : 1)
                } else {
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .strokeBorder(Theme.line2, lineWidth: 1.5)
                        .frame(width: wide ? 20 : 18, height: wide ? 20 : 18)
                }
                Text(row.label)
                    .font(.system(size: 12, weight: row.gap ? .regular : .bold))
                    .italic(row.gap)
                    .foregroundStyle(row.gap ? Theme.muted : Theme.ink)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if row.gap {
                PCPtsChip(kind: .off, text: "—", color: nil, fill: 0, small: !wide)
            } else {
                PCPtsChip(kind: row.started == true ? .start : .bench, text: row.ptsText ?? "", color: row.team?.color,
                        fill: row.fill ?? 0, small: !wide)
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(Theme.ink3)
                .frame(width: 7)
                .opacity(linked ? 1 : 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 5)
        .contentShape(Rectangle())
        .overlay(alignment: .top) { Rectangle().fill(Theme.line.opacity(0.6)).frame(height: 1) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(row.gap ? row.tip : "\(row.tip), \(row.label), \(row.ptsText ?? "")")
    }

    private var week: some View {
        let yr = all ? "’\(String(row.season).suffix(2)) · " : ""
        var text = Text(yr + String(row.week))
        if row.playoff {
            text = text + Text("P").font(.system(size: 8, weight: .heavy)).foregroundStyle(Color(hex: 0xB8733F)).baselineOffset(4)
        }
        return text
            .font(.system(size: 11.5, weight: .heavy))
            .monospacedDigit()
            .foregroundStyle(Theme.muted)
            .lineLimit(1)
    }
}

/// A week's points (player-card.js `.pc-pts`): filled in the team's colour
/// when he started, darker for a bigger score; outlined on the bench.
private struct PCPtsChip: View {
    @Environment(\.colorScheme) private var scheme
    enum Kind { case start, bench, off }
    let kind: Kind
    let text: String
    let color: String?
    let fill: Double
    var small = false

    var body: some View {
        let c = Color(css: color) ?? Theme.navy2
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        Text(text)
            .font(.system(size: small ? 10.5 : 11.5, weight: kind == .start ? .black : .bold))
            .monospacedDigit()
            .lineLimit(1)
            .frame(minWidth: small ? 46 : 54, alignment: kind == .off ? .center : .trailing)
            .padding(.horizontal, small ? 7 : 8)
            .padding(.vertical, small ? 2 : 3)
            .foregroundStyle(ink)
            .background {
                switch kind {
                case .start: shape.fill(c.mix(with: Theme.card, by: 1 - fill))
                case .bench: shape.fill(Theme.card).overlay(shape.strokeBorder(c.mix(with: Theme.card, by: 0.45), lineWidth: 1.5))
                case .off: shape.fill(Theme.surface3)
                }
            }
            .fixedSize()
    }

    private var ink: Color {
        switch kind {
        case .start: return Color.pcChipInk(color, fill: fill, dark: scheme == .dark)
        case .bench: return Theme.muted
        case .off: return Theme.ink3
        }
    }
}

// MARK: Little helpers

/// A light press: the card or tile dips a touch while held.
private struct PCPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// A list row's press: a wash of the accent behind it.
private struct PCRowPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(Theme.accent.opacity(configuration.isPressed ? 0.08 : 0))
            .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}

/// Items laid out in lines, wrapping as they run out of width.
struct PCFlow: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width {
                y += line + lineSpacing
                x = 0
                line = 0
            }
            x += size.width + spacing
            line = max(line, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                y += line + lineSpacing
                x = bounds.minX
                line = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}
