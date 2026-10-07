import SceneKit
import UIKit
import simd

/// trophy/models.js: every object in the hall, built from primitives at load
/// time — lathed cups, extruded stars and shields, a porcelain throne. Each
/// builder returns a node whose origin sits on the surface it stands on, and
/// says which parts turn on their own and where it catches a glint.
struct Sculpture {
    let node: SCNNode
    var spin: [(node: SCNNode, speed: Float)] = []
    var glints: [SIMD3<Float>] = []
    /// It has a front meant to be read, so it barely sways.
    var faceForward = false
}

/// What a sculpture needs to know about whose it is.
struct Livery {
    var ownerId: String?
    var color: String
    var icon: String?
    var tarnished = false
    var key: String
}

/// The shared workshop: materials, team logos, and every geometry that never
/// varies, cut once and shared by every exhibit.
final class TrophyKit {
    let mat: TrophyMaterials
    let logos: [String: UIImage]
    private var geometries: [String: SCNGeometry] = [:]
    private var crests: [String: SCNMaterial] = [:]
    private let lock = NSLock()

    init(logos: [String: UIImage]) {
        self.mat = TrophyMaterials()
        self.logos = logos
    }

    func geometry(_ key: String, _ make: () -> SCNGeometry) -> SCNGeometry {
        lock.lock()
        if let g = geometries[key] { lock.unlock(); return g }
        lock.unlock()
        let g = make()
        lock.lock(); geometries[key] = g; lock.unlock()
        return g
    }

    /// One node of a shared geometry, in its own material.
    func part(_ key: String, _ material: SCNMaterial, at p: SIMD3<Float> = .zero, _ make: () -> SCNGeometry) -> SCNNode {
        SCNNode.shared(geometry(key, make), material, at: p)
    }

    func crestMaterial(_ livery: Livery) -> SCNMaterial {
        let key = livery.ownerId ?? livery.key
        lock.lock()
        if let m = crests[key] { lock.unlock(); return m }
        lock.unlock()
        let image = Paint.crest(icon: livery.icon, color: UIColor(trophyHex: livery.color), logo: livery.ownerId.flatMap { logos[$0] })
        let m = TrophyMaterials.faced(image, metalness: 0.15, roughness: 0.52, transparent: true)
        lock.lock(); crests[key] = m; lock.unlock()
        return m
    }

    // MARK: Crest disc

    /// A disc carrying the team crest on its front face, gold on the rim and back.
    func crestDisc(_ livery: Livery, radius: Float = 0.3, thickness: Float = 0.055, metal: SCNMaterial? = nil) -> SCNNode {
        let surround = metal ?? (livery.tarnished ? mat.pewter : mat.gold)
        let group = SCNNode()
        let body = part("crestBody:\(radius):\(thickness)", livery.tarnished ? mat.tarnish : mat.goldWarm) {
            Mesh.cylinder(radius, radius, thickness, 56)
        }
        body.simdEulerAngles.x = .pi / 2
        let face = part("crestFace:\(radius)", crestMaterial(livery), at: [0, 0, thickness / 2 + 0.002]) {
            Mesh.disc(radius * 0.995, segments: 64)
        }
        face.renderingOrder = 1
        let rim = part("crestRim:\(radius):\(thickness)", surround) {
            Mesh.torus(radius * 1.005, thickness * 0.44, radial: 10, tubular: 60)
        }
        return group.adding(body, face, rim)
    }

    // MARK: Pedestal

