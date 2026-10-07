import UIKit

/// trophy/textures.js, in CoreGraphics. Everything in the hall is painted at
/// load time — marble, walnut, brushed brass, the engraved plates, the team
/// crests and flags — onto bitmaps handed to SceneKit as textures. Each
/// painter draws in the site's own canvas units (so the numbers read the same
/// as the original) and is rendered at `scale` of that size, which is plenty
/// at phone distances and keeps the hall's texture memory modest.
enum Paint {
    // MARK: Canvas

    static func image(_ width: CGFloat, _ height: CGFloat, scale: CGFloat = 0.5, opaque: Bool = false,
                      _ draw: (CGContext) -> Void) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = opaque
        format.preferredRange = .standard
        let size = CGSize(width: max(1, (width * scale).rounded()), height: max(1, (height * scale).rounded()))
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            let ctx = context.cgContext
            ctx.scaleBy(x: size.width / width, y: size.height / height)
            draw(ctx)
        }
    }

    // MARK: Type

    /// The site's display face (Barlow Condensed): here the system's condensed width.
    static func display(_ size: CGFloat, _ weight: Int = 800) -> UIFont {
        let w: UIFont.Weight
        switch weight {
        case ..<550: w = .medium
        case ..<650: w = .semibold
        case ..<750: w = .bold
        case ..<850: w = .heavy
        default: w = .black
        }
        return UIFont.systemFont(ofSize: max(4, size), weight: w, width: .condensed)
    }

    private static func attributed(_ text: String, _ font: UIFont, _ color: UIColor, kern: CGFloat) -> NSAttributedString {
        NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: color, .kern: kern])
    }

    static func measure(_ text: String, _ font: UIFont, kern: CGFloat = 0) -> CGFloat {
        attributed(text, font, .white, kern: kern).size().width
    }

    /// textures.js `fitText`: steps the size down until the line fits.
    static func fit(_ text: String, _ maxWidth: CGFloat, _ start: CGFloat, weight: Int = 800, kern: CGFloat = 0) -> CGFloat {
        var size = start
        var width = measure(text, display(size, weight), kern: kern)
        if width <= maxWidth { return size }
        size = max(8, floor(start * maxWidth / max(1, width)))
        width = measure(text, display(size, weight), kern: kern)
        while width > maxWidth && size > 8 {
            size -= 1
            width = measure(text, display(size, weight), kern: kern)
        }
        return size
    }

    enum Align { case center, left }

    /// One line of text with the canvas's "middle" baseline at `y`.
    static func text(_ ctx: CGContext, _ text: String, x: CGFloat, y: CGFloat, font: UIFont, color: UIColor,
                     kern: CGFloat = 0, align: Align = .center) {
        let string = attributed(text, font, color, kern: kern)
        let width = string.size().width
        let baseline = y + font.capHeight / 2
        let origin = CGPoint(x: align == .center ? x - width / 2 : x, y: baseline - font.ascender)
        UIGraphicsPushContext(ctx)
        string.draw(at: origin)
        UIGraphicsPopContext()
    }

    /// Cut into metal: a bright lip below the stroke and a dark fill above it.
    static func engrave(_ ctx: CGContext, _ s: String, x: CGFloat, y: CGFloat, size: CGFloat, weight: Int = 800,
                        ink: UIColor, lip: UIColor, kern: CGFloat = 0, align: Align = .center) {
        let font = display(size, weight)
        text(ctx, s, x: x, y: y + max(1.5, size * 0.045), font: font, color: lip, kern: kern, align: align)
        text(ctx, s, x: x, y: y, font: font, color: ink, kern: kern, align: align)
    }

    // MARK: Helpers

    static func linear(_ ctx: CGContext, _ colors: [(CGFloat, UIColor)], from: CGPoint, to: CGPoint, in rect: CGRect) {
        guard let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
                                        colors: colors.map(\.1.cgColor) as CFArray,
                                        locations: colors.map(\.0)) else { return }
        ctx.saveGState()
        ctx.clip(to: rect)
        ctx.drawLinearGradient(gradient, start: from, end: to, options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
        ctx.restoreGState()
    }

    static func radial(_ ctx: CGContext, _ colors: [(CGFloat, UIColor)], c0: CGPoint, r0: CGFloat, c1: CGPoint, r1: CGFloat, clip: CGRect? = nil) {
        guard let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
                                        colors: colors.map(\.1.cgColor) as CFArray,
                                        locations: colors.map(\.0)) else { return }
        ctx.saveGState()
        if let clip { ctx.clip(to: clip) }
        ctx.drawRadialGradient(gradient, startCenter: c0, startRadius: r0, endCenter: c1, endRadius: r1, options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
        ctx.restoreGState()
    }

    static func hex(_ value: UInt32, _ alpha: CGFloat = 1) -> UIColor { UIColor(trophyRGB: value, alpha: alpha) }
    static func white(_ a: CGFloat) -> UIColor { UIColor(white: 1, alpha: a) }
    static func black(_ a: CGFloat) -> UIColor { UIColor(white: 0, alpha: a) }
    static func rgba(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat) -> UIColor {
        UIColor(red: r / 255, green: g / 255, blue: b / 255, alpha: a)
    }
    static func rnd() -> CGFloat { CGFloat.random(in: 0..<1) }

    /// Fine grain over the whole bitmap.
    static func noise(_ ctx: CGContext, amount: CGFloat) {
        guard let data = ctx.data else { return }
        let bytes = data.bindMemory(to: UInt8.self, capacity: ctx.bytesPerRow * ctx.height)
        for y in 0..<ctx.height {
            let row = y * ctx.bytesPerRow
            for x in 0..<ctx.width {
                let i = row + x * 4
                let grain = Int((rnd() - 0.5) * amount)
                for c in 0..<3 {
                    bytes[i + c] = UInt8(max(0, min(255, Int(bytes[i + c]) + grain)))
                }
            }
        }
    }

    // MARK: Stone and timber

    static func marble(base: UInt32 = 0x141D2C, vein: UInt32 = 0x33455F, glow: UInt32 = 0x1D2A3E, size: CGFloat = 512, veins: Int = 26) -> UIImage {
        image(size, size, scale: 1, opaque: true) { ctx in
            ctx.setFillColor(hex(base).cgColor)
            ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
            let all = CGRect(x: 0, y: 0, width: size, height: size)
            for _ in 0..<12 {
                ctx.saveGState()
                ctx.setAlpha(0.35)
                radial(ctx, [(0, hex(glow)), (1, black(0))],
                       c0: CGPoint(x: rnd() * size, y: rnd() * size), r0: 0,
                       c1: CGPoint(x: rnd() * size, y: rnd() * size), r1: size * (0.2 + rnd() * 0.4), clip: all)
                ctx.restoreGState()
            }
            for _ in 0..<veins {
                var x = rnd() * size
                var y: CGFloat = -20
                ctx.beginPath()
                ctx.move(to: CGPoint(x: x, y: y))
                while y < size + 20 {
                    x += (rnd() - 0.5) * size * 0.22
                    y += size * (0.05 + rnd() * 0.09)
                    ctx.addLine(to: CGPoint(x: x, y: y))
                }
                ctx.setStrokeColor(hex(vein, 0.08 + rnd() * 0.18).cgColor)
                ctx.setLineWidth(0.6 + rnd() * 2.4)
                ctx.strokePath()
            }
            noise(ctx, amount: 14)
        }
    }

    static func wood(base: UInt32 = 0x2B1C12, grain: UInt32 = 0x160D07, highlight: UInt32 = 0x4A3320, size: CGFloat = 512) -> UIImage {
        image(size, size, scale: 1, opaque: true) { ctx in
            ctx.setFillColor(hex(base).cgColor)
            ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
            for i in 0..<190 {
                let y = rnd() * size
                ctx.beginPath()
                ctx.move(to: CGPoint(x: -10, y: y))
                var x: CGFloat = -10
                while x < size + 10 {
                    ctx.addLine(to: CGPoint(x: x, y: y + sin(x * 0.03 + CGFloat(i)) * 3 + (rnd() - 0.5) * 2))
                    x += 16
                }
                ctx.setStrokeColor(hex(rnd() > 0.72 ? highlight : grain, 0.06 + rnd() * 0.16).cgColor)
                ctx.setLineWidth(0.5 + rnd() * 2)
                ctx.strokePath()
            }
            noise(ctx, amount: 10)
        }
    }

    // MARK: Metal plates

    enum Metal: String { case brass, pewter }

    private static func plateInk(_ metal: Metal) -> (ink: UIColor, lip: UIColor) {
        metal == .pewter
            ? (hex(0x1D2228), rgba(240, 246, 251, 0.6))
            : (hex(0x2A2013), rgba(255, 244, 214, 0.6))
    }

    static func brushed(_ ctx: CGContext, _ width: CGFloat, _ height: CGFloat, _ metal: Metal) {
        let stops: [UInt32] = metal == .pewter
            ? [0xA5ACB5, 0x767E88, 0x959DA6, 0x5E666F, 0x888F98]
            : [0xE8CD8F, 0xC9A55F, 0xE2C384, 0xB48F4C, 0xD8B871]
        let scratch: [UInt32] = metal == .pewter ? [0xDFE4EA, 0x3C434A] : [0xFFF3D2, 0x7D5F2A]
        let offsets: [CGFloat] = [0, 0.22, 0.5, 0.78, 1]
        linear(ctx, zip(offsets, stops.map { hex($0) }).map { ($0, $1) },
               from: .zero, to: CGPoint(x: 0, y: height), in: CGRect(x: 0, y: 0, width: width, height: height))
        let lines = Int(height * 1.5)
        for _ in 0..<lines {
            let y = rnd() * height
            ctx.setStrokeColor(hex(rnd() > 0.5 ? scratch[0] : scratch[1], 0.02 + rnd() * 0.05).cgColor)
            ctx.setLineWidth(0.6 + rnd())
            ctx.beginPath()
            ctx.move(to: CGPoint(x: 0, y: y))
            ctx.addLine(to: CGPoint(x: width, y: y + (rnd() - 0.5) * 2))
            ctx.strokePath()
        }
    }

    static func plateFrame(_ ctx: CGContext, _ width: CGFloat, _ height: CGFloat, accent: UIColor?) {
        ctx.setStrokeColor(rgba(66, 46, 16, 0.55).cgColor)
        ctx.setLineWidth(max(2, height * 0.018))
        ctx.stroke(CGRect(x: width * 0.035, y: height * 0.09, width: width * 0.93, height: height * 0.82))
        ctx.setStrokeColor((accent ?? rgba(255, 240, 200, 0.5)).withAlphaComponent(0.55).cgColor)
        ctx.setLineWidth(max(1, height * 0.008))
        ctx.stroke(CGRect(x: width * 0.05, y: height * 0.12, width: width * 0.9, height: height * 0.76))
    }

    /// The small engraved plate on the front of a plinth.
    static func nameplate(title: String, sub: String?, accent: UIColor, metal: Metal = .brass) -> UIImage {
        let width: CGFloat = 1024, height: CGFloat = 256
        return image(width, height, opaque: true) { ctx in
            let tone = plateInk(metal)
            brushed(ctx, width, height, metal)
            plateFrame(ctx, width, height, accent: accent)
            let titleSize = fit(title, width * 0.8, sub != nil ? 86 : 104, weight: 800, kern: 2)
            engrave(ctx, title, x: width / 2, y: sub != nil ? height * 0.4 : height * 0.5, size: titleSize,
                    ink: tone.ink, lip: tone.lip, kern: 2)
            if let sub {
                let upper = sub.uppercased()
                let subSize = fit(upper, width * 0.78, 46, weight: 600, kern: 6)
                engrave(ctx, upper, x: width / 2, y: height * 0.68, size: subSize, weight: 600,
                        ink: metal == .pewter ? rgba(40, 48, 56, 0.9) : rgba(52, 38, 14, 0.9), lip: tone.lip, kern: 6)
            }
        }
    }

    /// The face of a record plaque: the number first, then what it is and who owns it.
    static func recordFace(value: String, label: String, holder: String, meta: String?, accent: UIColor, metal: Metal) -> UIImage {
        let width: CGFloat = 1024, height: CGFloat = 768
        return image(width, height, opaque: true) { ctx in
            let tone = plateInk(metal)
            brushed(ctx, width, height, metal)
            ctx.setFillColor(accent.withAlphaComponent(0.1).cgColor)
            ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
            plateFrame(ctx, width, height, accent: accent)

            let upper = label.uppercased()
            engrave(ctx, upper, x: width / 2, y: height * 0.235, size: fit(upper, width * 0.8, 56, weight: 700, kern: 8), weight: 700,
                    ink: metal == .pewter ? rgba(34, 42, 50, 0.92) : rgba(58, 42, 16, 0.92), lip: tone.lip, kern: 8)

            ctx.setStrokeColor((metal == .pewter ? rgba(48, 56, 64, 0.4) : rgba(70, 50, 18, 0.4)).cgColor)
            ctx.setLineWidth(3)
            ctx.beginPath()
            ctx.move(to: CGPoint(x: width * 0.33, y: height * 0.295))
            ctx.addLine(to: CGPoint(x: width * 0.67, y: height * 0.295))
            ctx.strokePath()

            engrave(ctx, value, x: width / 2, y: height * 0.47, size: fit(value, width * 0.82, 210, weight: 800, kern: -2), weight: 800,
                    ink: tone.ink, lip: tone.lip, kern: -2)
            engrave(ctx, holder, x: width / 2, y: height * 0.665, size: fit(holder, width * 0.85, 64, weight: 700), weight: 700,
                    ink: metal == .pewter ? rgba(28, 36, 44, 0.95) : rgba(48, 34, 12, 0.95), lip: tone.lip)
            if let meta {
                engrave(ctx, meta, x: width / 2, y: height * 0.775, size: fit(meta, width * 0.85, 42, weight: 500, kern: 3), weight: 500,
                        ink: metal == .pewter ? rgba(44, 52, 60, 0.8) : rgba(64, 48, 20, 0.8), lip: tone.lip, kern: 3)
            }
        }
    }

    /// The engraved year on the front of a trophy's plinth and every season honour.
    static func yearPlate(year: Int?, color: UIColor) -> UIImage {
        let width: CGFloat = 1024, height: CGFloat = 460
        return image(width, height, opaque: true) { ctx in
            let all = CGRect(x: 0, y: 0, width: width, height: height)
            linear(ctx, [(0, hex(0x0B1421)), (0.5, hex(0x060C15)), (1, hex(0x0A1220))], from: .zero, to: CGPoint(x: 0, y: height), in: all)
            ctx.saveGState()
            ctx.setAlpha(0.34)
            radial(ctx, [(0, color), (1, black(0))], c0: CGPoint(x: width / 2, y: height / 2), r0: 10,
                   c1: CGPoint(x: width / 2, y: height / 2), r1: width * 0.55, clip: all)
            ctx.restoreGState()

            ctx.setStrokeColor(color.mixed(with: .white, 0.5).cgColor)
            ctx.setLineWidth(7)
            ctx.stroke(CGRect(x: 20, y: 20, width: width - 40, height: height - 40))
            ctx.setStrokeColor(white(0.6 * 0.45).cgColor)
            ctx.setLineWidth(2)
            ctx.stroke(CGRect(x: 36, y: 36, width: width - 72, height: height - 72))

            let s = year.map(String.init) ?? ""
            let size = fit(s, width * 0.72, 250, weight: 700, kern: 16)
            let font = display(size, 700)
            text(ctx, s, x: width / 2 + 4, y: height / 2 + 5, font: font, color: black(0.6), kern: 16)
            // The year in a white-to-team-colour gradient ink.
            ctx.beginTransparencyLayer(auxiliaryInfo: nil)
            text(ctx, s, x: width / 2, y: height / 2, font: font, color: .white, kern: 16)
            ctx.setBlendMode(.sourceIn)
            linear(ctx, [(0, .white), (0.5, color.mixed(with: .white, 0.75)), (1, color.mixed(with: .white, 0.35))],
                   from: CGPoint(x: 0, y: height * 0.28), to: CGPoint(x: 0, y: height * 0.72), in: all)
            ctx.endTransparencyLayer()
        }
    }

    // MARK: Crests

    /// A team crest: the team's logo struck bare into the medallion, or its
    /// mark (initial or emoji) in a coloured roundel with a brass rim.
    static func crest(icon: String?, color: UIColor, logo: UIImage?) -> UIImage {
        let size: CGFloat = 512
        let half = size / 2
        return image(size, size) { ctx in
            if let logo {
                ctx.saveGState()
                ctx.setShadow(offset: CGSize(width: 0, height: size * 0.012), blur: size * 0.035, color: black(0.5).cgColor)
                drawLogo(ctx, logo, cx: half, cy: half, box: size * 0.74)
                ctx.restoreGState()
                return
            }
            ctx.saveGState()
            ctx.addEllipse(in: CGRect(x: half - half * 0.97, y: half - half * 0.97, width: size * 0.97, height: size * 0.97))
            ctx.clip()
            radial(ctx, [(0, color.mixed(with: .white, 0.14)), (0.55, color), (1, color.mixed(with: .black, 0.55))],
                   c0: CGPoint(x: half, y: half * 0.75), r0: size * 0.05, c1: CGPoint(x: half, y: half), r1: half)
            // Rays, so the crest catches the eye as it turns under the lights.
            ctx.translateBy(x: half, y: half)
            for i in 0..<24 {
                ctx.rotate(by: .pi * 2 / 24)
                ctx.beginPath()
                ctx.move(to: .zero)
                ctx.addArc(center: .zero, radius: half * 0.95, startAngle: 0, endAngle: .pi / 24, clockwise: false)
                ctx.closePath()
                ctx.setFillColor((i % 2 == 1 ? white(0.07) : black(0.07)).cgColor)
                ctx.fillPath()
            }
            ctx.restoreGState()

            ctx.setStrokeColor(rgba(236, 206, 150, 0.75).cgColor)
            ctx.setLineWidth(size * 0.035)
            ctx.strokeEllipse(in: CGRect(x: half - half * 0.9, y: half - half * 0.9, width: size * 0.9, height: size * 0.9))
            ctx.setStrokeColor(rgba(20, 14, 6, 0.35).cgColor)
            ctx.setLineWidth(size * 0.012)
            ctx.strokeEllipse(in: CGRect(x: half - half * 0.79, y: half - half * 0.79, width: size * 0.79, height: size * 0.79))

            ctx.saveGState()
            ctx.setShadow(offset: CGSize(width: 0, height: size * 0.012), blur: size * 0.04, color: black(0.45).cgColor)
            drawIcon(ctx, icon, x: half, y: half, px: size * 0.56)
            ctx.restoreGState()
        }
    }

    /// An avatar as a disc of `box` across, cropped round the way Sleeper shows them.
    static func drawLogo(_ ctx: CGContext, _ logo: UIImage, cx: CGFloat, cy: CGFloat, box: CGFloat) {
        let r = box / 2
        let disc = CGRect(x: cx - r, y: cy - r, width: box, height: box)
        ctx.setFillColor(rgba(10, 16, 26, 0.92).cgColor)
        ctx.fillEllipse(in: disc)
        ctx.saveGState()
        ctx.setShadow(offset: .zero, blur: 0, color: nil)
        ctx.addEllipse(in: disc)
        ctx.clip()
        let w = max(1, logo.size.width), h = max(1, logo.size.height)
        let scale = box / min(w, h)
        UIGraphicsPushContext(ctx)
        logo.draw(in: CGRect(x: cx - w * scale / 2, y: cy - h * scale / 2, width: w * scale, height: h * scale))
        UIGraphicsPopContext()
        ctx.restoreGState()
    }

    /// A team's mark without an avatar: its initial in the display face, or the emoji itself.
    static func drawIcon(_ ctx: CGContext, _ icon: String?, x: CGFloat, y: CGFloat, px: CGFloat) {
        let mark = (icon?.isEmpty == false ? icon! : "🏈")
        if mark.count == 1, mark.range(of: "^[A-Za-z0-9]$", options: .regularExpression) != nil {
            text(ctx, mark.uppercased(), x: x, y: y + px * 0.04, font: display(px * 0.92, 700), color: .white)
        } else {
            let font = UIFont.systemFont(ofSize: px)
            let string = NSAttributedString(string: mark, attributes: [.font: font])
            let size = string.size()
            UIGraphicsPushContext(ctx)
            string.draw(at: CGPoint(x: x - size.width / 2, y: y - size.height / 2))
            UIGraphicsPopContext()
        }
    }

    // MARK: Cloth

    /// A team's flag across the top of their locker wall.
    static func teamFlag(icon: String?, color: UIColor, team: String, owner: String, since: Int?, logo: UIImage?) -> UIImage {
        let width: CGFloat = 1200, height: CGFloat = 636
        return image(width, height, opaque: true) { ctx in
            let all = CGRect(x: 0, y: 0, width: width, height: height)
            linear(ctx, [(0, color.mixed(with: .white, 0.16)), (0.45, color), (1, color.mixed(with: hex(0x05080E), 0.55))],
                   from: .zero, to: CGPoint(x: width, y: height), in: all)
            linear(ctx, [(0, black(0)), (0.35, rgba(4, 8, 14, 0.55)), (1, rgba(4, 8, 14, 0.66))],
                   from: CGPoint(x: width * 0.3, y: 0), to: CGPoint(x: width, y: 0), in: all)
            ctx.setStrokeColor(rgba(255, 240, 205, 0.75).cgColor)
            ctx.setLineWidth(9)
            ctx.stroke(CGRect(x: 24, y: 24, width: width - 48, height: height - 48))
            ctx.setStrokeColor(white(0.7 * 0.4).cgColor)
            ctx.setLineWidth(3)
            ctx.stroke(CGRect(x: 44, y: 44, width: width - 88, height: height - 88))

            let cx = width * 0.195, cy = height * 0.5, r = height * 0.285
            if logo == nil {
                ctx.saveGState()
                ctx.addEllipse(in: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2))
                ctx.clip()
                radial(ctx, [(0, color.mixed(with: .white, 0.3)), (1, color.mixed(with: .black, 0.45))],
                       c0: CGPoint(x: cx, y: cy - r * 0.3), r0: r * 0.1, c1: CGPoint(x: cx, y: cy), r1: r)
                ctx.restoreGState()
                ctx.setStrokeColor(rgba(255, 238, 190, 0.9).cgColor)
                ctx.setLineWidth(10)
                ctx.strokeEllipse(in: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2))
            }
            ctx.saveGState()
            ctx.setShadow(offset: .zero, blur: 18, color: black(0.5).cgColor)
            if let logo { drawLogo(ctx, logo, cx: cx, cy: cy, box: r * 2.3) } else { drawIcon(ctx, icon, x: cx, y: cy, px: r * 1.05) }
            ctx.restoreGState()

            let left = width * 0.395
            let room = width - left - 96
            let name = team.uppercased()
            let nameSize = fit(name, room, 104, weight: 700, kern: 2)
            text(ctx, name, x: left + 3, y: height * 0.42 + 4, font: display(nameSize, 700), color: black(0.55), kern: 2, align: .left)
            text(ctx, name, x: left, y: height * 0.42, font: display(nameSize, 700), color: rgba(255, 250, 240, 0.98), kern: 2, align: .left)
            let who = owner.uppercased()
            let ownerSize = fit(who, room, 54, weight: 600, kern: 6)
            text(ctx, who, x: left, y: height * 0.585, font: display(ownerSize, 600), color: color.mixed(with: .white, 0.72), kern: 6, align: .left)
            if let since {
                text(ctx, "EST. \(since)", x: left, y: height * 0.71, font: display(30, 600), color: white(0.5), kern: 10, align: .left)
            }
        }
    }

    /// One pennant per playoff berth, its own silhouette cut out of the bitmap.
    static func pennant(year: Int?, color: UIColor, note: String, crown: Bool) -> UIImage {
        let width: CGFloat = 320, height: CGFloat = 720
        return image(width, height) { ctx in
            ctx.beginPath()
            ctx.move(to: CGPoint(x: 14, y: 12))
            ctx.addLine(to: CGPoint(x: width - 14, y: 12))
            ctx.addLine(to: CGPoint(x: width / 2, y: height - 10))
            ctx.closePath()
            ctx.clip()
            let all = CGRect(x: 0, y: 0, width: width, height: height)
            linear(ctx, [(0, color.mixed(with: .white, 0.08)), (0.45, color), (1, color.mixed(with: hex(0x05080E), 0.32))],
                   from: .zero, to: CGPoint(x: 0, y: height), in: all)
            ctx.setFillColor((crown ? rgba(255, 214, 120, 0.98) : rgba(255, 246, 226, 0.95)).cgColor)
            ctx.fill(CGRect(x: 0, y: 18, width: width, height: crown ? 16 : 12))
            ctx.fill(CGRect(x: 0, y: 150, width: width, height: crown ? 12 : 8))

            let s = year.map(String.init) ?? ""
            let yearSize = fit(s, width * 0.74, 92, weight: 700, kern: 4)
            text(ctx, s, x: width / 2 + 3, y: 99, font: display(yearSize, 700), color: black(0.45), kern: 4)
            text(ctx, s, x: width / 2, y: 96, font: display(yearSize, 700), color: rgba(255, 250, 240, 0.98), kern: 4)
            let noteSize = fit(note, width * 0.66, 40, weight: 600, kern: 5)
            text(ctx, note, x: width / 2, y: 200, font: display(noteSize, 600), color: white(0.85), kern: 5)

            ctx.setFillColor(white(0.18).cgColor)
            for i in 0..<3 {
                let y = CGFloat(300 + i * 96)
                let size = CGFloat(26 - i * 6)
                ctx.beginPath()
                for p in 0..<10 {
                    let radius = p % 2 == 1 ? size * 0.44 : size
                    let angle = CGFloat(p) / 10 * .pi * 2 - .pi / 2
                    let point = CGPoint(x: width / 2 + cos(angle) * radius, y: y + sin(angle) * radius)
                    if p == 0 { ctx.move(to: point) } else { ctx.addLine(to: point) }
                }
                ctx.closePath()
                ctx.fillPath()
            }
        }
    }

    /// The hanging banner that names a wing.
    static func banner(name: String, kicker: String, accent: UIColor) -> UIImage {
        let width: CGFloat = 1024, height: CGFloat = 368
        return image(width, height, opaque: true) { ctx in
            let all = CGRect(x: 0, y: 0, width: width, height: height)
            linear(ctx, [(0, hex(0x101C2E)), (0.5, hex(0x16273E)), (1, hex(0x0B1420))], from: .zero, to: CGPoint(x: width, y: height), in: all)
            ctx.setFillColor(accent.withAlphaComponent(0.14).cgColor)
            ctx.fill(all)
            ctx.setStrokeColor(accent.withAlphaComponent(0.6).cgColor)
            ctx.setLineWidth(5)
            ctx.stroke(CGRect(x: 20, y: 20, width: width - 40, height: height - 40))

            let k = kicker.uppercased()
            text(ctx, k, x: width / 2, y: height * 0.27, font: display(fit(k, width * 0.7, 32, weight: 600, kern: 14), 600), color: accent, kern: 14)
            let n = name.uppercased()
            text(ctx, n, x: width / 2, y: height * 0.6, font: display(fit(n, width * 0.82, 126, weight: 700, kern: 12), 700),
                 color: rgba(255, 247, 230, 0.97), kern: 12)
            linear(ctx, [(0, black(0.45)), (0.28, white(0.06)), (0.7, black(0.2)), (1, black(0.5))],
                   from: .zero, to: CGPoint(x: 0, y: height), in: all)
        }
    }

    /// Brass lettering set into the floor where a wing begins.
    static func floorInlay(name: String, accent: UIColor) -> UIImage {
        let size: CGFloat = 1024, half = size / 2
        return image(size, size) { ctx in
            for (radius, width, alpha) in [(0.46, 7.0, 0.7), (0.41, 2.0, 0.4), (0.3, 3.0, 0.5)] as [(CGFloat, CGFloat, CGFloat)] {
                ctx.setStrokeColor(hex(0xE6C98A, alpha).cgColor)
                ctx.setLineWidth(width)
                ctx.strokeEllipse(in: CGRect(x: half - size * radius, y: half - size * radius, width: size * radius * 2, height: size * radius * 2))
            }
            let n = name.uppercased()
            text(ctx, n, x: half, y: half, font: display(fit(n, size * 0.5, 96, weight: 800, kern: 10), 800), color: hex(0xF0D69C, 0.85), kern: 10)
            text(ctx, "· PIGSKIN PANTHEON ·", x: half, y: half + size * 0.09, font: display(size * 0.032, 600), color: accent.withAlphaComponent(0.5), kern: 8)
        }
    }

    /// The small caption over each row of a locker wall.
    static func sectionLabel(_ s: String, color: UIColor) -> UIImage {
        image(1024, 92) { ctx in
            text(ctx, s, x: 512, y: 50, font: display(46, 700), color: black(0.6), kern: 14)
            text(ctx, s, x: 512, y: 46, font: display(46, 700), color: color, kern: 14)
        }
    }

    // MARK: Light

    /// One soft blob: contact shadows, pools of light, washes, dust.
    static func radialBlob(_ color: UIColor = .white, shadow: Bool = false) -> UIImage {
        image(256, 256) { ctx in
            let c = CGPoint(x: 128, y: 128)
            let stops: [(CGFloat, UIColor)] = shadow
                ? [(0, black(1)), (0.45, black(0.55)), (1, black(0))]
                : [(0, color), (1, color.withAlphaComponent(0))]
            radial(ctx, stops, c0: c, r0: 0, c1: c, r1: 128)
        }
    }

    /// A four-point star, the additive sparkle on polished gold.
    static func glint() -> UIImage {
        let size: CGFloat = 256, half = size / 2
        return image(size, size) { ctx in
            radial(ctx, [(0, white(1)), (0.4, rgba(255, 238, 196, 0.75)), (1, rgba(255, 220, 150, 0))],
                   c0: CGPoint(x: half, y: half), r0: 0, c1: CGPoint(x: half, y: half), r1: half * 0.28,
                   clip: CGRect(x: 0, y: 0, width: size, height: size))
            ctx.translateBy(x: half, y: half)
            ctx.setBlendMode(.plusLighter)
            for _ in 0..<4 {
                ctx.rotate(by: .pi / 2)
                ctx.saveGState()
                ctx.beginPath()
                ctx.move(to: CGPoint(x: -size * 0.018, y: 0))
                ctx.addLine(to: CGPoint(x: 0, y: -half))
                ctx.addLine(to: CGPoint(x: size * 0.018, y: 0))
                ctx.closePath()
                ctx.clip()
                linear(ctx, [(0, rgba(255, 247, 224, 0.85)), (1, rgba(255, 220, 150, 0))], from: .zero, to: CGPoint(x: 0, y: -half),
                       in: CGRect(x: -half, y: -half, width: size, height: size))
                ctx.restoreGState()
            }
        }
    }

    /// The streak of light a plinth throws on the polished floor.
    static func sheen() -> UIImage {
        image(64, 256, scale: 1) { ctx in
            let all = CGRect(x: 0, y: 0, width: 64, height: 256)
            linear(ctx, [(0, white(0.85)), (0.45, white(0.3)), (1, white(0))], from: .zero, to: CGPoint(x: 0, y: 256), in: all)
            ctx.setBlendMode(.destinationOut)
            linear(ctx, [(0, black(1)), (0.5, black(0)), (1, black(1))], from: .zero, to: CGPoint(x: 64, y: 0), in: all)
        }
    }

    /// The hall's reflected world: what gives gold its streaks of overhead light.
    static func environment() -> UIImage {
        let width: CGFloat = 1024, height: CGFloat = 512
        return image(width, height, scale: 1, opaque: true) { ctx in
            let all = CGRect(x: 0, y: 0, width: width, height: height)
            linear(ctx, [(0, hex(0xC2A878)), (0.3, hex(0x5C6478)), (0.48, hex(0x2C3A4F)), (0.62, hex(0x1A2433)), (0.8, hex(0x0D141F)), (1, hex(0x070B12))],
                   from: .zero, to: CGPoint(x: 0, y: height), in: all)
            ctx.saveGState()
            ctx.setBlendMode(.plusLighter)
            for i in 0..<6 {
                let y = height * (0.06 + CGFloat(i) * 0.035)
                linear(ctx, [(0, rgba(255, 226, 170, 0)), (0.5, rgba(255, 232, 186, 0.5 - CGFloat(i) * 0.06)), (1, rgba(255, 226, 170, 0))],
                       from: CGPoint(x: 0, y: y - 14), to: CGPoint(x: 0, y: y + 14), in: CGRect(x: 0, y: y - 16, width: width, height: 32))
            }
            for i in 0..<10 {
                let x = (CGFloat(i) + 0.5) * (width / 10)
                let y = height * 0.42
                radial(ctx, [(0, rgba(255, 214, 146, 0.85)), (0.35, rgba(255, 182, 104, 0.28)), (1, rgba(255, 170, 90, 0))],
                       c0: CGPoint(x: x, y: y), r0: 0, c1: CGPoint(x: x, y: y), r1: width * 0.05,
                       clip: CGRect(x: x - width * 0.05, y: y - width * 0.05, width: width * 0.1, height: width * 0.1))
            }
            ctx.restoreGState()
            linear(ctx, [(0, rgba(40, 70, 110, 0)), (1, rgba(46, 80, 124, 0.35))], from: CGPoint(x: 0, y: height * 0.7),
                   to: CGPoint(x: 0, y: height), in: CGRect(x: 0, y: height * 0.7, width: width, height: height * 0.3))
        }
    }
}

