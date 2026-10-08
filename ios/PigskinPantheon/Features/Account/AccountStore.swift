import Foundation
import Observation
import Security
import UIKit

/// The member's account (Supabase, as account.js on the site): signing in
/// and out, the profile, the leagues synced to the account, and the league
/// gate (`admit`). It talks to Supabase's own APIs directly: GoTrue for the
/// session, PostgREST for the profile, the synced leagues and the two league
/// functions (sync_league / unsync_league, where the limits live).
///
/// The session is kept in the Keychain and refreshed before it runs out;
/// every engine (the finder, the open league) is handed the fresh token, so
/// espn.js opens private leagues with keys saved to the account and the
/// league AI knows who is asking.
@MainActor
@Observable
final class AccountStore {
    struct User: Hashable, Codable {
        let id: String
        let email: String
        var name: String = ""
    }

    /// The `profiles` row (the columns the app reads).
    struct Profile: Decodable, Hashable {
        var display_name: String?
        var sleeper_username: String?
        var plan: String?
    }

    /// A `synced_leagues` row: a league by its whole history.
    struct SyncedLeague: Decodable, Identifiable, Hashable {
        let league_id: String
        let league_ids: [String]?
        let name: String?
        let avatar: String?
        let synced_at: String?

        var id: String { league_id }
        var ids: [String] { league_ids ?? [league_id] }
        var title: String { (name?.isEmpty == false ? name : nil) ?? "League \(league_id)" }
        var syncedDate: Date? { synced_at.flatMap { AccountStore.parseDate($0) } }
    }

    /// A real league someone tried to open signed out: it opens once they
    /// sign in (account.js's gate, before the league loads).
    struct PendingLeague: Identifiable, Equatable {
        let id: String
        let name: String?
        let avatar: String?
    }

    /// Adding a league to the account failed (the gate's "Couldn't add").
    struct GateFailure: Identifiable, Equatable {
        let id: String
        let name: String
        let message: String
    }

    // MARK: State

    var user: User?
    var accessToken: String?
    var profile: Profile?
    var leagues: [SyncedLeague] = []
    /// The session is known (restored, refreshed, or there is none).
    var ready = false
    var pending: PendingLeague?
    var gateFailure: GateFailure?
    /// A short note shown for a moment ("Signed in.").
    var toast: Toast?

    struct Toast: Equatable, Identifiable {
        let id = UUID()
        let message: String
    }

    var isSignedIn: Bool { user != nil }

    /// What the engine's `window.Account` stand-in is given.
    var engineSession: [String: Any]? {
        guard let user, let accessToken else { return nil }
        return ["accessToken": accessToken, "user": ["id": user.id, "email": user.email]]
    }

    /// PRICING is off: every signed-in member gets everything (account.js isPro()).
    var isPro: Bool { Supabase.pricing ? profile?.plan == "pro" : isSignedIn }

    var displayName: String {
        if let n = profile?.display_name, !n.isEmpty { return n }
        if let user { return user.name.isEmpty ? String(user.email.split(separator: "@").first ?? "") : user.name }
        return ""
    }

    var initials: String {
        let parts = displayName.split(whereSeparator: { " ._-".contains($0) }).filter { !$0.isEmpty }
        let first = parts.first?.first.map(String.init) ?? "?"
        let second = parts.count > 1 ? (parts[1].first.map(String.init) ?? "") : ""
        return (first + second).uppercased()
    }

    /// Whether this device has ever been signed in, so a gate asks to sign
    /// in rather than to create an account.
    var hasSignedInBefore: Bool { UserDefaults.standard.bool(forKey: Self.seenKey) }

    // MARK: Private

    private struct StoredSession: Codable {
        var accessToken: String
        var refreshToken: String
        var expiresAt: Date
        var user: User
    }

    @ObservationIgnored private var stored: StoredSession?
    @ObservationIgnored private var refreshTimer: Task<Void, Never>?
    @ObservationIgnored private var refreshing: Task<Bool, Never>?
    @ObservationIgnored private var listeners: [String: ([String: Any]?) -> Void] = [:]
    /// Names and avatars for league ids, from the finder, for the gate's title.
    @ObservationIgnored private var hints: [String: (name: String?, avatar: String?)] = [:]
    private static let seenKey = "lh-account-seen"
    private static let installedKey = "lh-account-installed"

