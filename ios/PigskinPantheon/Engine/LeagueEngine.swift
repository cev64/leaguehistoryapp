import Foundation
import WebKit

/// Runs the website's own JavaScript (sleeper.js, espn.js, demo.js,
/// insights.js, chat.js and the season page's computations) in a hidden web
/// view, so the app reads leagues exactly as the site does: the same
/// requests, the same month-long cache of finished seasons, the same
/// standings, tiebreaks, recaps and grades. Every screen is drawn natively
/// from what it answers.
///
/// The page is given the site's own address (pigskinpantheon.com), so its
/// requests go out with the site's origin: Sleeper and ESPN answer it as
/// they answer the site, the ESPN relay and the league AI accept it, and
/// IndexedDB keeps each finished season between launches.
///
/// One engine per league, like one browser tab per league page. `leagueId`
/// nil makes a finder engine (looking up users and their leagues).
@MainActor
final class LeagueEngine: NSObject {
    static let siteURL = URL(string: "https://pigskinpantheon.com/")!

    let leagueId: String?
    /// Seasons read so far while a league loads: (done, total).
    var onProgress: ((Int, Int) -> Void)?

    private var webView: WKWebView?
    private var ready: Task<Void, Error>?
    private var readyContinuation: CheckedContinuation<Void, Error>?

    init(leagueId: String?) {
        self.leagueId = leagueId
        super.init()
    }

    // MARK: Starting

    /// Builds the page and waits for every script to have run. Safe to call
    /// more than once; later calls wait on the first.
    func start() async throws {
        if let ready { return try await ready.value }
        let task = Task { @MainActor in
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                self.readyContinuation = continuation
                self.makeWebView()
                // A page that never comes up (its web process couldn't start,
                // say) fails rather than leaving the league loading forever.
                DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
                    self?.finishStart(.failure(EngineError.loadFailed("The league engine didn't start. Try again.")))
                }
            }
        }
        ready = task
        do {
            try await task.value
        } catch {
            // Start over on the next call (a retry), with a fresh page.
            ready = nil
            tearDown()
            throw error
        }
    }

    private func makeWebView() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.preferences.inactiveSchedulingPolicy = .none
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        let controller = WKUserContentController()
        controller.add(WeakMessageHandler(self), name: "native")
        for source in Self.scripts(demo: leagueId.map(Self.isDemo) ?? false) {
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        config.userContentController = controller

        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 10, height: 10), configuration: config)
        view.navigationDelegate = self
        #if DEBUG
        view.isInspectable = true
        #endif
        webView = view

        // The page a league is read from: season.html?league=<id>, as on the
        // site, so `League.leagueId` and every link it builds are the site's.
        var address = Self.siteURL.appendingPathComponent(leagueId == nil ? "index.html" : "season.html")
        if let leagueId, var parts = URLComponents(url: address, resolvingAgainstBaseURL: false) {
            parts.queryItems = [URLQueryItem(name: "league", value: leagueId)]
            address = parts.url ?? address
        }
        let html = """
        <!doctype html><html><head><meta charset="utf-8"><title>Pigskin Pantheon engine</title></head>
        <body><div class="lhc-fab" hidden></div></body></html>
        """
        view.loadHTMLString(html, baseURL: address)
    }

    static func isDemo(_ id: String) -> Bool {
        id.range(of: #"^demo(-\d{4})?$"#, options: .regularExpression) != nil
    }

    /// The scripts, in the order the site's pages load them. The shared ones
    /// are the site's own files, bundled from the repository's root.
    private static func scripts(demo: Bool) -> [String] {
        var names = ["account-config", "engine-core", "sleeper", "espn"]
        if demo { names.append("demo") }
        names += ["insights", "chat", "season-engine"]
        var sources = names.compactMap(bundled)
        // Each screen's bridge (bridge-*.js), in name order.
        let bridges = (Bundle.main.urls(forResourcesWithExtension: "js", subdirectory: nil) ?? [])
            .filter { $0.lastPathComponent.hasPrefix("bridge-") }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        sources += bridges.compactMap { try? String(contentsOf: $0, encoding: .utf8) }
        sources.append("window.webkit.messageHandlers.native.postMessage({ type: 'ready' });")
        return sources
    }

    private static func bundled(_ name: String) -> String? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "js") else {
            assertionFailure("Missing \(name).js in the bundle")
            return nil
        }
        return try? String(contentsOf: url, encoding: .utf8)
    }

    // MARK: Calling

    /// Evaluates `expression` (anything awaitable, e.g. `Bridge.load()`)
    /// with `arguments` in scope as local names, and decodes its answer.
    func call<T: Decodable>(_ type: T.Type, _ expression: String, _ arguments: [String: Any] = [:]) async throws -> T {
        let data = try await callData(expression, arguments)
        return try await Task.detached(priority: .userInitiated) {
            let envelope = try JSONDecoder().decode(Envelope<T>.self, from: data)
            if let error = envelope.error { throw EngineError.script(error) }
            guard let value = envelope.ok else { throw EngineError.empty }
            return value
        }.value
    }

    /// The same, for a call whose answer doesn't matter (or may be empty).
    func run(_ expression: String, _ arguments: [String: Any] = [:]) async throws {
        let data = try await callData(expression, arguments)
        let envelope = try JSONDecoder().decode(Envelope<JSONValue>.self, from: data)
        if let error = envelope.error { throw EngineError.script(error) }
    }

    func callData(_ expression: String, _ arguments: [String: Any] = [:]) async throws -> Data {
        try await start()
        guard let webView else { throw EngineError.notRunning }
        let body = """
        try {
          const ok = await (\(expression));
          return JSON.stringify({ ok: ok === undefined ? null : ok });
        } catch (e) {
          return JSON.stringify({ error: String((e && e.message) || e || "Something went wrong.") });
        }
        """
        let result = try await webView.callAsyncJavaScript(body, arguments: arguments, contentWorld: .page)
        guard let text = result as? String, let data = text.data(using: .utf8) else { throw EngineError.empty }
        return data
    }

    private struct Envelope<T: Decodable>: Decodable {
        let ok: T?
        let error: String?
    }

    func tearDown() {
        webView?.configuration.userContentController.removeAllScriptMessageHandlers()
        webView?.stopLoading()
        webView = nil
    }
}

