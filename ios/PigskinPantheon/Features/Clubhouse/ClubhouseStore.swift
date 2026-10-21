import Foundation
import Observation
import SwiftUI

/// A league's clubhouse (one per open league, kept by its LeagueSession):
/// who the member is in the league (their claimed manager), the season's
/// pick'em and award boards, and the picks and votes being saved.
///
/// A real league talks to Supabase (ClubhouseAPI) and needs an account and
/// a claimed team; the app still opens it without either, and only the
/// clubhouse asks. The demo league (no league key) runs on the device: its
/// league-mates are made up by clubhouse.js (Bridge.clubhouse.demo) and the
/// visitor's own team, picks and votes are kept in UserDefaults
/// ("pp-clubhouse-demo-<year>"), so the demo shows a full leaderboard
/// without an account.
@MainActor
@Observable
final class ClubhouseStore {
    enum Access: Equatable {
        /// Not worked out yet.
        case unknown
        /// A real league, signed out: the clubhouse asks to sign in.
        case signedOut
        /// Signed in (or the demo) without a team claimed.
        case unclaimed
        case member
        /// A league that can't have a clubhouse, or the server didn't answer.
        case unavailable(String)
    }

    enum SaveState: Equatable {
        case idle, saving, saved
        case failed(String)
    }

    /// A pick being made: the game's two teams, the winner and the lock.
    struct Draft: Equatable {
        let a: String
        let b: String
        var winner: String
        var lock: Bool
    }

    let engine: LeagueEngine
    let leagueId: String
    let isDemo: Bool
    @ObservationIgnored let account: AccountStore

    private(set) var info: ClubhouseInfo?
    private(set) var access: Access = .unknown
    /// The managers someone has claimed (owner ids).
    private(set) var claimed: [String] = []
    /// The member's manager (owner id).
    private(set) var me: String?
    /// Which notifications the member wants from this league, as the server
    /// has them (league_claims().mine): off until they turn one on here.
    private(set) var notify = ClubhouseNotify.off
    /// Bumped whenever a board changes: the cards read their week again.
    private(set) var revision = 0
    /// Each season's boards, as their JSON text.
    private(set) var pickemBoards: [Int: String] = [:]
    private(set) var awardBoards: [Int: String] = [:]
    /// The week's picks while they're being made and saved ("year-week" → game key → pick).
    private(set) var drafts: [String: [String: Draft]] = [:]
    private(set) var saveStates: [String: SaveState] = [:]
    /// Votes cast but not yet on the board ("year-week-award" → team id, or "" taken back).
    private(set) var voteDrafts: [String: String] = [:]
    private(set) var voteError: String?
    /// What to do once the member has claimed a team (the pick they tapped first).
    @ObservationIgnored var afterClaim: (() -> Void)?

    @ObservationIgnored private var resolvedFor: String?
    /// claim_manager has refreshed the league's row this session.
    @ObservationIgnored private var refreshedLeagueRow = false
    @ObservationIgnored private var resolving: Task<Void, Never>?
    @ObservationIgnored private var loading: [Int: Task<Void, Never>] = [:]
    @ObservationIgnored private var saveTasks: [String: Task<Void, Never>] = [:]
    @ObservationIgnored private var draftGeneration: [String: Int] = [:]

    init(engine: LeagueEngine, leagueId: String, account: AccountStore) {
        self.engine = engine
        self.leagueId = leagueId
        self.isDemo = LeagueEngine.isDemo(leagueId)
        self.account = account
    }

    var key: String? { info?.key }
    var isMember: Bool { access == .member }

    /// The member's team in a season.
    func myTeam(in season: Season) -> String? {
        guard let me else { return nil }
        return season.teams.first { $0.value.ownerId == me }?.key
    }

    func team(of owner: String, in season: Season) -> String? {
        season.teams.first { $0.value.ownerId == owner }?.key
    }

    // MARK: Who the member is

    /// Works out the member's place in the league (once per account), and
    /// reads the season's boards.
    func prepare(year: Int) async {
        let user = account.user?.id ?? "-"
        if resolvedFor != user {
            if let resolving { await resolving.value } else {
                let task = Task { await self.resolve(user: user) }
                resolving = task
                await task.value
                resolving = nil
            }
        }
        await load(year: year)
    }

