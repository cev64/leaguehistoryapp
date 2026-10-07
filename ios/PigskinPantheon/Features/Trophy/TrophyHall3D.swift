import SceneKit
import UIKit
import simd

/// trophy/hall.js: the building. Everything that spans the gallery is built
/// once and flattened into a handful of meshes, so the room costs a few draw
/// calls however many wings the league grows into.
enum HallMetrics {
    // The corridor (a desktop, an iPad, a phone on its side).
    static let spacing: Float = 3.85
    static let wingGap: Float = 6.4
    static let itemZ: Float = 0
    static let wallZ: Float = -5.0
    static let frontZ: Float = 9.4
    static let ceilingY: Float = 6.7

    // The shaft (a phone held upright): the same gallery stood on its end.
    enum Shaft {
        static let spacing: Float = 4.6
        static let wingGap: Float = 7.2
        static let wallZ: Float = -1.35
        static let shelfZ: Float = 0.9
        static let shelfDepth: Float = 1.9
        static let half: Float = 2.3
        static let shelfDrop: Float = 0.2
    }

    /// A pillar is most of a plinth already, and a plaque has to land at
    /// reading height; the plinth under each exhibit is cut to suit.
    static func plinthHeight(_ kind: String) -> Float {
        switch kind {
        case "cup": return 0.72
        case "pillar": return 0.86
        case "plaque": return 0.92
        case "toilet": return 0.74
        default: return 1.12
        }
    }
}

/// hall.js `planLayout`: where every exhibit stands along the rail, and where
/// each wing begins and ends. Positions are distances along the rail.
struct HallLayout {
    struct WingSpan { var startX: Float; var archX: Float; var endX: Float; var centerX: Float }

    let vertical: Bool
    let spacing: Float
    let wingGap: Float
    var positions: [Float] = []
    var wings: [WingSpan] = []
    var minX: Float = 0
    var maxX: Float = 0
    var length: Float { maxX - minX }

    init(hall: TrophyHall, vertical: Bool) {
        self.vertical = vertical
        spacing = vertical ? HallMetrics.Shaft.spacing : HallMetrics.spacing
        wingGap = vertical ? HallMetrics.Shaft.wingGap : HallMetrics.wingGap
        positions = Array(repeating: 0, count: hall.rail.count)
        var x: Float = 0
        for (index, wing) in hall.wings.enumerated() {
            if index > 0 { x += wingGap }
            let start = x
            for i in 0..<wing.count { positions[wing.start + i] = x + Float(i) * spacing }
            x += Float(max(0, wing.count - 1)) * spacing
            wings.append(WingSpan(startX: start, archX: start - wingGap / 2, endX: x, centerX: (start + x) / 2))
        }
        minX = (positions.first ?? 0) - wingGap
        maxX = (positions.last ?? 0) + wingGap
    }

    /// A distance along the rail as a point in the room: a corridor spends it
    /// going right, a shaft going down.
    func place(_ distance: Float) -> SIMD3<Float> {
        vertical ? [0, -distance, HallMetrics.itemZ] : [distance, 0, HallMetrics.itemZ]
    }

    /// A fractional rail index as a distance along the rail.
    func along(_ t: Float) -> Float {
        guard !positions.isEmpty else { return 0 }
        let clamped = min(max(t, 0), Float(positions.count - 1))
        let low = Int(clamped.rounded(.down))
        let high = min(positions.count - 1, low + 1)
        let f = clamped - Float(low)
        return positions[low] + (positions[high] - positions[low]) * f
    }
}

/// Builds the room: a corridor or a shaft.
struct HallBuilder {
    let kit: TrophyKit
    let hall: TrophyHall
    let layout: HallLayout
    private var mat: TrophyMaterials { kit.mat }

    private let solid = SCNNode()
    private let glows = SCNNode()
    private let extras = SCNNode()

    init(kit: TrophyKit, hall: TrophyHall, layout: HallLayout) {
        self.kit = kit
        self.hall = hall
        self.layout = layout
    }

