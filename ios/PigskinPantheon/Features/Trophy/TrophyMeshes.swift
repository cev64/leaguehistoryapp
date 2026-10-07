import SceneKit
import UIKit
import simd

/// The three.js primitives the hall is built from (lathes, tubes, tori,
/// extruded shapes, rounded boxes), as SceneKit geometry. Coordinates are the
/// site's: metres, y up, the viewer looking down -z — SceneKit's own frame.
enum Mesh {
    typealias V3 = SIMD3<Float>

    // MARK: Raw geometry

    /// Triangles from arrays. Every triangle is turned to face the way its
    /// vertex normals point, so builders never have to think about winding.
    static func geometry(_ positions: [V3], _ normals: [V3], _ uvs: [SIMD2<Float>], _ indices: [UInt32]) -> SCNGeometry {
        var faces = indices
        var i = 0
        while i + 2 < faces.count {
            let a = Int(faces[i]), b = Int(faces[i + 1]), c = Int(faces[i + 2])
            let g = simd_cross(positions[b] - positions[a], positions[c] - positions[a])
            if simd_dot(g, normals[a] + normals[b] + normals[c]) < 0 { faces.swapAt(i + 1, i + 2) }
            i += 3
        }
        let vertexSource = SCNGeometrySource(vertices: positions.map { SCNVector3($0.x, $0.y, $0.z) })
        let normalSource = SCNGeometrySource(normals: normals.map { SCNVector3($0.x, $0.y, $0.z) })
        let uvSource = SCNGeometrySource(textureCoordinates: uvs.map { CGPoint(x: CGFloat($0.x), y: CGFloat($0.y)) })
        let element = SCNGeometryElement(indices: faces, primitiveType: .triangles)
        return SCNGeometry(sources: [vertexSource, normalSource, uvSource], elements: [element])
    }

    /// A grid of `rows` × `cols` vertices (row-major) into quads.
    private static func gridIndices(rows: Int, cols: Int) -> [UInt32] {
        var out: [UInt32] = []
        out.reserveCapacity((rows - 1) * (cols - 1) * 6)
        for r in 0..<(rows - 1) {
            for c in 0..<(cols - 1) {
                let a = UInt32(r * cols + c), b = UInt32(r * cols + c + 1)
                let d = UInt32((r + 1) * cols + c), e = UInt32((r + 1) * cols + c + 1)
                out += [a, d, b, b, d, e]
            }
        }
        return out
    }

    // MARK: Lathe

    /// three.js LatheGeometry: a profile of (radius, height) points turned
    /// about the y axis. A profile that walks back down its own inside makes a
    /// hollow vessel; normals follow the profile, so the inside faces inward.
    static func lathe(_ points: [(Float, Float)], segments: Int = 64) -> SCNGeometry {
        let n = points.count
        var profileNormals: [SIMD2<Float>] = []
        for j in 0..<n {
            let prev = points[max(0, j - 1)], next = points[min(n - 1, j + 1)]
            let dx = next.0 - prev.0, dy = next.1 - prev.1
            var normal = SIMD2<Float>(dy, -dx)
            if simd_length(normal) < 1e-6 { normal = SIMD2(1, 0) }
            profileNormals.append(simd_normalize(normal))
        }
        var positions: [V3] = [], normals: [V3] = [], uvs: [SIMD2<Float>] = []
        for i in 0...segments {
            let phi = Float(i) / Float(segments) * 2 * .pi
            let s = sin(phi), c = cos(phi)
            for j in 0..<n {
                let (x, y) = points[j]
                positions.append(V3(s * x, y, c * x))
                let pn = profileNormals[j]
                normals.append(simd_normalize(V3(s * pn.x, pn.y, c * pn.x) + V3(0, 1e-7, 0)))
                uvs.append(SIMD2(Float(i) / Float(segments), 1 - Float(j) / Float(n - 1)))
            }
        }
        return geometry(positions, normals, uvs, gridIndices(rows: segments + 1, cols: n))
    }

    // MARK: Tubes and tori

