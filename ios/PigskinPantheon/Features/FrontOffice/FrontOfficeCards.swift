import SwiftUI

// The front office's cards (moves.html `.fo-*`): ranked rows with a bar and
// small stats, lines of what happened, trades side by side, draft-pick chips.

struct OfficeCardView: View {
    let card: OfficeCard
    let store: OfficeStore

    var body: some View {
        Card {
            CardHead(title: card.title, symbol: card.symbol, meta: card.meta)
            if let empty = card.empty {
                OfficeEmptyText(text: empty)
            } else {
                switch card.kind {
                case "rows":
                    OfficeList(count: card.rows.count) { i in OfficeRowView(row: card.rows[i]) }
                case "items":
                    OfficeList(count: card.items.count) { i in OfficeItemView(item: card.items[i]) }
                case "trades":
                    OfficeTrades(trades: card.trades, store: store)
                default:
                    EmptyView()
                }
            }
            if let note = card.note {
                Text(note)
                    .font(.system(size: 12.5))
                    .foregroundStyle(Theme.muted)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.top, 10)
                    .padding(.bottom, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .top) { Rectangle().fill(Theme.line).frame(height: 1) }
            }
        }
    }
}

/// Rows on hairlines (`.fo-list`).
private struct OfficeList<Row: View>: View {
    let count: Int
    @ViewBuilder let row: (Int) -> Row

    var body: some View {
        LazyVStack(spacing: 0) {
            ForEach(0..<count, id: \.self) { i in
                row(i)
                if i < count - 1 { Rectangle().fill(Theme.line).frame(height: 1) }
            }
        }
    }
}

// MARK: Bits

/// A team as it was, or a manager (`.fo-team`).
struct OfficeWhoView: View {
    let who: OfficeWho
    var size: CGFloat = 32

    var body: some View {
        HStack(spacing: 10) {
            TeamBadge(name: who.name, icon: who.icon, color: who.color, logo: who.logo, size: size, corner: size * 0.28)
            VStack(alignment: .leading, spacing: 1) {
                Text(who.name)
                    .font(.system(size: 13.5, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Text(who.sub)
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
        }
    }
}

/// The number at the end of a row, with its words under it (`.fo-big`).
struct OfficeBig: View {
    let value: String
    let sub: String
    var tone: String? = nil
    var size: CGFloat = 16

    var body: some View {
        VStack(alignment: .trailing, spacing: 1) {
            Text(value)
                .font(.system(size: size, weight: .black))
                .foregroundStyle(officeTone(tone) ?? Theme.ink)
                .monospacedDigit()
                .contentTransition(.numericText())
            Text(sub)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
        }
        .multilineTextAlignment(.trailing)
        .fixedSize()
    }
}

func officeTone(_ tone: String?) -> Color? {
    switch tone {
    case "good": return Theme.green
    case "bad": return Theme.red
    default: return nil
    }
}

/// Text in pieces, the emphasised ones darker and the quiet ones muted.
func officeText(_ segs: [OfficeSeg], base: Color = Theme.muted, em: Color = Theme.ink2) -> Text {
    segs.reduce(Text("")) { text, s in
        var piece = Text(s.t)
        if s.em { piece = piece.fontWeight(.bold).foregroundStyle(em) }
        else if s.muted { piece = piece.foregroundStyle(Theme.muted).fontWeight(.medium) }
        else { piece = piece.foregroundStyle(base) }
        return Text("\(text)\(piece)")
    }
}

private struct OfficeTag: View {
    let text: String
    let soft: Bool
    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .heavy))
            .tracking(0.4)
            .textCase(.uppercase)
            .foregroundStyle(soft ? Theme.ink2 : Theme.red)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(soft ? Theme.surface3 : Theme.redSoft, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
    }
}

/// A card's whole message when there's nothing to list (`.fo-empty`).
struct OfficeEmptyText: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 13.5))
            .foregroundStyle(Theme.muted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 16)
            .padding(.vertical, 26)
    }
}

struct OfficeEmpty: View {
    let text: String
    var body: some View { Card { OfficeEmptyText(text: text) } }
}

/// Wraps like the site's flex-wrap rows of small stats and chips.
struct OfficeFlow: Layout {
    var spacing: CGFloat = 14
    var lineSpacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > 0, x + s.width > width { y += line + lineSpacing; x = 0; line = 0 }
            x += s.width + spacing
            line = max(line, s.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x > bounds.minX, x + s.width > bounds.maxX { y += line + lineSpacing; x = bounds.minX; line = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            line = max(line, s.height)
        }
    }
}

// MARK: Ranked rows

/// A ranked team or manager (`.fo-row`): the rank, who, the big number;
/// under them the bar, the small stats, or the draft-pick chips.
private struct OfficeRowView: View {
    let row: OfficeRow