    /// A plinth: a base, a shaft and a capped top, with a band of the team's
    /// colour under the cap and an engraved plate on the front.
    func pedestal(_ item: TrophyExhibit, height: Float) -> SCNNode {
        let baseTop: Float = 0.13
        let capBottom = height - 0.09
        let shaftHeight = max(0.12, capBottom - baseTop)
        let group = SCNNode()
        let plinth = part("plinth", mat.darkMarble, at: [0, 0.065, 0]) { Mesh.roundedBox(1.0, 0.13, 1.0, 0.045) }
        let shaft = part("shaft:\(shaftHeight)", mat.marble, at: [0, baseTop + shaftHeight / 2, 0]) {
            Mesh.roundedBox(0.76, shaftHeight, 0.76, 0.035)
        }
        let cap = part("pedCap", mat.darkMarble, at: [0, height - 0.045, 0]) { Mesh.roundedBox(0.92, 0.09, 0.92, 0.03) }
        let band = part("pedBand", mat.teamMetal(item.tint, emissive: 0.5), at: [0, height - 0.105, 0]) {
            Mesh.roundedBox(0.855, 0.02, 0.855, 0.01)
        }
        let plateImage = Paint.nameplate(title: item.title, sub: item.subtitle, accent: UIColor(trophyHex: item.accent),
                                         metal: item.isTarnished ? .pewter : .brass)
        let plate = part("pedPlate", TrophyMaterials.faced(plateImage, metalness: 0.28, roughness: 0.32),
                         at: [0, baseTop + shaftHeight / 2, 0.3855]) { Mesh.plane(0.64, 0.16) }

        let sheenColor = UIColor(trophyHex: item.tint).mixed(with: UIColor(trophyRGB: 0xFFD28A), 0.6)
        let sheenMaterial = TrophyMaterials.glow(mat.image("sheen") { Paint.sheen() }, opacity: 1)
        sheenMaterial.multiply.contents = sheenColor
        sheenMaterial.transparency = 0.16
        let sheen = part("pedSheen", sheenMaterial, at: [0, 0.014, 1.42]) { Mesh.plane(0.62, 2.2) }
        sheen.simdEulerAngles.x = -.pi / 2
        _ = sheen.decorative()
        return group.adding(plinth, shaft, cap, band, plate, sheen)
    }

    // MARK: The league trophy

    private enum Cup {
        static let plinthTop: Float = 0.08
        static let blockTop: Float = 0.48
        static let collarTop: Float = 0.54
        static let blockDepth: Float = 0.54
        static let k: Float = 1.2
    }

    private static let cupProfile: [(Float, Float)] = [
        (0.000, 0.000), (0.200, 0.000), (0.206, 0.018), (0.194, 0.038),
        (0.150, 0.058), (0.108, 0.086), (0.080, 0.125), (0.064, 0.190),
        (0.058, 0.290), (0.080, 0.315), (0.092, 0.340), (0.080, 0.365),
        (0.056, 0.385), (0.052, 0.430), (0.070, 0.462), (0.122, 0.500),
        (0.198, 0.560), (0.262, 0.640), (0.302, 0.740), (0.326, 0.860),
        (0.340, 0.980), (0.350, 1.080), (0.362, 1.130), (0.378, 1.150),
        (0.383, 1.165), (0.374, 1.178), (0.356, 1.170), (0.340, 1.100),
        (0.328, 0.990), (0.310, 0.870), (0.282, 0.760), (0.232, 0.670),
        (0.150, 0.600), (0.000, 0.575)
    ]

    private static let handleCurve: [(Float, Float)] = [
        (0.320, 1.070), (0.420, 1.110), (0.520, 1.080), (0.570, 0.990),
        (0.555, 0.880), (0.480, 0.790), (0.370, 0.735), (0.270, 0.690)
    ]

    /// The league trophy: a gold cup with ear handles on a black stepped
    /// plinth carrying the year, the champion's crest on the bowl.
    func leagueTrophy(year: Int?, livery: Livery) -> Sculpture {
        let k = Cup.k
        let group = SCNNode()
        let gold = mat.trophyGold, black = mat.trophyBlack

        let plinth = part("cupPlinth", black, at: [0, Cup.plinthTop / 2, 0]) { Mesh.roundedBox(0.82, Cup.plinthTop, 0.66, 0.03) }
        let block = part("cupBlock", black, at: [0, (Cup.plinthTop + Cup.blockTop) / 2, 0]) {
            Mesh.roundedBox(0.68, Cup.blockTop - Cup.plinthTop, Cup.blockDepth, 0.035)
        }
        let band = part("cupBand", gold, at: [0, Cup.blockTop - 0.013, 0]) { Mesh.roundedBox(0.70, 0.026, Cup.blockDepth + 0.02, 0.012) }
        let collar = part("cupCollar", gold, at: [0, (Cup.blockTop + Cup.collarTop) / 2, 0]) {
            Mesh.roundedBox(0.50, Cup.collarTop - Cup.blockTop, 0.40, 0.02)
        }
        let plateY = (Cup.plinthTop + Cup.blockTop) / 2 - 0.01
        let frame = part("cupPlateFrame", gold, at: [0, plateY, Cup.blockDepth / 2 + 0.004]) {
            Mesh.roundedBox(0.50, 0.46 * 0.449 + 0.04, 0.014, 0.012)
        }
        let plateImage = mat.image("year:\(year ?? 0):\(livery.color)") { Paint.yearPlate(year: year, color: UIColor(trophyHex: livery.color)) }
        let plate = part("cupPlate", TrophyMaterials.faced(plateImage, metalness: 0.3, roughness: 0.34),
                         at: [0, plateY, Cup.blockDepth / 2 + 0.013]) { Mesh.plane(0.46, 0.46 * 0.449) }

        let cup = SCNNode()
        cup.simdPosition.y = Cup.collarTop
        let bowl = part("cupBowl", gold) { Mesh.lathe(Self.cupProfile.map { ($0.0, $0.1 * k) }, segments: 64) }
        let lip = part("cupLip", gold, at: [0, 1.165 * k, 0]) { Mesh.torus(0.379, 0.013, radial: 10, tubular: 72) }
        lip.simdEulerAngles.x = .pi / 2
        cup.adding(bowl, lip)
        for side: Float in [1, -1] {
            let handle = part("cupHandle:\(side)", gold) {
                Mesh.tube(Self.handleCurve.map { SIMD3(side * $0.0, $0.1 * k, 0) }, segments: 48, radius: 0.026, radial: 12)
            }
            let cap = part("cupHandleCap", gold, at: [side * 0.372, 1.095 * k, 0]) { Mesh.sphere(0.036, 16) }
            cup.adding(handle, cap)
        }
        let crest = crestDisc(livery, radius: 0.15, thickness: 0.045, metal: gold)
        crest.simdPosition = [0, 0.86 * k, 0.334]
        crest.simdEulerAngles.x = 0.12
        cup.addChildNode(crest)

        group.adding(plinth, block, band, collar, frame, plate, cup)
        return Sculpture(node: group, glints: [
            [0.26, Cup.collarTop + 1.12 * k, 0.26],
            [-0.5, Cup.collarTop + 1.0 * k, 0.05],
            [0.18, Cup.collarTop + 0.7 * k, 0.24]
        ], faceForward: true)
    }

