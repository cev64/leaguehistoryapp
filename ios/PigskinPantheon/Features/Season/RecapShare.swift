import SwiftUI
import UIKit
import UniformTypeIdentifiers

// Sharing the recap (season.html's openRecap): the recap as text for a
// group chat (recapText) and as two 1080 × 1350 pictures (recapImages):
// the week, and in the regular season the table. The pictures are drawn
// natively here, following the site's canvas drawing line by line.

/// One picture of the recap, shareable as a PNG.
struct RecapPicture: Transferable, Identifiable {
    let id: Int
    let image: UIImage
    let png: Data
    let name: String

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .png) { $0.png }
            .suggestedFileName { $0.name }
    }
}

/// The recap, ready to send: its pictures and its text.
struct RecapShareBundle: Identifiable {
    let id = UUID()
    let week: Int
    let title: String
    let text: String
    let pictures: [RecapPicture]

    @MainActor
    static func make(recap: WeekRecap, season: Season) -> RecapShareBundle {
        let data = recap.share
        var sheets: [AnyView] = [AnyView(RecapWeekSheet(data: data, sheet: data.week, season: season))]
        if let table = data.table {
            sheets.append(AnyView(RecapTableSheet(data: data, sheet: table, season: season)))
        }
        let pictures: [RecapPicture] = sheets.enumerated().compactMap { i, view in
            let renderer = ImageRenderer(content: view.environment(\.colorScheme, .dark))
            renderer.scale = 1
            renderer.proposedSize = ProposedViewSize(width: RecapSheet.W, height: RecapSheet.H)
            guard let image = renderer.uiImage, let png = image.pngData() else { return nil }
            let name = "\(data.fileBase)\(sheets.count > 1 ? "-\(i + 1)" : "").png"
            return RecapPicture(id: i, image: image, png: png, name: name)
        }
        return RecapShareBundle(week: recap.week, title: data.title, text: recap.text, pictures: pictures)
    }
}

/// The recap, previewed, with the ways to send it.
struct RecapShareSheet: View {
    @Environment(\.dismiss) private var dismiss
    let bundle: RecapShareBundle
    @State private var page = 0
    @State private var copied = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                TabView(selection: $page) {
                    ForEach(bundle.pictures) { pic in
                        Image(uiImage: pic.image)
                            .resizable()
                            .aspectRatio(1080.0 / 1350.0, contentMode: .fit)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .shadow(color: .black.opacity(0.25), radius: 12, y: 6)
                            .padding(.horizontal, 24)
                            .tag(pic.id)
                            .accessibilityLabel("Week \(bundle.week) recap\(bundle.pictures.count > 1 ? ", page \(pic.id + 1) of \(bundle.pictures.count)" : "")")
                            .contextMenu {
                                ShareLink(item: pic, preview: SharePreview(pic.name, image: Image(uiImage: pic.image))) {
                                    Label("Share this picture", systemImage: "photo")
                                }
                            }
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: bundle.pictures.count > 1 ? .always : .never))
                .indexViewStyle(.page(backgroundDisplayMode: .always))
                .frame(maxHeight: .infinity)

                if bundle.pictures.count > 1 {
                    Text("\(bundle.pictures.count) pictures: the week, then the power rankings. Swipe to see both.")
                        .font(.footnote)
                        .foregroundStyle(Theme.ink2)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                }

                VStack(spacing: 10) {
                    ShareLink(items: bundle.pictures,
                              subject: Text(bundle.title),
                              message: Text(bundle.text),
                              preview: { pic in SharePreview(pic.name, image: Image(uiImage: pic.image)) }) {
                        Label("Share", systemImage: "square.and.arrow.up")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 4)
                    }
                    .buttonStyle(.glassProminent)

