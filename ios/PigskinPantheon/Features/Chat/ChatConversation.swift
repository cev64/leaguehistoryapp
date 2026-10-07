import Foundation
import Observation

/// What the member sees: a question, an answer, or why there wasn't one.
struct ChatMessage: Identifiable, Hashable {
    enum Role: Hashable { case user, assistant }
    let id = UUID()
    let role: Role
    let text: String
    var error = false
    /// An error bubble offers "Try again" unless trying again can't help.
    var retry = false
    /// The function said the member isn't signed in: offer the way in.
    var signIn = false
}

/// The answer being written: its status line while it works, then the words.
struct ChatPending: Equatable {
    var status: String
    var text = ""
    /// A tool is running (the site rings the bubble in blue).
    var looking = false
}

/// The member's session token for a request: `force` refreshes it first
/// (the function turned the last one down). Nil when signed out.
typealias ChatToken = @MainActor (_ force: Bool) async -> String?

/// What the screen needs from the engine before anything is asked.
struct ChatIntro: Decodable {
    let name: String
    let endpoint: String
    let anonKey: String?
    let pricing: Bool
    let proPrice: String
    let passPrice: String
    let suggestions: [String]
}

/// One league's conversation with the League Historian: chat.js's mount()
/// and ask loop. It lives for the app session (the site keeps it in
/// sessionStorage for the tab), so closing the sheet and opening it again,
/// or moving between the league's tabs, picks up where it left off; an
/// answer being written keeps going while the sheet is closed.
@MainActor
@Observable
final class ChatConversation {
    /// A conversation this long is closed for a fresh one: the AI reads all
    /// of it on every question. One question can add up to 18 turns (eight
    /// look-ups), which still fits under the function's 80.
    static let maxTurns = 60
    static let maxToolRounds = 8
    /// The longest question the league-chat function takes (MAX_QUESTION),
    /// counted as JavaScript counts a string's length: UTF-16 units.
    static let maxQuestion = 2000

    /// `text` cut to the function's limit, never splitting a character.
    static func clipped(_ text: String) -> String {
        guard text.utf16.count > maxQuestion else { return text }
        var out = ""
        var units = 0
        for character in text {
            let n = character.utf16.count
            if units + n > maxQuestion { break }
            out.append(character)
            units += n
        }
        return out
    }

    static let working: [String: String] = [
        "box_score": "Pulling the box scores",
        "player_history": "Tracing a player's history",
        "team_season": "Going through that season",
        "top_performances": "Searching the best weeks",
        "trades": "Digging through every trade",
        "waiver_pickups": "Checking the waiver wire",
        "draft": "Opening the draft board",
        "lineup_efficiency": "Grading lineups",
    ]
    static let workingStart = ["Reading the record book", "Flipping through old seasons", "Checking the standings"]

    private static var all: [String: ChatConversation] = [:]

    /// The league's conversation, kept for the app session.
    static func of(league id: String) -> ChatConversation {
        if let found = all[id] { return found }
        let made = ChatConversation(leagueId: id)
        all[id] = made
        return made
    }

    let leagueId: String

    /// What the API sees: every turn, tool calls included, as JSON.
    @ObservationIgnored private(set) var history: [[String: Any]] = [] { didSet { historyCount = history.count } }
    private(set) var historyCount = 0
    /// What the member sees.
    private(set) var shown: [ChatMessage] = []
    private(set) var pending: ChatPending?
    private(set) var intro: ChatIntro?
    private(set) var introError: String?

    /// Haptics: a question sent, an answer finished, an answer that failed.
    private(set) var sentCount = 0
    private(set) var answeredCount = 0
    private(set) var failedCount = 0

    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var digestJob: Task<String, Error>?
    /// Bumped by a new chat, so an answer cancelled by it doesn't write
    /// itself into the fresh conversation.
    @ObservationIgnored private var generation = 0

    var busy: Bool { pending != nil }
    var full: Bool { historyCount >= Self.maxTurns }
    /// "This chat is getting long": the site's note under the log.
    var long: Bool { shown.count >= Self.maxTurns / 2 || full }

    private init(leagueId: String) {
        self.leagueId = leagueId
    }

    // MARK: Opening

    /// The welcome's name and suggestions, and where questions go.
    func prepare(engine: LeagueEngine) async {
        guard intro == nil else { return }
        do {
            intro = try await engine.call(ChatIntro.self, "Bridge.chat.intro()")
            introError = nil
        } catch {
            introError = error.localizedDescription
        }
    }

    /// Starts writing the league out while the member types.
    func warm(engine: LeagueEngine) {
        _ = digest(engine: engine)
    }

    private func digest(engine: LeagueEngine) -> Task<String, Error> {
        if let digestJob { return digestJob }
        let job = Task { @MainActor in
            try await engine.call(String.self, "Bridge.chat.digest()")
        }
        digestJob = job
        return job
    }

