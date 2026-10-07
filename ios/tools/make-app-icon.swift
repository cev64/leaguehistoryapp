// Builds the iOS app icon (1024×1024, opaque) from icons/crest-master.png:
// the crest at 80% on the site's navy (theme_color #071827), as
// tools/build-icons.py does for apple-touch-icon.png.
//
// From the repository root:
//     swiftc -o /tmp/make-app-icon ios/tools/make-app-icon.swift && /tmp/make-app-icon
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let input = root.appendingPathComponent("icons/crest-master.png")
let output = root.appendingPathComponent("ios/PigskinPantheon/Assets.xcassets/AppIcon.appiconset/icon-1024.png")

guard let source = CGImageSourceCreateWithURL(input as CFURL, nil),
      let crest = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fatalError("Couldn't read \(input.path) (run from the repository root)")
}
let size = 1024, scale = 0.80
guard let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                          space: CGColorSpace(name: CGColorSpace.sRGB)!,
                          bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { fatalError("no context") }
ctx.setFillColor(CGColor(srgbRed: 7 / 255, green: 24 / 255, blue: 39 / 255, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
let inner = Double(size) * scale, off = (Double(size) - inner) / 2
ctx.interpolationQuality = .high
ctx.draw(crest, in: CGRect(x: off, y: off, width: inner, height: inner))
guard let image = ctx.makeImage(),
      let dest = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil) else { fatalError("no image") }
CGImageDestinationAddImage(dest, image, nil)
CGImageDestinationFinalize(dest)
print("wrote \(output.path)")
