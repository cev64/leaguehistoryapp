import Foundation
import Observation
import SwiftUI

/// The front page's league finder (index.html's script), driven through
/// the finder engine: the site's own sleeper.js and espn.js, with no league
/// open. Sleeper: a username lists its leagues, or a league ID opens one.
/// ESPN: a league ID or link opens one; the private-league panel keeps the
/// member's ESPN keys (a set per ESPN account) and lists their ESPN leagues.
@MainActor
@Observable
final class FinderModel {
    static let shared = FinderModel()

    enum Platform: String, CaseIterable, Identifiable {
        case sleeper, espn
        var id: String { rawValue }
        var label: String { self == .sleeper ? "Sleeper" : "ESPN" }
    }

    /// The line under a form: its default words, a message, or an error.
    enum Note: Equatable {
        case standard
        case message(String)
        case error(String)
        /// "That isn't an ESPN league ID…" with its "Private league?" link.
        case notEspnId
    }

    struct SleeperUser: Decodable, Equatable {
        let id: String
        let username: String?
        let name: String
        let avatar: String?
    }

    struct SleeperLeague: Decodable, Identifiable, Equatable {
        struct History: Decodable, Equatable {
            let n: Int
            let first: Int
            let more: Bool
        }
        let id: String
        let name: String
        let season: Int
        let status: String?
        let teams: Int?
        let avatar: String?
        let history: History

        /// "12 teams · 2019–2025", as the site's describe().
        var describe: String {
            let span = history.n > 1 || history.more
                ? "\(history.first)\(history.more ? " and earlier" : "")–\(season)"
                : "\(season)"
            return "\(teams ?? 0) teams · \(span)"
        }
        var live: Bool { ["in_season", "post_season", "drafting"].contains(status ?? "") }
    }

    struct EspnLeague: Decodable, Identifiable, Equatable {
        let id: String
        let name: String
        let season: Int?
        let size: Int?
        let team: String?
        let logo: String?
        let swid: String?

        var describe: String {
            ["ESPN", season.map(String.init), size.map { "\($0) teams" }, team.map { "your team: \($0)" }]
                .compactMap { $0 }.joined(separator: " · ")
        }
    }

    /// An ESPN account with keys: on this device, on the member's account, or both.
    struct EspnAccount: Identifiable, Equatable {
        let swid: String
        let local: Bool
        let account: Bool
        var id: String { swid }
    }

    // MARK: Sleeper

    var platform: Platform = Platform(rawValue: UserDefaults.standard.string(forKey: "lh-platform") ?? "") ?? .sleeper {
        didSet { UserDefaults.standard.set(platform.rawValue, forKey: "lh-platform") }
    }
    var username = ""
    var byId = false
    var sleeperNote: Note = .standard
    var looking = false
    var sleeperUser: SleeperUser?
    var sleeperLeagues: [SleeperLeague]?

    // MARK: ESPN

    var espnInput = ""
    var espnNote: Note = .standard
    var privateOpen = false
    var relay = true
    var accountsAvailable = false
    var espnSignedIn = false
    var connected: [EspnAccount] = []
    var localCount = 0
    var onAccountKnown = false
    var adding = false
    /// "Have your keys already? Enter them here": the key boxes instead of
    /// the finish-on-a-computer steps.
    var keysAnyway = false
    var toAccount = true
    var s2 = ""
    var swid = ""
    var savingKeys = false
    var busySwid: String?
    /// The member's ESPN leagues: nil when there's nothing to show.
    var espnLeagues: [EspnLeague]?
    var espnListNote: String?
    var leagueNamesBySwid: [String: [String]] = [:]
    var refusedSwids: [String] = []

    // MARK: Engine

    @ObservationIgnored let engine = LeagueEngine(leagueId: nil)
    @ObservationIgnored private var sentSession: String?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var espnAsked = 0
    @ObservationIgnored private var espnAskedFor: String?
    @ObservationIgnored private var sleeperTurn = 0