                    HStack(spacing: 10) {
                        Button {
                            UIPasteboard.general.string = bundle.text
                            withAnimation(.snappy) { copied = true }
                            Task {
                                try? await Task.sleep(for: .seconds(1.8))
                                withAnimation(.snappy) { copied = false }
                            }
                        } label: {
                            Label(copied ? "Copied" : "Copy as text", systemImage: copied ? "checkmark" : "doc.on.doc")
                                .contentTransition(.symbolEffect(.replace))
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glass)
                        .sensoryFeedback(.success, trigger: copied) { _, new in new }

                        ShareLink(item: bundle.text, subject: Text(bundle.title)) {
                            Label("Share as text", systemImage: "text.bubble")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glass)
                    }
                    .font(.subheadline.weight(.semibold))
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 8)
            }
            .padding(.top, 8)
            .background(Theme.page)
            .navigationTitle("Week \(bundle.week) recap")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
    }
}

// MARK: - The pictures

/// The drawing kit of recapImages's `sheet()`: the 1080 × 1350 navy page,
/// text placed by its baseline like the canvas's fillText, and the team marks.
enum RecapSheet {
    static let W: CGFloat = 1080
    static let H: CGFloat = 1350
    static let PAD: CGFloat = 72
    static let gold = Color(hex: 0xF6B73C)
    static let soft = Color(hex: 0xDBE5EE, alpha: 0.7)
    static let dim = Color(hex: 0xDBE5EE, alpha: 0.5)
    static let red = Color(hex: 0xD71920)

    static func uiFont(_ size: CGFloat, _ weight: UIFont.Weight, display: Bool) -> UIFont {
        display ? UIFont.systemFont(ofSize: size, weight: weight, width: .condensed) : UIFont.systemFont(ofSize: size, weight: weight)
    }

    static func width(_ text: String, _ font: UIFont) -> CGFloat {
        (text as NSString).size(withAttributes: [.font: font]).width
    }

    /// Words wrapped to `lines` lines at most, the rest run into the last
    /// (which is then cut short), as the canvas `wrap` does.
    static func wrap(_ text: String, font: UIFont, max: CGFloat, lines: Int) -> [String] {
        var out: [String] = []
        var cur = ""
        for w in text.split(whereSeparator: { $0.isWhitespace }).map(String.init) {
            let t = cur.isEmpty ? w : "\(cur) \(w)"
            if width(t, font) <= max || cur.isEmpty { cur = t } else { out.append(cur); cur = w }
        }
        if !cur.isEmpty { out.append(cur) }
        var shown = Array(out.prefix(lines))
        if out.count > lines { shown[lines - 1] = ([shown[lines - 1]] + out[lines...]).joined(separator: " ") }
        return shown
    }
}

/// A line of text set like the canvas's fillText: x, the baseline y, a
/// maximum width (cut short with an ellipsis) and an alignment.
private struct SheetText: View {
    enum Align { case left, center, right }
    let text: String
    let x: CGFloat
    let y: CGFloat
    let size: CGFloat
    var weight: Font.Weight = .regular
    var color: Color = .white
    var max: CGFloat = RecapSheet.W - RecapSheet.PAD * 2
    var align: Align = .left
    var display = false

    var body: some View {
        let boxH = size * 1.4
        Text(text)
            .font(display ? .display(size, weight: weight) : .system(size: size, weight: weight))
            .foregroundStyle(color)
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(width: max, height: boxH, alignment: align == .left ? .leading : align == .right ? .trailing : .center)
            .offset(x: align == .left ? x : align == .right ? x - max : x - max / 2,
                    y: y - size * (display ? 1.0 : 1.05))
    }
}

private struct SheetBox: View {
    let x: CGFloat, y: CGFloat, w: CGFloat, h: CGFloat
    var fill: Color = .white.opacity(0.06)
    var radius: CGFloat = 16
    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(fill)
            .frame(width: w, height: h)
            .offset(x: x, y: y)
    }
}