    init() {
        // The Keychain outlives the app: a session left by an earlier
        // install (deleted and installed again) isn't picked up.
        if !UserDefaults.standard.bool(forKey: Self.installedKey) {
            Keychain.delete()
            UserDefaults.standard.set(true, forKey: Self.installedKey)
        }
        if let saved = Keychain.load(), let session = try? JSONDecoder().decode(StoredSession.self, from: saved) {
            apply(session, persist: false)
            Task { await self.resume() }
        } else {
            ready = true
        }
        // Back from the background (where the refresh timer may not have
        // run): a token about to run out is refreshed, and every engine is
        // handed the fresh one.
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.stored != nil else { return }
                Task { await self.freshen() }
            }
        }
    }

    // MARK: Engines

    /// Hears every change of session (signed in or out, a fresh token), with
    /// what to hand an engine's `Bridge.setSession`.
    func observeSession(_ key: String, _ fn: @escaping ([String: Any]?) -> Void) {
        listeners[key] = fn
    }

    private func announce() {
        let s = engineSession
        listeners.values.forEach { $0(s) }
    }

    // MARK: The session

    private func apply(_ session: StoredSession?, persist: Bool = true) {
        stored = session
        user = session?.user
        accessToken = session?.accessToken
        if persist {
            if let session, let data = try? JSONEncoder().encode(session) { Keychain.save(data) } else { Keychain.delete() }
        }
        if session != nil { UserDefaults.standard.set(true, forKey: Self.seenKey) }
        schedule()
        announce()
    }

    /// A restored session: refreshed if it's about to run out, then the
    /// profile and leagues.
    private func resume() async {
        _ = await freshen()
        ready = true
        await refresh()
    }

    /// A token good for a while yet: refreshes one that runs out within two
    /// minutes. False when there is no session (or it was turned away).
    @discardableResult
    func freshen(force: Bool = false) async -> Bool {
        guard let stored else { return false }
        if !force && stored.expiresAt.timeIntervalSinceNow > 120 { return true }
        if let refreshing { return await refreshing.value }
        let task = Task { await self.refreshSession() }
        refreshing = task
        let ok = await task.value
        refreshing = nil
        return ok
    }

    private func refreshSession() async -> Bool {
        guard let current = stored else { return false }
        do {
            let answer = try await GoTrue.post("token?grant_type=refresh_token", ["refresh_token": current.refreshToken])
            guard let session = Self.session(from: answer) else { return false }
            // Signed out (or the account deleted) while this was in flight.
            guard stored?.refreshToken == current.refreshToken else { return false }
            apply(session)
            return true
        } catch let error as AccountError {
            // Turned away (revoked, expired, signed out elsewhere): signed out
            // here too. A network failure keeps the session for a later try.
            if case .server(let status, _) = error, (400...401).contains(status) || status == 403 {
                apply(nil)
                profile = nil
                leagues = []
            }
            return false
        } catch {
            return false
        }
    }

    private func schedule() {
        refreshTimer?.cancel()
        guard let expiresAt = stored?.expiresAt else { return }
        // Three minutes before it runs out (the refresh puts a new timer
        // in place). Forced: at that point `freshen` alone would still
        // think the token good. A refresh that failed for want of a
        // network tries again a minute later.
        let wait = max(5, expiresAt.timeIntervalSinceNow - 180)
        refreshTimer = Task { [weak self] in
            try? await Task.sleep(for: .seconds(wait))
            guard !Task.isCancelled, let self else { return }
            if await !self.freshen(force: true), self.stored != nil, !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled else { return }
                self.schedule()
            }
        }
    }

    private static func session(from json: [String: Any]) -> StoredSession? {
        guard let access = json["access_token"] as? String,
              let refresh = json["refresh_token"] as? String,
              let user = json["user"] as? [String: Any],
              let id = user["id"] as? String else { return nil }
        let expiresAt: Date
        if let at = (json["expires_at"] as? NSNumber)?.doubleValue {
            expiresAt = Date(timeIntervalSince1970: at)
        } else {
            expiresAt = Date().addingTimeInterval((json["expires_in"] as? NSNumber)?.doubleValue ?? 3600)
        }
        let meta = user["user_metadata"] as? [String: Any]
        let name = (meta?["display_name"] as? String) ?? (meta?["full_name"] as? String) ?? ""
        return StoredSession(accessToken: access, refreshToken: refresh, expiresAt: expiresAt,
                             user: User(id: id, email: (user["email"] as? String) ?? "", name: name))
    }

    // MARK: Signing in and out

    func signIn(email: String, password: String) async throws {
        let answer = try await GoTrue.post("token?grant_type=password", ["email": email, "password": password])
        guard let session = Self.session(from: answer) else { throw AccountError.server(0, "Something went wrong.") }
        apply(session)
        await refresh()
    }

    /// Creates an account. True when the email has to be confirmed first
    /// (Supabase's default): there's no session until the link is followed.
    func signUp(email: String, password: String, name: String) async throws -> Bool {
        let body: [String: Any] = ["email": email, "password": password,
                                   "data": ["display_name": name.isEmpty ? NSNull() as Any : name]]
        let answer = try await GoTrue.post("signup", body, redirect: true)
        if let session = Self.session(from: answer) {
            apply(session)
            await refresh()
            return false
        }
        return true
    }

    func resetPassword(email: String) async throws {
        _ = try await GoTrue.post("recover", ["email": email], redirect: true)
    }

    func signOut() async {
        if let token = accessToken {
            _ = try? await GoTrue.post("logout?scope=global", [:], token: token)
        }
        apply(nil)
        profile = nil
        leagues = []
    }

    /// delete_my_account(): the account and everything on it (its synced
    /// leagues, saved ESPN keys, profile) is gone for good. Then signed out
    /// as `signOut` does, and this device forgets it was ever signed in.
    func deleteAccount() async throws {
        guard stored != nil else { throw AccountError.server(0, "not_signed_in") }
        // Still signed in but the token couldn't be refreshed: no connection.
        guard await freshen(), let token = accessToken else { throw AccountError.offline }
        try await PostgREST.send("POST", "rpc/delete_my_account", [:], token: token)
        // The sessions went with the user, so there's nothing to log out of.
        apply(nil)
        profile = nil
        leagues = []
        pending = nil
        gateFailure = nil
        hints = [:]
        UserDefaults.standard.removeObject(forKey: Self.seenKey)
    }

    // MARK: Profile and leagues

    /// The profile row and the synced leagues, fetched again.
    func refresh() async {
        guard let user, await freshen(), let token = accessToken else {
            if user == nil { profile = nil; leagues = [] }
            return
        }
        async let profileRows: [Profile] = PostgREST.get("profiles?select=*&id=eq.\(user.id)", token: token)
        async let leagueRows: [SyncedLeague] = PostgREST.get("synced_leagues?select=*&order=synced_at.asc", token: token)
        do {
            let (p, l) = try await (profileRows, leagueRows)
            profile = p.first ?? Profile(display_name: user.name, sleeper_username: nil, plan: "free")
            leagues = l
        } catch {
            if profile == nil { profile = Profile(display_name: nil, sleeper_username: nil, plan: "free") }
        }
    }

    func saveProfile(name: String, sleeperUsername: String) async throws {
        guard let user, await freshen(), let token = accessToken else { throw AccountError.server(0, "not_signed_in") }
        let name = name.trimmingCharacters(in: .whitespaces), sleeper = sleeperUsername.trimmingCharacters(in: .whitespaces)
        try await PostgREST.send("PATCH", "profiles?id=eq.\(user.id)", [
            "display_name": name.isEmpty ? NSNull() as Any : name,
            "sleeper_username": sleeper.isEmpty ? NSNull() as Any : sleeper,
        ], token: token)
        await refresh()
    }

    /// sync_league(p_league_id, p_league_ids, p_name, p_avatar), as account.js calls it.
    func sync(id: String, ids: [String], name: String?, avatar: String?) async throws {
        guard await freshen(), let token = accessToken else { throw AccountError.server(0, "not_signed_in") }
        try await PostgREST.send("POST", "rpc/sync_league", [
            "p_league_id": id, "p_league_ids": ids,
            "p_name": name.map { $0 as Any } ?? NSNull(), "p_avatar": avatar.map { $0 as Any } ?? NSNull(),
        ], token: token)
        await refresh()
    }

    func unsync(_ leagueId: String) async throws {
        guard await freshen(), let token = accessToken else { throw AccountError.server(0, "not_signed_in") }
        try await PostgREST.send("POST", "rpc/unsync_league", ["p_league_id": leagueId], token: token)
        await refresh()
    }

    /// The synced league that covers any of these ids (any season of its history).
    func syncedLeague(covering ids: [String]) -> SyncedLeague? {
        leagues.first { row in row.ids.contains { ids.contains($0) } }
    }

    // MARK: The gate

    /// Whether a league can be opened before it loads: in the app, any
    /// league, signed in or not (`Supabase.requireAccount`).
    func mayOpen(_ id: String) -> Bool {
        LeagueEngine.isDemo(id) || !Supabase.requireAccount || isSignedIn
    }

    /// The finder knows a league's name before it opens: kept for the gate.
    func hint(_ id: String, name: String?, avatar: String?) {
        hints[id] = (name, avatar)
    }

    /// A real league opened signed out: ask to sign in, then open it.
    func askToSignIn(for id: String) {
        let recent = RecentLeague.load().first { $0.id == id }
        let known = leagues.first { $0.ids.contains(id) }
        let name = hints[id]?.name ?? recent?.name ?? known?.name
        pending = PendingLeague(id: id, name: name, avatar: hints[id]?.avatar ?? recent?.avatar ?? known?.avatar)
    }

    /// account.js `admit(model)` once the league has loaded: already on the
    /// account (by any season's id) opens it, and a renewal's new ids are
    /// added quietly; otherwise it's added (everyone signed in may add
    /// leagues while PRICING is off). Signed out, it just opens, unsynced.
    /// Answers why not, if it couldn't be added.
    func admit(_ summary: LeagueSummary) async -> String? {
        if summary.demo { return nil }
        guard isSignedIn else { return Supabase.requireAccount ? "Sign in first." : nil }
        var ids: [String] = []
        for id in [summary.leagueId] + summary.seasons.map(\.leagueId) where !id.isEmpty && !ids.contains(id) { ids.append(id) }
        if leagues.isEmpty { await refresh() }
        if let row = syncedLeague(covering: ids) {
            if ids.contains(where: { !row.ids.contains($0) }) {
                Task { try? await self.sync(id: summary.leagueId, ids: ids, name: summary.name, avatar: summary.avatar) }
            }
            return nil
        }
        do {
            try await sync(id: summary.leagueId, ids: ids, name: summary.name, avatar: summary.avatar)
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    // MARK: Words

    func say(_ message: String) {
        toast = Toast(message: message)
    }

    nonisolated static func parseDate(_ text: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: text) { return d }
        f.formatOptions = [.withInternetDateTime]
        if let d = f.date(from: text) { return d }
        // PostgREST: "2026-10-05T14:03:11.123456+00:00"
        let trimmed = text.replacingOccurrences(of: #"\.\d+"#, with: "", options: .regularExpression)
        return f.date(from: trimmed)
    }

    /// The site's fmtDate: "Oct 5, 2026".
    static func fmtDate(_ date: Date?) -> String {
        guard let date else { return "" }
        return date.formatted(.dateTime.month(.abbreviated).day().year())
    }

    /// account.js `explain`: the backends' short codes and messages, as sentences.
    nonisolated static func explain(_ raw: String) -> String {
        let code = raw.split(separator: ":", maxSplits: 1).first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
        let rest: String = raw.firstIndex(of: ":").map { String(raw[raw.index(after: $0)...]).trimmingCharacters(in: .whitespaces) } ?? ""
        func has(_ pattern: String) -> Bool { raw.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil }
        switch code {
        case "free_limit": return "Your account can hold 1 league. Unsync it to add another."
        case "swap_locked":
            return "Your league is locked in until \(fmtDateStatic(rest)). It can be swapped once every \(Supabase.swapDays) days."
        case "not_signed_in": return "Sign in first."
        case "bad_league": return "That isn't a Sleeper or ESPN league."
        default: break
        }
        if has("invalid login credentials") { return "That email and password don't match an account." }
        if has("already registered|already been registered|user_already_exists") { return "There's already an account with that email. Sign in instead." }
        if has("password should be at least|weak_password") { return "Use a password of at least 8 characters." }
        if has("email not confirmed") { return "Confirm your email first: the link is in your inbox." }
        if has("rate limit|too many") { return "Too many tries. Wait a minute and try again." }
        if has("failed to fetch|network") { return "Couldn't reach the server. Check your connection." }
        if raw.range(of: #"^[a-z_]+:.+$"#, options: .regularExpression) != nil, !rest.isEmpty {
            return rest.prefix(1).uppercased() + rest.dropFirst()
        }
        return raw.isEmpty ? "Something went wrong." : raw
    }

    nonisolated private static func fmtDateStatic(_ iso: String) -> String {
        let f = ISO8601DateFormatter()
        guard let d = f.date(from: iso) else { return iso }
        return d.formatted(.dateTime.month(.abbreviated).day().year())
    }
}

// MARK: Errors

enum AccountError: LocalizedError {
    /// The server's answer: its status and its own words (or code).
    case server(Int, String)
    case offline

    var errorDescription: String? {
        switch self {
        case .server(_, let raw): return AccountStore.explain(raw)
        case .offline: return "Couldn't reach the server. Check your connection."
        }
    }
}

// MARK: Supabase

/// The project's settings, read from the bundled account-config.js (the
/// site's own file), with the same values as a fallback.
enum Supabase {
    private static let config: String = {
        guard let url = Bundle.main.url(forResource: "account-config", withExtension: "js"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return "" }
        return text
    }()

    private static func value(_ key: String) -> String? {
        let pattern = key + #"\s*:\s*"([^"]*)""#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: config, range: NSRange(config.startIndex..., in: config)),
              let range = Range(match.range(at: 1), in: config) else { return nil }
        let v = String(config[range])
        return v.isEmpty ? nil : v
    }

    private static func flag(_ key: String) -> Bool? {
        let pattern = key + #"\s*:\s*(true|false)"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: config, range: NSRange(config.startIndex..., in: config)),
              let range = Range(match.range(at: 1), in: config) else { return nil }
        return config[range] == "true"
    }

    static let url = URL(string: value("SUPABASE_URL") ?? "https://vnmzjfnfqqxedbmirakb.supabase.co")!
    static let anonKey = value("SUPABASE_ANON_KEY") ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZubXpqZm5mcXF4ZWRibWlyYWtiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5NDIxOTYsImV4cCI6MjEwNjUxODE5Nn0.YQUMzJU2aNfg0_T_2FsVNPRDmOERsT-DPsrlcd5smv8"
    /// The site's REQUIRE_ACCOUNT puts its league pages behind sign-in. The
    /// app doesn't: a league opens signed out, unsynced, and signed in it's
    /// added to the account as on the site (App Review 5.1.1(v): looking at
    /// a public league isn't account based).
    static let requireAccount = false
    /// PRICING: off, so nothing mentions plans and everyone signed in gets everything.
    static let pricing = flag("PRICING") ?? false
    static let swapDays = 30
    /// Where confirmation and password-reset emails land: the site's front
    /// page, already in the project's redirect URLs.
    static let emailRedirect = "https://pigskinpantheon.com/index.html"

    static func request(_ path: String, method: String, token: String?, body: Any?) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: Supabase.url) else { throw AccountError.server(0, "Something went wrong.") }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 20
        req.setValue(anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(token ?? anonKey)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        return req
    }

    static func perform(_ req: URLRequest) async throws -> (Data, Int) {
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if !(200..<300).contains(status) {
                throw AccountError.server(status, message(in: data) ?? "The server answered \(status)")
            }
            return (data, status)
        } catch let error as AccountError {
            throw error
        } catch {
            throw AccountError.offline
        }
    }

    /// GoTrue's ({msg} / {error_description}) and PostgREST's ({message})
    /// words, whichever the answer has.
    private static func message(in data: Data) -> String? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        for key in ["msg", "error_description", "message", "error"] {
            if let s = json[key] as? String, !s.isEmpty { return s }
        }
        return nil
    }
}

