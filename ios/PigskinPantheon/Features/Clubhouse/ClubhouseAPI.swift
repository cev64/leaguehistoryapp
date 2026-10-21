import Foundation

/// The clubhouse's functions in Supabase (supabase/migrations/
/// 20261021000000_league_clubhouse.sql), called through PostgREST's /rpc
/// with the member's token, as the site's pages call them. Every one needs
/// a signed-in member; the boards come back as their JSON text, which the
/// engine reads (Bridge.clubhouse), so the app never second-guesses how the
/// site grades them.
enum ClubhouseAPI {
    /// Calls rpc/<name> and answers its body.
    static func call(_ name: String, _ body: [String: Any], token: String) async throws -> Data {
        let req = try Supabase.request("rest/v1/rpc/\(name)", method: "POST", token: token, body: body)
        do {
            let (data, _) = try await Supabase.perform(req)
            return data
        } catch let error as AccountError {
            throw ClubhouseError(error)
        }
    }

    static func decode<T: Decodable>(_ type: T.Type, _ name: String, _ body: [String: Any], token: String) async throws -> T {
        let data = try await call(name, body, token: token)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw ClubhouseError.message("The clubhouse gave an answer the app couldn't read.")
        }
    }

    private static func text(_ data: Data) -> String { String(decoding: data, as: UTF8.self) }
    private static func orNull(_ v: Any?) -> Any { v ?? NSNull() }

    // MARK: Members

    static func claims(key: String, token: String) async throws -> ClubhouseClaims {
        try await decode(ClubhouseClaims.self, "league_claims", ["p_league_key": key], token: token)
    }

    static func claim(key: String, owner: String, source: String, currentLeagueId: String, season: Int?, name: String?, token: String) async throws -> ClubhouseClaims {
        try await decode(ClubhouseClaims.self, "claim_manager", [
            "p_league_key": key, "p_owner_id": owner, "p_source": source,
            "p_current_league_id": currentLeagueId, "p_season": orNull(season), "p_name": orNull(name),
        ], token: token)
    }

    static func release(key: String, token: String) async throws {
        _ = try await call("release_manager", ["p_league_key": key], token: token)
    }

    static func myClubhouses(token: String) async throws -> [MyClubhouse] {
        try await decode([MyClubhouse].self, "my_clubhouses", [:], token: token)
    }

    /// nil leaves a notification as it is.
    static func setNotifications(key: String, recap: Bool?, pickem: Bool?, awards: Bool?, token: String) async throws {
        _ = try await call("set_league_notifications", [
            "p_league_key": key, "p_recap": orNull(recap), "p_pickem": orNull(pickem), "p_awards": orNull(awards),
        ], token: token)
    }

    // MARK: Pick'em

    struct Pick: Hashable, Codable {
        let a: String
        let b: String
        let winner: String
        let lock: Bool
    }

    /// Replaces the member's picks for a week (an empty list takes them all back).
    static func savePicks(key: String, season: Int, week: Int, picks: [Pick], token: String) async throws {
        let list: [[String: Any]] = picks.map { ["a": $0.a, "b": $0.b, "winner": $0.winner, "lock": $0.lock] }
        _ = try await call("save_picks", ["p_league_key": key, "p_season": season, "p_week": week, "p_picks": list], token: token)
    }

    /// pickem_board, as its JSON text.
    static func pickemBoard(key: String, season: Int, token: String) async throws -> String {
        text(try await call("pickem_board", ["p_league_key": key, "p_season": season], token: token))
    }

    // MARK: Awards

    /// A vote, or with a nil nominee, a vote taken back.
    static func vote(key: String, season: Int, week: Int, award: String, nominee: String?, token: String) async throws {
        _ = try await call("cast_vote", [
            "p_league_key": key, "p_season": season, "p_week": week, "p_award": award, "p_nominee": orNull(nominee),
        ], token: token)
    }

    /// award_board, as its JSON text.
    static func awardBoard(key: String, season: Int, token: String) async throws -> String {
        text(try await call("award_board", ["p_league_key": key, "p_season": season], token: token))
    }

    // MARK: Notifications

    static func registerDevice(token deviceToken: String, environment: String, token: String) async throws {
        _ = try await call("register_push_device", [
            "p_kind": "apns", "p_token": deviceToken, "p_p256dh": NSNull(), "p_auth": NSNull(), "p_env": environment,
        ], token: token)
    }

    static func unregisterDevice(token deviceToken: String, token: String) async throws {
        _ = try await call("unregister_push_device", ["p_token": deviceToken], token: token)
    }
}

/// The clubhouse functions' stable error codes, as sentences.
enum ClubhouseError: LocalizedError, Equatable {
    case code(String)
    case message(String)
    case offline

    init(_ error: AccountError) {
        switch error {
        case .offline: self = .offline
        case .server(_, let raw):
            let code = raw.trimmingCharacters(in: .whitespaces)
            self = Self.sentences[code] != nil ? .code(code) : .message(AccountStore.explain(raw))
        }
    }

    var code: String? {
        if case .code(let c) = self { return c }
        return nil
    }

    static let sentences: [String: String] = [
        "not_signed_in": "Sign in first.",
        "bad_league": "This league can't have a clubhouse.",
        "bad_manager": "That team can't be claimed.",
        "taken": "Someone in your league has already claimed that team. If it's yours, ask them to let it go.",
        "not_a_member": "Claim your team in this league first.",
        "locked": "Picks for this week are locked: the first game has kicked off.",
        "two_locks": "Only one game can be your Lock of the Week.",
        "bad_picks": "Those picks didn't add up. Try again.",
        "bad_week": "That week isn't open.",
        "bad_award": "That isn't one of the week's awards.",
        "bad_nominee": "That team can't be voted for.",
        "not_open": "Voting opens once the week has kicked off.",
        "closed": "Voting for this week has closed.",
        "bad_device": "This device couldn't be set up for notifications. Try again later.",
    ]

    var errorDescription: String? {
        switch self {
        case .code(let c): return Self.sentences[c] ?? "Something went wrong."
        case .message(let m): return m
        case .offline: return "Couldn't reach the clubhouse. Check your connection."
        }
    }
}
