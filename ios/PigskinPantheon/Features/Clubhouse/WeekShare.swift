import SwiftUI
import UIKit

// "Share the week": the week's story as one 1080 × 1350 picture for the
// league's group chat (the high and low scores, the blowout and the closest
// game, the top of the standings and who moved, the bench blunder, and once
// they're in, the awards and the pick'em winner), drawn in SwiftUI and
// rendered with ImageRenderer, then sent with the share sheet.

/// "Share the week", made on a tap (the Recap lead's Share menu, beside
/// "Share the recap"): the picture drawn, then previewed in a sheet with
/// the share sheet a tap away.
@MainActor
@Observable
final class WeekShare {
    var picture: RecapPicture?
    private(set) var preparing = false
    private(set) var failed = false

    func make(store: ClubhouseStore, season: Season, week: Int) {
        guard !preparing else { return }
        preparing = true
        failed = false
        Task { @MainActor in
            await store.prepare(year: season.year)
            guard let data = try? await store.share(year: season.year, week: week) else {
                preparing = false
                failed = true
                return
            }
            picture = Self.render(data: data, season: season)
            failed = picture == nil
            preparing = false
        }
    }

    @MainActor
    static func render(data: WeekShareData, season: Season) -> RecapPicture? {
        let renderer = ImageRenderer(content: WeekShareCanvas(data: data, season: season).environment(\.colorScheme, .dark))
        renderer.scale = 1
        renderer.proposedSize = ProposedViewSize(width: WeekShareCanvas.W, height: WeekShareCanvas.H)
        guard let image = renderer.uiImage, let png = image.pngData() else { return nil }
        let slug = data.league.lowercased().replacingOccurrences(of: #"[^a-z0-9]+"#, with: "-", options: .regularExpression)
        #if DEBUG
        try? png.write(to: URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("week-share.png"))
        #endif
        return RecapPicture(id: data.week, image: image, png: png, name: "\(slug)-week-\(data.week).png")
    }
}

/// The picture, previewed, with the share sheet a tap away.
struct WeekShareSheet: View {
    @Environment(\.dismiss) private var dismiss
    let picture: RecapPicture
    let week: Int

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Image(uiImage: picture.image)
                    .resizable()
                    .aspectRatio(WeekShareCanvas.W / WeekShareCanvas.H, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .shadow(color: .black.opacity(0.25), radius: 12, y: 6)
                    .padding(.horizontal, 24)
                    .frame(maxHeight: .infinity)
                    .accessibilityLabel("The week \(week) picture")
                ShareLink(item: picture, preview: SharePreview(picture.name, image: Image(uiImage: picture.image))) {
                    Label("Share", systemImage: "square.and.arrow.up")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                }
                .buttonStyle(Felt(.glassProminent))
                .padding(.horizontal, 20)
                .padding(.bottom, 8)
            }
            .padding(.top, 8)
            .background(Theme.page)
            .navigationTitle("Week \(week)")
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

// MARK: - The picture

/// 1080 × 1350, in the recap pictures' design: navy, the red rule, the
/// league in gold, the week in the display type, white tiles.
struct WeekShareCanvas: View {
    static let W: CGFloat = 1080
    static let H: CGFloat = 1350
    static let P: CGFloat = 72
    let data: WeekShareData
    let season: Season

    private let gold = Color(hex: 0xF6B73C)
    private let soft = Color(hex: 0xDBE5EE, alpha: 0.72)
    private let dim = Color(hex: 0xDBE5EE, alpha: 0.5)
    private let red = Color(hex: 0xD71920)

    private func name(_ id: String) -> String { season.team(id)?.name ?? id }

    /// How much there is to fit, so the sections share the height.
    private var extras: Int { (data.awards != nil ? 1 : 0) + (data.pickWinner != nil ? 1 : 0) + (data.blunder != nil ? 1 : 0) }

    var body: some View {
        ZStack(alignment: .topLeading) {
            LinearGradient(stops: [.init(color: Color(hex: 0x102B43), location: 0),
                                   .init(color: Color(hex: 0x071827), location: 0.38),
                                   .init(color: Color(hex: 0x050F1A), location: 1)],
                           startPoint: .top, endPoint: .bottom)
            Rectangle().fill(red).frame(height: 10)
            VStack(alignment: .leading, spacing: extras >= 3 ? 22 : 30) {
                header
                tiles
                standings
                if let blunder = data.blunder { blunderRow(blunder) }
                if let awards = data.awards { awardsRow(awards) }
                if let pick = data.pickWinner { pickRow(pick) }
                Spacer(minLength: 0)
                footer
            }
            .padding(.horizontal, Self.P)
            .padding(.top, Self.P - 4)
            .padding(.bottom, Self.P - 16)
        }
        .frame(width: Self.W, height: Self.H)
        .clipped()
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(data.league.uppercased())
                .font(.system(size: 30, weight: .bold))
                .tracking(2)
                .foregroundStyle(gold)
                .lineLimit(1)
            Text(data.title.uppercased())
                .font(.display(118, weight: .heavy))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(data.kicker)
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(soft)
        }
    }

    // The week's four notes, two by two.
    private var tiles: some View {
        let cols = [GridItem(.flexible(), spacing: 22), GridItem(.flexible(), spacing: 22)]
        return LazyVGrid(columns: cols, alignment: .leading, spacing: 22) {
            if let h = data.high { tile("High score", team: h.team, title: name(h.team), detail: h.score) }
            if let l = data.low { tile("Low score", team: l.team, title: name(l.team), detail: l.score) }
            if let b = data.blowout { tile("Biggest blowout", team: b.winner, title: name(b.winner), detail: "over \(name(b.loser)) by \(b.margin)") }
            if let c = data.closest { tile("Closest game", team: c.winner, title: name(c.winner), detail: "over \(name(c.loser)) by \(c.margin)") }
        }
    }