    // MARK: The hall-of-fame shield

    private static func shieldPath(_ width: CGFloat, _ shoulder: CGFloat, _ point: CGFloat) -> UIBezierPath {
        let path = UIBezierPath()
        path.move(to: CGPoint(x: -width, y: shoulder))
        path.addLine(to: CGPoint(x: width, y: shoulder))
        path.addLine(to: CGPoint(x: width, y: 0.06))
        path.addCurve(to: CGPoint(x: 0, y: -point), controlPoint1: CGPoint(x: width, y: -0.3), controlPoint2: CGPoint(x: width * 0.62, y: -point * 0.75))
        path.addCurve(to: CGPoint(x: -width, y: 0.06), controlPoint1: CGPoint(x: -width * 0.62, y: -point * 0.75), controlPoint2: CGPoint(x: -width, y: -0.3))
        path.close()
        return path
    }

    /// A manager's crest as the object: a heraldic shield struck in their own
    /// colour on a brass post, a gold star turning overhead for every title.
    func shield(_ item: TrophyExhibit) -> Sculpture {
        let livery = Livery(ownerId: item.ownerId, color: item.tint, icon: item.icon, key: item.id)
        let group = SCNNode()
        // models.js grows each outline by its bevel; the same, on the path.
        let rim = part("shieldRim", mat.gold, at: [0, 1.02, -0.02]) {
            Mesh.extrude(Self.shieldPath(0.46 * 1.06 + 0.022, 0.56 * 1.06 + 0.022, 0.64 * 1.06 + 0.022), depth: 0.1 + 0.044, bevel: 0.022)
        }
        let face = part("shieldFace", mat.teamMetal(item.tint, roughness: 0.46, emissive: 0, metalness: 0.3, lighten: 0), at: [0, 1.02, 0.03]) {
            Mesh.extrude(Self.shieldPath(0.46 + 0.022, 0.56 + 0.022, 0.64 + 0.022), depth: 0.12 + 0.044, bevel: 0.022)
        }
        let crest = crestDisc(livery, radius: 0.29, thickness: 0.05)
        crest.simdPosition = [0, 1.09, 0.11]
        let chevron = part("shieldChevron", mat.gold, at: [0, 0.64, 0.1]) { Mesh.box(0.72, 0.045, 0.02) }
        let post = part("shieldPost", mat.brass, at: [0, 0.23, 0]) { Mesh.cylinder(0.045, 0.062, 0.46, 16) }
        let foot = part("shieldFoot", mat.darkMarble, at: [0, 0.035, 0]) { Mesh.cylinder(0.19, 0.23, 0.07, 24) }
        let collar = part("shieldCollar", mat.gold, at: [0, 0.45, 0]) { Mesh.torus(0.062, 0.018, radial: 8, tubular: 26) }
        collar.simdEulerAngles.x = .pi / 2
        let halo = part("shieldHalo", mat.teamMetal(item.tint, roughness: 0.2, emissive: 0.45), at: [0, 0.44, 0]) {
            Mesh.torus(0.2, 0.014, radial: 8, tubular: 34)
        }
        halo.simdEulerAngles.x = .pi / 2

        let stars = SCNNode()
        stars.simdPosition.y = 1.86
        let rings = item.rings ?? 0
        for i in 0..<rings {
            let angle = Float(i) / Float(max(1, rings)) * 2 * .pi
            stars.addChildNode(part("hofStar", mat.gold, at: [cos(angle) * 0.34, sin(angle * 2) * 0.05, sin(angle) * 0.34]) {
                Mesh.star(0.085, 0.038, 0.028)
            })
        }
        group.adding(foot, post, collar, halo, rim, face, chevron, crest, stars)
        return Sculpture(node: group, spin: rings > 0 ? [(node: stars, speed: Float(-0.3))] : [],
                         glints: [[0.42, 1.4, 0.1], [-0.4, 0.7, 0.1], [0, 1.09, 0.16]])
    }