    func build() -> SCNNode {
        if layout.vertical { buildShaft() } else { buildCorridor() }
        let room = SCNNode()
        room.name = "room"
        let flatSolid = solid.flattenedClone()
        flatSolid.castsShadow = false
        let flatGlow = glows.flattenedClone()
        flatGlow.castsShadow = false
        flatGlow.renderingOrder = 2
        room.adding(flatSolid, flatGlow, extras)
        room.enumerateHierarchy { node, _ in
            node.categoryBitMask = TrophyCategory.decor
            node.castsShadow = false
        }
        return room
    }

    // MARK: Pieces

    private func add(_ geometry: SCNGeometry, _ material: SCNMaterial, _ p: SIMD3<Float>, rx: Float = 0, ry: Float = 0, rz: Float = 0, to parent: SCNNode? = nil) {
        let node = SCNNode.shared(geometry, material, at: p)
        node.simdEulerAngles = [rx, ry, rz]
        (parent ?? solid).addChildNode(node)
    }

    private func strip(_ color: UInt32, _ intensity: CGFloat) -> SCNMaterial {
        TrophyMaterials.glow(UIColor(trophyRGB: color).scaled(intensity), additive: false)
    }

    private func wash(_ color: UIColor, opacity: CGFloat) -> SCNMaterial {
        let image = mat.image("blob") { Paint.radialBlob() }
        let m = TrophyMaterials.glow(image, additive: true, opacity: 1)
        m.multiply.contents = color.scaled(opacity)
        return m
    }

    private func banner(_ wing: TrophyWing, width: Float, height: Float) -> SCNNode {
        let image = mat.image("banner:\(wing.id)") { Paint.banner(name: wing.name, kicker: wing.kicker, accent: UIColor(trophyHex: wing.accent)) }
        let material = TrophyMaterials.faced(image, metalness: 0.05, roughness: 0.85, doubleSided: true)
        let geometry = kit.geometry("banner:\(width)") { Mesh.plane(width, height, 16, 1) { x, _ in sin(x * 2.2) * 0.05 } }
        return SCNNode.shared(geometry, material)
    }

    // MARK: Shaft

    private func buildShaft() {
        typealias S = HallMetrics.Shaft
        let span = layout.length
        let midY = -(layout.minX + layout.maxX) / 2
        let wallZ = S.wallZ, half = S.half

        add(Mesh.plane(half * 2 + 1.4, span), mat.tiled(mat.darkMarbleImage, color: 0x8BA2BD, metalness: 0.3, roughness: 0.5, rx: 2, ry: span / 7), [0, midY, wallZ])
        let stile = mat.tiled(mat.walnutImage, color: 0x6D5539, metalness: 0.15, roughness: 0.66, rx: 1, ry: span / 4)
        for side: Float in [-1, 1] {
            add(Mesh.box(0.9, span, 0.5), stile, [side * (half + 0.2), midY, wallZ + 0.24])
            add(Mesh.box(0.1, span, 0.62), mat.brass, [side * (half - 0.3), midY, wallZ + 0.5])
            add(Mesh.box(0.05, span, 0.3), strip(0xD9B168, 0.4), [side * (half + 0.62), midY, wallZ + 0.5])
        }

        let alcove = TrophyMaterials.pbr(UIColor(trophyRGB: 0x101B2C), metalness: 0.35, roughness: 0.55)
        let alcoveG = Mesh.roundedBox(half * 1.3, 3.2, 0.16, 0.06)
        let shelfG = Mesh.roundedBox(half * 1.4, S.shelfDrop, S.shelfDepth, 0.05)
        let lipG = Mesh.roundedBox(half * 1.42, 0.03, S.shelfDepth + 0.06, 0.012)
        let bracketG = Mesh.cylinder(0.05, 0.08, 0.34, 10)
        let washG = Mesh.plane(half * 1.3, 3.4)
        for (index, distance) in layout.positions.enumerated() {
            let y = -distance
            add(alcoveG, alcove, [0, y + 1.55, wallZ + 0.14])
            add(shelfG, mat.darkMarble, [0, y - S.shelfDrop / 2, wallZ + S.shelfZ])
            add(lipG, mat.brass, [0, y - S.shelfDrop - 0.015, wallZ + S.shelfZ])
            for side: Float in [-1, 1] {
                add(bracketG, mat.brass, [side * half * 0.6, y - S.shelfDrop - 0.2, wallZ + 0.5])
            }
            let accent = UIColor(trophyHex: hall.rail[index].accent)
            add(washG, wash(accent, opacity: 0.08), [0, y + 1.55, wallZ + 0.24], to: glows)
        }

        for (wingIndex, wing) in hall.wings.enumerated() {
            let span = layout.wings[wingIndex]
            let bannerY = -(span.startX - layout.wingGap * 0.46)
            let cloth = banner(wing, width: 3.9, height: 1.4)
            cloth.simdPosition = [0, bannerY, wallZ + 0.6]
            extras.addChildNode(cloth)
            add(Mesh.cylinder(0.036, 0.036, 4.2, 12), mat.brass, [0, bannerY + 0.76, wallZ + 0.62], rz: .pi / 2)
            if wingIndex > 0 {
                let y = -span.archX
                add(Mesh.box(half * 2 + 1.2, 0.34, 0.7), mat.marble, [0, y, wallZ + 0.8])
                add(Mesh.box(half * 2 + 1.3, 0.08, 0.84), mat.brass, [0, y - 0.2, wallZ + 0.86])
                add(Mesh.plane(half * 2 + 1.2, 0.06), strip(0, 1).copyWith(UIColor(trophyHex: wing.accent)), [0, y + 0.2, wallZ + 1.16])
            }
        }

        let capMaterial = TrophyMaterials.pbr(UIColor(trophyRGB: 0x0A1220), metalness: 0.3, roughness: 0.7)
        for (y, facing) in [(-layout.minX, Float(-1)), (-layout.maxX, Float(1))] {
            add(Mesh.plane(half * 2 + 1.4, HallMetrics.frontZ - wallZ), capMaterial, [0, y, (wallZ + HallMetrics.frontZ) / 2], rx: facing * .pi / 2)
        }

        // A little more ambient than a corridor: you are nose to nose with the case.
        let fill = SCNNode()
        fill.light = SCNLight()
        fill.light!.type = .ambient
        fill.light!.color = UIColor(trophyRGB: 0xA9C4EE)
        fill.light!.intensity = 90
        extras.addChildNode(fill)
    }