    // MARK: Asking

    func fresh() {
        task?.cancel()
        task = nil
        generation += 1
        history = []
        shown = []
        pending = nil
    }

    func stop() {
        task?.cancel()
    }

    /// The last question again, after an error (its bubble's "Try again").
    func retry(engine: LeagueEngine, token: @escaping ChatToken) {
        guard shown.count >= 2, shown[shown.count - 2].role == .user else { return }
        let last = shown[shown.count - 2].text
        shown.removeLast(2)
        ask(last, engine: engine, token: token)
    }

    func ask(_ question: String, engine: LeagueEngine, token: @escaping ChatToken) {
        let question = Self.clipped(question.trimmingCharacters(in: .whitespacesAndNewlines))
        guard !question.isEmpty, !busy, !full, let intro else { return }
        let mark = history.count
        let markShown = shown.count
        history.append(["role": "user", "content": question])
        shown.append(ChatMessage(role: .user, text: question))
        pending = ChatPending(status: Self.workingStart[0])
        sentCount += 1
        let generation = self.generation

        task = Task { @MainActor [weak self] in
            guard let self else { return }
            // The status line cycles while nothing is written yet.
            let cycler = Task { @MainActor [weak self] in
                var tick = 0
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(2.6))
                    guard !Task.isCancelled, let self, var p = self.pending, p.text.isEmpty, !p.looking else { continue }
                    tick += 1
                    p.status = Self.workingStart[tick % Self.workingStart.count]
                    self.pending = p
                }
            }
            defer { cycler.cancel() }

