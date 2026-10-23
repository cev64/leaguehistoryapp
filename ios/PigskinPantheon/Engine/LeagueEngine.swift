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
    /// This engine, apart from any other (an address can be reused once one goes).
    let instance = UUID()
    /// Seasons read so far while a league loads: (done, total).
    var onProgress: ((Int, Int) -> Void)?

    private var webView: WKWebView?
    private var ready: Task<Void, Error>?
    private var readyContinuation: CheckedContinuation<Void, Error>?
    /// Which start the page coming up belongs to, so a late timeout or
    /// failure from an earlier one is ignored.
    private var attempt = 0
    /// Closed with its league: it doesn't start again.
    private var closed = false
    /// What a fresh page is given before its first call, so a page iOS
    /// killed comes back as it was: the member's session, and the league
    /// loaded again once it has been.
    private var session: [String: Any]?
    private var loaded = false

    init(leagueId: String?) {
        self.leagueId = leagueId
        super.init()
    }

    // MARK: Starting

    /// Builds the page and waits for every script to have run. Safe to call
    /// more than once; later calls wait on the first.
    func start() async throws {
        if closed { throw EngineError.notRunning }
        if let ready { return try await ready.value }
        // A page still coming up from before is given up on.
        finishStart(.failure(EngineError.loadFailed("The league engine didn't start. Try again.")))
        attempt += 1
        let attempt = self.attempt
        let task = Task { @MainActor in
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                self.readyContinuation = continuation
                self.makeWebView()
            }
            try await self.restore()
        }
        ready = task
        // A page that never comes up (its web process couldn't start, say)
        // fails rather than leaving the league loading forever.
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            guard let self, self.attempt == attempt else { return }
            self.finishStart(.failure(EngineError.loadFailed("The league engine didn't start. Try again.")))
        }
        do {
            try await task.value
        } catch {
            // Start over on the next call (a retry), with a fresh page,
            // unless a newer start has already taken over.
            if self.attempt == attempt {
                ready = nil
                dropPage()
            }
            throw error
        }
    }

    /// A page started again after iOS killed the last one: given the
    /// session and the league again, so screens carry on as if nothing
    /// happened. Every page first gets back any ESPN keys iOS cleared from
    /// its storage.
    private func restore() async throws {
        await restoreEspnKeys()
        if let session { try check(await evaluate("Bridge.setSession(s)", ["s": session])) }
        if loaded { try check(await evaluate("Bridge.load()", [:])) }
    }

    private func check(_ data: Data) throws {
        let envelope = try JSONDecoder().decode(Envelope<JSONValue>.self, from: data)
        if let error = envelope.failure { throw error }
    }

    // MARK: ESPN keys

    /// The Keychain's copy of the ESPN keys back in a page that has none
    /// (iOS cleared its storage), and the page's sets kept in the Keychain
    /// in turn, so keys saved before there was a copy get one too. A Forget
    /// takes its keys out of the Keychain before the page, so they aren't
    /// given back here.
    private func restoreEspnKeys() async {
        let saved = EspnKeychain.load().map { ["s2": $0.s2, "swid": $0.swid] }
        guard let data = try? await evaluate("Bridge.finder.espnRestore(list)", ["list": saved]),
              let sets = try? JSONDecoder().decode(Envelope<[EspnKeychain.KeySet]>.self, from: data).ok else { return }
        EspnKeychain.save(sets)
    }

    /// After a save or a Forget: the Keychain's copy made the page's again,
    /// less any ESPN account just forgotten (should the page still have it).
    func keepEspnKeys(without forgotten: String? = nil) async {
        guard let sets = try? await call([EspnKeychain.KeySet].self, "Bridge.finder.espnLocalSets()") else { return }
        EspnKeychain.save(sets.filter { $0.swid != forgotten })
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
        names += ["insights", "chat", "season-engine", "clubhouse"]
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
            if let error = envelope.failure { throw error }
            guard let value = envelope.ok else { throw EngineError.empty }
            return value
        }.value
    }

    /// The same, for a call whose answer doesn't matter (or may be empty).
    func run(_ expression: String, _ arguments: [String: Any] = [:]) async throws {
        try check(await callData(expression, arguments))
    }

    /// Hands the page the member's session (`Bridge.setSession`), kept to
    /// hand a restarted page too.
    func setSession(_ session: [String: Any]?) async throws {
        self.session = session
        try await run("Bridge.setSession(s)", ["s": session ?? NSNull()])
    }

    /// Reads the league (`Bridge.load()`); a restarted page reads it again
    /// before its first call.
    func load<T: Decodable>(_ type: T.Type) async throws -> T {
        let answer = try await call(type, "Bridge.load()")
        loaded = true
        return answer
    }

    func callData(_ expression: String, _ arguments: [String: Any] = [:]) async throws -> Data {
        try await start()
        return try await evaluate(expression, arguments)
    }

    /// Runs `expression` on the page as it is, started or not.
    private func evaluate(_ expression: String, _ arguments: [String: Any]) async throws -> Data {
        guard let webView else { throw EngineError.notRunning }
        let body = """
        try {
          const ok = await (\(expression));
          return JSON.stringify({ ok: ok === undefined ? null : ok });
        } catch (e) {
          return JSON.stringify({ error: String((e && e.message) || e || "Something went wrong."), privateLeague: Boolean(e && e.privateLeague) });
        }
        """
        #if DEBUG
        let began = CFAbsoluteTimeGetCurrent()
        #endif
        let result = try await webView.callAsyncJavaScript(body, arguments: arguments, contentWorld: .page)
        guard let text = result as? String, let data = text.data(using: .utf8) else { throw EngineError.empty }
        #if DEBUG
        if ProcessInfo.processInfo.environment["PP_TIMING"] == "1" {
            let line = String(format: "%6.0f ms %8d B  %@\n", (CFAbsoluteTimeGetCurrent() - began) * 1000, data.count, expression)
            let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("timing.log")
            if let h = try? FileHandle(forWritingTo: url) { h.seekToEndOfFile(); h.write(Data(line.utf8)); try? h.close() }
            else { try? Data(line.utf8).write(to: url) }
        }
        #endif
        return data
    }

    private struct Envelope<T: Decodable>: Decodable {
        let ok: T?
        let error: String?
        /// espn.js's privateError: a private ESPN league ESPN wouldn't open.
        let privateLeague: Bool?

        var failure: EngineError? {
            error.map { privateLeague == true ? .privateLeague($0) : .script($0) }
        }
    }

    /// Closed with its league: the page goes, and the engine doesn't start again.
    func tearDown() {
        closed = true
        ready = nil
        finishStart(.failure(EngineError.notRunning))
        dropPage()
    }

    private func dropPage() {
        webView?.configuration.userContentController.removeAllScriptMessageHandlers()
        webView?.stopLoading()
        webView = nil
    }
}

enum EngineError: LocalizedError {
    case script(String)
    /// A private ESPN league that needs (fresh) ESPN keys: signing in to
    /// ESPN opens it.
    case privateLeague(String)
    case empty
    case notRunning
    case loadFailed(String)

    var errorDescription: String? {
        switch self {
        case .script(let message), .privateLeague(let message): return message
        case .empty: return "The league engine gave no answer."
        case .notRunning: return "The league engine isn't running."
        case .loadFailed(let message): return message
        }
    }
}

extension LeagueEngine: WKNavigationDelegate, WKScriptMessageHandler {
    nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Task { @MainActor in
            guard webView === self.webView else { return }
            self.finishStart(.failure(error))
        }
    }

    nonisolated func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        Task { @MainActor in
            guard webView === self.webView else { return }
            self.finishStart(.failure(error))
        }
    }

    nonisolated func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // The page was killed (memory pressure): a fresh one next call,
        // given the session and the league again (`restore`).
        Task { @MainActor in
            guard webView === self.webView else { return }
            self.finishStart(.failure(EngineError.loadFailed("The league engine stopped. Try again.")))
            self.ready = nil
            self.dropPage()
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
final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: (any WKScriptMessageHandler)?
    init(_ target: any WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