    // MARK: Corridor

    private func buildCorridor() {
        let centerX = (layout.minX + layout.maxX) / 2
        let span = layout.length
        let depth = HallMetrics.frontZ - HallMetrics.wallZ
        let midZ = (HallMetrics.wallZ + HallMetrics.frontZ) / 2
        let itemZ = HallMetrics.itemZ

        add(Mesh.plane(span, depth), mat.tiled(mat.darkMarbleImage, color: 0x8EA4BD, metalness: 0.55, roughness: 0.26, rx: span / 6, ry: depth / 6),
            [centerX, 0, midZ], rx: -.pi / 2)
        add(Mesh.plane(span, 3.6), TrophyMaterials.pbr(UIColor(trophyRGB: 0x0B1524), metalness: 0.5, roughness: 0.34),
            [centerX, 0.004, itemZ + 0.4], rx: -.pi / 2)
        for side: Float in [-1, 1] {
            add(Mesh.plane(span, 0.06), strip(0xD9B168, 0.55), [centerX, 0.008, itemZ + 0.4 + side * 1.82], rx: -.pi / 2)
        }

        let wainscot = mat.tiled(mat.walnutImage, color: 0x6D5539, metalness: 0.15, roughness: 0.66, rx: span / 3, ry: 1)
        let upper = mat.tiled(mat.darkMarbleImage, color: 0x97AEC9, metalness: 0.3, roughness: 0.52, rx: span / 8, ry: 1)
        for (z, f) in [(HallMetrics.wallZ, Float(1)), (HallMetrics.frontZ, Float(-1))] {
            add(Mesh.box(span, 1.45, 0.5), wainscot, [centerX, 0.72, z - f * 0.25])
            add(Mesh.box(span, 0.09, 0.62), mat.brass, [centerX, 1.5, z - f * 0.31])
            add(Mesh.box(span, 3.9, 0.4), upper, [centerX, 3.5, z - f * 0.2])
            add(Mesh.box(span, 0.3, 0.66), mat.darkMarble, [centerX, 5.6, z - f * 0.33])
            add(Mesh.box(span, 0.06, 0.3), strip(0xFFD9A0, 0.85), [centerX, 5.4, z - f * 0.55])
        }

        let bays = max(2, Int((span / 4.3).rounded()))
        let pilaster = Mesh.roundedBox(0.46, 4.1, 0.34, 0.03)
        let capital = Mesh.roundedBox(0.58, 0.16, 0.44, 0.03)
        for i in 0..<bays {
            let x = layout.minX + (Float(i) + 0.5) * (span / Float(bays))
            for (z, f) in [(HallMetrics.wallZ, Float(1)), (HallMetrics.frontZ, Float(-1))] {
                add(pilaster, mat.marble, [x, 3.5, z - f * 0.02])
                add(capital, mat.brass, [x, 5.62, z - f * 0.06])
            }
        }

        let sconce = Mesh.sphere(0.075, 12)
        let arm = Mesh.cylinder(0.02, 0.03, 0.2, 8)
        let halo = Mesh.plane(1.1, 1.1)
        let haloMaterial = wash(UIColor(trophyRGB: 0xFFBE72), opacity: 0.3)
        for i in 0..<bays {
            let x = layout.minX + Float(i + 1) * (span / Float(bays))
            add(sconce, strip(0xFFD9A4, 1), [x, 2.62, HallMetrics.wallZ + 0.28])
            add(halo, haloMaterial, [x, 2.62, HallMetrics.wallZ + 0.3], to: glows)
            add(arm, mat.brass, [x, 2.48, HallMetrics.wallZ + 0.18])
        }

        add(Mesh.plane(span, depth), TrophyMaterials.pbr(UIColor(trophyRGB: 0x080E18), metalness: 0.2, roughness: 0.9),
            [centerX, HallMetrics.ceilingY, midZ], rx: .pi / 2)
        let coffer = Mesh.roundedBox(3.0, 0.16, 3.0, 0.06)
        let cofferMaterial = TrophyMaterials.pbr(UIColor(trophyRGB: 0x14202F), metalness: 0.4, roughness: 0.6)
        let lamp = Mesh.plane(2.2, 0.42)
        for i in 0..<bays {
            let x = layout.minX + (Float(i) + 0.5) * (span / Float(bays))
            add(coffer, cofferMaterial, [x, HallMetrics.ceilingY - 0.12, itemZ + 1.2])
            add(lamp, strip(0xFFD39A, 0.8), [x, HallMetrics.ceilingY - 0.21, itemZ + 1.2], rx: .pi / 2)
        }

        for (wingIndex, wing) in hall.wings.enumerated() {
            let w = layout.wings[wingIndex]
            let accent = UIColor(trophyHex: wing.accent)
            let cloth = banner(wing, width: 3.2, height: 1.15)
            cloth.simdPosition = [w.centerX, 4.35, HallMetrics.wallZ + 0.42]
            extras.addChildNode(cloth)
            add(Mesh.cylinder(0.032, 0.032, 3.5, 12), mat.brass, [w.centerX, 4.99, HallMetrics.wallZ + 0.44], rz: .pi / 2)

            let inlayImage = mat.image("inlay:\(wing.id)") { Paint.floorInlay(name: wing.name, accent: accent) }
            let inlayMaterial = TrophyMaterials.glow(inlayImage, additive: false, opacity: 0.55)
            inlayMaterial.blendMode = .alpha
            inlayMaterial.writesToDepthBuffer = false
            add(Mesh.plane(3, 3), inlayMaterial, [w.centerX, 0.012, itemZ + 2.0], rx: -.pi / 2, to: glows)

            if wingIndex > 0 { arch(at: w.archX, accent: accent) }
            add(Mesh.plane(w.endX - w.startX + 5, 5.4), wash(accent, opacity: 0.08), [w.centerX, 2.6, HallMetrics.wallZ + 0.5], to: glows)
        }

        let endMaterial = TrophyMaterials.pbr(UIColor(trophyRGB: 0x0A1220), metalness: 0.3, roughness: 0.7)
        for (x, f) in [(layout.minX, Float(1)), (layout.maxX, Float(-1))] {
            add(Mesh.plane(depth, 6.7), endMaterial, [x, 3.35, midZ], ry: f * .pi / 2)
        }
    }

