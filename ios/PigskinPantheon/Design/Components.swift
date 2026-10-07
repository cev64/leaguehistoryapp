import Observation
import SwiftUI

// MARK: Team badge

/// A team's mark: its avatar where there is one, otherwise its initial (or
/// emoji) on the manager's colour. The demo's logos are drawn pictures of
/// the team's initials, so they are drawn here the same way, natively.
struct TeamBadge: View {
    let name: String
    let icon: String
    let color: String?
    let logo: String?
    var size: CGFloat = 32
    var corner: CGFloat? = nil

    init(name: String, icon: String, color: String?, logo: String?, size: CGFloat = 32, corner: CGFloat? = nil) {
        self.name = name
        self.icon = icon
        self.color = color
        self.logo = logo
        self.size = size
        self.corner = corner
    }

    init(team: Team, size: CGFloat = 32, corner: CGFloat? = nil) {
        self.init(name: team.name, icon: team.icon, color: team.color, logo: team.logo, size: size, corner: corner)
    }

    init(owner: Owner, size: CGFloat = 32, corner: CGFloat? = nil) {
        self.init(name: owner.currentTeam, icon: owner.icon, color: owner.color, logo: owner.logo, size: size, corner: corner)
    }

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: corner ?? size / 2, style: .continuous)
    }

    private var tint: Color { Color(css: color) ?? Theme.navy2 }

    /// Pictures that load over the network; drawn data URLs (the demo's)
    /// are drawn natively instead.
    private var remoteLogo: URL? {
        #if DEBUG
        // SIMCTL_CHILD_PP_LOGO=<url> gives every team that logo (an ESPN SVG, say).
        if let test = ProcessInfo.processInfo.environment["PP_LOGO"] { return URL(string: test) }
        #endif
        guard let logo, logo.hasPrefix("http"), let url = URL(string: logo) else { return nil }
        return url
    }

    private var mark: String {
        if logo?.hasPrefix("data:image/svg") == true { return Initials.of(name) }
        return icon
    }

    var body: some View {
        ZStack {
            shape.fill(LinearGradient(colors: [tint, Color(hex: 0x0B1220)], startPoint: .topLeading, endPoint: .bottomTrailing))
            shape.strokeBorder(.white.opacity(0.35), lineWidth: max(1, size / 26))
                .padding(size * 0.09)
            Text(mark)
                .font(.system(size: size * (mark.count > 1 ? 0.36 : 0.44), weight: .heavy))
                .foregroundStyle(.white)
                .minimumScaleFactor(0.5)
                .lineLimit(1)
                .padding(size * 0.12)
            if let url = remoteLogo {
                RemoteImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    }
                }
                .frame(width: size, height: size)
                .clipShape(shape)
            }
        }
        .frame(width: size, height: size)
        .overlay(shape.strokeBorder(tint.opacity(0.9), lineWidth: 1.2))
        .accessibilityHidden(true)
    }
}

/// The demo's way of naming a team in two letters (demo.js `initials`).
enum Initials {
    static func of(_ name: String) -> String {
        let words = name.split(whereSeparator: { $0.isWhitespace }).filter { $0.first?.isUppercase == true }
        if words.isEmpty { return String(name.prefix(1)).uppercased() }
        return words.prefix(2).compactMap { $0.first.map(String.init) }.joined().uppercased()
    }
}

// MARK: Cards

/// White on a hairline, with a whisper of shadow (design.css `.card`).
struct Card<Content: View>: View {
    var padding: CGFloat = 0
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous).strokeBorder(Theme.line))
            .shadow(color: Color(hex: 0x101828, alpha: 0.05), radius: 1, y: 1)
    }
}

/// A card's head: the dark chip with its icon, the title in display type,
/// and a quiet note on the right (design.css `.card-head`).
struct CardHead: View {
    let title: String
    var symbol: String? = nil
    var meta: String? = nil

    var body: some View {
        HStack(spacing: 10) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.card)   // reads on the chip in light and dark
                    .frame(width: 24, height: 24)
                    .background(Theme.ink, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            }
            Text(title)
                .displayStyle(20)
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 8)
            if let meta {
                Text(meta)
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

/// The card icons of season.html (CARD_ICONS), as SF Symbols.
enum CardIcon {
    static let standings = "list.bullet"
    static let schedule = "calendar"
    static let rulebook = "book"
    static let toilet = "arrow.down.to.line"
    static let notes = "note.text"
    static let bracket = "point.3.connected.trianglepath.dotted"
    static let versus = "arrow.left.and.right"
    static let document = "doc.text"
    static let shield = "shield"
    static let recap = "text.bubble"
    static let trophy = "trophy.fill"
}

/// A page title with the site's blue rule on its left ("WEEK 8 · 2026").
struct PageTitle: View {
    let text: String
    var body: some View {
        HStack(spacing: 10) {
            Capsule().fill(Theme.accent).frame(width: 5, height: 28)
            Text(text)
                .displayStyle(30)
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .contentTransition(.numericText())
        }
        .accessibilityAddTraits(.isHeader)
    }
}

/// Small label over a value ("W–L / 7–1").
struct StatPair: View {
    let label: String
    let value: String
    var valueColor: Color = Theme.ink
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.ink3).textCase(.uppercase)
            Text(value).font(.system(size: 13, weight: .semibold)).foregroundStyle(valueColor).monospacedDigit()
        }
    }
}