/// GoTrue: /auth/v1/…
enum GoTrue {
    static func post(_ path: String, _ body: [String: Any], token: String? = nil, redirect: Bool = false) async throws -> [String: Any] {
        var p = "auth/v1/\(path)"
        if redirect {
            let to = Supabase.emailRedirect.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: ":/?&=+"))) ?? ""
            p += (p.contains("?") ? "&" : "?") + "redirect_to=\(to)"
        }
        let req = try Supabase.request(p, method: "POST", token: token, body: body)
        let (data, _) = try await Supabase.perform(req)
        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }
}

/// PostgREST: /rest/v1/…
enum PostgREST {
    static func get<T: Decodable>(_ path: String, token: String) async throws -> T {
        let req = try Supabase.request("rest/v1/\(path)", method: "GET", token: token, body: nil)
        let (data, _) = try await Supabase.perform(req)
        return try JSONDecoder().decode(T.self, from: data)
    }

    static func send(_ method: String, _ path: String, _ body: [String: Any], token: String) async throws {
        var req = try Supabase.request("rest/v1/\(path)", method: method, token: token, body: body)
        req.setValue("return=minimal", forHTTPHeaderField: "Prefer")
        _ = try await Supabase.perform(req)
    }
}

// MARK: Keychain

/// The session, kept where iOS keeps passwords: this device only, readable
/// after the first unlock (so a token refresh can run in the background).
enum Keychain {
    private static let base: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.pigskinpantheon.account",
        kSecAttrAccount as String: "supabase-session",
    ]

    static func load() -> Data? {
        var query = base
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    static func save(_ data: Data) {
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        if SecItemUpdate(base as CFDictionary, attributes as CFDictionary) == errSecItemNotFound {
            SecItemAdd(base.merging(attributes) { $1 } as CFDictionary, nil)
        }
    }

    static func delete() {
        SecItemDelete(base as CFDictionary)
    }
}
