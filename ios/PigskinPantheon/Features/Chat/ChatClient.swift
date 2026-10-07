import Foundation

/// Why a question got no answer, as chat.js's ChatError: the words the
/// member sees and a code (the function's, or one of chat.js's own).
struct ChatFailure: Error, Equatable {
    let message: String
    let code: String
}

/// What the league-chat function streams while it answers.
enum ChatStreamEvent {
    /// Words as they're written.
    case text(String)
    /// The AI called a tool (it'll be run here once the turn is done).
    case tool(String)
}

/// The finished turn: why it stopped, and the whole message as content
/// blocks, kept exactly as they came (they go back with the next turn,
/// Gemini's thought signatures and all).
struct ChatTurn {
    let stop: String
    let content: [[String: Any]]
}

/// Talks to supabase/functions/league-chat the way chat.js's `post()` does:
/// the same headers and body, the same server-sent events, the same errors.
/// The request is streamed natively (URLSession) rather than from the
/// engine's page, so the answer can be drawn as it arrives and cancelling
/// the task cancels the request, which cancels the function's request to
/// the model.
enum ChatClient {
    /// The site's origin: the function's ALLOWED_ORIGINS lets it in.
    static let origin = "https://pigskinpantheon.com"

    static func post(endpoint: String,
                     anonKey: String?,
                     token: String?,
                     body: [String: Any],
                     onEvent: @MainActor (ChatStreamEvent) -> Void) async throws -> ChatTurn {
        guard !endpoint.isEmpty, let url = URL(string: endpoint) else {
            throw ChatFailure(message: "", code: "not_set_up")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 120
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(origin, forHTTPHeaderField: "Origin")
        if let anonKey, !anonKey.isEmpty { request.setValue(anonKey, forHTTPHeaderField: "apikey") }
        if let token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        } else if let anonKey, !anonKey.isEmpty {
            request.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let bytes: URLSession.AsyncBytes
        let response: URLResponse
        do {
            (bytes, response) = try await URLSession.shared.bytes(for: request)
        } catch {
            if isCancellation(error) { throw CancellationError() }
            throw ChatFailure(message: "The league AI didn't answer. Check your connection and try again.", code: "network")
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0

        if !(200..<300).contains(status) {
            var data = Data()
            do {
                for try await byte in bytes { data.append(byte) }
            } catch {
                if isCancellation(error) { throw CancellationError() }
            }
            let answer = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            let message: String
            if let error = answer["error"] as? String, !error.isEmpty {
                message = error.prefix(1).uppercased() + error.dropFirst() + "."
            } else {
                message = "The league AI answered \(status)."
            }
            throw ChatFailure(message: message, code: (answer["code"] as? String) ?? "http_\(status)")
        }

        // Server-sent events, one JSON object per `data:` line, each event
        // ending in a blank line.
        var buffer: [UInt8] = []
        var done: ChatTurn?
        do {
            for try await byte in bytes {
                if byte == 13 { continue } // \r
                buffer.append(byte)
                let n = buffer.count
                guard byte == 10, n >= 2, buffer[n - 2] == 10 else { continue }
                let chunk = buffer[0..<(n - 2)]
                buffer.removeAll(keepingCapacity: true)
                switch try parse(chunk) {
                case .event(let event): await onEvent(event)
                case .done(let turn): done = turn
                case .none: break
                }
            }
            if !buffer.isEmpty, case .done(let turn) = try parse(buffer[...]) { done = turn }
        } catch let failure as ChatFailure {
            throw failure
        } catch {
            if isCancellation(error) || Task.isCancelled { throw CancellationError() }
            throw ChatFailure(message: "The answer was cut off. Try again.", code: "cut_off")
        }
        try Task.checkCancellation()
        guard let done else { throw ChatFailure(message: "The answer was cut off. Try again.", code: "cut_off") }
        return done
    }

    private enum Parsed {
        case event(ChatStreamEvent)
        case done(ChatTurn)
        case none
    }

    /// One event: its `data: ` line as JSON. An error event throws.
    private static func parse(_ chunk: ArraySlice<UInt8>) throws -> Parsed {
        let text = String(decoding: chunk, as: UTF8.self)
        guard let line = text.split(separator: "\n", omittingEmptySubsequences: false)
            .first(where: { $0.hasPrefix("data: ") }) else { return .none }
        guard let data = line.dropFirst(6).data(using: .utf8),
              let event = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return .none }
        switch event["t"] as? String {
        case "error":
            let message = (event["message"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "The league AI couldn't answer that."
            throw ChatFailure(message: message, code: (event["setup"] as? Bool) == true ? "not_set_up_upstream" : "upstream")
        case "done":
            return .done(ChatTurn(stop: (event["stop"] as? String) ?? "end_turn",
                                  content: (event["content"] as? [[String: Any]]) ?? []))
        case "text":
            return (event["d"] as? String).map { .event(.text($0)) } ?? .none
        case "tool":
            return .event(.tool((event["name"] as? String) ?? ""))
        default:
            return .none
        }
    }

    static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        if let url = error as? URLError, url.code == .cancelled { return true }
        return (error as NSError).domain == NSURLErrorDomain && (error as NSError).code == NSURLErrorCancelled
    }
}
