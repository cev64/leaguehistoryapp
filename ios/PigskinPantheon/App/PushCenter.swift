import Foundation
import Observation
import UIKit
import UserNotifications

/// The clubhouse's notifications ("Week 9 is final", "Picks lock tonight",
/// "The Week 8 awards are in"), sent by the league's push sender through
/// APNs to the devices registered with register_push_device.
///
/// Nothing is asked at launch: the app asks iOS for permission only when a
/// member turns on one of a league's notifications (the Leaderboard sheet),
/// then registers for remote notifications and hands the device token to
/// the member's account. Which leagues send is the account's own choice,
/// league by league (league_members.notify_*, off until set_league_notifications
/// turns one on). The device goes to an account only once that account has
/// turned notifications on here: another account signing in on the same
/// iPhone isn't registered until it asks. Signing out takes the device off
/// the account.
@MainActor
@Observable
final class PushCenter {
    static let shared = PushCenter()

    /// The device token in hex, once APNs has given one.
    private(set) var deviceToken: String? = UserDefaults.standard.string(forKey: PushCenter.tokenKey)
    private(set) var status: UNAuthorizationStatus = .notDetermined
    /// Notifications are on for this device: the signed-in member turned
    /// one on here and iOS allows them.
    var enabled: Bool { asked && allowed }
    /// iOS allows notifications.
    var allowed: Bool { status == .authorized || status == .provisional || status == .ephemeral }
    /// iOS said no (in the prompt or in Settings).
    var denied: Bool { status == .denied }
    /// Why the account couldn't take this device (register_push_device's
    /// error, e.g. bad_device), as a sentence; nil once it has.
    private(set) var registerError: String?

    /// The accounts (user ids) that turned notifications on, on this device.
    private var askedUsers: Set<String> = Set(UserDefaults.standard.stringArray(forKey: PushCenter.askedKey) ?? [])
    /// The signed-in member turned notifications on, on this device.
    private var asked: Bool {
        guard let id = account?.user?.id else { return false }
        return askedUsers.contains(id)
    }
    @ObservationIgnored weak var account: AccountStore?
    @ObservationIgnored private var tokenWaiters: [CheckedContinuation<String?, Never>] = []
    /// The token last handed to the account, and whose account it was.
    @ObservationIgnored private var registeredFor: String?
    /// APNs has been asked for this launch's token.
    @ObservationIgnored private var requested = false
    /// A token a signed-out account may still have: its sign-out couldn't
    /// reach the server. The next account signed in here takes it over and
    /// lets it go (register_push_device hands a token to whoever calls).
    @ObservationIgnored private var orphan: String? = UserDefaults.standard.string(forKey: PushCenter.orphanKey) {
        didSet { UserDefaults.standard.set(orphan, forKey: Self.orphanKey) }
    }

    private static let tokenKey = "pp-push-token"
    private static let askedKey = "pp-push-asked-users"
    private static let orphanKey = "pp-push-orphan"