    private func arch(at x: Float, accent: UIColor) {
        let z = HallMetrics.wallZ + 0.62
        let half: Float = 1.35
        for side: Float in [-1, 1] {
            add(kit.geometry("archColumn") { Mesh.cylinder(0.2, 0.24, 3.6, 18) }, mat.marble, [x + side * half, 1.8, z])
            add(kit.geometry("archBase") { Mesh.cylinder(0.3, 0.34, 0.18, 18) }, mat.darkMarble, [x + side * half, 0.09, z])
            add(kit.geometry("archCap") { Mesh.cylinder(0.28, 0.21, 0.18, 18) }, mat.brass, [x + side * half, 3.69, z])
        }
        add(kit.geometry("archSpan") { Mesh.torus(half, 0.19, radial: 12, tubular: 36, arc: .pi) }, mat.marble, [x, 3.78, z])
        add(kit.geometry("archKey") { Mesh.roundedBox(0.34, 0.44, 0.34, 0.04) }, mat.brass, [x, 5.18, z])
        add(Mesh.plane(half * 2.1, 5.1), TrophyMaterials.pbr(UIColor(trophyRGB: 0x060B13), metalness: 0.2, roughness: 0.9), [x, 2.2, HallMetrics.wallZ + 0.12])
        add(Mesh.plane(half * 2.6, 5.4), wash(accent, opacity: 0.3), [x, 2.0, HallMetrics.wallZ + 0.2], to: glows)
        add(kit.geometry("archRim") { Mesh.torus(half - 0.19, 0.022, radial: 8, tubular: 40, arc: .pi) },
            TrophyMaterials.glow(accent.scaled(1.5), additive: false), [x, 3.78, z + 0.02])
    }
}