    private func resolve(user: String) async {
        do {
            if info == nil { info = try await engine.call(ClubhouseInfo.self, "Bridge.clubhouse.info()") }
        } catch {
            access = .unavailable("The clubhouse couldn't be opened. \(error.localizedDescription)")
            return
        }
        guard let info else { return }
        if isDemo {
            await applyLaunchSettings(info)
            me = Demo.load(year: info.season ?? 0).me
            claimed = me.map { [$0] } ?? []
            access = me == nil ? .unclaimed : .member
            resolvedFor = user
            return
        }
        guard let key = info.key else {
            access = .unavailable("This league can't have a clubhouse.")
            resolvedFor = user
            return
        }
        guard account.isSignedIn else {
            reset(to: .signedOut)
            resolvedFor = user
            return
        }
        do {
            let token = try await accessToken()
            apply(try await ClubhouseAPI.claims(key: key, token: token))
            resolvedFor = user
            // Once a session, a member's claim made again (no change to who's
            // who): it keeps the league's row on its newest season, so the
            // push sender follows a Sleeper league into its renewal.
            if let me, !refreshedLeagueRow {
                refreshedLeagueRow = true
                _ = try? await ClubhouseAPI.claim(key: key, owner: me, source: info.source, currentLeagueId: info.leagueId,
                                                  season: info.season, name: info.name, token: token)
            }
        } catch {
            access = .unavailable(error.localizedDescription)
        }
    }

    private func reset(to access: Access) {
        self.access = access
        me = nil
        claimed = []
        pickemBoards = [:]
        awardBoards = [:]
        drafts = [:]
        voteDrafts = [:]
        notify = .off
        revision += 1
    }

    private func apply(_ claims: ClubhouseClaims) {
        claimed = claims.claimed
        let was = me
        me = claims.mine?.owner_id
        notify = claims.mine.map { ClubhouseNotify(recap: $0.notify_recap, pickem: $0.notify_pickem, awards: $0.notify_awards) } ?? .off
        access = me == nil ? .unclaimed : .member
        if was != me {
            pickemBoards = [:]
            awardBoards = [:]
            revision += 1
        }
    }

    private func accessToken() async throws -> String {
        guard account.isSignedIn else { throw ClubhouseError.code("not_signed_in") }
        guard await account.freshen(), let token = account.accessToken else { throw ClubhouseError.offline }
        return token
    }

    /// What has to happen before the member can pick or vote: signing in, or
    /// claiming their team. nil when they're set.
    var gate: LeagueSheet? {
        switch access {
        case .signedOut: return .clubhouseSignIn
        case .unclaimed: return .claim
        default: return nil
        }
    }

    /// "I'm this manager." In the demo it's kept on the device.
    func claim(_ owner: String) async throws {
        guard let info else { return }
        if isDemo {
            var saved = Demo.load(year: info.season ?? 0)
            if saved.me != owner {
                // The picks and votes were the other team's; the new team
                // keeps the weeks its made-up manager had already picked.
                saved = Demo.Saved(me: owner, picks: await demoHistory(owner, year: info.season ?? 0), votes: [])
            }
            Demo.save(saved, year: info.season ?? 0)
            me = owner
            claimed = [owner]
            access = .member
            pickemBoards = [:]
            awardBoards = [:]
            drafts = [:]
            voteDrafts = [:]
            revision += 1
        } else {
            guard let key = info.key else { return }
            let token = try await accessToken()
            apply(try await ClubhouseAPI.claim(key: key, owner: owner, source: info.source, currentLeagueId: info.leagueId,
                                               season: info.season, name: info.name, token: token))
        }
        let next = afterClaim
        afterClaim = nil
        next?()
    }

    /// Lets the member's team go.
    func release() async throws {
        guard let info else { return }
        if isDemo {
            Demo.save(Demo.Saved(me: nil, picks: [], votes: []), year: info.season ?? 0)
            reset(to: .unclaimed)
            return
        }
        guard let key = info.key else { return }
        let token = try await accessToken()
        try await ClubhouseAPI.release(key: key, token: token)
        reset(to: .unclaimed)
        if let claims = try? await ClubhouseAPI.claims(key: key, token: token) { apply(claims) }
    }

    /// Whose the other managers are, fresh, for the claim sheet.
    func refreshClaims() async {
        guard !isDemo, let key, account.isSignedIn, let token = try? await accessToken(),
              let claims = try? await ClubhouseAPI.claims(key: key, token: token) else { return }
        apply(claims)
    }

    // MARK: The boards

    func pickemBoard(_ year: Int) -> String { pickemBoards[year] ?? "" }
    func awardBoard(_ year: Int) -> String { awardBoards[year] ?? "" }

