import SwiftUI

// MARK: Data (Bridge.season.bracket)

/// A bracket view as the page draws it: the playoff picture of a regular
/// season week (renderPicturePanel), a playoff week (renderPlayoffPanel) or
/// a finished season's bracket (renderSeasonBracket).
struct BracketData: Decodable {
    struct Notice: Decodable {
        let title: String
        let detail: String
    }
    /// "How the field is set" (formatCard), for the weeks before there is
    /// anything to project.
    struct Format: Decodable {
        struct Line: Decodable, Hashable {
            let head: String
            let text: String
        }
        let title: String
        let meta: String
        let lines: [Line]
    }

    let empty: Notice?
    let format: Format?
    let scenarios: Scenarios?
    /// "Projected · through Week 8", "Final seeding", "Through Week 16"…
    let note: String
    let label: String
    /// Teams level on record and points ("Level on record and points · A / B").
    let flips: [String]
    let winners: WinnersBracket?
    let losers: LosersBracket?
    let projected: Bool
}

/// One team's line in a bracket game: a team with its seed and its score
/// (or its record, projected), or a label for a slot still to be decided.
struct BKRow: Decodable, Hashable {
    let seed: String
    let id: String?
    let label: String?
    let score: Double?
    let record: String?
    let winner: Bool
    let lastPlace: Bool
    let projected: Bool
}

struct BKGame: Decodable, Hashable {
    let rows: [BKRow]
    /// "", "championship", "third" or "lastPlace"
    let kind: String
    let kicker: String
    /// Where the teams go next (the losers bracket's routes).
    let path: String
    /// The week whose box score this game has, or 0.
    let week: Int
    /// The round named on the game itself, in a phone's semifinal lanes.
    let stage: String

    var decided: Bool { rows.contains { $0.winner } }

    func boxScore(year: Int) -> LeagueRoute? {
        guard week > 0, rows.count == 2, let a = rows[0].id, let b = rows[1].id else { return nil }
        return .boxScore(year: year, week: week, a: a, b: b)
    }
}

struct BKBye: Decodable, Hashable {
    let seed: String
    let row: BKRow
}

/// A slot of the winner's bracket tree: a game or a bye.
struct BKCell: Decodable, Hashable {
    let bye: BKBye?
    let game: BKGame?
}

struct WinnersBracket: Decodable {
    struct Column: Decodable, Hashable {
        let round: Int
        let title: String
        let weeks: String
        let stage: String
        /// 2^(rounds - round) slots, each a game, a bye or nothing.
        let cells: [BKCell?]
    }
    let rounds: Int
    let columns: [Column]
    let third: BKGame?
    /// "#1 Seed Side", "#2 Seed Side" (a phone's two lanes).
    let laneLabels: [String]
    let champion: String?
}

struct LosersBracket: Decodable {
    struct Round: Decodable, Hashable {
        let round: Int
        let title: String
        let weeks: String
        let games: [BKGame]
    }
    let toilet: Bool
    let rounds: [Round]
}

// MARK: Panels

/// A regular-season week's playoff picture: what's at stake next, then the
/// bracket as it would be seeded if the season ended now.
struct PlayoffPicturePanel: View {
    let info: SeasonInfo
    let season: Season
    let payload: WeekPayload

    var body: some View {
        PanelLoader(expression: "Bridge.season.bracket(year, week, view)",
                    arguments: ["year": season.year, "week": payload.week, "view": "panel-picture"],
                    loadingTitle: "Drawing the playoff picture",
                    failureTitle: "The playoff picture couldn't be drawn") { (data: BracketData) in
            BracketStack(season: season, data: data, median: info.median)
        }
    }
}

/// A playoff week's bracket (projected until the regular season is over),
/// or a finished season's bracket as it finished (week 0).
struct BracketPanel: View {
    let info: SeasonInfo
    let season: Season
    let week: Int

    var body: some View {
        PanelLoader(expression: "Bridge.season.bracket(year, week, view)",
                    arguments: ["year": season.year, "week": week, "view": week == 0 ? "bracket" : "panel-playoffs"],
                    loadingTitle: "Drawing the bracket",
                    failureTitle: "The bracket couldn't be drawn") { (data: BracketData) in
            BracketStack(season: season, data: data, median: info.median)
        }
    }
}

private struct BracketStack: View {
    let season: Season
    let data: BracketData
    let median: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let empty = data.empty {
                EmptyCard(title: empty.title, detail: empty.detail, symbol: "trophy")
                if let format = data.format {
                    FormatCard(format: format)
                }
            } else {
                if let scenarios = data.scenarios, !scenarios.rows.isEmpty {
                    ScenarioCard(season: season, scenarios: scenarios, median: median)
                }
                if let winners = data.winners {
                    WinnersCard(season: season, bracket: winners, note: data.note, label: data.label)
                }
                if !data.flips.isEmpty {
                    PanelFlow(spacing: 8, lineSpacing: 8) {
                        ForEach(data.flips, id: \.self) { RuleTag(text: $0) }
                    }
                }
                if let losers = data.losers {
                    LosersCard(season: season, bracket: losers, note: data.note)
                }
            }
        }
    }
}