    /// Once, when the front page first shows: the account's session to the
    /// engine, the username remembered from last time looked up again, and
    /// the member's ESPN leagues.
    func start(account: AccountStore) {
        account.observeSession("finder") { [weak self, weak account] _ in
            guard let self, let account else { return }
            Task { await self.accountChanged(account) }
        }
        guard !started else { return }
        started = true
        Task {
            await sendSession(account)
            if username.isEmpty, let saved = try? await engine.call(SavedUser.self, "Bridge.finder.savedUser()"),
               let name = saved.username, !name.isEmpty {
                username = name
                await findLeagues(name)
            } else if username.isEmpty, let sleeper = account.profile?.sleeper_username, !sleeper.isEmpty {
                username = sleeper
            }
            await loadState()
            await loadEspnLeagues(account: account)
        }
    }

    private struct SavedUser: Decodable { let username: String? }

    private func sendSession(_ account: AccountStore) async {
        let key = account.user.map { "\($0.id)|\(account.accessToken ?? "")" } ?? ""
        guard key != sentSession else { return }
        sentSession = key
        try? await engine.run("Bridge.setSession(s)", ["s": account.engineSession ?? NSNull()])
    }

    /// Signed in or out (or a fresh token): ESPN's keys may have changed hands.
    func accountChanged(_ account: AccountStore) async {
        guard started else { return }
        await sendSession(account)
        await loadState()
        if privateOpen { await drawPrivate() }
        await loadEspnLeagues(account: account)
    }

    // MARK: Sleeper: find

    var sleeperPlaceholder: String { byId ? "Sleeper league ID" : "Your Sleeper username" }
    var sleeperButton: String { byId ? "Open league" : "Find leagues" }

    func toggleById() {
        byId.toggle()
        username = ""
    }

    /// The form's submit: a league ID (or a long number) opens it; anything
    /// else is a username to look up.
    func submitSleeper(app: AppModel) {
        let value = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        if byId || value.range(of: #"^\d{12,}$"#, options: .regularExpression) != nil {
            let id = value.filter { $0.isASCII && $0.isWholeNumber }
            guard id.count >= 6 else {
                sleeperNote = .error("A Sleeper league ID is a long number, in the league's address on sleeper.com.")
                return
            }
            app.open(id)
        } else {
            Task { await findLeagues(value) }
        }
    }

    func findLeagues(_ name: String) async {
        sleeperTurn += 1
        let turn = sleeperTurn
        looking = true
        sleeperNote = .message("Looking you up on Sleeper…")
        defer { if turn == sleeperTurn { looking = false } }
        do {
            let user = try await engine.call(SleeperUser.self, "Bridge.finder.user(name)", ["name": name])
            let leagues = try await engine.call([SleeperLeague].self, "Bridge.finder.leagues(id)", ["id": user.id])
            guard turn == sleeperTurn else { return }
            withAnimation(.smooth) {
                sleeperUser = user
                sleeperLeagues = leagues
            }
            sleeperNote = .standard
        } catch {
            guard turn == sleeperTurn else { return }
            let message = error.localizedDescription
            sleeperNote = .error(message.isEmpty ? "Sleeper didn't answer. Try again in a moment." : message)
        }
    }

    // MARK: ESPN: open