// MARK: Team logos

/// The team logos the crests are struck from, decoded before anything is
/// painted (textures.js `loadTeamLogos`). An http logo is fetched; the demo's
/// drawn data: logos are drawn natively as the same badge.
enum TrophyLogos {
    static func load(_ table: [String: String]) async -> [String: UIImage] {
        await withTaskGroup(of: (String, UIImage?).self) { group in
            for (ownerId, source) in table {
                group.addTask { (ownerId, await image(source)) }
            }
            var out: [String: UIImage] = [:]
            for await (ownerId, image) in group { if let image { out[ownerId] = image } }
            return out
        }
    }

    static func image(_ source: String) async -> UIImage? {
        if source.hasPrefix("http"), let url = URL(string: source) {
            var request = URLRequest(url: url)
            request.timeoutInterval = 8
            guard let (data, _) = try? await URLSession.shared.data(for: request) else { return nil }
            return UIImage(data: data)
        }
        if source.hasPrefix("data:image/svg") {
            return svgBadge(source)
        }
        if source.hasPrefix("data:"), let comma = source.firstIndex(of: ","), source[..<comma].hasSuffix(";base64"),
           let data = Data(base64Encoded: String(source[source.index(after: comma)...])) {
            return UIImage(data: data)
        }
        return nil
    }

