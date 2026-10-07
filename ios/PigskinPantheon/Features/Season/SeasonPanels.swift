import SwiftUI

// Pieces the season's standings, bracket and schedule-strength panels share
// (StandingsPanel.swift, BracketPanel.swift, SOSPanel.swift): reading a
// Bridge.season answer for a panel, the standings markers (seed, clinch
// letter, the tiebreak "why" dot and its popover), a wrapping row, and the
// round titles the brackets use.

// MARK: Reading a panel's data

/// Every panel answer read this session, by engine and call, so going back
/// to a week (or a view) shows it at once. A league's answers don't change
/// while its engine is open; a new session has a new engine.
@MainActor
enum PanelCache {
    static var answers: [String: Any] = [:]
}

/// Reads one Bridge call for a panel and draws it, with the loading card
/// while it's read and the reason if it can't be.
struct PanelLoader<Value: Decodable, Content: View>: View {
    @Environment(LeagueSession.self) private var session
    let expression: String
    let arguments: [String: Any]
    let loadingTitle: String
    var failureTitle: String = "This view couldn't be read"
    @ViewBuilder let content: (Value) -> Content

    @State private var value: Value?
    @State private var error: String?

    private var key: String {
        let args = arguments.keys.sorted().map { "\($0)=\(String(describing: arguments[$0]!))" }.joined(separator: "&")
        return "\(ObjectIdentifier(session.engine).hashValue)|\(expression)|\(args)"
    }