/// How the field is set, round by round, from the league's settings.
private struct FormatCard: View {
    let format: BracketData.Format

    var body: some View {
        Card {
            CardHead(title: format.title, symbol: CardIcon.rulebook, meta: format.meta)
            AdaptiveGrid(minWidth: 200, spacing: 10) {
                ForEach(format.lines, id: \.self) { line in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(line.head)
                            .font(.system(size: 11, weight: .bold))
                            .tracking(0.8)
                            .textCase(.uppercase)
                            .foregroundStyle(Theme.ink3)
                        Text(line.text)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Theme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
            }
            .padding(12)
        }
    }
}

// MARK: Cards

/// A bracket card's head: a dot of colour naming the bracket (gold for the
/// winner's, red for the losers), the title, and the note on the right.
private struct BracketHead: View {
    let title: String
    let dot: Color
    let note: String

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(dot)
                .frame(width: 10, height: 10)
                .background(Circle().fill(dot.opacity(0.22)).padding(-3))
            Text(title)
                .displayStyle(20)
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 8)
            if !note.isEmpty {
                Text(note)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.ink3)
                    .multilineTextAlignment(.trailing)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
    }
}

private let lastPlaceRed = Color(light: 0xD6433D, dark: 0xFF6B5E)

/// The winner's bracket: a tree, title game on the right, where there's
/// room; on a phone, round under round, the two halves of the draw side by
/// side and meeting at the title game.
private struct WinnersCard: View {
    let season: Season
    let bracket: WinnersBracket
    let note: String
    let label: String

    var body: some View {
        let width = CGFloat(bracket.rounds) * WinnersTree.column + CGFloat(max(0, bracket.rounds - 1)) * WinnersTree.gap + 44
        Card {
            BracketHead(title: "Winner's Bracket", dot: Theme.gold, note: note)
            ViewThatFits(in: .horizontal) {
                WinnersTree(season: season, bracket: bracket)
                    .padding(.horizontal, 22)
                    .padding(.top, 20)
                    .padding(.bottom, 24)
                    .frame(minWidth: width, idealWidth: width, maxWidth: .infinity)
                WinnersRounds(season: season, bracket: bracket)
                    .frame(maxWidth: BKGrid.maxWidth)
                    .padding(.horizontal, BKGrid.inset)
                    .padding(.top, 16)
                    .padding(.bottom, 18)
                    .frame(maxWidth: .infinity)
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(label)
        }
    }
}

/// The tree: a column per round, every column the same height, each
/// round's games centred in equal slots, joined by rounded brackets.
private struct WinnersTree: View {
    let season: Season
    let bracket: WinnersBracket
    static let gap: CGFloat = 36
    static let slot: CGFloat = 130
    /// The narrowest a round may be and still read: a seed, a logo, a
    /// short name and a score. Rounds widen to share any room beyond it.
    static let column: CGFloat = 200

