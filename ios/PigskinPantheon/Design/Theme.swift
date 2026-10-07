import SwiftUI
import UIKit

/// The site's design language (design.css, ui.css), as SwiftUI tokens:
/// quiet white cards on a hairline, grey-blue labels, navy ink, the
/// league's blue accent and gold. Every colour has a dark-mode twin.
enum Theme {
    // Ink
    static let ink = Color(light: 0x0B1F3F, dark: 0xEEF2F8)
    static let ink2 = Color(light: 0x475467, dark: 0xC2CAD6)
    static let ink3 = Color(light: 0x8A94A6, dark: 0x8C97A9)
    static let muted = Color(light: 0x667085, dark: 0x98A2B3)

    // Surfaces
    static let page = Color(light: 0xEEF1F5, dark: 0x060E19)
    static let card = Color(light: 0xFFFFFF, dark: 0x101B2B)
    static let surface2 = Color(light: 0xF7F8FA, dark: 0x15223A)
    static let surface3 = Color(light: 0xEEF1F5, dark: 0x1B2A42)
    static let line = Color(light: 0xE4E7EC, dark: 0x22324B)
    static let line2 = Color(light: 0xD5DAE1, dark: 0x2C3E5C)

    // Accent
    static let accent = Color(light: 0x1769E0, dark: 0x5B9BFF)
    static let accentInk = Color(light: 0x0F56BD, dark: 0x8AB8FF)
    static let accentSoft = Color(light: 0xEDF3FF, dark: 0x13284A)

    // The league's own
    static let navy = Color(hex: 0x071827)
    static let navy2 = Color(hex: 0x0F2A4A)
    static let gold = Color(hex: 0xF6B73C)
    static let goldInk = Color(light: 0x8A5A00, dark: 0xF6C661)
    static let goldSoft = Color(light: 0xFDF1D8, dark: 0x3A2B0C)
    static let red = Color(light: 0xD92D20, dark: 0xFF6B5E)
    static let redSoft = Color(light: 0xFEF3F2, dark: 0x3A1414)
    static let green = Color(light: 0x079455, dark: 0x47CD89)

    static let cardRadius: CGFloat = 14
    static let gutter: CGFloat = 16
}

// MARK: Type

extension Font {
    /// Barlow Condensed on the site: the titles that name a thing. Here the
    /// system's own condensed width, bold, set in capitals by the caller.
    static func display(_ size: CGFloat, weight: Font.Weight = .bold) -> Font {
        .system(size: size, weight: weight).width(.condensed)
    }
}

extension View {
    /// A display title: condensed, bold, upper case, tracked out a little.
    func displayStyle(_ size: CGFloat) -> some View {
        self.font(.display(size)).textCase(.uppercase).tracking(size * 0.02)
    }
}

// MARK: Colour helpers

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: alpha)
    }

    init(light: UInt32, dark: UInt32) {
        self.init(UIColor { traits in
            UIColor(Color(hex: traits.userInterfaceStyle == .dark ? dark : light))
        })
    }

    /// A CSS colour as the engine writes them: "#304f91" or "hsl(120 42% 38%)".
    init?(css: String?) {
        guard let css = css?.trimmingCharacters(in: .whitespaces), !css.isEmpty else { return nil }
        if css.hasPrefix("#") {
            var hex = String(css.dropFirst())
            if hex.count == 3 { hex = hex.map { "\($0)\($0)" }.joined() }
            guard let value = UInt32(hex, radix: 16) else { return nil }
            self.init(hex: value)
            return
        }
        if css.hasPrefix("hsl") {
            let numbers = css.components(separatedBy: CharacterSet(charactersIn: "0123456789.").inverted)
                .compactMap(Double.init)
            guard numbers.count >= 3 else { return nil }
            let h = numbers[0] / 360, s = numbers[1] / 100, l = numbers[2] / 100
            // HSL to HSB
            let v = l + s * min(l, 1 - l)
            let sb = v == 0 ? 0 : 2 * (1 - l / v)
            self.init(hue: h, saturation: sb, brightness: v)
            return
        }
        return nil
    }

    /// Black or white, whichever reads on this colour (the site's readableInk).
    static func readableInk(on hex: String?) -> Color {
        guard let hex, hex.hasPrefix("#"), let n = UInt32(hex.dropFirst(), radix: 16) else { return .white }
        let lum = (0.299 * Double((n >> 16) & 255) + 0.587 * Double((n >> 8) & 255) + 0.114 * Double(n & 255)) / 255
        return lum > 0.62 ? Color(hex: 0x0B1726) : .white
    }
}

// MARK: Numbers, as the site writes them

enum Fmt {
    private static let two: NumberFormatter = {
        let f = NumberFormatter()
        f.locale = Locale(identifier: "en_US")
        f.numberStyle = .decimal
        f.minimumFractionDigits = 2
        f.maximumFractionDigits = 2
        return f
    }()

    /// 1,209.32
    static func pts(_ n: Double?) -> String {
        guard let n else { return "—" }
        return two.string(from: NSNumber(value: n)) ?? String(format: "%.2f", n)
    }
    /// 120.9
    static func one(_ n: Double) -> String { String(format: "%.1f", n) }
    /// .594
    static func pct(_ v: Double) -> String {
        let s = String(format: "%.3f", v)
        return s.hasPrefix("0") ? String(s.dropFirst()) : s
    }
    /// +240.45 / -36.51
    static func signed(_ n: Double) -> String { (n > 0 ? "+" : "") + pts(n) }

    static func ordinal(_ n: Int) -> String {
        // The site's: s[(v - 20) % 10] || s[v] || s[0]
        let s = ["th", "st", "nd", "rd"], v = n % 100, i = (v - 20) % 10
        let suffix = (0..<4).contains(i) ? s[i] : (0..<4).contains(v) ? s[v] : s[0]
        return "\(n)\(suffix)"
    }

    static func record(_ w: Int, _ l: Int, _ t: Int = 0) -> String { t > 0 ? "\(w)–\(l)–\(t)" : "\(w)–\(l)" }

    static func plural(_ n: Int, _ one: String, _ many: String? = nil) -> String {
        "\(n) \(n == 1 ? one : (many ?? one + "s"))"
    }
}