    private func tile(_ label: String, team: String, title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(label.uppercased())
                .font(.system(size: 20, weight: .bold))
                .tracking(1.2)
                .foregroundStyle(gold)
            HStack(spacing: 14) {
                badge(team, 46)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 30, weight: .bold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    Text(detail)
                        .font(.system(size: 23, weight: .medium))
                        .foregroundStyle(soft)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var standings: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("THE STANDINGS")
                .font(.system(size: 20, weight: .bold))
                .tracking(1.2)
                .foregroundStyle(gold)
            VStack(spacing: 10) {
                ForEach(data.standings, id: \.self) { s in
                    HStack(spacing: 18) {
                        Text("\(s.rank)")
                            .font(.display(40, weight: .heavy))
                            .foregroundStyle(s.rank == 1 ? gold : .white)
                            .frame(width: 40)
                        badge(s.team, 44)
                        Text(name(s.team))
                            .font(.system(size: 31, weight: .bold))
                            .foregroundStyle(.white)
                            .lineLimit(1)
                        Spacer(minLength: 12)
                        Text(s.record)
                            .font(.system(size: 30, weight: .bold))
                            .monospacedDigit()
                            .foregroundStyle(.white)
                        Text(s.move > 0 ? "▲\(s.move)" : s.move < 0 ? "▼\(-s.move)" : "–")
                            .font(.system(size: 22, weight: .bold))
                            .foregroundStyle(s.move > 0 ? Color(hex: 0x3CCF7A) : s.move < 0 ? Color(hex: 0xFF6B6B) : dim)
                            .frame(width: 56, alignment: .trailing)
                    }
                    .padding(.horizontal, 22)
                    .padding(.vertical, 10)
                    .background(.white.opacity(s.rank % 2 == 1 ? 0.05 : 0.02), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
            if !movers.isEmpty {
                HStack(spacing: 28) {
                    ForEach(movers, id: \.self) { line in
                        Text(line)
                            .font(.system(size: 23, weight: .semibold))
                            .foregroundStyle(soft)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                }
            }
        }
    }

    private var movers: [String] {
        var parts: [String] = []
        if let r = data.riser { parts.append("▲ \(name(r.team)) up \(r.move) to \(Fmt.ordinal(r.rank))") }
        if let f = data.faller { parts.append("▼ \(name(f.team)) down \(-f.move) to \(Fmt.ordinal(f.rank))") }
        return parts
    }

    /// "London Calling", "A & B", or "A and 2 others".
    private func names(_ ids: [String]) -> String {
        switch ids.count {
        case 0: return ""
        case 1, 2: return ids.map(name).joined(separator: " & ")
        default: return "\(name(ids[0])) and \(ids.count - 1) others"
        }
    }

    private func blunderRow(_ b: WeekShareData.Blunder) -> some View {
        HStack(spacing: 16) {
            badge(b.team, 44)
            VStack(alignment: .leading, spacing: 3) {
                Text("BENCH BLUNDER")
                    .font(.system(size: 19, weight: .bold))
                    .tracking(1.2)
                    .foregroundStyle(gold)
                Text("\(name(b.team)) benched \(b.benched): \(b.pts) on the bench\(b.costGame ? ", and it cost the game" : "")")
                    .font(.system(size: 25, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func awardsRow(_ awards: [WeekShareData.AwardWinner]) -> some View {
        HStack(spacing: 18) {
            ForEach(awards, id: \.self) { a in
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(a.emoji) \(a.title.uppercased())")
                        .font(.system(size: 17, weight: .bold))
                        .tracking(0.6)
                        .foregroundStyle(gold)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    HStack(spacing: 10) {
                        if let first = a.teams.first { badge(first, 34) }
                        Text(names(a.teams))
                            .font(.system(size: 24, weight: .bold))
                            .foregroundStyle(.white)
                            .lineLimit(2)
                            .minimumScaleFactor(0.75)
                    }
                }
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
    }

    private func pickRow(_ p: WeekShareData.PickWinner) -> some View {
        HStack(spacing: 14) {
            Text("👑").font(.system(size: 34))
            Text("PICK'EM")
                .font(.system(size: 20, weight: .bold))
                .tracking(1.2)
                .foregroundStyle(gold)
            Text("\(names(p.teams)) went \(p.correct) for \(p.games)")
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
    }

    private var footer: some View {
        VStack(spacing: 18) {
            Rectangle().fill(.white.opacity(0.12)).frame(height: 2)
            HStack {
                Text("PIGSKIN PANTHEON")
                    .font(.system(size: 24, weight: .bold))
                    .tracking(1.5)
                    .foregroundStyle(Color(hex: 0xDBE5EE, alpha: 0.75))
                Spacer()
                Text(data.host)
                    .font(.system(size: 24, weight: .medium))
                    .foregroundStyle(dim)
            }
        }
    }

    /// A team's mark drawn from its colour and initials (pictures from the
    /// network don't draw in a rendered image).
    private func badge(_ id: String, _ size: CGFloat) -> some View {
        let t = season.team(id)
        return TeamBadge(name: t?.name ?? id, icon: t.map { $0.logo?.hasPrefix("data:image/svg") == true || $0.logo?.hasPrefix("http") == true ? Initials.of($0.name) : $0.icon } ?? "?",
                         color: t?.color, logo: nil, size: size)
    }
}
