import SwiftUI
import UIKit
import WebKit
#if DEBUG
import os
#endif

/// "Sign in with ESPN": ESPN's own sign-in page in a sheet. The member signs
/// in as they always do; the app watches the page's cookies and, once ESPN
/// has set `espn_s2` (a visitor who isn't signed in has only `SWID`), takes
/// the two keys a private league opens with and closes the sheet. The
/// password goes to ESPN alone: the app never reads the page.
///
/// Each sheet has a cookie store of its own, kept in memory and wiped when
/// it closes, so every sign-in starts signed out ("Add another ESPN
/// account" just works) and nothing mixes with the engines' pages.
@MainActor
@Observable
final class EspnSignIn: NSObject {
    struct Keys: Equatable {
        let s2: String
        let swid: String
    }

    /// Where the sheet opens: ESPN's fantasy football page, whose OneID (v4)
    /// signs in inside a web view. (espn.com/login is OneID v2, whose sign-in
    /// never reached ESPN's cookies in one.) `launch` opens its sign-in.
    static let start = URL(string: "https://www.espn.com/fantasy/football/")!

    /// On ESPN's pages: opens OneID's sign-in (what ESPN's own Log In does).
    /// ESPN makes `window.did` before OneID has started, and `launchLogin()`
    /// rejects until it has, so it's tried every half second for up to 20
    /// seconds. Says when OneID signs in or closes. Nothing once signed in.
    static let launch = """
        (() => {
          if (!/(^|\\.)espn\\.com$/.test(location.hostname) || /(^|; )espn_s2=/.test(document.cookie)) return;
          const post = (event) => { try { webkit.messageHandlers.espnSignIn.postMessage(event); } catch (e) {} };
          let tries = 0, heard = false;
          const retry = () => { if (++tries < 40) setTimeout(go, 500); };
          const go = () => {
            const did = window.did;
            if (!did || typeof did.launchLogin !== "function") return retry();
            if (!heard && typeof did.on === "function") {
              heard = true;
              ["login", "close"].forEach((name) => did.on(name, () => post(name)));
            }
            Promise.resolve().then(() => did.launchLogin()).catch(retry);
          };
          go();
        })();
        """

    /// The sites a sign-in moves between, and their subdomains (OneID is on
    /// registerdisney.go.com). Anything else the page links to opens in Safari.
    static let hosts = ["espn.com", "go.com", "disney.com", "disneyplus.com"]

    static func allows(_ url: URL) -> Bool {
        guard ["https", "http"].contains(url.scheme?.lowercased() ?? ""), let host = url.host?.lowercased() else { return false }
        return hosts.contains { host == $0 || host.hasSuffix("." + $0) }
    }

    /// Safari's words at the end of the user agent, so ESPN serves the page
    /// it gives Safari ("Version/27.0 Mobile/15E148 Safari/604.1").
    private static var safariName: String {
        let major = UIDevice.current.systemVersion.split(separator: ".").first ?? "26"
        return "Version/\(major).0 Mobile/15E148 Safari/604.1"
    }

    var progress = 0.0
    var loading = true
    var failed = false
    /// The keys, once ESPN has set them.
    var keys: Keys?