    /// three.js TubeGeometry along a Catmull-Rom curve through `points`.
    static func tube(_ points: [V3], segments: Int = 48, radius: Float, radial: Int = 12) -> SCNGeometry {
        let path = catmullRom(points, samples: segments)
        var positions: [V3] = [], normals: [V3] = [], uvs: [SIMD2<Float>] = []
        var previousNormal = V3(0, 0, 1)
        for (k, point) in path.enumerated() {
            let ahead = path[min(path.count - 1, k + 1)], behind = path[max(0, k - 1)]
            let tangent = simd_normalize(ahead - behind)
            // A frame that turns with the curve (parallel transport).
            var normal = simd_cross(tangent, simd_cross(previousNormal, tangent))
            if simd_length(normal) < 1e-5 { normal = simd_cross(tangent, V3(0, 0, 1)) }
            normal = simd_normalize(normal)
            previousNormal = normal
            let binormal = simd_normalize(simd_cross(tangent, normal))
            for r in 0...radial {
                let v = Float(r) / Float(radial) * 2 * .pi
                let dir = cos(v) * normal + sin(v) * binormal
                positions.append(point + dir * radius)
                normals.append(dir)
                uvs.append(SIMD2(Float(k) / Float(path.count - 1), Float(r) / Float(radial)))
            }
        }
        return geometry(positions, normals, uvs, gridIndices(rows: path.count, cols: radial + 1))
    }