/// A team as a coloured disc with its first letter (the canvas `badge`).
private struct SheetBadge: View {
    let team: Team?
    let x: CGFloat, cy: CGFloat, size: CGFloat
    var body: some View {
        ZStack {
            Circle().fill(Color(css: team?.color) ?? Color(hex: 0x304F91))
            Text(String(team?.name.trimmingCharacters(in: .whitespaces).first ?? "?"))
                .font(.system(size: (size * 0.5).rounded(), weight: .bold))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
        .offset(x: x, y: cy - size / 2)
    }
}

/// The page: gradient, red rule, league, title, kicker and the footer.
private struct SheetFrame<Content: View>: View {
    let league: String
    let host: String
    let title: String
    let kicker: String
    @ViewBuilder var content: Content

    var body: some View {
        let P = RecapSheet.PAD, W = RecapSheet.W, H = RecapSheet.H
        ZStack(alignment: .topLeading) {
            LinearGradient(stops: [.init(color: Color(hex: 0x102B43), location: 0),
                                   .init(color: Color(hex: 0x071827), location: 0.35),
                                   .init(color: Color(hex: 0x050F1A), location: 1)],
                           startPoint: .top, endPoint: .bottom)
                .frame(width: W, height: H)
            Rectangle().fill(RecapSheet.red).frame(width: W, height: 10)
            SheetText(text: league.uppercased(), x: P, y: P + 30, size: 30, weight: .bold, color: RecapSheet.gold)
            SheetText(text: title, x: P, y: P + 30 + 92, size: 104, weight: .bold, display: true)
            SheetText(text: kicker, x: P, y: P + 30 + 92 + 46, size: 28, weight: .semibold, color: RecapSheet.soft)
            content
            Rectangle().fill(.white.opacity(0.12)).frame(width: W - P * 2, height: 2).offset(x: P, y: H - P - 34)
            SheetText(text: "PIGSKIN PANTHEON", x: P, y: H - P + 6, size: 24, weight: .bold, color: Color(hex: 0xDBE5EE, alpha: 0.75))
            SheetText(text: host, x: W - P, y: H - P + 6, size: 24, weight: .medium, color: RecapSheet.dim, max: 500, align: .right)
        }
        .frame(width: W, height: H, alignment: .topLeading)
        .clipped()
    }

    /// Where a sheet's content starts (`top` in the canvas code).
    static var top: CGFloat { RecapSheet.PAD + 30 + 92 + 46 + 44 }
}

/// Tiles two to a row, as many as fit above the footer.
private struct SheetTiles: View {
    let tiles: [WeekRecap.ShareTile]
    let y: CGFloat

    var body: some View {
        let P = RecapSheet.PAD, W = RecapSheet.W
        let tw = (W - P * 2 - 24) / 2, th: CGFloat = 126, bottom = RecapSheet.H - P - 60
        ZStack(alignment: .topLeading) {
            ForEach(Array(rows.enumerated()), id: \.offset) { r, row in
                let top = y + CGFloat(r) * th
                if top + th <= bottom {
                    ForEach(Array(row.enumerated()), id: \.offset) { k, t in
                        let fx = P + CGFloat(k) * (tw + 24)
                        SheetBox(x: fx, y: top, w: tw, h: th - 14, fill: .white.opacity(0.05))
                        SheetText(text: t.label, x: fx + 20, y: top + 36, size: 20, weight: .bold, color: RecapSheet.gold, max: tw - 40)
                        SheetText(text: t.title, x: fx + 20, y: top + 70, size: 26, weight: .bold, max: tw - 40)
                        SheetText(text: t.detail, x: fx + 20, y: top + 99, size: 21, weight: .medium, color: RecapSheet.soft, max: tw - 40)
                    }
                }
            }
        }
    }

    private var rows: [[WeekRecap.ShareTile]] {
        stride(from: 0, to: tiles.count, by: 2).map { Array(tiles[$0..<min($0 + 2, tiles.count)]) }
    }
}

/// 1 · the week: headline, scores and players.
struct RecapWeekSheet: View {
    let data: WeekRecap.ShareData
    let sheet: WeekRecap.WeekSheet
    let season: Season