    // MARK: Record plaque

    /// Walnut board (cold slate on the lowlight wall), brass face (pewter),
    /// studs at the corners, tilted back on a stand — or hung on a wall.
    func plaque(value: String, label: String, holder: String, meta: String?, accent: String,
                holders: [Livery], tarnished: Bool, mounted: Bool = false) -> Sculpture {
        let group = SCNNode()
        let board = SCNNode()
        let metal: Paint.Metal = tarnished ? .pewter : .brass
        let trimMetal = tarnished ? mat.pewter : mat.brass
        let timber = tarnished ? mat.slate : mat.walnut

        let backing = part("plaqueBack", timber) { Mesh.roundedBox(1.06, 1.30, 0.09, 0.05) }
        let faceImage = Paint.recordFace(value: value, label: label, holder: holder, meta: meta, accent: UIColor(trophyHex: accent), metal: metal)
        let face = part("plaqueFace", TrophyMaterials.faced(faceImage, metalness: 0.26, roughness: 0.3), at: [0, -0.16, 0.062]) {
            Mesh.plane(0.86, 0.645)
        }
        let trim = part("plaqueTrim", trimMetal, at: [0, -0.16, 0.046]) { Mesh.roundedBox(0.9, 0.685, 0.02, 0.02) }
        board.adding(backing, trim, face)
        for (x, y) in [(-0.45, 0.575), (0.45, 0.575), (-0.45, -0.575), (0.45, -0.575)] as [(Float, Float)] {
            let stud = part("plaqueStud", trimMetal, at: [x, y, 0.055]) { Mesh.sphere(0.028, 14) }
            stud.simdScale.z = 0.6
            board.addChildNode(stud)
        }
        let count = Float(holders.count)
        let spacing = min(0.36, 0.8 / count)
        let radius = min(0.165, spacing * 0.42)
        for (i, holder) in holders.enumerated() {
            var livery = holder
            livery.tarnished = tarnished
            let crest = crestDisc(livery, radius: radius, thickness: 0.05)
            crest.simdPosition = [(Float(i) - (count - 1) / 2) * spacing, 0.42, 0.062]
            board.addChildNode(crest)
        }

        if mounted {
            group.addChildNode(board)
        } else {
            board.simdPosition.y = 0.82
            board.simdEulerAngles.x = -0.13
            let foot = part("plaqueFoot", mat.darkMarble, at: [0, 0.05, 0]) { Mesh.roundedBox(0.66, 0.1, 0.36, 0.03) }
            let strut = part("plaqueStrut", trimMetal, at: [0, 0.24, -0.02]) { Mesh.cylinder(0.035, 0.045, 0.34, 12) }
            group.adding(foot, strut, board)
        }
        return Sculpture(node: group, glints: [[0.42, 1.32, 0.1], [-0.42, 0.55, 0.1]], faceForward: true)
    }

    // MARK: The cellar's throne

    private enum Throne {
        static let plinthTop: Float = 0.07
        static let blockTop: Float = 0.36
        static let blockDepth: Float = 0.56
        static let bowlZ: Float = 0.07
        static let long: Float = 1.28
        static let rim: Float = 0.452
    }

    private static func oval(_ rx: CGFloat, _ rz: CGFloat, hole: (rx: CGFloat, rz: CGFloat, dz: CGFloat)? = nil) -> UIBezierPath {
        let path = UIBezierPath(ovalIn: CGRect(x: -rx, y: -rz, width: rx * 2, height: rz * 2))
        if let hole {
            let inner = UIBezierPath(ovalIn: CGRect(x: -hole.rx, y: hole.dz - hole.rz, width: hole.rx * 2, height: hole.rz * 2))
            path.append(inner.reversing())
        }
        path.usesEvenOddFillRule = true
        return path
    }