    /// APNs' environment the token belongs to, from how the app was signed:
    /// the embedded provisioning profile's aps-environment ("development" →
    /// the sandbox; a Release build run from Xcode is still signed for
    /// development). App Store builds carry no profile: production. The
    /// simulator: the sandbox.
    static let environment: String = {
        #if targetEnvironment(simulator)
        return "sandbox"
        #else
        return apsEnvironment(profile: Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision")) ?? "production"
        #endif
    }()

    /// A provisioning profile's aps-environment, as APNs names it. The
    /// profile is CMS-signed; its plist sits inside as plain XML.
    nonisolated static func apsEnvironment(profile url: URL?) -> String? {
        guard let url, let data = try? Data(contentsOf: url),
              let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
              let plist = try? PropertyListSerialization.propertyList(from: data.subdata(in: start.lowerBound..<end.upperBound), format: nil) as? [String: Any],
              let entitlements = plist["Entitlements"] as? [String: Any],
              let aps = entitlements["aps-environment"] as? String else { return nil }
        return aps == "development" ? "sandbox" : "production"
    }

    private init() {
        // Before accounts had their own: one switch for the whole device,
        // whoever signed in.
        UserDefaults.standard.removeObject(forKey: "pp-push-asked")
    }

    /// At launch: what iOS allows now, and a fresh token if the signed-in
    /// member turned notifications on here before (tokens can change).
    func start(account: AccountStore) {
        self.account = account
        account.observeSession("push") { [weak self] session in
            guard let self, session != nil else { return }
            Task { await self.sessionChanged() }
        }
        Task {
            await refreshStatus()
            requestToken()
            #if DEBUG
            // SIMCTL_CHILD_PP_PUSH=1 turns notifications on at launch, to try
            // `xcrun simctl push` (ios/tools/clubhouse-push.apns).
            if ProcessInfo.processInfo.environment["PP_PUSH"] == "1" { await enable() }
            #endif
        }
    }

    func refreshStatus() async {
        status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    /// Asks APNs for this launch's token, if the member here wants it.
    private func requestToken() {
        guard enabled, !requested else { return }
        requested = true
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// Asks iOS (the first time) and registers this device with the signed-in
    /// member's account. True when notifications can arrive.
    @discardableResult
    func enable() async -> Bool {
        await refreshStatus()
        if status == .notDetermined {
            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            await refreshStatus()
        }
        guard allowed else { return false }
        if let id = account?.user?.id, !askedUsers.contains(id) {
            askedUsers.insert(id)
            UserDefaults.standard.set(Array(askedUsers), forKey: Self.askedKey)
        }
        requested = true
        let token = await withCheckedContinuation { (c: CheckedContinuation<String?, Never>) in
            tokenWaiters.append(c)
            UIApplication.shared.registerForRemoteNotifications()
            // The simulator without a push server, a device offline: don't wait forever.
            DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in self?.answerWaiters(self?.deviceToken) }
        }
        if token != nil { await registerWithAccount() }
        return true
    }

    // MARK: From the app delegate

    func didRegister(_ data: Data) {
        let hex = data.map { String(format: "%02x", $0) }.joined()
        if hex != deviceToken { registeredFor = nil }
        deviceToken = hex
        UserDefaults.standard.set(hex, forKey: Self.tokenKey)
        answerWaiters(hex)
        Task { await registerWithAccount() }
    }

    func didFail(_ error: Error) {
        #if DEBUG
        print("[push] registration failed: \(error.localizedDescription)")
        #endif
        answerWaiters(nil)
    }

    private func answerWaiters(_ token: String?) {
        tokenWaiters.splice().forEach { $0.resume(returning: token) }
    }

    // MARK: The account

    /// Signed in, or a fresh token: a token left on a signed-out account is
    /// taken back, and the member's own registered if they asked here.
    private func sessionChanged() async {
        await releaseOrphan()
        requestToken()
        await registerWithAccount()
    }

    /// Hands the token to the member's account (register_push_device), once
    /// per account and token, and only if the member turned notifications
    /// on, on this device.
    func registerWithAccount() async {
        guard asked, let deviceToken, let account, let user = account.user?.id, registeredFor != "\(user)|\(deviceToken)" else { return }
        guard await account.freshen(), let token = account.accessToken, account.user?.id == user else { return }
        do {
            try await ClubhouseAPI.registerDevice(token: deviceToken, environment: Self.environment, token: token)
            registeredFor = "\(user)|\(deviceToken)"
            registerError = nil
            // It was a signed-out account's: it's this member's now.
            if orphan == deviceToken { orphan = nil }
        } catch {
            registerError = error.localizedDescription
            #if DEBUG
            print("[push] register_push_device: \(error.localizedDescription)")
            #endif
        }
    }

    /// The token a sign-out couldn't take off its account, taken over by
    /// the member signed in now (register_push_device) and let go
    /// (unregister_push_device), unless it's theirs to keep.
    private func releaseOrphan() async {
        guard let stale = orphan, let account, let user = account.user?.id else { return }
        // The member's own device token, and they want it: registering it hands it over.
        if stale == deviceToken, asked { return }
        guard await account.freshen(), let token = account.accessToken, account.user?.id == user else { return }
        do {
            try await ClubhouseAPI.registerDevice(token: stale, environment: Self.environment, token: token)
            try await ClubhouseAPI.unregisterDevice(token: stale, token: token)
            if orphan == stale { orphan = nil }
            if stale == deviceToken { registeredFor = nil }
        } catch {
            #if DEBUG
            print("[push] releasing a signed-out account's token: \(error.localizedDescription)")
            #endif
        }
    }

    /// Takes this device off the account, before signing out (with the
    /// session that's about to go, freshened; nil if it couldn't be). If
    /// the server can't be reached, the device stops taking notifications
    /// from APNs at all, and the token is kept to be let go by the next
    /// account signed in here.
    func unregister(accessToken: String?) async {
        defer { registeredFor = nil }
        guard let deviceToken else { return }
        if let accessToken {
            do {
                try await ClubhouseAPI.unregisterDevice(token: deviceToken, token: accessToken)
                return
            } catch {
                #if DEBUG
                print("[push] unregister_push_device: \(error.localizedDescription)")
                #endif
            }
        }
        orphan = deviceToken
        UIApplication.shared.unregisterForRemoteNotifications()
        requested = false
    }

    /// Signed out (or the account deleted): what the account was sent goes
    /// from the notification centre and the badge, and notifications that
    /// still arrive aren't shown or followed until someone signs in.
    func signedOut(forget user: String? = nil) {
        registeredFor = nil
        if let user, askedUsers.remove(user) != nil {
            UserDefaults.standard.set(Array(askedUsers), forKey: Self.askedKey)
        }
        let center = UNUserNotificationCenter.current()
        center.removeAllDeliveredNotifications()
        center.setBadgeCount(0)
    }

    /// Whether a notification arriving now is shown and followed: only
    /// while someone is signed in (Debug builds launched with PP_PUSH=1 take
    /// them signed out too, for `xcrun simctl push`).
    var accepting: Bool {
        #if DEBUG
        if ProcessInfo.processInfo.environment["PP_PUSH"] == "1" { return true }
        #endif
        return account?.isSignedIn ?? false
    }
}

private extension Array {
    /// Every element, leaving the array empty.
    mutating func splice() -> [Element] {
        let all = self
        removeAll()
        return all
    }
}

// MARK: - The app delegate

/// Remote notifications need an app delegate: the device token, and what a
/// notification tapped (or arriving while the app is open) does.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        MainActor.assumeIsolated { PushCenter.shared.didRegister(deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        MainActor.assumeIsolated { PushCenter.shared.didFail(error) }
    }