private extension SCNMaterial {
    func copyWith(_ color: UIColor) -> SCNMaterial {
        let m = copy() as! SCNMaterial
        m.diffuse.contents = color
        return m
    }
}

// MARK: Lights

/// hall.js `buildTravellingLights`: a key on whatever is in front of the
/// viewer and a wash on each neighbour, riding the rail with them, plus a
/// warm bounce off the wall behind.
final class TravellingLights {
    let vertical: Bool
    let key = SCNNode(), keyTarget = SCNNode()
    let wings = [SCNNode(), SCNNode()]
    let rim = SCNNode()
    private var keyColor = SIMD3<Float>(1, 0.89, 0.72)
    private var rimColor = SIMD3<Float>(1, 0.62, 0.36)

    init(vertical: Bool, shadows: Bool) {
        self.vertical = vertical
        let keyLight = SCNLight()
        keyLight.type = .spot
        keyLight.intensity = vertical ? 290 : 500
        keyLight.spotOuterAngle = vertical ? 64 : 72
        keyLight.spotInnerAngle = vertical ? 20 : 40
        keyLight.attenuationStartDistance = 0
        keyLight.attenuationEndDistance = vertical ? 30 : 22
        keyLight.attenuationFalloffExponent = vertical ? 1 : 1.5
        if shadows {
            keyLight.castsShadow = true
            keyLight.shadowMapSize = CGSize(width: 1024, height: 1024)
            keyLight.shadowRadius = 4
            keyLight.shadowSampleCount = 8
            keyLight.shadowColor = UIColor(white: 0, alpha: 0.55)
            keyLight.zNear = 1
            keyLight.zFar = 14
            keyLight.shadowMode = .forward
        }
        key.light = keyLight
        for wing in wings {
            let light = SCNLight()
            light.type = .spot
            light.color = UIColor(trophyRGB: 0xBCD2FF)
            light.intensity = vertical ? 120 : 340
            light.spotOuterAngle = vertical ? 114 : 80
            light.spotInnerAngle = vertical ? 12 : 28
            light.attenuationEndDistance = vertical ? 26 : 20
            light.attenuationFalloffExponent = 1.5
            wing.light = light
        }
        let rimLight = SCNLight()
        rimLight.type = .omni
        rimLight.intensity = vertical ? 50 : 260
        rimLight.attenuationStartDistance = 0
        rimLight.attenuationEndDistance = vertical ? 6 : 16
        rimLight.attenuationFalloffExponent = 2
        rim.light = rimLight
    }

    var nodes: [SCNNode] { [key, keyTarget, wings[0], wings[1], rim] }