    private static func catmullRom(_ p: [V3], samples: Int) -> [V3] {
        guard p.count > 1 else { return p }
        var out: [V3] = []
        for s in 0...samples {
            let t = Float(s) / Float(samples) * Float(p.count - 1)
            let i = min(p.count - 2, Int(t))
            let u = t - Float(i)
            let p0 = p[max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[min(p.count - 1, i + 2)]
            let u2 = u * u, u3 = u2 * u
            let a: V3 = 2 * p1
            let b: V3 = (p2 - p0) * u
            var c: V3 = 2 * p0
            c -= 5 * p1
            c += 4 * p2
            c -= p3
            var d: V3 = 3 * p1
            d -= p0
            d -= 3 * p2
            d += p3
            let sum: V3 = a + b + c * u2 + d * u3
            out.append(0.5 * sum)
        }
        return out
    }

    /// three.js TorusGeometry: a ring of `radius` in the xy plane (axis z),
    /// optionally only part way round (`arc`).
    static func torus(_ radius: Float, _ tube: Float, radial: Int = 10, tubular: Int = 48, arc: Float = 2 * .pi) -> SCNGeometry {
        var positions: [V3] = [], normals: [V3] = [], uvs: [SIMD2<Float>] = []
        for j in 0...tubular {
            let u = Float(j) / Float(tubular) * arc
            let centre = V3(radius * cos(u), radius * sin(u), 0)
            for i in 0...radial {
                let v = Float(i) / Float(radial) * 2 * .pi
                let p = V3((radius + tube * cos(v)) * cos(u), (radius + tube * cos(v)) * sin(u), tube * sin(v))
                positions.append(p)
                normals.append(simd_normalize(p - centre))
                uvs.append(SIMD2(Float(j) / Float(tubular), Float(i) / Float(radial)))
            }
        }
        return geometry(positions, normals, uvs, gridIndices(rows: tubular + 1, cols: radial + 1))
    }

    // MARK: Flat things

    /// three.js CircleGeometry: a disc in the xy plane facing +z, mapped
    /// straight across so a texture lands upright.
    static func disc(_ radius: Float, segments: Int = 64) -> SCNGeometry {
        var positions: [V3] = [V3(0, 0, 0)], normals: [V3] = [V3(0, 0, 1)], uvs: [SIMD2<Float>] = [SIMD2(0.5, 0.5)]
        for i in 0...segments {
            let a = Float(i) / Float(segments) * 2 * .pi
            positions.append(V3(radius * cos(a), radius * sin(a), 0))
            normals.append(V3(0, 0, 1))
            uvs.append(SIMD2(0.5 + 0.5 * cos(a), 0.5 - 0.5 * sin(a)))
        }
        var indices: [UInt32] = []
        for i in 1...UInt32(segments) { indices += [0, i, i + 1] }
        return geometry(positions, normals, uvs, indices)
    }

    /// A plane in xy facing +z, with `displace` pushing each vertex along z
    /// (the wave baked into a banner or a pennant).
    static func plane(_ width: Float, _ height: Float, _ ws: Int = 1, _ hs: Int = 1, displace: ((Float, Float) -> Float)? = nil) -> SCNGeometry {
        guard let displace else {
            let plane = SCNPlane(width: CGFloat(width), height: CGFloat(height))
            return plane
        }
        var positions: [V3] = [], uvs: [SIMD2<Float>] = []
        for r in 0...hs {
            let y = height / 2 - Float(r) / Float(hs) * height
            for c in 0...ws {
                let x = -width / 2 + Float(c) / Float(ws) * width
                positions.append(V3(x, y, displace(x, y)))
                uvs.append(SIMD2(Float(c) / Float(ws), Float(r) / Float(hs)))
            }
        }
        // Normals from the displaced surface.
        let cols = ws + 1
        var normals = [V3](repeating: V3(0, 0, 0), count: positions.count)
        let indices = gridIndices(rows: hs + 1, cols: cols)
        var i = 0
        while i < indices.count {
            let a = Int(indices[i]), b = Int(indices[i + 1]), c = Int(indices[i + 2])
            var n = simd_cross(positions[b] - positions[a], positions[c] - positions[a])
            if n.z < 0 { n = -n }
            normals[a] += n; normals[b] += n; normals[c] += n
            i += 3
        }
        normals = normals.map { simd_length($0) > 0 ? simd_normalize($0) : V3(0, 0, 1) }
        return geometry(positions, normals, uvs, indices)
    }

    // MARK: Solids

    /// models.js `roundedBox`: a box with its edges rounded.
    static func roundedBox(_ w: Float, _ h: Float, _ d: Float, _ r: Float) -> SCNGeometry {
        let chamfer = min(r, min(w, min(h, d)) * 0.45)
        return SCNBox(width: CGFloat(w), height: CGFloat(h), length: CGFloat(d), chamferRadius: CGFloat(chamfer))
    }

    static func box(_ w: Float, _ h: Float, _ d: Float) -> SCNGeometry {
        SCNBox(width: CGFloat(w), height: CGFloat(h), length: CGFloat(d), chamferRadius: 0)
    }

    /// three.js CylinderGeometry(top, bottom, height): along y, centred.
    static func cylinder(_ top: Float, _ bottom: Float, _ height: Float, _ segments: Int = 24) -> SCNGeometry {
        if abs(top - bottom) < 1e-5 {
            let c = SCNCylinder(radius: CGFloat(top), height: CGFloat(height))
            c.radialSegmentCount = segments
            return c
        }
        let c = SCNCone(topRadius: CGFloat(top), bottomRadius: CGFloat(bottom), height: CGFloat(height))
        c.radialSegmentCount = segments
        return c
    }

    static func sphere(_ r: Float, _ segments: Int = 18) -> SCNGeometry {
        let s = SCNSphere(radius: CGFloat(r))
        s.segmentCount = segments
        return s
    }

    /// The top half of a sphere, standing on its flat face.
    static func dome(_ r: Float, _ segments: Int = 16) -> SCNGeometry {
        let points: [(Float, Float)] = (0...8).map { i in
            let a = Float(i) / 8 * .pi / 2
            return (r * cos(a), r * sin(a))
        } + [(0, r)]
        return lathe(points, segments: segments)
    }

    /// three.js ExtrudeGeometry of a 2D outline, centred on z, `depth` thick
    /// overall with a `bevel` round its edges.
    static func extrude(_ path: UIBezierPath, depth: Float, bevel: Float = 0) -> SCNGeometry {
        path.flatness = 0.002
        let shape = SCNShape(path: path, extrusionDepth: CGFloat(depth))
        if bevel > 0 {
            shape.chamferRadius = CGFloat(min(bevel, depth * 0.49))
            let profile = UIBezierPath()
            profile.move(to: CGPoint(x: 0, y: 1))
            profile.addQuadCurve(to: CGPoint(x: 1, y: 0), controlPoint: CGPoint(x: 1, y: 1))
            profile.flatness = 0.05
            shape.chamferProfile = profile
        }
        return shape
    }

    /// models.js `starGeometry`: a five-point star, extruded and centred.
    static func star(_ outer: Float = 0.1, _ inner: Float = 0.045, _ thickness: Float = 0.03) -> SCNGeometry {
        let path = UIBezierPath()
        for i in 0..<10 {
            let radius = i % 2 == 1 ? inner : outer
            let angle = Float(i) / 10 * 2 * .pi - .pi / 2
            let p = CGPoint(x: CGFloat(cos(angle) * radius), y: CGFloat(sin(angle) * radius))
            if i == 0 { path.move(to: p) } else { path.addLine(to: p) }
        }
        path.close()
        // The star in three.js is drawn with y up; UIBezierPath points are
        // taken as-is by SCNShape (y up in the shape's plane), so this is the
        // same star, point down like the original before `center()`.
        return extrude(path, depth: thickness * 0.5 + thickness * 0.7, bevel: thickness * 0.35)
    }
}

// MARK: Materials

/// models.js `initMaterials`: every surface in the hall, physically based,
/// shared across the hall so ten exhibits with one palette share a material.
final class TrophyMaterials {
    let gold, goldWarm, goldDark, brass, silver, trophyGold, trophyBlack, pewter, bronze, tarnish: SCNMaterial
    let porcelain, water, tissue, marble, darkMarble, walnut, slate: SCNMaterial
    let marbleImage, darkMarbleImage, walnutImage, slateImage: UIImage
    private var teamCache: [String: SCNMaterial] = [:]
    private var imageCache: [String: UIImage] = [:]
    private let lock = NSLock()