    /// The cellar prize: a glazed toilet dressed in the cup's gold, on the
    /// same black plinth with the year, the last-place crest on its lid.
    func toilet(year: Int?, livery: Livery) -> Sculpture {
        let gold = mat.trophyGold, china = mat.porcelain
        let group = SCNNode()

        let plinth = part("thPlinth", mat.trophyBlack, at: [0, Throne.plinthTop / 2, 0]) { Mesh.roundedBox(0.84, Throne.plinthTop, 0.70, 0.03) }
        let block = part("thBlock", mat.trophyBlack, at: [0, (Throne.plinthTop + Throne.blockTop) / 2, 0]) {
            Mesh.roundedBox(0.70, Throne.blockTop - Throne.plinthTop, Throne.blockDepth, 0.035)
        }
        let band = part("thBand", gold, at: [0, Throne.blockTop - 0.012, 0]) { Mesh.roundedBox(0.72, 0.024, Throne.blockDepth + 0.02, 0.012) }
        let plateY = (Throne.plinthTop + Throne.blockTop) / 2 - 0.008
        let frame = part("thFrame", gold, at: [0, plateY, Throne.blockDepth / 2 + 0.004]) { Mesh.roundedBox(0.44, 0.40 * 0.449 + 0.036, 0.014, 0.012) }
        let plateImage = mat.image("year:\(year ?? 0):\(livery.color)") { Paint.yearPlate(year: year, color: UIColor(trophyHex: livery.color)) }
        let plate = part("thPlate", TrophyMaterials.faced(plateImage, metalness: 0.3, roughness: 0.34),
                         at: [0, plateY, Throne.blockDepth / 2 + 0.013]) { Mesh.plane(0.40, 0.40 * 0.449) }
        group.adding(plinth, block, band, frame, plate)

        let throne = SCNNode()
        throne.simdPosition.y = Throne.blockTop
        let bowl = part("thBowl", china, at: [0, 0, Throne.bowlZ]) {
            Mesh.lathe([
                (0.000, 0.000), (0.172, 0.000), (0.182, 0.012), (0.176, 0.032),
                (0.146, 0.064), (0.124, 0.120), (0.120, 0.180), (0.132, 0.230),
                (0.160, 0.272), (0.200, 0.312), (0.234, 0.350), (0.254, 0.390),
                (0.262, 0.420), (0.260, 0.440), (0.248, Throne.rim), (0.228, 0.448),
                (0.206, 0.426), (0.170, 0.384), (0.124, 0.350), (0.000, 0.338)
            ], segments: 64)
        }
        bowl.simdScale.z = Throne.long
        let water = part("thWater", mat.water, at: [0, 0.357, Throne.bowlZ]) { Mesh.disc(0.13, segments: 40) }
        water.simdEulerAngles.x = -.pi / 2
        water.simdScale.y = Throne.long
        let seat = part("thSeat", gold, at: [0, Throne.rim + 0.024, Throne.bowlZ]) {
            Mesh.extrude(Self.oval(0.262, 0.335, hole: (0.165, 0.222, -0.012)), depth: 0.018 + 0.024, bevel: 0.012)
        }
        seat.simdEulerAngles.x = -.pi / 2

        let tankZ = Throne.bowlZ - 0.335 - 0.1
        let neck = part("thNeck", china, at: [0, 0.22, tankZ + 0.1]) { Mesh.roundedBox(0.30, 0.44, 0.36, 0.07) }
        let tank = part("thTank", china, at: [0, 0.70, tankZ]) { Mesh.roundedBox(0.56, 0.52, 0.22, 0.06) }
        let tankTrim = part("thTankTrim", gold, at: [0, 0.962, tankZ]) { Mesh.roundedBox(0.605, 0.014, 0.265, 0.007) }
        let tankLid = part("thTankLid", china, at: [0, 0.992, tankZ]) { Mesh.roundedBox(0.60, 0.05, 0.26, 0.022) }

        let lever = SCNNode()
        let boss = part("thBoss", gold) { Mesh.cylinder(0.026, 0.026, 0.014, 20) }
        boss.simdEulerAngles.x = .pi / 2
        let arm = part("thArm", gold, at: [0.038, 0, 0.012]) { Mesh.roundedBox(0.075, 0.018, 0.018, 0.008) }
        let knob = part("thKnob", gold, at: [0.078, 0, 0.012]) { Mesh.sphere(0.014, 12) }
        lever.adding(boss, arm, knob)
        lever.simdPosition = [-0.235, 0.89, tankZ + 0.115]

        let lid = SCNNode()
        let lidBack = part("thLidBack", gold) { Mesh.extrude(Self.oval(0.252, 0.300), depth: 0.016 + 0.02, bevel: 0.01) }
        let lidFace = part("thLidFace", china, at: [0, 0, 0.022]) { Mesh.extrude(Self.oval(0.238, 0.286), depth: 0.022 + 0.028, bevel: 0.014) }
        let crest = crestDisc(livery, radius: 0.135, thickness: 0.04, metal: gold)
        crest.simdPosition = [0, 0.03, 0.06]
        lid.adding(lidBack, lidFace, crest)
        lid.simdPosition = [0, Throne.rim + 0.035 + 0.3, tankZ + 0.15]
        lid.simdEulerAngles.x = -0.1

        throne.adding(bowl, water, seat, neck, tank, tankTrim, tankLid, lever, lid)
        for side: Float in [-1, 1] {
            throne.addChildNode(part("thBoltCap", gold, at: [side * 0.15, 0, Throne.bowlZ + 0.1]) { Mesh.dome(0.024) })
        }

        let holder = SCNNode()
        let post = part("thPost", gold, at: [0, 0.06, 0]) { Mesh.cylinder(0.012, 0.016, 0.12, 12) }
        let spindle = part("thSpindle", gold, at: [0, 0.12, 0]) { Mesh.cylinder(0.011, 0.011, 0.15, 12) }
        spindle.simdEulerAngles.z = .pi / 2
        let roll = part("thRoll", mat.tissue, at: [0, 0.12, 0]) {
            let tube = SCNTube(innerRadius: 0.02, outerRadius: 0.066, height: 0.11)
            tube.radialSegmentCount = 32
            return tube
        }
        roll.simdEulerAngles.z = .pi / 2
        holder.adding(post, spindle, roll)
        holder.simdPosition = [0.27, Throne.blockTop, 0.17]
        holder.simdEulerAngles.y = -0.35

        group.adding(throne, holder)
        group.simdScale = SIMD3(repeating: 1.12)
        return Sculpture(node: SCNNode().adding(group), glints: [
            [0.22 * 1.12, (Throne.blockTop + Throne.rim + 0.03) * 1.12, (Throne.bowlZ + 0.2) * 1.12],
            [-0.2 * 1.12, (Throne.blockTop + 0.89) * 1.12, -0.25 * 1.12],
            [0.18 * 1.12, (Throne.blockTop + 1.0) * 1.12, -0.2 * 1.12]
        ], faceForward: true)
    }

