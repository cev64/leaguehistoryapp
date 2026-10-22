import SwiftUI
import UIKit
import WebKit

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

    /// Where the sheet opens: ESPN's sign-in page (Disney's OneID, in a frame).
    static let start = URL(string: "https://www.espn.com/login")!

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
    @ObservationIgnored private var closed = false
    #if DEBUG
    /// PP_ESPN_FAKE=1: made-up keys instead of a real sign-in.
    @ObservationIgnored private var faked = false
    #endif

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = store
        config.applicationNameForUserAgent = Self.safariName
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        #if DEBUG
        webView.isInspectable = true
        #endif
        store.httpCookieStore.add(self)
        progressWatch = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] view, _ in
            let value = view.estimatedProgress
            Task { @MainActor in self?.progress = value }
        }
        webView.load(URLRequest(url: Self.start))
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
        progressWatch = nil
        store.httpCookieStore.remove(self)
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
        let espn = cookies.filter { c in
            let domain = c.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
            return domain == "espn.com" || domain.hasSuffix(".espn.com")
        }
        guard let s2 = espn.first(where: { $0.name == "espn_s2" })?.value, !s2.isEmpty,
              let swid = espn.first(where: { $0.name == "SWID" })?.value, !swid.isEmpty else { return }
        keys = Keys(s2: s2, swid: swid)
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
            guard action.targetFrame?.isMainFrame ?? true, let url, url.scheme != "about" else {
                decisionHandler(.allow)
                return
            }
            #if DEBUG
            print("[espn sign-in] \(Self.allows(url) ? "page" : "Safari"): \(url.scheme ?? "")://\(url.host ?? url.absoluteString)")
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
struct EspnSignInSheet: View {
    let done: (EspnSignIn.Keys) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var model = EspnSignIn()

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
                ProgressView(value: model.progress)
                    .progressViewStyle(.linear)
                    .opacity(model.loading ? 1 : 0)
                    .animation(.easeOut(duration: 0.2), value: model.loading)
                ZStack {
                    EspnWebView(webView: model.webView)
                        .opacity(model.failed ? 0 : 1)
                    if model.failed {
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
        .onChange(of: model.keys) { _, keys in
            guard let keys else { return }
            done(keys)
            dismiss()
        }
        .onDisappear { model.close() }
    }
}

/// The sign-in's web view, as SwiftUI shows it.
private struct EspnWebView: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ view: WKWebView, context: Context) {}
}