    /// Reads a season's boards (once; `reload` reads them again).
    func load(year: Int) async {
        if pickemBoards[year] != nil, awardBoards[year] != nil { return }
        if let task = loading[year] { return await task.value }
        let task = Task { await self.fetch(year: year) }
        loading[year] = task
        await task.value
        loading[year] = nil
    }

    func reload(year: Int) async {
        await fetch(year: year)
    }

    private func fetch(year: Int) async {
        if isDemo {
            let saved = Demo.load(year: year)
            let mine = Demo.mineJSON(saved)
            guard let boards = try? await engine.call(ClubhouseDemoBoards.self, "Bridge.clubhouse.demo(year, me, mine)",
                                                      ["year": year, "me": me ?? NSNull(), "mine": mine]) else { return }
            pickemBoards[year] = boards.pickem
            awardBoards[year] = boards.awards
            revision += 1
            return
        }
        guard access == .member, let key, let token = try? await accessToken() else { return }
        async let p = ClubhouseAPI.pickemBoard(key: key, season: year, token: token)
        async let a = ClubhouseAPI.awardBoard(key: key, season: year, token: token)
        do {
            let (pick, award) = try await (p, a)
            pickemBoards[year] = pick
            awardBoards[year] = award
            revision += 1
        } catch let error as ClubhouseError where error.code == "not_a_member" {
            // The claim went (released elsewhere, or by hand).
            reset(to: .unclaimed)
        } catch {
            // Kept as it was; the next look tries again.
        }
    }

    // MARK: Asking the engine

    func week(year: Int, week: Int) async -> PickemWeek? {
        try? await engine.call(PickemWeek.self, "Bridge.clubhouse.week(year, week, board)",
                               ["year": year, "week": week, "board": pickemBoard(year)])
    }

    func standings(year: Int) async -> PickemStandings? {
        try? await engine.call(PickemStandings.self, "Bridge.clubhouse.grade(year, board)", ["year": year, "board": pickemBoard(year)])
    }

    func awards(year: Int, week: Int) async -> AwardsWeek? {
        try? await engine.call(AwardsWeek.self, "Bridge.clubhouse.awards(year, week, board)",
                               ["year": year, "week": week, "board": awardBoard(year)])
    }

    func seasonAwards(year: Int) async -> [SeasonAwardWeek] {
        (try? await engine.call([SeasonAwardWeek].self, "Bridge.clubhouse.seasonAwards(year, board)",
                                ["year": year, "board": awardBoard(year)])) ?? []
    }

    func share(year: Int, week: Int) async throws -> WeekShareData {
        try await engine.call(WeekShareData.self, "Bridge.clubhouse.share(year, week, pickem, awards)",
                              ["year": year, "week": week, "pickem": pickemBoard(year), "awards": awardBoard(year)])
    }

    // MARK: Picks

    static func weekKey(_ year: Int, _ week: Int) -> String { "\(year)-\(week)" }

    func saveState(year: Int, week: Int) -> SaveState { saveStates[Self.weekKey(year, week)] ?? .idle }

    /// The member's picks for a week as they stand: being made, or as saved.
    func picks(for week: PickemWeek) -> [String: Draft] {
        if let draft = drafts[Self.weekKey(week.year, week.week)] { return draft }
        var out: [String: Draft] = [:]
        for g in week.games {
            if let mine = g.mine { out[g.key] = Draft(a: g.a, b: g.b, winner: mine, lock: g.myLock) }
        }
        return out
    }

    /// A tap on a side: picked to win, or taken back if it was.
    func pick(_ team: String, in game: PickemWeek.Game, of week: PickemWeek) {
        var draft = picks(for: week)
        if draft[game.key]?.winner == team {
            draft[game.key] = nil
        } else {
            draft[game.key] = Draft(a: game.a, b: game.b, winner: team, lock: draft[game.key]?.lock ?? false)
        }
        change(draft, week)
    }

    /// The Lock of the Week: this game (one a week), or none if it was.
    func toggleLock(_ game: PickemWeek.Game, of week: PickemWeek) {
        var draft = picks(for: week)
        guard draft[game.key] != nil else { return }
        let on = !(draft[game.key]?.lock ?? false)
        for k in draft.keys { draft[k]?.lock = false }
        draft[game.key]?.lock = on
        change(draft, week)
    }

