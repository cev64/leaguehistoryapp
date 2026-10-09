import Foundation
import Observation
import SwiftUI

/// The app's state: which league is open, the leagues opened before, and
/// the member's account.
@MainActor
@Observable
final class AppModel {
    var league: LeagueSession?
    var recents: [RecentLeague] = RecentLeague.load()
    let account = AccountStore()

    /// Who was signed in when the open league last heard: signing in with
    /// a league open adds it to the account.
    @ObservationIgnored private var leagueUser: String?

    /// Opens a league by its id ("demo", a Sleeper id, "espn-<id>"). Signed
    /// in, a real league is added to the account once it loads; signed out,
    /// it opens all the same, unsynced (`Supabase.requireAccount`).
    func open(_ id: String) {
        let id = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return }
        if let league, league.id == id { return }
        // Only when the account is required (the site's rule): signed out, a
        // real league waits on the sign-in sheet and opens once they're in.
        guard account.mayOpen(id) else {
            closeLeague()
            account.askToSignIn(for: id)
            return
        }
        account.pending = nil
        account.gateFailure = nil
        league?.close()
        let session = LeagueSession(id: id, app: self)
        league = session
        leagueUser = account.user?.id
        // A session that changes while the league is open (signed in later,
        // a fresh token) goes to its engine too. Signed in later, the league
        // goes on the account; signed out, it stays open.
        account.observeSession("league") { [weak self] s in
            guard let self, let league = self.league else { return }
            if s == nil, !league.isDemo, Supabase.requireAccount {
                self.closeLeague()
                return
            }
            league.resendSession(s)
            let user = self.account.user?.id
            if let user, user != self.leagueUser { Task { await self.admit(league) } }
            self.leagueUser = user
        }
        Task {
            await account.freshen()
            await session.load()
            await admit(session)
        }
    }

    /// Opens a league the finder already knows the name of, so the sign-in
    /// sheet can say which league it's for.
    func open(_ id: String, name: String?, avatar: String? = nil) {
        account.hint(id, name: name, avatar: avatar)
        open(id)
    }

    /// The gate once the league has loaded: a real league is added to the
    /// member's account (sync_league), as account.js does. If it can't be,
    /// the account isn't needed to look at it, so it stays open and says
    /// why; on the site's rule it closes and the front page says why.
    func admit(_ session: LeagueSession) async {
        guard league === session, !session.isDemo, session.phase == .ready, let summary = session.summary else { return }
        if let message = await account.admit(summary), league === session {
            if Supabase.requireAccount {
                closeLeague()
                account.gateFailure = AccountStore.GateFailure(id: session.id, name: summary.name, message: message)
            } else {
                account.say("Couldn't add \(summary.name) to your account. \(message)")
            }
        }
    }

    func closeLeague() {
        league?.close()
        league = nil
    }

    func remember(_ summary: LeagueSummary) {
        guard !summary.demo else { return }
        let entry = RecentLeague(id: summary.leagueId, name: summary.name, avatar: summary.avatar,
                                 season: summary.currentYear, platform: summary.platform, at: Date())
        recents.removeAll { $0.id == entry.id }
        recents.insert(entry, at: 0)
        recents = Array(recents.prefix(8))
        RecentLeague.save(recents)
    }

    func forget(_ id: String) {
        recents.removeAll { $0.id == id }
        RecentLeague.save(recents)
    }
}

/// A league opened in the app: its engine (one hidden page, like one
/// browser tab) and the model it read.
@MainActor
@Observable
final class LeagueSession: Identifiable {
    enum Phase: Equatable {
        case loading(done: Int, total: Int)
        case ready
        case failed(String)
    }

    let id: String
    let engine: LeagueEngine
    var phase: Phase = .loading(done: 0, total: 0)
    var summary: LeagueSummary?
    /// The season the season screens show.
    var year: Int = Calendar.current.component(.year, from: Date())
    /// A sheet raised over the league (the league AI, the account).
    var sheet: LeagueSheet?
    private weak var app: AppModel?

    var isDemo: Bool { LeagueEngine.isDemo(id) }

    init(id: String, app: AppModel) {
        self.id = id
        self.app = app
        self.engine = LeagueEngine(leagueId: id)
    }

    func load() async {
        phase = .loading(done: 0, total: 0)
        engine.onProgress = { [weak self] done, total in
            self?.phase = .loading(done: done, total: total)
        }
        do {
            if let session = app?.account.engineSession {
                try? await engine.run("Bridge.setSession(s)", ["s": session])
            }
            let summary = try await engine.call(LeagueSummary.self, "Bridge.load()")
            self.summary = summary
            self.year = summary.opening?.year ?? summary.newest?.year ?? year
            app?.remember(summary)
            phase = .ready
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    /// Loaded again after a failure, then through the gate as the first
    /// load would have gone (sync_league).
    func retry() {
        Task {
            await load()
            await app?.admit(self)
        }
    }

    /// The member signed in or out, or their token was refreshed: the
    /// engine's `window.Account` stand-in hears it too.
    func resendSession(_ session: [String: Any]?) {
        Task { try? await engine.run("Bridge.setSession(s)", ["s": session ?? NSNull()]) }
    }

    func close() {
        engine.tearDown()
    }

    var season: Season? { summary?.season(year) }
}

struct RecentLeague: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let avatar: String?
    let season: Int?
    let platform: String?
    let at: Date

    private static let key = "lh-recent-leagues"

    static func load() -> [RecentLeague] {
        guard let data = UserDefaults.standard.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([RecentLeague].self, from: data)) ?? []
    }

    static func save(_ list: [RecentLeague]) {
        if let data = try? JSONEncoder().encode(list) { UserDefaults.standard.set(data, forKey: key) }
    }
}