    // MARK: The exhibit on a pedestal

    func exhibit(_ item: TrophyExhibit) -> Sculpture {
        let livery = Livery(ownerId: item.ownerId, color: item.tint, icon: item.icon, tarnished: item.isTarnished, key: item.id)
        switch item.kind {
        case "pillar":
            return shield(item)
        case "plaque":
            let holders = (item.holders?.count ?? 0) > 1
                ? item.holders!.map { Livery(ownerId: $0.ownerId, color: $0.color ?? item.tint, icon: $0.icon, key: "\(item.id):\($0.ownerId ?? "")") }
                : [livery]
            return plaque(value: item.bigValue ?? "", label: item.title, holder: item.subtitle ?? "", meta: item.meta,
                          accent: item.accent, holders: holders, tarnished: item.isTarnished)
        case "toilet":
            return toilet(year: item.year, livery: livery)
        default:
            return leagueTrophy(year: item.year, livery: livery)
        }
    }

    // MARK: The team locker's pieces

    /// The bowl second and third place take home, in the metal of the place.
    func podiumBowl(year: Int?, metal: String?, accent: String) -> SCNNode {
        let group = SCNNode()
        let bronze = metal == "bronze"
        let plinth = part("bowlPlinth", mat.darkMarble, at: [0, 0.037, 0]) { Mesh.roundedBox(0.28, 0.075, 0.28, 0.02) }
        let bowl = part("bowlBowl", bronze ? mat.bronze : mat.silver, at: [0, 0.075, 0]) {
            Mesh.lathe([
                (0.000, 0.000), (0.098, 0.000), (0.104, 0.020), (0.084, 0.036),
                (0.052, 0.052), (0.049, 0.082), (0.088, 0.112), (0.148, 0.152),
                (0.198, 0.212), (0.224, 0.270), (0.235, 0.302), (0.238, 0.316),
                (0.233, 0.324), (0.220, 0.316), (0.204, 0.272), (0.160, 0.204),
                (0.100, 0.152), (0.000, 0.140)
            ], segments: 48)
        }
        let image = Paint.nameplate(title: year.map(String.init) ?? "", sub: nil, accent: UIColor(trophyHex: accent), metal: bronze ? .brass : .pewter)
        let plate = part("bowlPlate", TrophyMaterials.faced(image, metalness: 0.28, roughness: 0.34), at: [0, 0.037, 0.1415]) { Mesh.plane(0.19, 0.05) }
        return group.adding(plinth, bowl, plate)
    }