    static func pbr(_ color: UIColor, metalness: CGFloat, roughness: CGFloat, map: UIImage? = nil,
                    emission: UIColor? = nil, emissionIntensity: CGFloat = 0) -> SCNMaterial {
        let m = SCNMaterial()
        m.lightingModel = .physicallyBased
        if let map {
            m.diffuse.contents = map
            m.multiply.contents = color
            m.diffuse.wrapS = .repeat
            m.diffuse.wrapT = .repeat
            m.diffuse.mipFilter = .linear
        } else {
            m.diffuse.contents = color
        }
        m.metalness.contents = metalness
        m.roughness.contents = roughness
        if let emission, emissionIntensity > 0 {
            m.emission.contents = emission
            m.emission.intensity = emissionIntensity
        }
        return m
    }

    /// A texture-faced material (a plate, a crest, a banner).
    static func faced(_ image: UIImage, metalness: CGFloat = 0.28, roughness: CGFloat = 0.32, transparent: Bool = false, doubleSided: Bool = false) -> SCNMaterial {
        let m = SCNMaterial()
        m.lightingModel = .physicallyBased
        m.diffuse.contents = image
        m.diffuse.mipFilter = .linear
        m.metalness.contents = metalness
        m.roughness.contents = roughness
        m.isDoubleSided = doubleSided
        if transparent {
            m.blendMode = .alpha
            m.transparencyMode = .aOne
            m.writesToDepthBuffer = false
        }
        return m
    }

    /// Unlit, for strips of light, washes and glows. `additive` adds to what is behind it.
    static func glow(_ contents: Any, additive: Bool = true, opacity: CGFloat = 1) -> SCNMaterial {
        let m = SCNMaterial()
        m.lightingModel = .constant
        m.diffuse.contents = contents
        if additive {
            m.blendMode = .add
            m.writesToDepthBuffer = false
        }
        m.transparency = opacity
        m.isDoubleSided = false
        return m
    }

    init() {
        let metal = { (hex: UInt32, roughness: CGFloat) in
            TrophyMaterials.pbr(UIColor(trophyRGB: hex), metalness: 1, roughness: roughness)
        }
        gold = metal(0xFFC964, 0.14)
        goldWarm = metal(0xE8A53C, 0.24)
        goldDark = metal(0x8A6420, 0.38)
        brass = metal(0xD8B46A, 0.28)
        silver = metal(0xD6DDE6, 0.16)
        trophyGold = TrophyMaterials.pbr(UIColor(trophyRGB: 0xF6BD42), metalness: 1, roughness: 0.2,
                                         emission: UIColor(trophyRGB: 0x6A4300), emissionIntensity: 0.12)
        trophyBlack = TrophyMaterials.pbr(UIColor(trophyRGB: 0x0D1117), metalness: 0.45, roughness: 0.3)
        pewter = metal(0x7D8794, 0.34)
        bronze = metal(0x9A6A38, 0.32)
        tarnish = metal(0x6D6553, 0.55)
        porcelain = TrophyMaterials.pbr(UIColor(trophyRGB: 0xDFE5EB), metalness: 0, roughness: 0.32)
        porcelain.clearCoat.contents = 1.0
        porcelain.clearCoatRoughness.contents = 0.06
        water = TrophyMaterials.pbr(UIColor(trophyRGB: 0x3F7FA6), metalness: 0.2, roughness: 0.04)
        water.transparency = 0.9
        tissue = TrophyMaterials.pbr(UIColor(trophyRGB: 0xF4F1EA), metalness: 0, roughness: 0.85)
        tissue.isDoubleSided = true

        marbleImage = Paint.marble()
        darkMarbleImage = Paint.marble(base: 0x0B1220, vein: 0x22344B, glow: 0x132132)
        walnutImage = Paint.wood()
        slateImage = Paint.wood(base: 0x242C38, grain: 0x11161E, highlight: 0x3B4757)
        marble = TrophyMaterials.pbr(.white, metalness: 0.2, roughness: 0.42, map: marbleImage)
        darkMarble = TrophyMaterials.pbr(.white, metalness: 0.3, roughness: 0.38, map: darkMarbleImage)
        walnut = TrophyMaterials.pbr(UIColor(trophyRGB: 0xD8B184), metalness: 0.12, roughness: 0.52, map: walnutImage)
        slate = TrophyMaterials.pbr(UIColor(trophyRGB: 0xB8C6D8), metalness: 0.16, roughness: 0.58, map: slateImage)
    }

