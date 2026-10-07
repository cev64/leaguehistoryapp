import SwiftUI

/// Bars down the side, for a compact screen that is wider than it is tall:
/// the folded iPhone Duo's outer display, or any iPhone turned sideways.
///
/// Apple's guidance for the Duo moves tab bars and toolbars to the side of
/// the screen ("vertical bars"), each item shown by its icon. Apps built
/// with the iOS 27.1 SDK get that from the system's own TabView and
/// toolbars; until the app is built with it, this rail of Liquid Glass does
/// the same, and steps aside once the system takes over.
enum SideRailLayout {
    static func applies(sizeClass: UserInterfaceSizeClass?, size: CGSize) -> Bool {
        if DebugLaunch.forceSideRail { return true }
        // Built with the iOS 27 SDKs (Xcode 27 ships Swift 6.4; Xcode 26.x is
        // 6.2 to 6.3) and running on iOS 27.1 or later, the system lays its
        // own bars vertically, so this rail steps aside.
        #if compiler(>=6.4)
        if #available(iOS 27.1, *) { return false }
        #endif
        return sizeClass == .compact && size.width > size.height * 1.05
    }
}

extension EnvironmentValues {
    /// True while the league's tabs are drawn as a rail down the side.
    @Entry var sideRail: Bool = false
}

extension View {
    /// The system tab bar steps aside while the side rail is showing.
    func sideRailHidesTabBar(_ rail: Bool) -> some View {
        toolbar(rail ? .hidden : .automatic, for: .tabBar)
    }
}

/// The league's tabs, the search and the league AI as a column of glass
/// buttons, icons only, as vertical bars present them.
struct SideRail: View {
    @Environment(LeagueSession.self) private var session
    @Binding var tab: LeagueTab
    @Namespace private var glass

    private struct Item: Identifiable {
        let tab: LeagueTab
        let title: String
        let symbol: String
        var id: String { title }
    }

    private let items: [Item] = [
        Item(tab: .season, title: "Season", symbol: "calendar"),
        Item(tab: .records, title: "Record Book", symbol: "book.closed"),
        Item(tab: .office, title: "Front Office", symbol: "briefcase"),
        Item(tab: .trophy, title: "Trophy Room", symbol: "trophy"),
    ]

    var body: some View {
        VStack(spacing: 14) {
            GlassEffectContainer(spacing: 8) {
                VStack(spacing: 6) {
                    ForEach(items) { item in
                        let selected = isSelected(item.tab)
                        Button {
                            UISelectionFeedbackGenerator().selectionChanged()
                            tab = item.tab
                        } label: {
                            Image(systemName: item.symbol)
                                .symbolVariant(selected ? .fill : .none)
                                .font(.system(size: 19, weight: .semibold))
                                .foregroundStyle(selected ? Theme.accent : Theme.ink2)
                                .frame(width: 46, height: 46)
                                .background {
                                    if selected {
                                        Circle().fill(Theme.accentSoft)
                                            .matchedGeometryEffect(id: "selection", in: glass)
                                    }
                                }
                                .contentShape(Circle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(item.title)
                        .accessibilityAddTraits(selected ? .isSelected : [])
                    }
                }
                .padding(6)
                .glassEffect(.regular.interactive(), in: Capsule())
            }

            Button {
                tab = .search
            } label: {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 18, weight: .semibold))
                    .frame(width: 46, height: 46)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .tint(tab == .search ? Theme.accent : nil)
            .accessibilityLabel("Search players")

            Spacer(minLength: 0)
        }
        .padding(.leading, 8)
        .padding(.trailing, 4)
        .padding(.vertical, 8)
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: tab)
    }

    private func isSelected(_ item: LeagueTab) -> Bool {
        switch (item, tab) {
        case (.season, .season), (.season, .year): return true
        default: return item == tab
        }
    }
}