    @ObservationIgnored let webView: WKWebView
    @ObservationIgnored private let store = WKWebsiteDataStore.nonPersistent()
    @ObservationIgnored private var progressWatch: NSKeyValueObservation?
    @ObservationIgnored private var settle: Task<Void, Never>?
    @ObservationIgnored private var watch: Task<Void, Never>?
    /// The last pair read: keys are taken when two reads in a row agree (a
    /// first sign-in can set espn_s2 before ESPN swaps the visitor's SWID).
    @ObservationIgnored private var candidate: Keys?
    @ObservationIgnored private var opened = false
    @ObservationIgnored private var closed = false
    #if DEBUG
    /// PP_ESPN_FAKE=1: made-up keys instead of a real sign-in.
    @ObservationIgnored private var faked = false
    @ObservationIgnored private var lastSeen = ""
    /// `log stream --predicate 'category == "espn-sign-in"' --level debug`
    static let log = Logger(subsystem: "com.pigskinpantheon.app", category: "espn-sign-in")
    #endif

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = store
        config.applicationNameForUserAgent = Self.safariName
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        let scripts = WKUserContentController()
        scripts.addUserScript(WKUserScript(source: Self.launch, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        config.userContentController = scripts
        #if DEBUG
        // Every frame's console errors and warnings (OneID's included), to the
        // debug log. Messages only: nothing typed into the page.
        scripts.addUserScript(WKUserScript(source: """
            (() => {
              const send = (level, args) => { try { webkit.messageHandlers.espnDebug.postMessage(`${location.host} ${level}: ${[...args].map(String).join(" ").slice(0, 400)}`); } catch (e) {} };
              ["error", "warn"].forEach((level) => { const was = console[level]; console[level] = (...a) => { send(level, a); was.apply(console, a); }; });
              addEventListener("error", (e) => send("uncaught", [e.message]));
              addEventListener("unhandledrejection", (e) => send("rejection", [e.reason && e.reason.message || e.reason]));
              if (document.hasStorageAccess) document.hasStorageAccess().then((ok) => send("storage-access", [ok]));
            })();
            """, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        #endif
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        scripts.add(WeakMessageHandler(self), name: "espnSignIn")
        #if DEBUG
        webView.isInspectable = true
        scripts.add(WeakMessageHandler(self), name: "espnDebug")
        #endif
        store.httpCookieStore.add(self)
        progressWatch = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] view, _ in
            let value = view.estimatedProgress
            Task { @MainActor in self?.progress = value }
        }
    }

    /// ESPN's page loading: once, by the sheet that keeps this sign-in (so
    /// one made and dropped never goes to ESPN).
    func open() {
        guard !opened, !closed else { return }
        opened = true
        var start = Self.start
        #if DEBUG
        // PP_ESPN_START=<url>: try another first page.
        if let other = ProcessInfo.processInfo.environment["PP_ESPN_START"].flatMap(URL.init(string:)) { start = other }
        #endif
        webView.load(URLRequest(url: start))
        // The cookie observer doesn't always hear about cookies set inside
        // OneID's frame, so the store is read every second as well.
        watch = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard let self, !self.closed, self.keys == nil else { return }
                await self.readKeys()
            }
        }
    }

    func retry() {
        failed = false
        loading = true
        webView.load(URLRequest(url: webView.url.flatMap { Self.allows($0) ? $0 : nil } ?? Self.start))
    }

    /// The sheet closed: the page goes, and everything it kept with it.
    func close() {
        guard !closed else { return }
        closed = true
        settle?.cancel()
        watch?.cancel()
        progressWatch = nil
        store.httpCookieStore.remove(self)
        webView.configuration.userContentController.removeAllScriptMessageHandlers()
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {}
    }

    // MARK: The keys

    /// The cookies changed: read again a moment later, so a pair being
    /// written isn't caught half done.
    private func cookiesChanged() {
        guard !closed, keys == nil else { return }
        settle?.cancel()
        settle = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            guard let self, !Task.isCancelled else { return }
            await self.readKeys()
        }
    }

    private func readKeys() async {
        let cookies = await store.httpCookieStore.allCookies()
        guard !closed, keys == nil else { return }
        #if DEBUG
        // Names and domains only, never values: what ESPN has set so far.
        let seen = cookies.map { "\($0.name)@\($0.domain)\($0.isHTTPOnly ? " httpOnly" : "")" }.sorted().joined(separator: ", ")
        if seen != lastSeen {
            lastSeen = seen
            Self.log.debug("cookies: \(seen, privacy: .public)")
        }
        #endif
        let espn = cookies.filter { c in
            let domain = c.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
            return domain == "espn.com" || domain.hasSuffix(".espn.com")
        }
        guard let s2 = espn.first(where: { $0.name == "espn_s2" })?.value, !s2.isEmpty,
              let swid = espn.first(where: { $0.name == "SWID" })?.value,
              swid.range(of: #"^\{[0-9A-Fa-f-]{36}\}$"#, options: .regularExpression) != nil else {
            candidate = nil
            return
        }
        let pair = Keys(s2: s2, swid: swid)
        guard pair == candidate else {
            candidate = pair
            return
        }
        keys = pair
    }

    #if DEBUG
    /// PP_ESPN_FAKE=1 (debug builds): once the page has loaded (or failed
    /// to), keys are set as ESPN would set them, so capturing, saving and
    /// listing can be tried with no ESPN account. ESPN turns them away.
    private func fakeIfAsked() {
        guard ProcessInfo.processInfo.environment["PP_ESPN_FAKE"] == "1", !faked else { return }
        faked = true
        let letters = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")
        let s2 = "AEB" + String((0..<117).map { _ in letters.randomElement()! })
        let swid = "{\(UUID().uuidString.uppercased())}"
        for (name, value) in [("SWID", swid), ("espn_s2", s2)] {
            if let cookie = HTTPCookie(properties: [.domain: ".espn.com", .path: "/", .name: name, .value: value, .secure: "TRUE"]) {
                store.httpCookieStore.setCookie(cookie)
            }
        }
    }
    #endif

    private func finished() {
        loading = false
        #if DEBUG
        fakeIfAsked()
        #endif
        Task { await readKeys() }
    }

    private func failedToLoad(_ error: Error) {
        let e = error as NSError
        // A navigation replaced by another, or turned away below: not a failure.
        if e.code == NSURLErrorCancelled || (e.domain == "WebKitErrorDomain" && e.code == 102) { return }
        loading = false
        failed = true
        #if DEBUG
        fakeIfAsked()
        #endif
    }

    /// A link off ESPN and Disney (help pages, an app's store page): Safari.
    private func openOutside(_ url: URL) {
        guard let scheme = url.scheme?.lowercased(), ["https", "http", "mailto", "tel", "itms-apps"].contains(scheme) else { return }
        UIApplication.shared.open(url)
    }
}