    /// espn.js parseLeague: the number after leagueId= in a league's
    /// address, or a bare id ("espn-" allowed).
    static func parseEspn(_ input: String) -> String? {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if let r = text.range(of: #"[?&#]leagueId=(\d{1,12})"#, options: [.regularExpression, .caseInsensitive]) {
            let digits = text[r].split(separator: "=").last.map(String.init) ?? ""
            return digits.isEmpty ? nil : digits
        }
        let bare = text.replacingOccurrences(of: #"^espn-"#, with: "", options: [.regularExpression, .caseInsensitive])
        return bare.range(of: #"^\d{1,12}$"#, options: .regularExpression) != nil ? bare : nil
    }

    func submitEspn(app: AppModel) {
        guard let n = Self.parseEspn(espnInput) else {
            espnNote = .notEspnId
            return
        }
        app.open("espn-\(n)")
    }

    // MARK: ESPN: keys

    private struct EspnState: Decodable {
        let relay: Bool
        let local: [String]
        let available: Bool
        let signedIn: Bool
        let account: [String]?
    }

    /// Where the keys stand, without asking the relay.
    func loadState() async {
        guard let s = try? await engine.call(EspnState.self, "Bridge.finder.espnState()") else { return }
        relay = s.relay
        accountsAvailable = s.available
        espnSignedIn = s.signedIn
        localCount = s.local.count
    }

    /// drawPrivate: every ESPN account with keys, here and on the account.
    func drawPrivate() async {
        guard let s = try? await engine.call(EspnState.self, "Bridge.finder.espnAccounts()") else { return }
        relay = s.relay
        accountsAvailable = s.available
        espnSignedIn = s.signedIn
        localCount = s.local.count
        let accountSets = s.account ?? []
        onAccountKnown = !accountSets.isEmpty
        var swids: [String] = []
        for x in s.local + accountSets where !swids.contains(x) { swids.append(x) }
        withAnimation(.smooth) {
            connected = swids.map { EspnAccount(swid: $0, local: s.local.contains($0), account: accountSets.contains($0)) }
        }
    }

    func setPrivateOpen(_ open: Bool) {
        withAnimation(.smooth) { privateOpen = open }
        if open { Task { await drawPrivate() } }
    }

    var isConnected: Bool { (relay && localCount > 0) || onAccountKnown }
    var connectedCount: Int { max(connected.count, localCount) }

    var toggleTitle: String {
        !isConnected ? "Private league?" : connectedCount > 1 ? "\(connectedCount) ESPN accounts connected" : "ESPN connected"
    }

    /// The site's words on a phone or tablet (index.html drawToggle, TOUCH).
    var toggleSubtitle: String {
        isConnected
            ? "Your ESPN keys are saved \(onAccountKnown ? "to your account" : "on this device"), so your private leagues open and are listed below. Manage them, or add another ESPN account, here."
            : "A one-time setup on a computer, then it works on your phone too."
    }

    /// A phone has no developer tools to copy the keys from, so until there
    /// are keys the panel says to finish on a computer (index.html
    /// drawPrivate's desktopOnly), unless they have the keys anyway.
    var showDesktop: Bool { relay && connected.isEmpty && !keysAnyway }

    /// The key boxes show until an account is connected, and again for "+ Add another".
    var showKeyFields: Bool { relay && !showDesktop && (connected.isEmpty || adding) }

    private struct SaveAnswer: Decodable {
        let ok: Bool
        let error: String?
        let swid: String?
        let accountError: String?
    }

    func saveKeys(app: AppModel, account: AccountStore) async {
        savingKeys = true
        defer { savingKeys = false }
        await sendSession(account)
        guard let answer = try? await engine.call(SaveAnswer.self, "Bridge.finder.espnSave(s2, swid, toAccount)",
                                                  ["s2": s2, "swid": swid, "toAccount": toAccount && espnSignedIn]) else {
            espnNote = .error("Something went wrong.")
            return
        }
        guard answer.ok else {
            espnNote = .error(answer.error ?? "Something went wrong.")
            return
        }
        s2 = ""
        swid = ""
        adding = false
        if let e = answer.accountError { espnNote = .error(e) }
        await drawPrivate()
        await loadEspnLeagues(account: account, force: true)
        if !espnInput.trimmingCharacters(in: .whitespaces).isEmpty {
            submitEspn(app: app)
            return
        }
        if answer.accountError == nil {
            espnNote = .message("✓ Keys saved. Your ESPN leagues are listed below; or enter a league's ID or link above.")
        }
    }

    func saveToAccount(_ swid: String, account: AccountStore) async {
        busySwid = swid
        defer { busySwid = nil }
        await sendSession(account)
        if let answer = try? await engine.call(SaveAnswer.self, "Bridge.finder.espnToAccount(swid)", ["swid": swid]),
           let e = answer.error {
            espnNote = .error(e)
        }
        await drawPrivate()
    }

    func forget(_ row: EspnAccount, account: AccountStore) async {
        busySwid = row.swid
        defer { busySwid = nil }
        await sendSession(account)
        if let answer = try? await engine.call(SaveAnswer.self, "Bridge.finder.espnForget(swid, onAccount)",
                                               ["swid": row.swid, "onAccount": row.account]),
           let e = answer.error {
            espnNote = .error(e)
        } else if !connected.contains(where: { $0.swid != row.swid }) {
            espnNote = .standard
        }
        // Where the keys stand first, so the list is asked for (or not)
        // with the keys that are left.
        await drawPrivate()
        await loadEspnLeagues(account: account, force: true)
    }

    /// A row's name: its leagues once ESPN has listed them.
    func title(for row: EspnAccount, index: Int) -> String {
        let names = leagueNamesBySwid[row.swid] ?? []
        if !names.isEmpty {
            return names.prefix(2).joined(separator: ", ") + (names.count > 2 ? " +\(names.count - 2) more" : "")
        }
        return connected.count > 1 ? "ESPN account \(index + 1)" : "Your ESPN account"
    }

    func detail(for row: EspnAccount) -> String {
        let place = row.local && row.account ? "on this device and on your account" : row.account ? "on your account" : "on this device"
        let id = row.swid.count > 6 ? String(row.swid.dropLast().suffix(5)) : row.swid
        return "Keys saved \(place) · ESPN id …\(id)"
    }

    var savedHint: String? {
        guard !connected.isEmpty, accountsAvailable else { return nil }
        if !connected.contains(where: { !$0.account }) {
            return "Your private ESPN leagues open on any device you sign in on, your phone included."
        }
        return espnSignedIn
            ? "Save keys to your account to open those private leagues on your other devices too, just by signing in there."
            : nil
    }

    // MARK: ESPN: the member's leagues

    private struct EspnListing: Decodable {
        let leagues: [EspnLeague]
        let refused: [String]
    }

    /// loadEspnLeagues: asked again only when the keys change hands.
    func loadEspnLeagues(account: AccountStore, force: Bool = false) async {
        let askFor = "\(localCount > 0)|\(account.user?.id ?? "")"
        if !force && askFor == espnAskedFor { return }
        espnAskedFor = askFor
        espnAsked += 1
        let turn = espnAsked
        if !relay || (localCount == 0 && !account.isSignedIn) {
            espnLeagues = nil
            espnListNote = nil
            return
        }
        do {
            let list = try await engine.call(EspnListing?.self, "Bridge.finder.espnLeagues()")
            guard turn == espnAsked else { return }
            guard let list else {
                espnLeagues = nil
                espnListNote = nil
                return
            }
            // A list with no keys on this device came from the account's keys.
            if localCount == 0 { onAccountKnown = true }
            var names: [String: [String]] = [:]
            list.leagues.forEach { l in if let s = l.swid { names[s, default: []].append(l.name) } }
            leagueNamesBySwid = names
            refusedSwids = list.refused
            withAnimation(.smooth) {
                espnLeagues = list.leagues
                espnListNote = list.leagues.isEmpty
                    ? "ESPN has no football leagues on the profile your keys belong to. You can still open one by its ID or link on the ESPN tab."
                    : nil
            }
        } catch EngineError.empty {
            // null: no keys to ask with
            guard turn == espnAsked else { return }
            espnLeagues = nil
            espnListNote = nil
        } catch {
            guard turn == espnAsked else { return }
            espnLeagues = []
            espnListNote = "ESPN didn't list your leagues (\(error.localizedDescription)). You can still open one by its ID or link on the ESPN tab."
        }
    }

    // MARK: The list under the form

    /// Whether the "Leagues found" card shows: something from either platform.
    var hasListing: Bool { sleeperLeagues != nil || espnLeagues != nil }

    var listingMeta: String {
        var parts: [String] = []
        if let s = sleeperLeagues, !s.isEmpty { parts.append("\(s.count) on Sleeper") }
        if let e = espnLeagues, !e.isEmpty { parts.append("\(e.count) on ESPN") }
        return parts.joined(separator: " · ")
    }

    var sleeperEmptyNote: String? {
        guard let s = sleeperLeagues, s.isEmpty else { return nil }
        return "No NFL leagues on Sleeper for \(sleeperUser?.name ?? username) in the last ten seasons."
    }
}