    var body: some View {
        let P = RecapSheet.PAD, W = RecapSheet.W
        let layout = self.layout
        SheetFrame<AnyView>(league: data.league, host: data.host, title: sheet.title, kicker: sheet.kicker) {
            AnyView(ZStack(alignment: .topLeading) {
                if sheet.headline != nil {
                    SheetBox(x: P, y: layout.ruleY, w: W - P * 2, h: 10, fill: RecapSheet.red, radius: 4)
                    ForEach(Array(layout.titleLines.enumerated()), id: \.offset) { i, line in
                        SheetText(text: line, x: P, y: layout.titleY + CGFloat(i) * 62, size: 62, weight: .bold, display: true)
                    }
                    ForEach(Array(layout.dekLines.enumerated()), id: \.offset) { i, line in
                        SheetText(text: line, x: P, y: layout.dekY + CGFloat(i) * 36, size: 26, weight: .medium, color: RecapSheet.soft)
                    }
                    ForEach(Array(sheet.also.enumerated()), id: \.offset) { i, t in
                        let y = layout.alsoY + CGFloat(i) * 36
                        Circle().fill(RecapSheet.red).frame(width: 10, height: 10).offset(x: P + 1, y: y - 1)
                        SheetText(text: t, x: P + 24, y: y + 13, size: 24, weight: .semibold, color: .white.opacity(0.88), max: W - P * 2 - 24)
                    }
                }
                games(y: layout.gamesY)
                SheetTiles(tiles: sheet.tiles, y: layout.tilesY)
            })
        }
    }

    private struct Layout {
        var ruleY: CGFloat = 0, titleY: CGFloat = 0, dekY: CGFloat = 0, alsoY: CGFloat = 0
        var titleLines: [String] = [], dekLines: [String] = []
        var gamesY: CGFloat = 0, tilesY: CGFloat = 0
    }

    private var cols: Int { sheet.games.count > 4 ? 2 : 1 }
    private var rowH: CGFloat { cols == 2 ? 92 : 104 }

    private var layout: Layout {
        let P = RecapSheet.PAD, W = RecapSheet.W
        var l = Layout()
        var y = SheetFrame<EmptyView>.top
        if let h = sheet.headline {
            l.ruleY = y
            y += 64
            l.titleY = y
            l.titleLines = RecapSheet.wrap(h.title, font: RecapSheet.uiFont(62, .bold, display: true), max: W - P * 2, lines: 2)
            y += CGFloat(l.titleLines.count) * 62
            l.dekY = y - 12
            l.dekLines = RecapSheet.wrap(h.dek, font: RecapSheet.uiFont(26, .medium, display: false), max: W - P * 2, lines: 2)
            y += CGFloat(l.dekLines.count) * 36
            l.alsoY = y
            y += CGFloat(sheet.also.count) * 36
            y += 14
        }
        l.gamesY = y
        let n = sheet.games.count
        y += CGFloat((n + cols - 1) / cols) * (rowH + 12) + 14
        l.tilesY = y
        return l
    }

    @ViewBuilder private func games(y: CGFloat) -> some View {
        let P = RecapSheet.PAD, W = RecapSheet.W
        let colW = (W - P * 2 - CGFloat(cols - 1) * 24) / CGFloat(cols)
        ForEach(Array(sheet.games.enumerated()), id: \.offset) { i, g in
            let col = cols == 2 ? i % 2 : 0, row = cols == 2 ? i / 2 : i
            let x = P + CGFloat(col) * (colW + 24), top = y + CGFloat(row) * (rowH + 12)
            SheetBox(x: x, y: top, w: colW, h: rowH)
            line(g.w, g.ws, x: x, colW: colW, cy: top + rowH * (cols == 2 ? 0.3 : 0.24), win: !g.tie)
            line(g.l, g.ls, x: x, colW: colW, cy: top + rowH * (cols == 2 ? 0.72 : 0.56), win: false)
            if cols == 1 && !g.note.isEmpty {
                SheetText(text: g.note, x: x + 56, y: top + rowH - 12, size: 19, weight: .medium, color: RecapSheet.gold, max: colW - 72)
            }
        }
    }