    private func change(_ draft: [String: Draft], _ week: PickemWeek) {
        let k = Self.weekKey(week.year, week.week)
        drafts[k] = draft
        draftGeneration[k, default: 0] += 1
        saveStates[k] = .saving
        saveTasks[k]?.cancel()
        let generation = draftGeneration[k] ?? 0
        saveTasks[k] = Task { [weak self] in
            // A run of taps saves once.
            try? await Task.sleep(for: .milliseconds(isDemo ? 250 : 700))
            guard !Task.isCancelled else { return }
            await self?.save(year: week.year, week: week.week, games: week.games, generation: generation)
        }
    }

    /// Saves the week's picks as they stand (again, after a failure).
    func retrySave(year: Int, week: Int, games: [PickemWeek.Game]) {
        Task { await save(year: year, week: week, games: games, generation: draftGeneration[Self.weekKey(year, week)] ?? 0) }
    }

    private func save(year: Int, week: Int, games: [PickemWeek.Game], generation: Int) async {
        let k = Self.weekKey(year, week)
        guard let draft = drafts[k] else { return }
        // In the slate's order, as the site sends them.
        let picks = games.compactMap { g in draft[g.key].map { ClubhouseAPI.Pick(a: $0.a, b: $0.b, winner: $0.winner, lock: $0.lock) } }
        saveStates[k] = .saving
        do {
            if isDemo {
                var saved = Demo.load(year: year)
                saved.picks.removeAll { $0.week == week }
                saved.picks += games.compactMap { g in
                    draft[g.key].map { Demo.Pick(week: week, game: g.key, winner: $0.winner, lock: $0.lock) }
                }
                Demo.save(saved, year: year)
            } else {
                guard let key else { return }
                let token = try await accessToken()
                try await ClubhouseAPI.savePicks(key: key, season: year, week: week, picks: picks, token: token)
            }
            // The draft stays the card's picks: it is what was just saved.
            // Dropping it here, before the card had read the new board,
            // showed the old picks for a moment (the tap flickered back),
            // then the new ones again.
            if draftGeneration[k] == generation { saveStates[k] = .saved }
            await fetch(year: year)
        } catch let error as ClubhouseError where error.code == "locked" {
            drafts[k] = nil
            saveStates[k] = .failed(error.localizedDescription)
            await fetch(year: year)
        } catch {
            if draftGeneration[k] == generation { saveStates[k] = .failed(error.localizedDescription) }
        }
    }

    // MARK: Votes

    static func voteKey(_ year: Int, _ week: Int, _ award: String) -> String { "\(year)-\(week)-\(award)" }

    /// The member's vote for an award as it stands (being cast, or on the board).
    func vote(_ award: AwardsWeek.Award, year: Int, week: Int) -> String? {
        if let draft = voteDrafts[Self.voteKey(year, week, award.id)] { return draft.isEmpty ? nil : draft }
        return award.mine
    }

    /// A tap on a nominee: the vote, or taken back if it was the vote already.
    func vote(for team: String, award: AwardsWeek.Award, year: Int, week: Int) {
        let k = Self.voteKey(year, week, award.id)
        let current = vote(award, year: year, week: week)
        let next: String? = current == team ? nil : team
        voteDrafts[k] = next ?? ""
        voteError = nil
        Task {
            do {
                if isDemo {
                    var saved = Demo.load(year: year)
                    saved.votes.removeAll { $0.week == week && $0.award == award.id }
                    if let next { saved.votes.append(Demo.Vote(week: week, award: award.id, nominee: next)) }
                    Demo.save(saved, year: year)
                } else {
                    guard let key else { return }
                    let token = try await accessToken()
                    try await ClubhouseAPI.vote(key: key, season: year, week: week, award: award.id, nominee: next, token: token)
                }
                // The vote stays as cast (voteDrafts): clearing it before
                // the card had read the new board flickered it back.
                await fetch(year: year)
            } catch {
                voteDrafts[k] = nil
                voteError = error.localizedDescription
            }
        }
    }

    // MARK: Notifications

    /// Some of this league's notifications are on for the account, but this
    /// device doesn't get them (turned on elsewhere, or by another account
    /// here): the card offers to turn them on here.
    var notOnThisDevice: Bool { notify.any && !PushCenter.shared.enabled && !PushCenter.shared.denied }

    private(set) var notifyError: String?

    /// A switch flipped: this league's notifications only
    /// (set_league_notifications for this league key; every other league
    /// keeps its own). Turning one on asks iOS first (the only time the app
    /// asks), and registers the device with the account.
    func setNotify(_ new: ClubhouseNotify) async {
        guard !isDemo, let key else { return }
        notifyError = nil
        let wanted = new
        if new.any, !PushCenter.shared.enabled {
            guard await enableHere() else { return }
        }
        let before = notify
        notify = wanted
        do {
            let token = try await accessToken()
            try await ClubhouseAPI.setNotifications(key: key, recap: wanted.recap, pickem: wanted.pickem, awards: wanted.awards, token: token)
        } catch {
            notify = before
            notifyError = error.localizedDescription
        }
    }