            var text = ""
            do {
                // Stop answers at once, even while the league is still
                // being written out (the digest itself carries on for the
                // next question).
                let job = self.digest(engine: engine)
                let leagueText = try await Self.cancellable { try await job.value }
                try Task.checkCancellation()
                var round = 0
                while true {
                    if round > Self.maxToolRounds {
                        throw ChatFailure(message: "That one needed too many look-ups. Try asking it more narrowly.", code: "too_many_steps")
                    }
                    round += 1
                    if !text.isEmpty, !text.hasSuffix("\n\n") { text += "\n\n" }
                    let body: [String: Any] = ["league": intro.name, "digest": leagueText, "messages": self.history]
                    var endpoint = intro.endpoint
                    #if DEBUG
                    // A stand-in for the function on this Mac (PP_CHAT_URL),
                    // to check streaming and tool rounds without an account.
                    if let url = ProcessInfo.processInfo.environment["PP_CHAT_URL"], !url.isEmpty { endpoint = url }
                    #endif
                    let onEvent: @MainActor (ChatStreamEvent) -> Void = { event in
                        guard self.generation == generation, var p = self.pending else { return }
                        switch event {
                        case .text(let d):
                            text += d
                            p.text = text
                        case .tool(let name):
                            p.status = Self.working[name] ?? "Looking it up"
                            p.looking = true
                        }
                        self.pending = p
                    }
                    let done: ChatTurn
                    let sent = await token(false)
                    do {
                        done = try await ChatClient.post(endpoint: endpoint, anonKey: intro.anonKey, token: sent, body: body, onEvent: onEvent)
                    } catch let failure as ChatFailure where failure.code == "not_signed_in" && sent != nil {
                        // The session ran out between the check and the
                        // request (or was revoked): refreshed once, then
                        // asked again. A 401 is answered before anything
                        // streams, so nothing was written yet.
                        guard let fresh = await token(true) else { throw failure }
                        try Task.checkCancellation()
                        done = try await ChatClient.post(endpoint: endpoint, anonKey: intro.anonKey, token: fresh, body: body, onEvent: onEvent)
                    }
                    if done.stop == "refusal" {
                        throw ChatFailure(message: "The league AI won't answer that one. Try asking another way.", code: "refusal")
                    }
                    // An empty turn can't be sent back next time; it stands as a line.
                    let content = done.content.isEmpty ? [["type": "text", "text": "I couldn't find an answer to that."]] : done.content
                    let uses = content.filter { ($0["type"] as? String) == "tool_use" }
                    if done.stop == "max_tokens", !uses.isEmpty {
                        throw ChatFailure(message: "That answer ran too long. Try asking something narrower.", code: "max_tokens")
                    }
                    self.history.append(["role": "assistant", "content": content])
                    if done.stop != "tool_use" || uses.isEmpty { break }

                    // The AI asked for detail: worked out in the engine, from
                    // the data the app already has, every result in one turn.
                    self.pending?.looking = true
                    let results = try await self.runTools(uses, engine: engine)
                    try Task.checkCancellation()
                    self.history.append(["role": "user", "content": results])
                    self.pending?.looking = false
                    self.pending?.status = "Writing it up"
                }
                guard self.generation == generation else { return }
                let final = text.trimmingCharacters(in: .whitespacesAndNewlines)
                self.shown.append(ChatMessage(role: .assistant,
                                              text: final.isEmpty ? "I couldn't find an answer to that in the league's history." : final))
                self.answeredCount += 1
            } catch {
                guard self.generation == generation else { return }
                // The question and anything after it come off the
                // conversation, so the next one starts clean.
                if self.history.count > mark { self.history.removeSubrange(mark...) }
                if error is CancellationError || ChatClient.isCancellation(error) {
                    // What was written so far stays on screen, marked as
                    // stopped; the AI won't see it.
                    if self.shown.count > markShown { self.shown.removeSubrange(markShown...) }
                    let partial = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !partial.isEmpty {
                        self.shown.append(ChatMessage(role: .user, text: question))
                        self.shown.append(ChatMessage(role: .assistant, text: "\(partial)\n\n*(stopped)*"))
                    }
                } else {
                    let failure = error as? ChatFailure
                    let code = failure?.code ?? ""
                    let message: String
                    if code == "not_set_up" {
                        message = "The league AI isn't switched on for this site yet."
                    } else if let failure, !failure.message.isEmpty {
                        message = failure.message
                    } else {
                        message = error.localizedDescription.isEmpty ? "Something went wrong. Try again." : error.localizedDescription
                    }
                    let final = ["not_set_up", "not_set_up_upstream", "pro_required", "daily_limit"].contains(code)
                    self.shown.append(ChatMessage(role: .assistant, text: message, error: true, retry: !final,
                                                  signIn: code == "not_signed_in"))
                    self.failedCount += 1
                }
            }
            if self.generation == generation {
                self.pending = nil
                self.task = nil
            }
        }
    }

    /// Runs the tool calls in the engine (Bridge.chat.runTools: chat.js's own
    /// tools, inputs checked as chat.js checks them) and returns the
    /// tool_result blocks.
    private func runTools(_ uses: [[String: Any]], engine: LeagueEngine) async throws -> [[String: Any]] {
        let json = String(decoding: try JSONSerialization.data(withJSONObject: uses), as: UTF8.self)
        // A look-up can take a while (a player's moves read every season's
        // transactions); stop doesn't wait for it.
        let data = try await Self.cancellable { try await engine.callData("Bridge.chat.runTools(uses)", ["uses": json]) }
        let envelope = (try JSONSerialization.jsonObject(with: data)) as? [String: Any]
        if let error = envelope?["error"] as? String { throw EngineError.script(error) }
        guard let results = envelope?["ok"] as? [[String: Any]] else { throw EngineError.empty }
        return results
    }

    /// Waits for `work` (which runs on regardless) but gives up the moment
    /// the waiting task is cancelled: the stop button stops at once.
    private static func cancellable<T>(_ work: @escaping @MainActor () async throws -> T) async throws -> T {
        let box = ResumeOnce<T>()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<T, Error>) in
                box.continuation = continuation
                Task { @MainActor in
                    do { box.resume(.success(try await work())) } catch { box.resume(.failure(error)) }
                }
            }
        } onCancel: {
            Task { @MainActor in box.resume(.failure(CancellationError())) }
        }
    }

    #if DEBUG
    /// A finished conversation to look at without asking anything (the
    /// launch setting PP_CHAT=sample): every mark the renderer knows.
    func loadSample(_ messages: [ChatMessage]) {
        guard shown.isEmpty else { return }
        shown = messages
    }

    /// Runs tools in the engine as the AI would and shows their results
    /// (PP_CHAT=tools), to check the tool runner in the app's own engine.
    func sampleTools(engine: LeagueEngine) async {
        guard shown.isEmpty else { return }
        let uses: [[String: Any]] = [
            ["id": "a", "type": "tool_use", "name": "top_performances", "input": ["position": "QB", "limit": 3]],
            ["id": "b", "type": "tool_use", "name": "lineup_efficiency", "input": ["season": 2025]],
            ["id": "c", "type": "tool_use", "name": "draft", "input": ["season": "nope"]],
        ]
        shown.append(ChatMessage(role: .user, text: "(debug) run top_performances, lineup_efficiency and a bad draft call"))
        do {
            let results = try await runTools(uses, engine: engine)
            for r in results {
                let content = (r["content"] as? String) ?? ""
                let failed = (r["is_error"] as? Bool) == true
                let text = failed ? content : content.split(separator: "\n").prefix(8).joined(separator: "\n")
                shown.append(ChatMessage(role: .assistant, text: text, error: failed))
            }
        } catch {
            shown.append(ChatMessage(role: .assistant, text: error.localizedDescription, error: true))
        }
    }
    #endif
}

/// A continuation resumed by whichever comes first: the work or the cancel.
@MainActor
private final class ResumeOnce<T> {
    var continuation: CheckedContinuation<T, Error>?

    func resume(_ result: Result<T, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        continuation.resume(with: result)
    }
}