    var body: some View {
        if row.picks.isEmpty {
            NavigationLink(value: row.who.route) { content }
                .buttonStyle(.plain)
        } else {
            content
        }
    }

    private var content: some View {
        HStack(alignment: .top, spacing: 8) {
            Text("\(row.rank)")
                .font(.system(size: 13, weight: .black))
                .foregroundStyle(Theme.ink3)
                .monospacedDigit()
                .frame(width: 24, height: 32)
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    if row.picks.isEmpty {
                        OfficeWhoView(who: row.who)
                    } else {
                        NavigationLink(value: row.who.route) { OfficeWhoView(who: row.who) }
                            .buttonStyle(.plain)
                    }
                    Spacer(minLength: 6)
                    OfficeBig(value: row.big, sub: row.bigSub, tone: row.tone)
                }
                if let meter = row.meter {
                    OfficeMeter(value: meter)
                }
                if !row.stats.isEmpty {
                    OfficeFlow(spacing: 14, lineSpacing: 4) {
                        ForEach(row.stats, id: \.label) { stat in
                            statText(stat)
                        }
                    }
                }
                if !row.picks.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(row.picks) { year in
                            HStack(alignment: .top, spacing: 4) {
                                Text(String(year.year))
                                    .font(.system(size: 11, weight: .heavy))
                                    .foregroundStyle(Theme.muted)
                                    .monospacedDigit()
                                    .frame(width: 42, height: 22, alignment: .leading)
                                OfficeFlow(spacing: 4, lineSpacing: 4) {
                                    ForEach(Array(year.chips.enumerated()), id: \.offset) { _, chip in
                                        OfficeChipView(chip: chip)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func statText(_ stat: OfficeStat) -> some View {
        let label = Text("\(stat.label) ").foregroundStyle(Theme.muted)
        let value = Text(stat.value).fontWeight(.heavy).foregroundStyle(officeTone(stat.tone) ?? Theme.ink2)
        var t = Text("\(label)\(value)")
        if let tail = stat.tail { t = Text("\(t)\(Text(" \(tail)").foregroundStyle(Theme.muted))") }
        return t.font(.system(size: 11.5)).monospacedDigit().lineLimit(1)
    }
}

/// The lineup bar (`.fo-meter`).
private struct OfficeMeter: View {
    let value: Double
    @State private var shown = false

    var body: some View {
        Capsule()
            .fill(Theme.surface3)
            .frame(height: 6)
            .overlay(alignment: .leading) {
                GeometryReader { geo in
                    Capsule()
                        .fill(Theme.accent)
                        .frame(width: geo.size.width * (shown ? min(max(value, 0), 1) : 0))
                }
            }
            .clipShape(Capsule())
            .onAppear { withAnimation(.smooth(duration: 0.5)) { shown = true } }
    }
}

/// A draft pick: a round, blue with a * from a trade, dashed and struck
/// through when traded away. Tap for whose it is.
private struct OfficeChipView: View {
    let chip: OfficeChip
    @State private var showsHint = false

    var body: some View {
        Button {
            showsHint = true
        } label: {
            Text(chip.text)
                .font(.system(size: 11, weight: .heavy))
                .strikethrough(chip.kind == "lost")
                .foregroundStyle(foreground)
                .monospacedDigit()
                .padding(.horizontal, 6)
                .frame(minWidth: 30, minHeight: 22)
                .background(background, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .overlay {
                    if chip.kind == "lost" {
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .strokeBorder(Theme.line2, style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
                    }
                }
        }
        .buttonStyle(.plain)
        .popover(isPresented: $showsHint) {
            Text(chip.hint)
                .font(.footnote.weight(.semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .presentationCompactAdaptation(.popover)
        }
        .accessibilityLabel("Round \(chip.round), \(chip.hint)")
    }

    private var foreground: Color {
        switch chip.kind {
        case "got": return Theme.accentInk
        case "lost": return Theme.ink3
        default: return Theme.ink2
        }
    }

    private var background: Color {
        switch chip.kind {
        case "got": return Theme.accent.opacity(0.14)
        case "lost": return .clear
        default: return Theme.surface3
        }
    }
}

// MARK: Lines

/// A benching, a lost game, a pickup (`.fo-item`). Tapping opens the player
/// it's about (or the game); a long press lists every place it names.
private struct OfficeItemView: View {
    @Environment(\.officePush) private var push
    let item: OfficeItem

    private var primary: LeagueRoute {
        if let pid = item.pid { return .player(id: pid) }
        if let opp = item.opponent, let year = item.team.year, let teamId = item.team.teamId {
            return .boxScore(year: year, week: item.week, a: teamId, b: opp)
        }
        return item.team.route
    }

    var body: some View {
        NavigationLink(value: primary) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(item.title)
                            .font(.system(size: 13.5, weight: .semibold))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(2)
                        if let tag = item.tag { OfficeTag(text: tag, soft: item.tagSoft) }
                    }
                    officeText(item.line)
                        .font(.system(size: 12))
                        .lineSpacing(1.5)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                OfficeBig(value: item.big, sub: item.bigSub, tone: item.tone)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            ForEach(item.players, id: \.pid) { p in
                Button { push(.player(id: p.pid)) } label: { Label(p.name, systemImage: "person") }
            }
            if let opp = item.opponent, let year = item.team.year, let teamId = item.team.teamId {
                Button { push(.boxScore(year: year, week: item.week, a: teamId, b: opp)) } label: {
                    Label("Week \(item.week) box score", systemImage: "list.bullet.rectangle")
                }
            }
            Button { push(item.team.route) } label: { Label(item.team.name, systemImage: "shield") }
            if let year = item.team.year {
                Button { push(.season(year: year, week: item.week)) } label: {
                    Label("Week \(item.week) · \(String(year))", systemImage: "calendar")
                }
            }
        }
    }
}

// MARK: Trades

/// Every trade (`.fo-trade`), twenty at a time.
private struct OfficeTrades: View {
    let trades: [OfficeTrade]
    let store: OfficeStore

    var body: some View {
        let shown = trades.prefix(store.shown)
        LazyVStack(spacing: 0) {
            ForEach(Array(shown.enumerated()), id: \.element.id) { i, trade in
                OfficeTradeView(trade: trade)
                if i < shown.count - 1 { Rectangle().fill(Theme.line).frame(height: 1) }
            }
        }
        if trades.count > shown.count {
            Button {
                store.showMore()
            } label: {
                Text("Show more trades (\(trades.count - shown.count))")
                    .font(.system(size: 13, weight: .bold))
                    .frame(maxWidth: .infinity, minHeight: 28)
            }
            .buttonStyle(.glass)
            .sensoryFeedback(.impact(weight: .light), trigger: store.shown)
            .padding(.horizontal, 12)
            .padding(.top, 8)
            .padding(.bottom, 14)
        }
    }
}

private struct OfficeTradeView: View {
    let trade: OfficeTrade
    @State private var width: CGFloat = 0

    /// The sides side by side where each gets 220 points (`.fo-sides`).
    private var columns: Int {
        guard width > 0 else { return 1 }
        return max(1, min(trade.sides.count, Int((width + 10) / 230)))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Text(trade.head)
                    .font(.system(size: 11.5, weight: .bold))
                    .tracking(0.5)
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.muted)
                Spacer(minLength: 6)
                Text(trade.verdict.text)
                    .font(.system(size: 10.5, weight: .bold))
                    .tracking(0.4)
                    .textCase(.uppercase)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .foregroundStyle(trade.verdict.won ? Theme.green : Theme.ink2)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(trade.verdict.won ? Theme.green.opacity(0.12) : Theme.surface3, in: Capsule())
            }
            Grid(horizontalSpacing: 10, verticalSpacing: 10) {
                ForEach(Array(stride(from: 0, to: trade.sides.count, by: columns)), id: \.self) { start in
                    GridRow(alignment: .top) {
                        ForEach(trade.sides[start..<min(start + columns, trade.sides.count)]) { side in
                            OfficeSideView(side: side)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        }
        .padding(.horizontal, 12)
        .padding(.top, 12)
        .padding(.bottom, 12)
    }
}

private struct OfficeSideView: View {
    let side: OfficeTrade.Side

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            NavigationLink(value: side.who.route) {
                HStack(spacing: 10) {
                    OfficeWhoView(who: side.who)
                    Spacer(minLength: 6)
                    OfficeBig(value: side.total, sub: "pts since", size: 15)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 5) {
                if side.got.isEmpty {
                    Text("Nothing").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Theme.muted)
                }
                ForEach(Array(side.got.enumerated()), id: \.offset) { _, got in
                    gotLine(got)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .leading) {
            if side.winner {
                UnevenRoundedRectangle(topLeadingRadius: 12, bottomLeadingRadius: 12, style: .continuous)
                    .fill(Theme.green)
                    .frame(width: 3)
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(side.winner ? Theme.green.opacity(0.45) : Theme.line)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    @ViewBuilder private func gotLine(_ got: OfficeTrade.Got) -> some View {
        let line = HStack(alignment: .firstTextBaseline, spacing: 10) {
            officeText(got.label, base: Theme.ink2)
                .font(.system(size: 12.5))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(got.value)
                .font(.system(size: 12.5, weight: got.valueMuted ? .semibold : .heavy))
                .foregroundStyle(got.valueMuted ? Theme.muted : Theme.ink)
                .monospacedDigit()
        }
        .contentShape(Rectangle())
        if let pid = got.pid {
            NavigationLink(value: LeagueRoute.player(id: pid)) { line }
                .buttonStyle(.plain)
        } else {
            line
        }
    }
}