    func update(along: Float, accent: UIColor) {
        let spacing = vertical ? HallMetrics.Shaft.spacing : HallMetrics.spacing
        let itemZ = HallMetrics.itemZ
        func place(_ node: SCNNode, _ across: Float, _ up: Float, _ out: Float, step: Float = 0) {
            node.simdPosition = vertical ? [across, along + up + step, itemZ + out] : [along + step, up, itemZ + out]
        }
        let target = SCNNode()
        if vertical {
            place(key, 1.1, 3.1, 3.3)
            place(target, 0, 1.2, 0)
        } else {
            place(key, 0, 5.3, 1.9)
            place(target, 0, 1.3, 0)
        }
        key.simdLook(at: target.simdPosition)
        for (i, side) in [Float(-1), 1].enumerated() {
            if vertical {
                place(wings[i], -1.5, 1.5, 3.6, step: side * spacing)
                place(target, 0, 1.2, 0, step: side * spacing)
            } else {
                place(wings[i], 0, 5.0, 2.4, step: side * spacing)
                place(target, 0, 1.1, 0, step: side * spacing)
            }
            wings[i].simdLook(at: target.simdPosition)
        }
        if vertical {
            place(rim, 0, 1.9, HallMetrics.Shaft.wallZ + 0.28 - itemZ)
        } else {
            place(rim, 0, 1.9, HallMetrics.wallZ + 1.4 - itemZ)
        }
        // The key and the bounce take on the wing's colour.
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        accent.getRed(&r, green: &g, blue: &b, alpha: &a)
        let tint = SIMD3<Float>(Float(r), Float(g), Float(b))
        let keyGoal = simd_mix(SIMD3<Float>(1, 0.89, 0.72), tint, SIMD3(repeating: 0.4))
        let rimGoal = simd_mix(SIMD3<Float>(1, 0.62, 0.36), tint, SIMD3(repeating: 0.45))
        keyColor = simd_mix(keyColor, keyGoal, SIMD3(repeating: 0.08))
        rimColor = simd_mix(rimColor, rimGoal, SIMD3(repeating: 0.06))
        key.light?.color = UIColor(red: CGFloat(keyColor.x), green: CGFloat(keyColor.y), blue: CGFloat(keyColor.z), alpha: 1)
        rim.light?.color = UIColor(red: CGFloat(rimColor.x), green: CGFloat(rimColor.y), blue: CGFloat(rimColor.z), alpha: 1)
    }
}

/// The soft dark patch a pedestal presses into the floor.
func contactShadow(kit: TrophyKit, radius: Float = 0.95, opacity: CGFloat) -> SCNNode {
    let image = kit.mat.image("shadow") { Paint.radialBlob(shadow: true) }
    let m = TrophyMaterials.glow(image, additive: false, opacity: opacity)
    m.blendMode = .alpha
    m.writesToDepthBuffer = false
    let node = kit.part("contactShadow", m, at: [0, 0.006, 0]) { Mesh.plane(radius * 2, radius * 2) }
    node.simdEulerAngles.x = -.pi / 2
    node.renderingOrder = -1
    return node.decorative()
}

/// hall.js `buildDust`: motes drifting in the light around the viewer.
func dustNode(kit: TrophyKit, vertical: Bool) -> SCNNode {
    let system = SCNParticleSystem()
    system.particleImage = kit.mat.image("blob") { Paint.radialBlob() }
    system.particleColor = UIColor(trophyRGB: 0xFFE1B0, alpha: 0.5)
    system.particleSize = 0.03
    system.particleSizeVariation = 0.015
    system.birthRate = 14
    system.particleLifeSpan = 30
    system.particleLifeSpanVariation = 8
    system.warmupDuration = 30
    system.blendMode = .additive
    system.isLightingEnabled = false
    system.emitterShape = SCNBox(width: vertical ? 7 : 26, height: vertical ? 26 : 5.4,
                                 length: CGFloat(HallMetrics.frontZ - HallMetrics.wallZ), chamferRadius: 0)
    system.birthLocation = .volume
    system.particleVelocity = 0.05
    system.particleVelocityVariation = 0.03
    system.emittingDirection = vertical ? SCNVector3(1, 0, 0) : SCNVector3(0, 1, 0)
    system.spreadingAngle = 25
    system.isLocal = false
    let node = SCNNode()
    node.addParticleSystem(system)
    return node.decorative()
}
