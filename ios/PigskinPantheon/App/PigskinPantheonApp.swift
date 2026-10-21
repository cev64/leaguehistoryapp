import SwiftUI
import UIKit

@main
struct PigskinPantheonApp: App {
    /// Remote notifications: the device token and a tapped notification.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
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
            // A league's link on the site (…?league=<id>, what "Share this
            // league" sends). It only reaches the app once the app claims
            // pigskinpantheon.com as a universal link (an Associated Domains
            // entitlement and the site's apple-app-site-association); until
            // then links open in Safari.
            if let id = DeepLink.leagueId(in: url) { app.open(id) }
        }
        // A notification tapped: its league opens (or stays, if it's open).
        .clubhouseLinks()
    }
}

enum DeepLink {
    /// The league a site link names (…?league=<id>).
    static func leagueId(in url: URL) -> String? {
        let parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
        guard let id = parts?.queryItems?.first(where: { $0.name == "league" })?.value, !id.isEmpty else { return nil }
        return id
    }
}