    /// A pennant per playoff berth, hung point-down from its own short rail.
    func pennant(year: Int?, cloth: String, note: String, crown: Bool) -> SCNNode {
        let group = SCNNode()
        let rail = part("pennantRail", mat.brass) { Mesh.cylinder(0.014, 0.014, 0.34, 10) }
        rail.simdEulerAngles.z = .pi / 2
        let image = Paint.pennant(year: year, color: UIColor(trophyHex: cloth), note: note, crown: crown)
        let material = TrophyMaterials.faced(image, metalness: 0.05, roughness: 0.85, doubleSided: true)
        material.shaderModifiers = [.surface: "if (_surface.diffuse.a < 0.45) { discard_fragment(); }"]
        let cloth = part("pennantCloth", material, at: [0, -0.35, 0]) {
            Mesh.plane(0.30, 0.675, 8, 8) { x, y in sin(x * 6.5 + y * 1.2) * 0.018 * (0.4 + (0.34 - y) / 0.68) }
        }
        return group.adding(rail, cloth)
    }

    private func yearPlate(_ year: Int?, accent: String, width: Float = 0.30) -> SCNNode {
        let image = mat.image("year:\(year ?? 0):\(accent)") { Paint.yearPlate(year: year, color: UIColor(trophyHex: accent)) }
        return part("honourPlate:\(width)", TrophyMaterials.faced(image, metalness: 0.3, roughness: 0.34)) { Mesh.plane(width, width * 0.449) }
    }

    /// The gold star for leading the league in regular-season scoring.
    func scoringStar(year: Int?, accent: String, compact: Bool = false) -> Sculpture {
        let group = SCNNode()
        let shift: Float = compact ? 0.30 : 0
        let backingMaterial = TrophyMaterials.pbr(UIColor(trophyRGB: 0x0A1018), metalness: 0.2, roughness: 0.62)
        let backing = part("starBacking", backingMaterial, at: [0, -0.30 + shift, 0]) { Mesh.cylinder(0.185, 0.185, 0.03, 40) }
        backing.simdEulerAngles.x = .pi / 2
        let rim = part("starRim", mat.brass, at: [0, -0.30 + shift, 0]) { Mesh.torus(0.186, 0.014, radial: 10, tubular: 44) }
        let starMaterial = TrophyMaterials.pbr(UIColor(trophyRGB: 0xF0B53C), metalness: 0.92, roughness: 0.38)
        let star = part("honourStar", starMaterial, at: [0, -0.30 + shift, 0.028]) { Mesh.star(0.145, 0.062, 0.05) }
        group.adding(backing, rim, star)
        if compact { return Sculpture(node: group, glints: [[0.06, 0.14, 0.07]]) }
        let hanger = part("hanger", mat.brass, at: [0, -0.03, 0]) { Mesh.torus(0.03, 0.009, radial: 8, tubular: 20) }
        let chain = part("starChain", mat.brass, at: [0, -0.09, 0]) { Mesh.cylinder(0.006, 0.006, 0.09, 6) }
        let plate = yearPlate(year, accent: accent)
        plate.simdPosition = [0, -0.63, 0.004]
        group.adding(hanger, chain, plate)
        return Sculpture(node: group, glints: [[0.06, -0.16, 0.07]])
    }

    private static func rosettePath(_ radius: CGFloat, lobes: Int, depth: CGFloat) -> UIBezierPath {
        let path = UIBezierPath()
        let steps = lobes * 10
        for i in 0...steps {
            let angle = CGFloat(i) / CGFloat(steps) * 2 * .pi
            let r = radius * (1 - depth / 2 + depth / 2 * cos(angle * CGFloat(lobes)))
            let p = CGPoint(x: cos(angle) * r, y: sin(angle) * r)
            if i == 0 { path.move(to: p) } else { path.addLine(to: p) }
        }
        path.close()
        return path
    }