    /// Notifications on this device for the member (iOS asked the first
    /// time). False, with the reason shown, if iOS says no.
    @discardableResult
    func enableHere() async -> Bool {
        notifyError = nil
        guard await PushCenter.shared.enable() else {
            notifyError = "Notifications are off for Pigskin Pantheon. Turn them on in Settings."
            return false
        }
        // The account couldn't take the device (register_push_device's bad_device, say).
        if let error = PushCenter.shared.registerError {
            notifyError = error
            return false
        }
        return true
    }

    /// Debug builds: SIMCTL_CHILD_PP_CLUBHOUSE_ME=<owner id> (or "none")
    /// claims a demo team, and PP_CLUBHOUSE_PICKS="r3*,r1,r10" makes the
    /// pick week's picks (the teams picked to win, * the Lock of the Week).
    private func applyLaunchSettings(_ info: ClubhouseInfo) async {
        guard let year = info.season, let me = DebugLaunch.clubhouseMe else { return }
        if me == "none" {
            Demo.save(Demo.Saved(me: nil, picks: [], votes: []), year: year)
            return
        }
        var saved = Demo.load(year: year)
        if saved.me != me { saved = Demo.Saved(me: me, picks: await demoHistory(me, year: year), votes: []) }
        if let teams = DebugLaunch.clubhousePicks, let week = info.pickWeek,
           let slate = try? await engine.call(PickemWeek.self, "Bridge.clubhouse.week(year, week, null)", ["year": year, "week": week]) {
            saved.picks.removeAll { $0.week == week }
            for raw in teams {
                let lock = raw.hasSuffix("*")
                let team = lock ? String(raw.dropLast()) : raw
                if let g = slate.games.first(where: { $0.a == team || $0.b == team }) {
                    saved.picks.append(Demo.Pick(week: week, game: g.key, winner: team, lock: lock))
                }
            }
        }
        Demo.save(saved, year: year)
    }

    /// The picks the demo's made-up manager of a team had made, for the
    /// weeks already locked, so a visitor who takes the team over has its
    /// season so far.
    private func demoHistory(_ owner: String, year: Int) async -> [Demo.Pick] {
        guard let boards = try? await engine.call(ClubhouseDemoBoards.self, "Bridge.clubhouse.demo(year, null, null)", ["year": year]),
              let json = try? JSONSerialization.jsonObject(with: Data(boards.pickem.utf8)) as? [String: Any],
              let picks = json["picks"] as? [[String: Any]] else { return [] }
        return picks.compactMap { p in
            guard p["owner"] as? String == owner, let week = (p["week"] as? NSNumber)?.intValue,
                  let game = p["game"] as? String, let winner = p["winner"] as? String else { return nil }
            return Demo.Pick(week: week, game: game, winner: winner, lock: (p["lock"] as? Bool) ?? false)
        }
    }

    // MARK: The demo, on the device

    enum Demo {
        struct Pick: Codable, Hashable { let week: Int; let game: String; let winner: String; let lock: Bool }
        struct Vote: Codable, Hashable { let week: Int; let award: String; let nominee: String }
        struct Saved: Codable {
            var me: String?
            var picks: [Pick]
            var votes: [Vote]
        }

        static func key(_ year: Int) -> String { "pp-clubhouse-demo-\(year)" }

        static func load(year: Int) -> Saved {
            guard let data = UserDefaults.standard.data(forKey: key(year)),
                  let saved = try? JSONDecoder().decode(Saved.self, from: data) else { return Saved(me: nil, picks: [], votes: []) }
            return saved
        }

        static func save(_ saved: Saved, year: Int) {
            if let data = try? JSONEncoder().encode(saved) { UserDefaults.standard.set(data, forKey: key(year)) }
        }

        /// The visitor's picks and votes, as demoBoard takes them.
        static func mineJSON(_ saved: Saved) -> String {
            struct Mine: Encodable { let picks: [Pick]; let votes: [Vote] }
            let data = (try? JSONEncoder().encode(Mine(picks: saved.picks, votes: saved.votes))) ?? Data("{}".utf8)
            return String(decoding: data, as: UTF8.self)
        }
    }
}