/// OneID saying it signed in (the keys are read straight away) or closed;
/// in debug builds, the page's console too.
extension EspnSignIn: WKScriptMessageHandler {
    nonisolated func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let name = message.name
        let text = String(describing: message.body)
        MainActor.assumeIsolated {
            #if DEBUG
            Self.log.debug("\(name == "espnSignIn" ? "oneid" : "console", privacy: .public) \(text, privacy: .public)")
            #endif
            if name == "espnSignIn", text == "login" { Task { await readKeys() } }
        }
    }
}

extension EspnSignIn: WKHTTPCookieStoreObserver {
    nonisolated func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
        Task { @MainActor in self.cookiesChanged() }
    }
}

extension EspnSignIn: WKNavigationDelegate, WKUIDelegate {
    /// The page itself stays on ESPN and Disney; what it loads inside
    /// (OneID's frame, reCAPTCHA from Google) isn't held back.
    nonisolated func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                             decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        MainActor.assumeIsolated {
            let url = action.request.url
            #if DEBUG
            if let url, action.targetFrame?.isMainFrame == false {
                Self.log.debug("frame: \(url.scheme ?? "", privacy: .public)://\(url.host ?? "", privacy: .public)\(url.path, privacy: .public)")
            }
            #endif
            guard action.targetFrame?.isMainFrame ?? true, let url, url.scheme != "about" else {
                decisionHandler(.allow)
                return
            }
            #if DEBUG
            Self.log.debug("\(Self.allows(url) ? "page" : "Safari", privacy: .public): \(url.scheme ?? "", privacy: .public)://\(url.host ?? "", privacy: .public)\(url.path, privacy: .public)")
            #endif
            if Self.allows(url) {
                decisionHandler(.allow)
            } else {
                decisionHandler(.cancel)
                openOutside(url)
            }
        }
    }

    /// A link that opens a new window (target="_blank", window.open): in
    /// this page if it's ESPN's or Disney's, otherwise Safari.
    nonisolated func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                             for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        MainActor.assumeIsolated {
            if let url = action.request.url {
                if Self.allows(url) { webView.load(action.request) } else { openOutside(url) }
            }
            return nil
        }
    }

    nonisolated func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        MainActor.assumeIsolated {
            loading = true
            failed = false
        }
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        MainActor.assumeIsolated { finished() }
    }

    nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        MainActor.assumeIsolated { failedToLoad(error) }
    }

    nonisolated func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        MainActor.assumeIsolated { failedToLoad(error) }
    }

    nonisolated func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        MainActor.assumeIsolated {
            loading = false
            failed = true
        }
    }
}

// MARK: The sheet

/// The sheet: ESPN's page under a bar with Cancel, its progress, and a line
/// on what's kept. Closes itself once ESPN has set the keys, handing them to
/// `done`; closed without signing in, nothing happens.
///
/// The sign-in is made once the sheet is up, not as the view is (a view is
/// made again whenever its parent draws, and `@State`'s first value with it).
struct EspnSignInSheet: View {
    let done: (EspnSignIn.Keys) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var model: EspnSignIn?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Text("Sign in on ESPN's own page. Pigskin Pantheon never sees your password; it keeps only the two keys ESPN uses to open your leagues.")
                    .font(.footnote)
                    .foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                ProgressView(value: model?.progress ?? 0)
                    .progressViewStyle(.linear)
                    .opacity(model?.loading ?? true ? 1 : 0)
                    .animation(.easeOut(duration: 0.2), value: model?.loading ?? true)
                ZStack {
                    if let model {
                        EspnWebView(webView: model.webView)
                            .opacity(model.failed ? 0 : 1)
                    }
                    if let model, model.failed {
                        ContentUnavailableView {
                            Label("ESPN's sign-in page didn't load", systemImage: "wifi.exclamationmark")
                        } description: {
                            Text("Check your connection and try again.")
                        } actions: {
                            Button("Try again") { model.retry() }
                                .buttonStyle(Felt(.glassProminent))
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .background(Theme.page)
            .navigationTitle("Sign in to ESPN")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationSizing(.form)
        .presentationDetents([.large])
        .onAppear {
            guard model == nil else { return }
            let signIn = EspnSignIn()
            model = signIn
            signIn.open()
        }
        .onChange(of: model?.keys) { _, keys in
            guard let keys else { return }
            done(keys)
            dismiss()
        }
        .onDisappear {
            model?.close()
            model = nil
        }
    }
}

/// The sign-in's web view, as SwiftUI shows it.
private struct EspnWebView: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ view: WKWebView, context: Context) {}
}