    /// Arriving while the app is open: shown as a banner all the same, but
    /// not while signed out (a signed-out account's, whose device the
    /// server couldn't be told about).
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        await MainActor.run { PushCenter.shared.accepting } ? [.banner, .list, .sound] : []
    }

    /// Tapped: open the league at the week and view it's about (not while
    /// signed out).
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        guard let link = ClubhouseLink(userInfo: info), await MainActor.run(body: { PushCenter.shared.accepting }) else { return }
        await MainActor.run { ClubhouseRouter.shared.open(link) }
    }
}

// MARK: - Where a notification goes

/// Where a notification leads: the push sender's `link` ({ league, season,
/// week, view }), with the site's `url` beside it for the web.
struct ClubhouseLink: Equatable, Identifiable {
    let id = UUID()
    /// A league id the app can open (the season's Sleeper id, or "espn-<id>").
    let league: String
    let season: Int?
    let week: Int?
    /// A season view's panel id ("panel-recap", "panel-results").
    let view: String?

    init(league: String, season: Int?, week: Int?, view: String?) {
        self.league = league
        self.season = season
        self.week = week
        self.view = view.map(Self.panel)
    }

    init?(userInfo: [AnyHashable: Any]) {
        let link = userInfo["link"] as? [String: Any]
        let number: (Any?) -> Int? = { ($0 as? NSNumber)?.intValue ?? ($0 as? String).flatMap(Int.init) }
        if let link, let league = (link["league"] as? String) ?? (link["league"] as? NSNumber)?.stringValue, !league.isEmpty {
            self.init(league: league, season: number(link["season"]), week: number(link["week"]), view: link["view"] as? String)
            return
        }
        // Only the web address: …season.html?league=<id>&season=…&week=…&view=…
        guard let raw = userInfo["url"] as? String, let url = URL(string: raw),
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let league = items.first(where: { $0.name == "league" })?.value else { return nil }
        let item = { (name: String) in items.first(where: { $0.name == name })?.value }
        self.init(league: league, season: item("season").flatMap(Int.init), week: item("week").flatMap(Int.init), view: item("view"))
    }

    /// The site's short view names, as the season screen's panel ids.
    static func panel(_ view: String) -> String {
        switch view {
        case "recap": return "panel-recap"
        case "results", "matchups", "pickem", "picks": return "panel-results"
        case "standings": return "panel-standings"
        case "picture", "playoffs": return "panel-picture"
        default: return view.hasPrefix("panel-") ? view : "panel-\(view)"
        }
    }

    static func == (l: ClubhouseLink, r: ClubhouseLink) -> Bool { l.id == r.id }
}

/// The link a notification opened, until the screens it names have taken it:
/// the app opens the league (RootView), the league's tabs move to its season
/// (LeagueTabs), and the season screen to its week and view.
@MainActor
@Observable
final class ClubhouseRouter {
    static let shared = ClubhouseRouter()
    private(set) var pending: ClubhouseLink?

    func open(_ link: ClubhouseLink) { pending = link }

    /// The season screen has shown it.
    func finish(_ link: ClubhouseLink) {
        if pending == link { pending = nil }
    }

    /// Whether a link is about this league (any of its seasons' ids).
    static func matches(_ link: ClubhouseLink, _ session: LeagueSession) -> Bool {
        if session.id == link.league { return true }
        guard let summary = session.summary else { return false }
        return summary.leagueId == link.league || summary.seasons.contains { $0.leagueId == link.league }
    }
}