enum EngineError: LocalizedError {
    case script(String)
    case empty
    case notRunning
    case loadFailed(String)

    var errorDescription: String? {
        switch self {
        case .script(let message): return message
        case .empty: return "The league engine gave no answer."
        case .notRunning: return "The league engine isn't running."
        case .loadFailed(let message): return message
        }
    }
}

extension LeagueEngine: WKNavigationDelegate, WKScriptMessageHandler {
    nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Task { @MainActor in self.finishStart(.failure(error)) }
    }

    nonisolated func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        Task { @MainActor in self.finishStart(.failure(error)) }
    }

    nonisolated func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // The page was killed (memory pressure): start over next call.
        Task { @MainActor in
            self.ready = nil
            self.webView = nil
        }
    }

    nonisolated func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        // WebKit hands messages over on the main thread.
        MainActor.assumeIsolated { receive(message) }
    }

    private func receive(_ message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        let payload = body["body"] as? [String: Any]
        switch type {
        case "ready":
            self.finishStart(.success(()))
        case "progress":
            let done = (payload?["done"] as? NSNumber)?.intValue ?? 0
            let total = (payload?["total"] as? NSNumber)?.intValue ?? 0
            self.onProgress?(done, total)
        case "players":
            self.deliverBundledPlayers()
        case "log":
            #if DEBUG
            print("[engine \(self.leagueId ?? "finder")] \(payload?["level"] ?? ""): \(payload?["text"] ?? "")")
            #endif
        default:
            break
        }
    }

    /// The players file bundled with the app, for when the site's can't be read.
    private func deliverBundledPlayers() {
        let text = Bundle.main.url(forResource: "players", withExtension: "json")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? "{}"
        webView?.callAsyncJavaScript("Bridge._players(text)", arguments: ["text": text], in: nil, in: .page) { _ in }
    }

    private func finishStart(_ result: Result<Void, Error>) {
        guard let continuation = readyContinuation else { return }
        readyContinuation = nil
        continuation.resume(with: result)
    }
}

/// WKUserContentController keeps its handlers strongly; this keeps the
/// engine out of that cycle.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: (any WKScriptMessageHandler)?
    init(_ target: any WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
