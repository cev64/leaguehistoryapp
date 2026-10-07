import SwiftUI
import WebKit

/// Where a remote picture has got to (AsyncImage's phases).
enum RemotePhase {
    case empty
    case success(Image)
    case failure

    var image: Image? {
        if case .success(let image) = self { return image }
        return nil
    }

    var failed: Bool {
        if case .failure = self { return true }
        return false
    }
}

/// A picture off the network: logos, avatars, headshots. Unlike AsyncImage
/// it keeps what it has loaded, so a row scrolled back into view (or a team
/// drawn on every page) shows its logo at once instead of fetching it again,
/// and it draws SVGs, which is what ESPN's own team logos are.
struct RemoteImage<Content: View>: View {
    let url: URL
    @ViewBuilder var content: (RemotePhase) -> Content
    @State private var phase: RemotePhase

    init(url: URL, @ViewBuilder content: @escaping (RemotePhase) -> Content) {
        self.url = url
        self.content = content
        _phase = State(initialValue: ImageStore.shared.cached(url).map { .success(Image(uiImage: $0)) } ?? .empty)
    }

    var body: some View {
        // Held in a clear frame: content that draws nothing until the
        // picture comes would otherwise never appear, and never load it.
        ZStack { Color.clear; content(phase) }
            .task(id: url) {
                if let hit = ImageStore.shared.cached(url) {
                    phase = .success(Image(uiImage: hit))
                    return
                }
                let image = await ImageStore.shared.image(url)
                withAnimation(.easeOut(duration: 0.2)) {
                    phase = image.map { .success(Image(uiImage: $0)) } ?? .failure
                }
            }
    }
}

/// The app's pictures: one download per address, kept in memory (and the
/// downloads on disk), and the addresses that failed remembered so they
/// aren't asked for on every appearance.
@MainActor
final class ImageStore {
    static let shared = ImageStore()

    private let memory = NSCache<NSURL, UIImage>()
    private var failed: Set<URL> = []
    private var loading: [URL: Task<UIImage?, Never>] = [:]
    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(memoryCapacity: 8 << 20, diskCapacity: 80 << 20)
        config.requestCachePolicy = .returnCacheDataElseLoad
        config.timeoutIntervalForRequest = 20
        return URLSession(configuration: config)
    }()

    init() {
        memory.totalCostLimit = 48 << 20
    }

    func cached(_ url: URL) -> UIImage? {
        memory.object(forKey: url as NSURL)
    }

    func image(_ url: URL) async -> UIImage? {
        if let hit = cached(url) { return hit }
        if failed.contains(url) { return nil }
        if let task = loading[url] { return await task.value }
        let task = Task { await self.fetch(url) }
        loading[url] = task
        let image = await task.value
        loading[url] = nil
        if let image {
            let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
            memory.setObject(image, forKey: url as NSURL, cost: cost)
        } else {
            failed.insert(url)
        }
        return image
    }

    private func fetch(_ url: URL) async -> UIImage? {
        guard let (data, response) = try? await session.data(from: url) else { return nil }
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) { return nil }
        if Self.isSVG(data, response) {
            return await SVGRasterizer.shared.image(svg: data, pixels: 192)
        }
        // Decoded once, at the size it's drawn, off the main thread.
        return await Task.detached(priority: .userInitiated) {
            guard let image = UIImage(data: data) else { return nil }
            return image.preparingThumbnail(of: Self.fit(image.size, max: 360)) ?? image
        }.value
    }

    nonisolated private static func fit(_ size: CGSize, max side: CGFloat) -> CGSize {
        let scale = min(1, side / Swift.max(size.width, size.height, 1))
        return CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
    }

    private static func isSVG(_ data: Data, _ response: URLResponse) -> Bool {
        if response.mimeType?.contains("svg") == true { return true }
        if response.url?.pathExtension.lowercased() == "svg" { return true }
        let head = String(decoding: data.prefix(256), as: UTF8.self).lowercased()
        return head.contains("<svg") || (head.hasPrefix("<?xml") && head.contains("svg"))
    }
}

/// Draws an SVG into a PNG, in a page of its own that's never shown: the
/// SVG is drawn onto a canvas and read back, filling a square the way a
/// logo fills its badge.
@MainActor
final class SVGRasterizer: NSObject, WKNavigationDelegate {
    static let shared = SVGRasterizer()

    private var webView: WKWebView?
    private var ready: [CheckedContinuation<Void, Never>] = []
    private var loaded = false

    private func page() async -> WKWebView {
        if let webView, loaded { return webView }
        if webView == nil {
            let config = WKWebViewConfiguration()
            config.websiteDataStore = .nonPersistent()
            let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 4, height: 4), configuration: config)
            view.configuration.preferences.inactiveSchedulingPolicy = .none
            view.navigationDelegate = self
            view.loadHTMLString("<!doctype html><meta charset=utf-8><title>svg</title>", baseURL: nil)
            webView = view
        }
        await withCheckedContinuation { ready.append($0) }
        return webView!
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        MainActor.assumeIsolated {
            loaded = true
            ready.forEach { $0.resume() }
            ready = []
        }
    }

    func image(svg: Data, pixels: Int) async -> UIImage? {
        let view = await page()
        let script = """
        const img = new Image();
        await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = src; });
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const w = img.naturalWidth || size, h = img.naturalHeight || size;
        const s = Math.max(size / w, size / h);
        c.getContext('2d').drawImage(img, (size - w * s) / 2, (size - h * s) / 2, w * s, h * s);
        return c.toDataURL('image/png');
        """
        let src = "data:image/svg+xml;base64," + svg.base64EncodedString()
        guard let result = try? await view.callAsyncJavaScript(script, arguments: ["src": src, "size": pixels],
                                                               in: nil, contentWorld: .page) as? String,
              let comma = result.firstIndex(of: ","),
              let png = Data(base64Encoded: String(result[result.index(after: comma)...])) else { return nil }
        return UIImage(data: png, scale: 3)
    }
}