    var body: some View {
        let firstRound = bracket.columns.first?.cells.count ?? 1
        let height = CGFloat(max(4, firstRound)) * Self.slot
        HStack(alignment: .top, spacing: Self.gap) {
            ForEach(bracket.columns, id: \.round) { column in
                let footer = BKSlot.footer(column.cells.map { BKSlot($0) })
                VStack(alignment: .leading, spacing: 12) {
                    RoundTitle(title: column.title, weeks: column.weeks)
                    ZStack(alignment: .top) {
                        VStack(spacing: 0) {
                            ForEach(Array(column.cells.enumerated()), id: \.offset) { _, cell in
                                BKSlotView(season: season, slot: BKSlot(cell), round: column.title, style: .wide, footer: footer)
                                    .frame(maxWidth: .infinity)
                                    .frame(height: height / CGFloat(max(1, column.cells.count)))
                            }
                        }
                        if column.round == bracket.rounds, let third = bracket.third {
                            VStack {
                                Spacer(minLength: 0)
                                BKSlotView(season: season, slot: .game(third), round: "Third Place", style: .wide,
                                           footer: !third.path.isEmpty)
                            }
                        }
                    }
                    .frame(height: height)
                    .overlay(alignment: .topLeading) {
                        if column.round > 1, let index = bracket.columns.firstIndex(of: column), index > 0 {
                            BracketJoins(column: column, previous: bracket.columns[index - 1])
                                .stroke(Theme.line2, style: BKGrid.stroke)
                                .frame(width: Self.gap, height: height)
                                .offset(x: -Self.gap)
                                .allowsHitTesting(false)
                        }
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
    }
}

/// The connectors into one column: a rounded bracket meeting the two slots
/// that feed each game at their centres, and a stub into the game.
private struct BracketJoins: Shape {
    let column: WinnersBracket.Column
    let previous: WinnersBracket.Column

    func path(in rect: CGRect) -> Path {
        var p = Path()
        let count = max(1, column.cells.count)
        let slot = rect.height / CGFloat(count)
        let mid = rect.width / 2
        let r: CGFloat = 7
        for j in 0..<count {
            guard let cell = column.cells[j], cell.game != nil else { continue }
            let y = (CGFloat(j) + 0.5) * slot
            let a = 2 * j, b = 2 * j + 1
            if a < previous.cells.count, b < previous.cells.count, previous.cells[a] != nil, previous.cells[b] != nil {
                let y1 = (CGFloat(j) + 0.25) * slot
                let y2 = (CGFloat(j) + 0.75) * slot
                p.move(to: CGPoint(x: 0, y: y1))
                p.addLine(to: CGPoint(x: mid - r, y: y1))
                p.addQuadCurve(to: CGPoint(x: mid, y: y1 + r), control: CGPoint(x: mid, y: y1))
                p.addLine(to: CGPoint(x: mid, y: y2 - r))
                p.addQuadCurve(to: CGPoint(x: mid - r, y: y2), control: CGPoint(x: mid, y: y2))
                p.addLine(to: CGPoint(x: 0, y: y2))
            }
            p.move(to: CGPoint(x: mid, y: y))
            p.addLine(to: CGPoint(x: rect.width, y: y))
        }
        return p
    }
}

/// The phone's bracket, read top to bottom: each round under a capsule
/// naming it, its games in two equal columns (the #1 seed's half of the
/// draw on the left, the #2 seed's on the right), a lone game centred at
/// the width of one column, rounds joined by elbows.
private struct WinnersRounds: View {
    let season: Season
    let bracket: WinnersBracket

    var body: some View {
        let columns = bracket.columns
        VStack(spacing: 0) {
            ForEach(Array(columns.enumerated()), id: \.offset) { i, column in
                let rows = Self.rows(column)
                if i == 0 {
                    VStack(spacing: 10) {
                        RoundCapsule(title: column.title, weeks: column.weeks)
                        if bracket.laneLabels.count == 2, rows.first?.count == 2 {
                            BKPair {
                                ForEach(bracket.laneLabels, id: \.self) { lane in
                                    Text(lane)
                                        .font(.system(size: 9.5, weight: .bold))
                                        .tracking(0.9)
                                        .textCase(.uppercase)
                                        .foregroundStyle(Theme.ink3)
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.8)
                                        .frame(maxWidth: .infinity)
                                }
                            }
                        }
                    }
                    .padding(.bottom, 10)
                } else {
                    let from = BKSlot.positions(Self.rows(columns[i - 1]).last ?? [])
                    let to = BKSlot.positions(rows.first ?? [])
                    // Each half feeds its own next game; only a merge (the
                    // two halves meeting) gets a crossbar.
                    RoundJoin(sources: from, targets: to, bar: from.count != to.count,
                              title: column.title, weeks: column.weeks)
                }
                BKRoundGrid(season: season, rows: rows, round: column.title, style: .compact)
            }
            if let third = bracket.third {
                BKRoundGrid(season: season, rows: [[.game(third)]], round: "Third Place", style: .compact)
                    .padding(.top, 22)
            }
        }
    }

    /// A round's slots as rows of two: the first half of the draw down the
    /// left, the second down the right, a slot missing on both sides dropped.
    static func rows(_ column: WinnersBracket.Column) -> [[BKSlot]] {
        let cells = column.cells
        guard cells.count >= 2 else { return cells.isEmpty ? [] : [[BKSlot(cells[0])]] }
        let n = cells.count / 2
        return (0..<n).compactMap { r in
            let pair = [BKSlot(cells[r]), BKSlot(cells[n + r])]
            return pair.allSatisfy(\.isEmpty) ? nil : pair
        }
    }
}

/// The losers bracket (a toilet bowl or a consolation bracket): a column a
/// round with room; on a phone, round under round like the winner's.
private struct LosersCard: View {
    let season: Season
    let bracket: LosersBracket
    let note: String

    var body: some View {
        let width = CGFloat(bracket.rounds.count) * WinnersTree.column + CGFloat(max(0, bracket.rounds.count - 1)) * 36 + 44
        Card {
            BracketHead(title: "Losers Bracket", dot: lastPlaceRed, note: note)
            ViewThatFits(in: .horizontal) {
                wide
                    .padding(.horizontal, 22)
                    .padding(.top, 20)
                    .padding(.bottom, 24)
                    .frame(minWidth: width, idealWidth: width, maxWidth: .infinity)
                phone
                    .frame(maxWidth: BKGrid.maxWidth)
                    .padding(.horizontal, BKGrid.inset)
                    .padding(.top, 16)
                    .padding(.bottom, 18)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private static let wideSpacing: CGFloat = 16

    private var wide: some View {
        let rounds = bracket.rounds
        return HStack(alignment: .top, spacing: 36) {
            ForEach(Array(rounds.enumerated()), id: \.offset) { i, round in
                let footer = BKSlot.footer(round.games.map(BKSlot.game))
                VStack(alignment: .leading, spacing: 12) {
                    RoundTitle(title: round.title, weeks: round.weeks)
                    VStack(spacing: Self.wideSpacing) {
                        ForEach(Array(round.games.enumerated()), id: \.offset) { _, game in
                            BKSlotView(season: season, slot: .game(game), round: round.title, style: .wide, footer: footer)
                        }
                    }
                    .frame(maxHeight: .infinity, alignment: .center)
                    .overlay(alignment: .leading) {
                        if i > 0 {
                            let previous = rounds[i - 1]
                            let h0 = BKMetrics.card(.wide, footer: BKSlot.footer(previous.games.map(BKSlot.game)))
                            let h1 = BKMetrics.card(.wide, footer: footer)
                            BKJoin(sources: previous.games.indices.map { .stack($0, previous.games.count, h0, Self.wideSpacing) },
                                   targets: round.games.indices.map { .stack($0, round.games.count, h1, Self.wideSpacing) },
                                   bar: true, horizontal: true)
                                .stroke(Theme.line2, style: BKGrid.stroke)
                                .frame(width: 36)
                                .offset(x: -36)
                                .allowsHitTesting(false)
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var phone: some View {
        let rounds = bracket.rounds
        return VStack(spacing: 0) {
            ForEach(Array(rounds.enumerated()), id: \.offset) { i, round in
                let rows = Self.rows(round)
                if i == 0 {
                    RoundCapsule(title: round.title, weeks: round.weeks)
                        .padding(.bottom, 12)
                } else {
                    // Every game of a round sends its teams on to the next
                    // round's games, so the rounds meet on one crossbar.
                    RoundJoin(sources: BKSlot.positions(Self.rows(rounds[i - 1]).last ?? []),
                              targets: BKSlot.positions(rows.first ?? []),
                              bar: true, title: round.title, weeks: round.weeks)
                }
                BKRoundGrid(season: season, rows: rows, round: round.title, style: .compact)
            }
        }
    }

    static func rows(_ round: LosersBracket.Round) -> [[BKSlot]] {
        stride(from: 0, to: round.games.count, by: 2).map { start in
            round.games[start..<min(start + 2, round.games.count)].map(BKSlot.game)
        }
    }
}

// MARK: Rounds on a phone

private enum BKGrid {
    /// Between a round's two columns, and between its rows.
    static let gap: CGFloat = 12
    static let rowGap: CGFloat = 12
    /// The height of the joins between rounds.
    static let join: CGFloat = 60
    static let inset: CGFloat = 12
    /// A phone bracket on a wider screen stays this wide, centred.
    static let maxWidth: CGFloat = 560
    static let stroke = StrokeStyle(lineWidth: 1.5, lineCap: .butt, lineJoin: .round)
}

/// One slot of a round: a game, a bye, or nothing (a hole in the draw).
private enum BKSlot: Hashable {
    case game(BKGame)
    case bye(BKBye)
    case empty

    init(_ cell: BKCell?) {
        if let bye = cell?.bye { self = .bye(bye) }
        else if let game = cell?.game { self = .game(game) }
        else { self = .empty }
    }

    var isEmpty: Bool { if case .empty = self { return true } else { return false } }

    /// A round's cards all keep a foot for the routes if any game has one.
    static func footer(_ slots: [BKSlot]) -> Bool {
        slots.contains { if case .game(let g) = $0 { return !g.path.isEmpty } else { return false } }
    }

    /// Where a row's cards sit across the round, for the joins.
    static func positions(_ row: [BKSlot]) -> [BKPos] {
        if row.count == 1 { return row[0].isEmpty ? [] : [.center] }
        return zip([BKPos.left, .right], row).compactMap { $1.isEmpty ? nil : $0 }
    }
}

/// A round's games in rows of two, every card the same size.
private struct BKRoundGrid: View {
    let season: Season
    let rows: [[BKSlot]]
    let round: String
    let style: BKStyle

    var body: some View {
        let footer = BKSlot.footer(rows.flatMap { $0 })
        VStack(spacing: BKGrid.rowGap) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                BKPair {
                    ForEach(Array(row.enumerated()), id: \.offset) { _, slot in
                        BKSlotView(season: season, slot: slot, round: round, style: style, footer: footer)
                    }
                }
            }
        }
    }
}

/// Two views side by side in equal columns, or one view centred at the
/// width of one column.
private struct BKPair: Layout {
    var gap: CGFloat = BKGrid.gap

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 340
        let column = max(0, (width - gap) / 2)
        let height = subviews.map { $0.sizeThatFits(ProposedViewSize(width: column, height: nil)).height }.max() ?? 0
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let column = max(0, (bounds.width - gap) / 2)
        let size = ProposedViewSize(width: column, height: bounds.height)
        if subviews.count == 1 {
            subviews[0].place(at: CGPoint(x: bounds.midX, y: bounds.minY), anchor: .top, proposal: size)
            return
        }
        for (i, view) in subviews.prefix(2).enumerated() {
            view.place(at: CGPoint(x: bounds.minX + CGFloat(i) * (column + gap), y: bounds.minY), anchor: .topLeading, proposal: size)
        }
    }
}

/// Where a join meets a card, across the round: the centre of the left or
/// right column, the middle, or the nth card of a centred stack.
private enum BKPos: Hashable {
    case left, right, center
    case stack(Int, Int, CGFloat, CGFloat)

    func resolve(_ length: CGFloat) -> CGFloat {
        let column = (length - BKGrid.gap) / 2
        switch self {
        case .left: return column / 2
        case .right: return length - column / 2
        case .center: return length / 2
        case let .stack(k, n, height, spacing):
            return length / 2 + (CGFloat(k) - CGFloat(n - 1) / 2) * (height + spacing)
        }
    }
}

/// The lines between two rounds: a stub out of every card of the round
/// before, a crossbar halfway, a stub into every card of the next round;
/// the crossbar's ends turn on a small radius. Without a crossbar, each
/// card runs straight on into the one in line with it.
private struct BKJoin: Shape {
    let sources: [BKPos]
    let targets: [BKPos]
    var bar: Bool
    var horizontal = false

    func path(in rect: CGRect) -> Path {
        var p = Path()
        let length = horizontal ? rect.width : rect.height
        let across = horizontal ? rect.height : rect.width
        func point(_ along: CGFloat, _ at: CGFloat) -> CGPoint {
            horizontal ? CGPoint(x: rect.minX + along, y: rect.minY + at) : CGPoint(x: rect.minX + at, y: rect.minY + along)
        }
        let s = sources.map { $0.resolve(across) }
        let t = targets.map { $0.resolve(across) }
        let all = s + t
        guard let lo = all.min(), let hi = all.max() else { return p }
        func near(_ a: CGFloat, _ b: CGFloat) -> Bool { abs(a - b) < 0.5 }

        if !bar || hi - lo < 0.5 {
            for x in s {
                p.move(to: point(0, x))
                p.addLine(to: point(t.contains { near($0, x) } ? length : length / 2, x))
            }
            for x in t where !s.contains(where: { near($0, x) }) {
                p.move(to: point(length / 2, x))
                p.addLine(to: point(length, x))
            }
            return p
        }

        let mid = (length / 2).rounded()
        let r = min(8, (hi - lo) / 2, mid)
        var done: [CGFloat] = []
        for x in all where !done.contains(where: { near($0, x) }) {
            done.append(x)
            let up = s.contains { near($0, x) }, down = t.contains { near($0, x) }
            let turn: CGFloat? = near(x, lo) ? 1 : (near(x, hi) ? -1 : nil)
            if up && down {
                p.move(to: point(0, x))
                p.addLine(to: point(length, x))
            } else if up {
                p.move(to: point(0, x))
                if let turn {
                    p.addLine(to: point(mid - r, x))
                    p.addQuadCurve(to: point(mid, x + turn * r), control: point(mid, x))
                } else {
                    p.addLine(to: point(mid, x))
                }
            } else if down {
                if let turn {
                    p.move(to: point(mid, x + turn * r))
                    p.addQuadCurve(to: point(mid + r, x), control: point(mid, x))
                } else {
                    p.move(to: point(mid, x))
                }
                p.addLine(to: point(length, x))
            }
        }
        let through = { (x: CGFloat) in s.contains { near($0, x) } && t.contains { near($0, x) } }
        p.move(to: point(mid, lo + (through(lo) ? 0 : r)))
        p.addLine(to: point(mid, hi - (through(hi) ? 0 : r)))
        return p
    }
}

/// The joins into a round, the round's name in a capsule where they meet.
private struct RoundJoin: View {
    let sources: [BKPos]
    let targets: [BKPos]
    let bar: Bool
    let title: String
    let weeks: String

    var body: some View {
        GeometryReader { geo in
            let column = (geo.size.width - BKGrid.gap) / 2
            ZStack {
                BKJoin(sources: sources, targets: targets, bar: bar)
                    .stroke(Theme.line2, style: BKGrid.stroke)
                // Clear of the lines running past it when there's no crossbar.
                RoundCapsule(title: title, weeks: weeks)
                    .frame(maxWidth: bar ? column + BKGrid.gap : column - 12)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .frame(height: BKGrid.join)
    }
}

/// "SEMIFINALS · WK 16": a round's name over its games.
private struct RoundCapsule: View {
    let title: String
    let weeks: String

    private var compactWeeks: String {
        weeks.replacingOccurrences(of: "NFL Weeks ", with: "Wks ")
            .replacingOccurrences(of: "NFL Week ", with: "Wk ")
    }

    var body: some View {
        Group {
            if weeks.isEmpty {
                Text(title).foregroundStyle(Theme.ink2)
            } else {
                Text("\(Text(title).foregroundStyle(Theme.ink2))\(Text(" · \(compactWeeks)").foregroundStyle(Theme.ink3))")
            }
        }
        .font(.system(size: 10.5, weight: .bold))
        .tracking(0.8)
        .textCase(.uppercase)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .padding(.horizontal, 12)
        .frame(height: 24)
        .background(Theme.card, in: Capsule())
        .overlay(Capsule().strokeBorder(Theme.line2, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(weeks.isEmpty ? title : "\(title), \(weeks)")
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: A game

private enum BKStyle {
    /// Half a phone's width: the logo beside the name, the seed and score
    /// under the name.
    case compact
    /// The tree's columns: seed, logo, name and score on one line.
    case wide
}

/// Every part of a card has a set height, so every card in a round is the
/// same size whatever its names.
private enum BKMetrics {
    static let head: CGFloat = 26
    static let foot: CGFloat = 25
    static let radius: CGFloat = 12
    static func row(_ style: BKStyle) -> CGFloat { style == .compact ? 48 : 40 }
    static func card(_ style: BKStyle, footer: Bool) -> CGFloat {
        head + 2 * row(style) + (footer ? foot : 0)
    }
}

/// A slot drawn as a card: a game, a bye (the seed's team and "Bye" where
/// an opponent would be), or a hole the size of a card.
private struct BKSlotView: View {
    let season: Season
    let slot: BKSlot
    let round: String
    let style: BKStyle
    let footer: Bool

    var body: some View {
        switch slot {
        case .game(let game):
            BKCardView(season: season, game: game, bye: nil, round: round, style: style, footer: footer)
        case .bye(let bye):
            BKCardView(season: season,
                       game: BKGame(rows: [bye.row], kind: "", kicker: "", path: "", week: 0, stage: ""),
                       bye: bye, round: round, style: style, footer: footer)
        case .empty:
            Color.clear.frame(height: BKMetrics.card(style, footer: footer))
        }
    }
}

/// A bracket game: a head naming it (with its box score on the right), the
/// two teams, and its route along the foot.
private struct BKCardView: View {
    let season: Season
    let game: BKGame
    let bye: BKBye?
    let round: String
    let style: BKStyle
    let footer: Bool

    private var champ: Bool { game.kind == "championship" }
    private var last: Bool { game.kind == "lastPlace" }

    /// The game's name: its kicker ("Game 3", "Third Place"), the stage a
    /// lane names ("Semifinal"), the seed of a bye, or the round's name.
    private var label: String {
        if let bye { return "\(bye.seed) Seed · Bye" }
        if !game.kicker.isEmpty { return game.kicker }
        if !game.stage.isEmpty, let stage = game.stage.components(separatedBy: " · ").first, !stage.isEmpty { return stage }
        return round
    }

    private var border: Color {
        if champ { return Theme.gold.opacity(0.7) }
        if last { return lastPlaceRed.opacity(0.4) }
        return Theme.line
    }

    var body: some View {
        VStack(spacing: 0) {
            head
            BKRowView(season: season, row: game.rows.first, game: game, style: style)
            Group {
                if bye != nil {
                    BKByeLine(style: style)
                } else {
                    BKRowView(season: season, row: game.rows.count > 1 ? game.rows[1] : nil, game: game, style: style)
                }
            }
            .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
            if footer {
                Text(game.path)
                    .font(.system(size: 9.5, weight: .medium))
                    .foregroundStyle(Theme.ink3)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 9)
                    .frame(height: BKMetrics.foot)
                    .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: BKMetrics.card(style, footer: footer))
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: BKMetrics.radius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: BKMetrics.radius, style: .continuous).strokeBorder(border, lineWidth: 1))
        .background {
            // the shape's shadow, not the card's (see Card)
            RoundedRectangle(cornerRadius: BKMetrics.radius, style: .continuous)
                .fill(Theme.card)
                .shadow(color: Color(hex: 0x101828, alpha: 0.05), radius: 1.5, y: 1)
        }
        .accessibilityElement(children: .contain)
    }

    private func boxCue(_ text: String) -> some View {
        HStack(spacing: 2) {
            Text(text)
            Image(systemName: "chevron.right").font(.system(size: 8, weight: .bold))
        }
        .font(.system(size: 10, weight: .semibold))
        .foregroundStyle(Theme.accentInk)
        .fixedSize()
    }

    private func headRow(fullLabel: Bool, box: String?) -> some View {
        HStack(spacing: 5) {
            if champ {
                Image(systemName: "trophy.fill")
                    .font(.system(size: 9.5, weight: .semibold))
                    .foregroundStyle(Theme.gold)
            } else if last {
                Text("🚽").font(.system(size: 10))
            }
            Text(label)
                .font(.system(size: 9.5, weight: .bold))
                .tracking(0.8)
                .textCase(.uppercase)
                .foregroundStyle(champ ? Theme.goldInk : (last ? lastPlaceRed : Theme.ink3))
                .lineLimit(1)
                .fixedSize(horizontal: fullLabel, vertical: false)
            Spacer(minLength: 6)
            if let box {
                if box.isEmpty {
                    // the narrowest: the box score as its icon alone
                    Image(systemName: "tablecells")
                        .font(.system(size: 10.5, weight: .semibold))
                        .foregroundStyle(Theme.accentInk)
                        .accessibilityLabel("Box score")
                } else {
                    boxCue(box)
                }
            }
        }
    }

    @ViewBuilder private var head: some View {
        let hasBox = game.boxScore(year: season.year) != nil
        // The whole label with "Box score", then with "Box", and only then
        // the label shortened: the game's name keeps priority over the link.
        let content = ViewThatFits(in: .horizontal) {
            headRow(fullLabel: true, box: hasBox ? "Box score" : nil)
            headRow(fullLabel: true, box: hasBox ? "Box" : nil)
            headRow(fullLabel: true, box: hasBox ? "" : nil)
            headRow(fullLabel: false, box: hasBox ? "" : nil)
        }
        .padding(.horizontal, 10)
        .frame(height: BKMetrics.head)
        .background(Theme.surface2)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }

        if let route = game.boxScore(year: season.year) {
            NavigationLink(value: route) { content.contentShape(Rectangle()) }
                .buttonStyle(PanelRowPressStyle())
                .accessibilityLabel("\(label), box score")
        } else {
            content
                .accessibilityElement(children: .combine)
        }
    }
}

/// A team's name in the bracket. In a debug build, launching with
/// PP_LONGNAMES=1 swaps in long names, mixed with short ones, to check the
/// cards keep their shape with the names real leagues use.
private func bracketName(_ team: Team) -> String {
    #if DEBUG
    if ProcessInfo.processInfo.environment["PP_LONGNAMES"] == "1" {
        let names = [
            "Javaris Jamar Javarison-Lamar", "Jets", "How I Metcalf Your Mother",
            "Hawaii McLovins VIII", "To infinity and Bijan", "The Mahomes Alone Holiday Special",
            "Pack", "Kirk Cousins' Fourth-Quarter Magic", "Jared's Pack Attack",
            "CeeDee Lamb of God Almighty Squad", "Bo", "Saquon and On and On and On",
        ]
        return names[(team.rosterId - 1 + names.count) % names.count]
    }
    #endif
    return team.name
}

/// One side of a game. The winner reads a weight heavier, its score in the
/// accent (gold in the title game) on the softest tint; the loser is
/// quieter; the team that lost its way to last place is red; a slot still
/// to be decided names the game that decides it.
private struct BKRowView: View {
    let season: Season
    let row: BKRow?
    let game: BKGame
    let style: BKStyle

    private struct Look {
        var ink: Color = Theme.ink
        var weight: Font.Weight = .semibold
        var tint: Color = .clear
        var scoreInk: Color = Theme.ink2
        var scoreWeight: Font.Weight = .semibold
        var dim = false
    }

    private func look(_ row: BKRow) -> Look {
        var l = Look()
        let champ = game.kind == "championship"
        if row.lastPlace {
            l.ink = lastPlaceRed; l.tint = Theme.redSoft.opacity(0.7); l.scoreInk = lastPlaceRed
        } else if row.winner && game.kind == "lastPlace" {
            l.weight = .bold; l.scoreInk = Theme.ink; l.scoreWeight = .bold
        } else if row.winner {
            l.weight = .bold
            l.scoreInk = champ ? Theme.goldInk : Theme.accentInk
            l.scoreWeight = .bold
            l.tint = (champ ? Theme.goldSoft : Theme.accentSoft).opacity(0.6)
        } else if game.decided {
            l.ink = Theme.ink2; l.weight = .regular; l.scoreInk = Theme.ink3; l.scoreWeight = .medium; l.dim = true
        }
        return l
    }

    var body: some View {
        if let row, let id = row.id, let team = season.team(id) {
            NavigationLink(value: LeagueRoute.team(year: season.year, teamId: id)) {
                content(row: row, team: team)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PanelRowPressStyle())
            .accessibilityLabel(accessibility(row, team))
        } else {
            tbd
        }
    }

    private func accessibility(_ row: BKRow, _ team: Team) -> String {
        var s = "\(row.seed) \(bracketName(team))"
        if let score = row.score { s += ", \(Fmt.pts(score))" }
        if let record = row.record { s += ", \(record)" }
        if row.winner { s += ", won" }
        if row.lastPlace { s += ", last place" }
        return s
    }

    @ViewBuilder private func trailing(_ row: BKRow, _ l: Look) -> some View {
        if let score = row.score {
            Text(Fmt.pts(score))
                .font(.system(size: 13, weight: l.scoreWeight))
                .foregroundStyle(l.scoreInk)
                .monospacedDigit()
                .lineLimit(1)
                .fixedSize()
        } else if let record = row.record {
            Text(record)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.ink3)
                .monospacedDigit()
                .lineLimit(1)
                .fixedSize()
        }
    }

    private func name(_ team: Team, _ l: Look) -> some View {
        Text(bracketName(team))
            .font(.system(size: style == .compact ? 13.5 : 14, weight: l.weight))
            .foregroundStyle(l.ink)
            .lineLimit(1)
            .minimumScaleFactor(0.78)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private func content(row: BKRow, team: Team) -> some View {
        let l = look(row)
        Group {
            switch style {
            case .compact:
                HStack(spacing: 8) {
                    TeamBadge(team: team, size: 24, corner: 7).opacity(l.dim ? 0.55 : 1)
                    VStack(alignment: .leading, spacing: 2) {
                        name(team, l)
                        HStack(spacing: 4) {
                            Text(row.seed)
                                .font(.system(size: 10.5, weight: .medium))
                                .foregroundStyle(Theme.ink3)
                                .monospacedDigit()
                            Spacer(minLength: 4)
                            trailing(row, l)
                        }
                    }
                }
                .padding(.leading, 9)
                .padding(.trailing, 10)
            case .wide:
                HStack(spacing: 8) {
                    Text(row.seed)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Theme.ink3)
                        .monospacedDigit()
                        .frame(width: 26, alignment: .leading)
                    TeamBadge(team: team, size: 22, corner: 6).opacity(l.dim ? 0.55 : 1)
                    name(team, l)
                    trailing(row, l)
                }
                .padding(.leading, 10)
                .padding(.trailing, 12)
            }
        }
        .frame(maxWidth: .infinity, minHeight: BKMetrics.row(style), maxHeight: BKMetrics.row(style))
        .background(l.tint)
    }

    private var tbd: some View {
        HStack(spacing: 8) {
            if style == .wide {
                Text("—")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Theme.ink3)
                    .frame(width: 26, alignment: .leading)
            }
            BKPlaceholderBadge(size: style == .compact ? 24 : 22)
            // A slot's label may take two lines; the row keeps its height.
            Text(row?.label ?? "To be decided")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.ink3)
                .lineLimit(style == .compact ? 2 : 1)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.leading, style == .compact ? 9 : 10)
        .padding(.trailing, 10)
        .frame(maxWidth: .infinity, minHeight: BKMetrics.row(style), maxHeight: BKMetrics.row(style))
        .accessibilityElement(children: .combine)
    }
}

/// Where an opponent would be, for a team with a bye.
private struct BKByeLine: View {
    let style: BKStyle
    var body: some View {
        HStack(spacing: 8) {
            if style == .wide { Color.clear.frame(width: 26, height: 1) }
            BKPlaceholderBadge(size: style == .compact ? 24 : 22)
            Text("Bye")
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(Theme.ink3)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.leading, style == .compact ? 9 : 10)
        .padding(.trailing, 10)
        .frame(maxWidth: .infinity, minHeight: BKMetrics.row(style), maxHeight: BKMetrics.row(style))
        .accessibilityElement(children: .combine)
    }
}

/// A dashed outline the size of a team's logo, for a slot with no team.
private struct BKPlaceholderBadge: View {
    let size: CGFloat
    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.29, style: .continuous)
            .strokeBorder(Theme.line2, style: StrokeStyle(lineWidth: 1, dash: [3, 2.5]))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}