    @ViewBuilder private func line(_ id: String, _ score: Double, x: CGFloat, colW: CGFloat, cy: CGFloat, win: Bool) -> some View {
        let loser = Color(hex: 0xDBE5EE, alpha: 0.6)
        SheetBadge(team: season.team(id), x: x + 16, cy: cy, size: 28)
        SheetText(text: season.team(id)?.name ?? id, x: x + 56, y: cy + 9, size: 25, weight: win ? .bold : .medium, color: win ? .white : loser, max: colW - 56 - 110)
        SheetText(text: Fmt.pts(score), x: x + colW - 16, y: cy + 9, size: 27, weight: .bold, color: win ? RecapSheet.gold : loser, max: 110, align: .right)
    }
}

/// 2 · the table: the power rankings and the numbers.
struct RecapTableSheet: View {
    let data: WeekRecap.ShareData
    let sheet: WeekRecap.TableSheet
    let season: Season

    var body: some View {
        let P = RecapSheet.PAD, W = RecapSheet.W, H = RecapSheet.H
        let y0 = SheetFrame<EmptyView>.top + 8
        let rows = Array(sheet.rows.prefix(14))
        let rowH = min(62, ((H - y0 - P - 420) / CGFloat(max(rows.count, 1))).rounded(.down))
        let y = y0 + 14
        let nameW = W - P * 2 - 164 - 340
        let bottom = H - P - 60
        SheetFrame<AnyView>(league: data.league, host: data.host, title: sheet.title, kicker: sheet.kicker) {
            AnyView(ZStack(alignment: .topLeading) {
                SheetText(text: "RECORD", x: W - P - 190, y: y0, size: 18, weight: .bold, color: RecapSheet.dim, max: 120, align: .right)
                SheetText(text: "ALL-PLAY", x: W - P, y: y0, size: 18, weight: .bold, color: RecapSheet.dim, max: 140, align: .right)
                ForEach(Array(rows.enumerated()), id: \.offset) { i, p in
                    let top = y + CGFloat(i) * rowH, cy = top + rowH / 2
                    if i % 2 == 0 {
                        SheetBox(x: P - 12, y: top, w: W - P * 2 + 24, h: rowH, fill: .white.opacity(0.04), radius: 12)
                    }
                    SheetText(text: "\(p.rank)", x: P + 22, y: cy + 10, size: 28, weight: .bold, color: i < 3 ? RecapSheet.gold : .white, max: 50, align: .center)
                    SheetText(text: p.move > 0 ? "▲\(p.move)" : p.move < 0 ? "▼\(-p.move)" : "–", x: P + 82, y: cy + 8, size: 20, weight: .bold,
                              color: p.move > 0 ? Color(hex: 0x3CCF7A) : p.move < 0 ? Color(hex: 0xFF6B6B) : RecapSheet.dim, max: 56, align: .center)
                    SheetBadge(team: season.team(p.id), x: P + 120, cy: cy, size: 30)
                    SheetText(text: season.team(p.id)?.name ?? p.id, x: P + 164, y: cy + 9, size: 26, weight: .semibold, max: nameW)
                    Rectangle().fill(Color(hex: 0xF6B73C, alpha: 0.35))
                        .frame(width: max(1, nameW * p.bar), height: 3)
                        .offset(x: P + 164, y: cy + 18)
                    SheetText(text: p.record, x: W - P - 190, y: cy + 9, size: 26, weight: .bold, max: 120, align: .right)
                    SheetText(text: p.apRecord, x: W - P, y: cy + 9, size: 24, weight: .medium, color: RecapSheet.soft, max: 140, align: .right)
                }
                SheetTiles(tiles: sheet.tiles, y: y + CGFloat(rows.count) * rowH + 30)
                SheetText(text: sheet.foot, x: P, y: bottom + 4, size: 19, weight: .medium, color: RecapSheet.dim)
            })
        }
    }
}