/// A tile of the week's notes (`.superlative`).
struct Superlative: View {
    let label: String
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.system(size: 10.5, weight: .bold)).foregroundStyle(Theme.ink3).textCase(.uppercase).tracking(0.6)
            Text(title).font(.system(size: 14.5, weight: .semibold)).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
            if !detail.isEmpty {
                Text(detail).font(.system(size: 12.5)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

/// An NFL club as its abbreviation on the club's colour (no logos).
struct ClubChip: View {
    let club: String
    var body: some View {
        let hex = NFLClub.colors[club]
        Text(club)
            .font(.system(size: 9.5, weight: .heavy))
            .foregroundStyle(Color.readableInk(on: hex))
            .padding(.horizontal, 4)
            .frame(minWidth: 28, minHeight: 15)
            .background(Color(css: hex) ?? Theme.ink3, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
    }
}

enum NFLClub {
    static let colors: [String: String] = [
        "ARI": "#97233F", "ATL": "#A71930", "BAL": "#241773", "BUF": "#00338D", "CAR": "#0085CA", "CHI": "#0B162A",
        "CIN": "#FB4F14", "CLE": "#311D00", "DAL": "#041E42", "DEN": "#FB4F14", "DET": "#0076B6", "GB": "#203731",
        "HOU": "#03202F", "IND": "#002C5F", "JAX": "#101820", "KC": "#E31837", "LAC": "#0080C6", "LAR": "#003594",
        "LV": "#111111", "MIA": "#008E97", "MIN": "#4F2683", "NE": "#002244", "NO": "#A08A5B", "NYG": "#0B2265",
        "NYJ": "#125740", "PHI": "#004C54", "PIT": "#FFB612", "SEA": "#002244", "SF": "#AA0000", "TB": "#D50A0A",
        "TEN": "#0C2340", "WSH": "#5A1414", "FA": "#8A94A1",
    ]
}

// MARK: States

struct LoadingCard: View {
    let title: String
    var detail: String? = nil
    var body: some View {
        Card {
            VStack(spacing: 10) {
                ProgressView()
                Text(title).font(.headline).foregroundStyle(Theme.ink)
                if let detail { Text(detail).font(.subheadline).foregroundStyle(Theme.ink2).multilineTextAlignment(.center) }
            }
            .frame(maxWidth: .infinity)
            .padding(28)
        }
    }
}

struct EmptyCard: View {
    let title: String
    let detail: String
    var symbol: String = "tray"
    var body: some View {
        Card {
            ContentUnavailableView(title, systemImage: symbol, description: Text(detail))
                .padding(.vertical, 8)
        }
    }
}

// MARK: Layout

/// Cards that sit one to a row on a phone and two (or more) to a row on a
/// wide screen: the unfolded iPhone Duo, an iPad, as the site's desktop does.
struct AdaptiveGrid<Content: View>: View {
    var minWidth: CGFloat = 340
    var spacing: CGFloat = 14
    @ViewBuilder var content: Content

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: minWidth), spacing: spacing, alignment: .top)], spacing: spacing) {
            content
        }
    }
}

/// The page every league screen scrolls on: the site's soft grey, with the
/// content held to a readable width on very wide screens.
struct PageScroll<Content: View>: View {
    var maxWidth: CGFloat = 1180
    /// Hears the page's scroll offset (from the top of its content).
    var onScroll: ((CGFloat) -> Void)? = nil
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) { content }
                .padding(.horizontal, Theme.gutter)
                .padding(.vertical, 12)
                .frame(maxWidth: maxWidth)
                .frame(maxWidth: .infinity)
        }
        .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y + $0.contentInsets.top } action: { _, y in
            onScroll?(y)
        }
        .background(Theme.page)
    }
}

/// Whether a bar should be minimised, the way the tab bar minimises
/// (`.tabBarMinimizeBehavior(.onScrollDown)`): down the page it tucks
/// away, a scroll back up (or reaching the top) brings it back. It hears
/// every frame of a scroll, so only `minimized` is observed: the page is
/// drawn again when the bar changes, not each time the offset does.
@MainActor
@Observable
final class ScrollMinimizer {
    private(set) var minimized = false
    @ObservationIgnored private var last: CGFloat = 0
    @ObservationIgnored private var travel: CGFloat = 0

    /// Brought back by hand (the tucked-away bar was tapped).
    func expand() {
        travel = 0
        set(false)
    }

    func update(_ y: CGFloat) {
        let delta = y - last
        last = y
        if y < 24 { travel = 0; set(false); return }
        // keep counting while the direction holds, start over when it turns
        travel = (travel >= 0) == (delta >= 0) ? travel + delta : delta
        if travel > 14 { set(true) }
        if travel < -14 { set(false) }
    }

    private func set(_ value: Bool) {
        guard value != minimized else { return }
        withAnimation(.spring(response: 0.5, dampingFraction: 0.82)) { minimized = value }
    }
}

/// The taps the app gives back, for the places a modifier can't reach
/// (UIKit gestures, the trophy room's scene). Views use `.sensoryFeedback`.
@MainActor
enum Haptics {
    /// A detent: a stop passed, a choice changed.
    static func select() { UISelectionFeedbackGenerator().selectionChanged() }
    /// Something opened or landed.
    static func tap(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .light) {
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }
}