    private func cloth(_ color: UInt32) -> SCNMaterial {
        let m = TrophyMaterials.pbr(UIColor(trophyRGB: color), metalness: 0.04, roughness: 0.82)
        m.isDoubleSided = true
        return m
    }

    /// The red, white and blue ribbon for the most wins in a season.
    func winsRibbon(year: Int?, accent: String, compact: Bool = false) -> Sculpture {
        let red: UInt32 = 0xA80A24, white: UInt32 = 0xEEF2F8, blue: UInt32 = 0x14337F
        let group = SCNNode()
        let shift: Float = compact ? 0.20 : 0

        let tails = SCNNode()
        tails.simdPosition = [0, -0.17 + shift, -0.012]
        for (x, lean, color) in [(-0.10, 0.28, blue), (0.10, -0.28, red)] as [(Float, Float, UInt32)] {
            let tail = part("ribbonTail:\(color)", cloth(color), at: [x, 0, 0.006]) {
                let half: CGFloat = 0.0625, length: CGFloat = 0.38
                let path = UIBezierPath()
                path.move(to: CGPoint(x: -half, y: 0))
                path.addLine(to: CGPoint(x: half, y: 0))
                path.addLine(to: CGPoint(x: half, y: -length))
                path.addLine(to: CGPoint(x: 0, y: -length + 0.125 * 0.44))
                path.addLine(to: CGPoint(x: -half, y: -length))
                path.close()
                return Mesh.extrude(path, depth: 0.02, bevel: 0.005)
            }
            tail.simdEulerAngles.z = lean
            tails.addChildNode(tail)
        }

        let rosette = SCNNode()
        rosette.simdPosition.y = -0.20 + shift
        let layer = { (key: String, radius: CGFloat, color: UInt32, lobes: Int, depth: CGFloat, z: Float) -> SCNNode in
            self.part("rosette:\(key)", self.cloth(color), at: [0, 0, z + 0.006]) {
                Mesh.extrude(Self.rosettePath(radius, lobes: lobes, depth: depth), depth: 0.028, bevel: 0.008)
            }
        }
        let b = layer("blue", 0.17, blue, 15, 0.16, 0)
        let w = layer("white", 0.125, white, 13, 0.18, 0.016)
        w.simdEulerAngles.z = .pi / 13
        let r = layer("red", 0.082, red, 11, 0.2, 0.032)
        let button = part("ribbonButton", mat.gold, at: [0, 0, 0.05]) { Mesh.cylinder(0.042, 0.042, 0.026, 26) }
        button.simdEulerAngles.x = .pi / 2
        let pip = part("ribbonPip", mat.goldWarm, at: [0, 0, 0.066]) { Mesh.star(0.03, 0.013, 0.014) }
        rosette.adding(b, w, r, button, pip)
        group.adding(tails, rosette)
        if compact { return Sculpture(node: group, glints: [[0, 0.06, 0.09]]) }

        let hanger = part("hanger", mat.brass, at: [0, -0.03, 0]) { Mesh.torus(0.03, 0.009, radial: 8, tubular: 20) }
        let chain = part("ribbonChain", mat.brass, at: [0, -0.08, 0]) { Mesh.cylinder(0.006, 0.006, 0.07, 6) }
        let plate = yearPlate(year, accent: accent, width: 0.28)
        plate.simdPosition = [0, -0.665, 0.004]
        group.adding(hanger, chain, plate)
        return Sculpture(node: group, glints: [[0, -0.14, 0.09]])
    }

    /// The team's flag, across the top of their wall.
    func teamFlag(_ locker: TrophyLocker) -> SCNNode {
        let group = SCNNode()
        let rod = part("flagRod", mat.brass, at: [0, 0.86, 0]) { Mesh.cylinder(0.03, 0.03, 3.25, 12) }
        rod.simdEulerAngles.z = .pi / 2
        group.addChildNode(rod)
        for side: Float in [-1, 1] {
            group.addChildNode(part("flagFinial", mat.gold, at: [side * 1.66, 0.86, 0]) { Mesh.sphere(0.05, 16) })
        }
        let image = Paint.teamFlag(icon: locker.icon, color: UIColor(trophyHex: locker.tint), team: locker.team, owner: locker.name,
                                   since: locker.wall.since, logo: logos[locker.ownerId])
        let cloth = part("flagCloth", TrophyMaterials.faced(image, metalness: 0.06, roughness: 0.8, doubleSided: true), at: [0, 0.03, 0]) {
            Mesh.plane(3.02, 1.60, 22, 6) { x, _ in sin(x * 2.1) * 0.05 }
        }
        group.addChildNode(cloth)
        return group
    }
}