    /// A textured material repeated `rx` × `ry` times over its surface.
    func tiled(_ image: UIImage, color: UInt32, metalness: CGFloat, roughness: CGFloat, rx: Float, ry: Float) -> SCNMaterial {
        let m = TrophyMaterials.pbr(UIColor(trophyRGB: color), metalness: metalness, roughness: roughness, map: image)
        m.diffuse.contentsTransform = SCNMatrix4MakeScale(rx, ry, 1)
        return m
    }

    /// models.js `teamMetal`: a team's colour in metal. Broad faces ask for
    /// painted metal (low metalness); thin accents can take the mirror.
    func teamMetal(_ color: String, roughness: CGFloat = 0.28, emissive: CGFloat = 0.08, metalness: CGFloat = 0.95, lighten: CGFloat = 0.1) -> SCNMaterial {
        let key = "\(color):\(roughness):\(emissive):\(metalness):\(lighten)"
        lock.lock(); defer { lock.unlock() }
        if let cached = teamCache[key] { return cached }
        let base = UIColor(trophyHex: color)
        let m = TrophyMaterials.pbr(base.mixed(with: .white, lighten), metalness: metalness, roughness: roughness,
                                    emission: base, emissionIntensity: emissive)
        teamCache[key] = m
        return m
    }

    /// One painted image per key, painted once.
    func image(_ key: String, _ paint: () -> UIImage) -> UIImage {
        lock.lock()
        if let cached = imageCache[key] { lock.unlock(); return cached }
        lock.unlock()
        let made = paint()
        lock.lock(); imageCache[key] = made; lock.unlock()
        return made
    }

    /// A ghosted copy for a title whose season was lost.
    static func ghost(_ material: SCNMaterial) -> SCNMaterial {
        let m = material.copy() as! SCNMaterial
        m.transparency = 0.26
        m.metalness.contents = 0.35
        m.roughness.contents = 0.62
        m.writesToDepthBuffer = false
        return m
    }
}

// MARK: Node helpers

extension SCNNode {
    convenience init(_ geometry: SCNGeometry, _ material: SCNMaterial, at position: SIMD3<Float> = .zero) {
        self.init(geometry: geometry)
        geometry.materials = [material]
        simdPosition = position
    }

    /// A node of a shared geometry with its own material (the geometry's data
    /// is shared; only the material list is per node).
    static func shared(_ geometry: SCNGeometry, _ material: SCNMaterial, at position: SIMD3<Float> = .zero) -> SCNNode {
        let copy = geometry.copy() as! SCNGeometry
        copy.materials = [material]
        let node = SCNNode(geometry: copy)
        node.simdPosition = position
        return node
    }

    @discardableResult
    func adding(_ children: SCNNode...) -> SCNNode {
        children.forEach(addChildNode)
        return self
    }

    /// Decorations a tap should pass straight through.
    func decorative() -> SCNNode {
        categoryBitMask = TrophyCategory.decor
        castsShadow = false
        return self
    }
}

enum TrophyCategory {
    static let solid = 1
    static let decor = 2
}

/// three.js `Box3.setFromObject`: the axis-aligned bounds of everything
/// under `node`, in the space of `reference` (nil: world space, which for a node not yet
/// in a scene includes its own transform, as three.js measures it).
enum Bounds {
    static func of(_ node: SCNNode, in reference: SCNNode? = nil) -> (min: SIMD3<Float>, max: SIMD3<Float>) {
        var lo = SIMD3<Float>(repeating: .greatestFiniteMagnitude)
        var hi = SIMD3<Float>(repeating: -.greatestFiniteMagnitude)
        node.enumerateHierarchy { child, _ in
            guard let geometry = child.geometry else { return }
            let (a, b) = geometry.boundingBox
            for i in 0..<8 {
                let corner = SCNVector3(i & 1 == 0 ? a.x : b.x, i & 2 == 0 ? a.y : b.y, i & 4 == 0 ? a.z : b.z)
                let p = child.convertPosition(corner, to: reference)
                let v = SIMD3<Float>(Float(p.x), Float(p.y), Float(p.z))
                lo = simd_min(lo, v)
                hi = simd_max(hi, v)
            }
        }
        if lo.x > hi.x { return (.zero, .zero) }
        return (lo, hi)
    }

    static func size(_ node: SCNNode, in reference: SCNNode? = nil) -> SIMD3<Float> {
        let b = of(node, in: reference)
        return b.max - b.min
    }

    static func centre(_ node: SCNNode, in reference: SCNNode? = nil) -> SIMD3<Float> {
        let b = of(node, in: reference)
        return (b.max + b.min) / 2
    }
}
