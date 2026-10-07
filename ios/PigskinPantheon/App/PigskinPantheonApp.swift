import SwiftUI
import UIKit

@main
struct PigskinPantheonApp: App {
    @State private var app = AppModel()

    init() {
        // Titles in the site's display type: condensed, heavy, in capitals.
        let bar = UINavigationBar.appearance()
        bar.largeTitleTextAttributes = [.font: UIFont.systemFont(ofSize: 34, weight: .heavy, width: .condensed)]
        bar.titleTextAttributes = [.font: UIFont.systemFont(ofSize: 18, weight: .bold, width: .condensed)]
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .tint(Theme.accent)
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            if let league = app.league {
                LeagueRootView(session: league)
                    .id(league.id)
                    .transition(.opacity.combined(with: .scale(scale: 0.98)))
            } else {
                HomeView()
                    .transition(.opacity)
            }
        }
        .animation(.smooth(duration: 0.35), value: app.league?.id)
        .task {
            if let id = DebugLaunch.league, app.league == nil { app.open(id) }
        }
        .onOpenURL { url in
            // pigskinpantheon.com links and pantheon://league/<id>
            if let id = DeepLink.leagueId(in: url) { app.open(id) }
        }
    }
}

enum DeepLink {
    /// The league a link names: a site link (…?league=<id>) or pantheon://league/<id>.
    static func leagueId(in url: URL) -> String? {
        let parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
        if let id = parts?.queryItems?.first(where: { $0.name == "league" })?.value, !id.isEmpty { return id }
        if url.scheme == "pantheon", url.host == "league" { return url.pathComponents.dropFirst().first }
        return nil
    }
}