    /// The demo's logos are a badge drawn in SVG: a disc shading from a colour
    /// to night blue, a pale ring, and the team's initials. Drawn here the same.
    static func svgBadge(_ source: String) -> UIImage? {
        guard let comma = source.firstIndex(of: ",") else { return nil }
        let body = String(source[source.index(after: comma)...]).removingPercentEncoding ?? ""
        func capture(_ pattern: String) -> String? {
            guard let regex = try? NSRegularExpression(pattern: pattern),
                  let match = regex.firstMatch(in: body, range: NSRange(body.startIndex..., in: body)),
                  let range = Range(match.range(at: 1), in: body) else { return nil }
            return String(body[range])
        }
        let top = UIColor(trophyHex: capture(#"stop-color="(#[0-9a-fA-F]{3,6})""#))
        let letters = capture(#">([^<>]+)</text>"#) ?? ""
        return Paint.image(256, 256, scale: 1) { ctx in
            ctx.addEllipse(in: CGRect(x: 0, y: 0, width: 256, height: 256))
            ctx.clip()
            Paint.linear(ctx, [(0, top), (1, Paint.hex(0x0B1220))], from: .zero, to: CGPoint(x: 256, y: 256),
                         in: CGRect(x: 0, y: 0, width: 256, height: 256))
            ctx.setStrokeColor(Paint.white(0.35).cgColor)
            ctx.setLineWidth(6)
            ctx.strokeEllipse(in: CGRect(x: 24, y: 24, width: 208, height: 208))
            let font = UIFont.systemFont(ofSize: 88, weight: .black)
            Paint.text(ctx, letters, x: 128, y: 152 - font.capHeight / 2, font: font, color: .white)
        }
    }
}