    var body: some View {
        let key = self.key
        Group {
            if let shown = value ?? (PanelCache.answers[key] as? Value) {
                content(shown)
            } else if let error {
                EmptyCard(title: failureTitle, detail: error, symbol: "exclamationmark.triangle")
            } else {
                LoadingCard(title: loadingTitle)
            }
        }
        .task(id: key) {
            if let hit = PanelCache.answers[key] as? Value { value = hit; return }
            value = nil
            error = nil
            do {
                let answer = try await session.engine.call(Value.self, expression, arguments)
                PanelCache.answers[key] = answer
                value = answer
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

// MARK: Standings markers

/// A clinch letter (CLINCH_KEY): z, x or e.
struct ClinchFlag: Decodable, Hashable {
    let label: String
    let kind: String
    let title: String
}

/// The tiebreaks a team was caught in, as the page's popover lists them.
struct WhyInfo: Decodable, Hashable {
    struct Entry: Decodable, Hashable {
        let head: String
        let detail: String
        let foot: String?
    }
    let title: String
    let entries: [Entry]
}

/// A key of the standings legend (standingsLegend).
struct LegendKey: Decodable, Hashable {
    /// "seed", "clinch" or "why"
    let kind: String
    /// seed: "lead", "div", "wc", "out"; clinch: "z", "x", "e"
    let cls: String
    let tag: String
    let text: String
}

/// The seed chip at the end of a team's line: "#1" in navy for a bye,
/// blue for a division leader (or any seed without divisions), gold for a
/// wild card, grey outside the field.
struct SeedChip: View {
    let chip: String
    /// "lead", "div", "wc" or "out"
    let style: String

    init(chip: String, style: String) {
        self.chip = chip
        self.style = style
    }

    init(_ label: SeedLabel) {
        self.init(chip: label.chip, style: label.kind == "div" && label.lead == true ? "lead" : label.kind)
    }

    private var colors: (Color, Color) {
        switch style {
        case "lead": return (Theme.ink, Theme.card)
        case "div": return (Theme.accentSoft, Theme.accentInk)
        case "wc": return (Theme.goldSoft, Theme.goldInk)
        default: return (Theme.surface3, Theme.ink3)
        }
    }

    var body: some View {
        let (bg, fg) = colors
        Text(chip)
            .font(.system(size: 10, weight: .bold))
            .tracking(0.2)
            .monospacedDigit()
            .foregroundStyle(fg)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .frame(minWidth: 30)
            .background(bg, in: Capsule())
    }
}

/// A clinch letter in its round chip.
struct ClinchChip: View {
    let kind: String
    let label: String

    private var colors: (Color, Color) {
        switch kind {
        case "z": return (Theme.green.opacity(0.16), Theme.green)
        case "x": return (Theme.accentSoft, Theme.accentInk)
        default: return (Theme.surface3, Theme.ink3)
        }
    }

    var body: some View {
        let (bg, fg) = colors
        Text(label)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(fg)
            .frame(width: 17, height: 17)
            .background(bg, in: Circle())
    }
}

/// The "i" that names a tiebreak, drawn as the site draws it (an italic
/// serif in a ringed dot), filled in while its popover is open.
struct WhyDot: View {
    var open: Bool = false
    var body: some View {
        Text("i")
            .font(.system(size: 10, weight: .bold, design: .serif))
            .italic()
            .foregroundStyle(open ? Theme.card : Theme.ink3)
            .frame(width: 17, height: 17)
            .background(Circle().fill(open ? Theme.ink : Theme.card))
            .overlay(Circle().strokeBorder(open ? Theme.ink : Theme.line2, lineWidth: 1))
    }
}

/// The tiebreak dot as a button, with its explanation in a popover.
struct WhyButton: View {
    let teamName: String
    let info: WhyInfo
    @State private var open = false

    var body: some View {
        Button {
            open.toggle()
        } label: {
            WhyDot(open: open)
                .frame(width: 26, height: 26)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(-4)
        .accessibilityLabel("Tiebreakers involving \(teamName)")
        .sensoryFeedback(.impact(weight: .light), trigger: open)
        .popover(isPresented: $open, attachmentAnchor: .rect(.bounds), arrowEdge: .top) {
            WhyPopover(info: info)
                .presentationCompactAdaptation(.popover)
        }
    }
}

/// The page's why-pop: "Team · 1 tiebreak", then each race, what decided
/// it, and where it left the team.
struct WhyPopover: View {
    let info: WhyInfo

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(info.title)
                .font(.system(size: 11, weight: .bold))
                .tracking(0.6)
                .textCase(.uppercase)
                .foregroundStyle(Theme.ink3)
                .padding(.bottom, 10)
            ForEach(Array(info.entries.enumerated()), id: \.offset) { index, entry in
                if index > 0 { Divider().overlay(Theme.line).padding(.vertical, 10) }
                VStack(alignment: .leading, spacing: 5) {
                    Text(entry.head)
                        .font(.system(size: 13.5, weight: .bold))
                        .foregroundStyle(Theme.ink)
                    Text(entry.detail)
                        .font(.system(size: 12.5))
                        .foregroundStyle(Theme.ink2)
                    if let foot = entry.foot {
                        Text(foot)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.accentInk)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .frame(width: 300, alignment: .leading)
    }
}

/// A team's markers, as the page orders them: the clinch letter, the
/// tiebreak dot, the seed last.
struct TeamMarkers: View {
    let teamName: String
    let seed: SeedLabel?
    let flag: ClinchFlag?
    let why: WhyInfo?

    var isEmpty: Bool { seed == nil && flag == nil && why == nil }

    var body: some View {
        HStack(spacing: 5) {
            if let flag {
                ClinchChip(kind: flag.kind, label: flag.label)
                    .help(flag.title)
                    .accessibilityLabel(flag.title)
            }
            if let why {
                WhyButton(teamName: teamName, info: why)
            }
            if let seed {
                SeedChip(seed)
                    .help(seed.note)
                    .accessibilityLabel("\(seed.chip) seed, \(seed.note)")
            }
        }
    }
}

/// The legend under the standings (standingsLegend).
struct StandingsLegendView: View {
    let keys: [LegendKey]

    var body: some View {
        PanelFlow(spacing: 16, lineSpacing: 8) {
            ForEach(keys, id: \.self) { key in
                HStack(spacing: 6) {
                    switch key.kind {
                    case "seed": SeedChip(chip: key.tag, style: key.cls)
                    case "clinch": ClinchChip(kind: key.cls, label: key.tag)
                    default: WhyDot()
                    }
                    Text(key.text)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.ink2)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 2)
    }
}

// MARK: Layout helpers

/// Pieces in a row that wraps onto the next line when it runs out of room.
struct PanelFlow: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let limit = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > limit {
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
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > bounds.width {
                y += line + lineSpacing
                x = 0
                line = 0
            }
            view.place(at: CGPoint(x: bounds.minX + x, y: bounds.minY + y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}

/// A row that opens somewhere when tapped, tinted while it's pressed. Used
/// as a row's background so the markers on top keep their own taps.
struct PanelRowPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Theme.surface2 : Color.clear)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

extension View {
    /// Makes the whole row open a team's season, behind whatever on it has
    /// its own taps (the tiebreak dot). The row's own content should not be
    /// hit-testable (`.allowsHitTesting(false)`) so taps fall through to it.
    func rowLink(_ route: LeagueRoute, label: String) -> some View {
        background {
            NavigationLink(value: route) {
                Rectangle().fill(Color.clear).contentShape(Rectangle())
            }
            .buttonStyle(PanelRowPressStyle())
            .accessibilityLabel(label)
        }
    }
}

/// "ROUND 1 · NFL WEEK 15": a round's name over its games.
struct RoundTitle: View {
    let title: String
    let weeks: String
    var centered: Bool = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text(title).foregroundStyle(Theme.ink2)
            if !weeks.isEmpty {
                Text(" · \(weeks)").foregroundStyle(Theme.ink3)
            }
        }
        .font(.system(size: 11, weight: .bold))
        .tracking(0.9)
        .textCase(.uppercase)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .frame(maxWidth: centered ? nil : .infinity, alignment: .leading)
    }
}

/// A player's NFL club chip with a hairline round it, so the darkest club
/// colours (Chicago, Houston, Dallas…) still read as a chip on a dark card.
struct ClubTag: View {
    let club: String
    var body: some View {
        ClubChip(club: club)
            .lineLimit(1)
            .fixedSize()
            .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(Theme.line2.opacity(0.7), lineWidth: 0.75))
    }
}

/// A small tag (the page's rule-tag).
struct RuleTag: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 11.5, weight: .semibold))
            .foregroundStyle(Theme.ink2)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Theme.surface2, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.line))
    }
}

