import SceneKit
import UIKit
import simd

/// trophy/locker.js: one manager's wall, everything they have to be proud of
/// on it at once. Rows run down the wall in the order a trophy case fills up:
/// the team's flag, a pennant per playoff berth (that season's star and
/// ribbon pinned to its posts), a shelf of trophies, and personal bests. On a
/// phone held upright the same wall is folded into columns.
enum LockerMetrics {
    static let wallTop: Float = 6.3
    static let rowGap: Float = 0.34
    static let captionDrop: Float = 0.28
    static let wallZ: Float = -0.55
    static let panelWide: Float = 10.5
    static let panelNarrow: Float = 14.5
    static let panelBelow: Float = 1
    static let pennantBlue = "#2a5fcc"
    static let pennantGold = "#7a5205"
    static let starPlate = "#e0aa2c"
    static let ribbonPlate = "#c8102e"
    static let flagHalf: Float = 0.80
    static let pennant: Float = 0.62
    static let trophy: Float = 0.90
    static let bowl: Float = 0.46
    static let plaqueHalf: Float = 0.43
    static let trophyScale: Float = 0.44
    static let bowlScale: Float = 1.1
    static let plaqueScale: Float = 0.66
    static let flagWidth: Float = 3.35
    static let pennantBig: Float = 1.45
    static let wallFloor: Float = 0.39 + 0.24

    enum Column {
        static let pitch: Float = 1.32
        static let drop: Float = 1.16
        static let pennant: Float = 1.3
        static let trophy: Float = 0.9
        static let plaque: Float = 0.82
        static let pad: Float = 0.14
    }

    enum Badge {
        static let span: Float = 0.52
        static let post: Float = 0.62
        static let drop: Float = 0.15
        static let out: Float = 0.12
    }
}

/// One thing on the wall that can be tapped and inspected.
final class LockerItem {
    let holder: SCNNode
    let spinner: SCNNode
    let home: SIMD3<Float>
    let push: Float
    let lift: Float
    let yaw: Float
    let pitch: Float
    let record: TrophyRecord
    var frameCentre: SIMD3<Float> = .zero
    var frameHalfWidth: Float = 0.5
    var frameHalfHeight: Float = 0.5

    init(holder: SCNNode, spinner: SCNNode, home: SIMD3<Float>, push: Float, lift: Float, yaw: Float, pitch: Float, record: TrophyRecord) {
        self.holder = holder
        self.spinner = spinner
        self.home = home
        self.push = push
        self.lift = lift
        self.yaw = yaw
        self.pitch = pitch
        self.record = record
    }
}

struct LockerWallBuild {
    let room: SCNNode
    let items: [LockerItem]
    let centre: SIMD3<Float>
    let size: SIMD3<Float>
    let narrow: Bool
}

/// The room a wall stands in: panelling, wainscot, a polished floor, and
/// broad even light, because a wall is read all at once.
private func lockerRoom(kit: TrophyKit, narrow: Bool) -> SCNNode {
    let mat = kit.mat
    let room = SCNNode()
    let wallZ = LockerMetrics.wallZ
    let height = narrow ? LockerMetrics.panelNarrow : LockerMetrics.panelWide
    let below = LockerMetrics.panelBelow

    let back = SCNNode.shared(Mesh.plane(13, height + below),
                              mat.tiled(mat.darkMarbleImage, color: 0x6A7D96, metalness: 0.3, roughness: 0.55, rx: 4, ry: (height + below) * 0.27),
                              at: [0, (height - below) / 2, wallZ - 0.1])
    let wainscot = SCNNode.shared(Mesh.box(13, 0.34, 0.22), mat.tiled(mat.walnutImage, color: 0x6D5539, metalness: 0.15, roughness: 0.64, rx: 6, ry: 1),
                                  at: [0, 0.17, wallZ + 0.06])
    let rail = SCNNode.shared(Mesh.box(13, 0.06, 0.3), mat.brass, at: [0, 0.36, wallZ + 0.1])
    let floor = SCNNode.shared(Mesh.plane(13, 8), mat.tiled(mat.darkMarbleImage, color: 0x8EA4BD, metalness: 0.55, roughness: 0.26, rx: 5, ry: 3),
                               at: [0, 0, wallZ + 3.9])
    floor.simdEulerAngles.x = -.pi / 2
    let cove = SCNNode.shared(Mesh.plane(11, 0.16), TrophyMaterials.glow(UIColor(trophyRGB: 0xFFD9A0), additive: false), at: [0, height + 0.6, wallZ + 0.6])
    room.adding(back, wainscot, rail, floor, cove)
    room.enumerateHierarchy { node, _ in node.categoryBitMask = TrophyCategory.decor; node.castsShadow = false }
    return room
}

/// Broad, even light over the whole wall, aimed at the middle of what hangs
/// on it: a wash from either side, a soft fill from the front and a cool
/// ambient. A wall is read all at once, so no part of it is lit hot enough to
/// burn out an engraved plate.
private func lightWall(_ room: SCNNode, lo: SIMD3<Float>, hi: SIMD3<Float>) {
    let centre = (lo + hi) / 2, size = hi - lo
    let wallZ = LockerMetrics.wallZ
    let back = max(size.x, size.y) * 0.75 + 2.5
    for side: Float in [-1, 1] {
        let wash = SCNNode()
        let light = SCNLight()
        light.type = .spot
        light.color = UIColor(trophyRGB: 0xFFF0D4)
        light.intensity = 190
        light.spotOuterAngle = 130
        light.spotInnerAngle = 60
        light.attenuationEndDistance = CGFloat(back * 4)
        light.attenuationFalloffExponent = 1
        wash.light = light
        wash.simdPosition = [centre.x + side * (size.x * 0.5 + 1.5), centre.y + size.y * 0.3, wallZ + back]
        wash.simdLook(at: [centre.x + side * size.x * 0.12, centre.y, wallZ])
        room.addChildNode(wash)
    }
    let front = SCNNode()
    front.light = SCNLight()
    front.light!.type = .omni
    front.light!.color = UIColor(trophyRGB: 0xFFE9C8)
    front.light!.intensity = 120
    front.light!.attenuationEndDistance = CGFloat(back * 4)
    front.light!.attenuationFalloffExponent = 1
    front.simdPosition = [centre.x, centre.y + 0.5, wallZ + back + 1]
    let ambient = SCNNode()
    ambient.light = SCNLight()
    ambient.light!.type = .ambient
    ambient.light!.color = UIColor(trophyRGB: 0x8E9DB8)
    ambient.light!.intensity = 260
    room.adding(front, ambient)
}

/// Builds one manager's wall and the room around it.
func buildLockerWall(kit: TrophyKit, locker: TrophyLocker, narrow: Bool) -> LockerWallBuild {
    typealias M = LockerMetrics
    let mat = kit.mat
    let room = lockerRoom(kit: kit, narrow: narrow)
    let wall = SCNNode()
    var items: [LockerItem] = []
    let accent = locker.tint
    let livery = Livery(ownerId: locker.ownerId, color: accent, icon: locker.icon, key: locker.ownerId)

    let clear: Float = 0.06, maxPush: Float = 0.45
    let wallFace = M.wallZ - 0.1

    func measure(_ object: SCNNode) -> (centre: SIMD3<Float>, size: SIMD3<Float>, min: SIMD3<Float>) {
        let b = Bounds.of(object)
        return ((b.min + b.max) / 2, b.max - b.min, b.min)
    }

    /// Hangs one piece; the spinner inside it pivots on the piece's own
    /// centre, and the piece works out how far it must come forward and lift
    /// to turn freely — or how far it may turn where it cannot.
    @discardableResult
    func mount(_ object: SCNNode, _ x: Float, _ y: Float, _ z: Float, _ record: TrophyRecord, standsOn: Float? = nil) -> LockerItem {
        let m = measure(object)
        let half = m.size / 2
        let spinner = SCNNode()
        spinner.simdPosition = m.centre
        object.simdPosition -= m.centre
        spinner.addChildNode(object)
        let seatY = standsOn.map { $0 - m.min.y } ?? y
        let holder = SCNNode()
        holder.simdPosition = [x, seatY, z]
        holder.addChildNode(spinner)

        let centreZ = z + m.centre.z
        let centreY = seatY + m.centre.y
        let sweep = simd_length(half)
        let push = min(maxPush, max(0, sweep - (centreZ - wallFace) + clear))
        let lift = standsOn.map { max(0, sweep - (centreY - $0) + clear) } ?? 0
        let room = centreZ + push - wallFace - clear
        func limit(_ across: Float, _ deep: Float) -> Float {
            let reach = hypot(across, deep)
            if reach <= room { return .infinity }
            return max(0.08, asin(min(1, room / reach)) - atan2(deep, across))
        }
        let item = LockerItem(holder: holder, spinner: spinner, home: holder.simdPosition, push: push, lift: lift,
                              yaw: limit(half.x, half.z), pitch: limit(half.y, half.z), record: record)
        holder.name = "locker:\(items.count)"
        wall.addChildNode(holder)
        items.append(item)
        return item
    }

    let captionInk = UIColor(trophyHex: accent).mixed(with: .white, 0.55)
    func label(_ text: String, _ x: Float, _ y: Float, _ width: Float = 2.0) {
        let image = Paint.sectionLabel(text, color: captionInk)
        let m = TrophyMaterials.glow(image, additive: false)
        m.blendMode = .alpha
        m.writesToDepthBuffer = false
        let plate = SCNNode.shared(Mesh.plane(width, width * 0.09), m, at: [x, y, M.wallZ + 0.06])
        wall.addChildNode(plate.decorative())
    }

    func record(_ meta: LockerMeta) -> TrophyRecord { TrophyRecord(locker: locker, meta: meta) }

    // What each kind of piece is, at whatever size the wall has room for.
    struct Piece {
        var stands = false
        var hangs = false
        var badges: [(side: Float, piece: Piece)] = []
        var build: (Float) -> SCNNode
        var record: TrophyRecord
    }

    func honourPiece(_ honour: LockerHonour, compact: Bool = false) -> Piece {
        Piece(hangs: true, build: { scale in
            let badge = honour.kind == "star"
                ? kit.scoringStar(year: honour.year, accent: M.starPlate, compact: compact).node
                : kit.winsRibbon(year: honour.year, accent: M.ribbonPlate, compact: compact).node
            badge.simdScale = SIMD3(repeating: scale)
            return SCNNode().adding(badge)
        }, record: record(honour.meta))
    }

    func piece(_ p: LockerPiece) -> Piece {
        switch p.kind {
        case "pennant":
            var piece = Piece(hangs: true, build: { scale in
                let division = p.division ?? false
                let pennant = kit.pennant(year: p.year, cloth: division ? M.pennantGold : M.pennantBlue,
                                          note: division ? "DIVISION CHAMPS" : "PLAYOFFS", crown: division)
                pennant.simdScale = SIMD3(repeating: scale)
                return SCNNode().adding(pennant)
            }, record: record(p.meta))
            piece.badges = (p.badges ?? []).map { (Float($0.side), honourPiece($0.piece, compact: true)) }
            return piece
        case "star", "ribbon":
            return honourPiece(LockerHonour(kind: p.kind, year: p.year, meta: p.meta))
        case "title", "bowl":
            return Piece(stands: true, build: { scale in
                let object: SCNNode
                if p.kind == "title" {
                    object = kit.leagueTrophy(year: p.year, livery: livery).node
                    object.simdScale = SIMD3(repeating: M.trophyScale * scale)
                } else {
                    object = kit.podiumBowl(year: p.year, metal: p.metal, accent: accent)
                    object.simdScale = SIMD3(repeating: M.bowlScale * scale)
                }
                return SCNNode().adding(object)
            }, record: record(p.meta))
        default:
            return Piece(build: { scale in
                let plaque = kit.plaque(value: p.bigValue ?? "", label: p.meta.title, holder: p.bigValue ?? "", meta: p.line,
                                        accent: accent, holders: [livery], tarnished: false, mounted: true).node
                plaque.simdScale = SIMD3(repeating: M.plaqueScale * scale)
                return SCNNode().adding(plaque)
            }, record: record(p.meta))
        }
    }

    let pennants = locker.wall.pennants.map { piece($0) }
    let trophies = locker.wall.trophies.map { piece($0) }
    let plaques = locker.wall.plaques.map { piece($0) }

    func hangShelf(_ centreX: Float, _ width: Float, _ topY: Float, depth: Float = 0.62, thickness: Float = 0.11) {
        let lift = thickness / 2
        let shelf = SCNNode.shared(Mesh.roundedBox(width, thickness, depth, min(0.03, thickness / 3)), mat.darkMarble,
                                   at: [centreX, topY - lift, M.wallZ + 0.32])
        let long = width > 1.4
        let edge = SCNNode.shared(Mesh.roundedBox(width + 0.04, long ? 0.022 : 0.012, depth + 0.04, 0.008),
                                  long ? mat.teamMetal(accent, emissive: 0.5) : mat.brass,
                                  at: [centreX, topY - lift - thickness * 0.56, M.wallZ + 0.32])
        wall.adding(shelf.decorative(), edge.decorative())
        guard long else { return }
        for x in [-(width / 2 - 0.2), 0, width / 2 - 0.2] {
            let bracket = kit.part("lockerBracket", mat.brass, at: [centreX + x, topY - lift - thickness * 0.5 - 0.1, M.wallZ + 0.14]) {
                Mesh.cylinder(0.035, 0.05, 0.2, 10)
            }
            wall.addChildNode(bracket.decorative())
        }
    }

    /// Hangs a piece dead centre on its slot, then pins its honours to its corners.
    func hangPiece(_ piece: Piece, _ object: SCNNode, _ x: Float, _ y: Float, _ z: Float) {
        let m = measure(object)
        mount(object, x - m.centre.x, y - m.centre.y, z, piece.record)
        for (side, badge) in piece.badges {
            let pin = badge.build(1)
            let natural = measure(pin)
            pin.simdScale *= (m.size.x * M.Badge.span) / max(0.001, natural.size.x)
            let pinned = measure(pin)
            mount(pin, x + side * m.size.x * M.Badge.post - pinned.centre.x,
                  y + m.size.y * (0.5 - M.Badge.drop) - pinned.centre.y, z + M.Badge.out, badge.record)
        }
    }

    var cursor = M.wallTop

    func hangFlag(_ scale: Float) {
        let flag = SCNNode().adding(kit.teamFlag(locker))
        flag.simdScale = SIMD3(repeating: scale)
        let half = M.flagHalf * scale
        mount(flag, 0, cursor - half - 0.12, M.wallZ + 0.14, record(locker.wall.flag))
        cursor -= half * 2 + 0.12 + (narrow ? 0.22 : M.rowGap)
    }

    func spread(_ count: Int, perRow: Int, gap: Float, top: Float, rowGap: Float) -> [SIMD2<Float>] {
        (0..<count).map { index in
            let row = index / perRow
            let inRow = min(perRow, count - row * perRow)
            let column = index - row * perRow
            return [(Float(column) - Float(inRow - 1) / 2) * gap, top - Float(row) * rowGap]
        }
    }

    if narrow {
        // The folded wall: one column per kind of thing, everything on screen at once.
        let lanes = [pennants, trophies, plaques].filter { !$0.isEmpty }
        if lanes.isEmpty {
            hangFlag(0.7)
        } else {
            let across = Float(lanes.count)
            let laneX = { (i: Int) in (Float(i) - (across - 1) / 2) * M.Column.pitch }
            hangFlag(min(M.Column.drop * 1.02 / (M.flagHalf * 2), (across * M.Column.pitch * 0.66) / M.flagWidth))

            func fitCell(_ object: SCNNode, _ height: Float = M.Column.drop) -> SCNNode {
                let size = measure(object).size
                let room = min((M.Column.pitch - M.Column.pad * 2) / max(0.001, size.x), (height - M.Column.pad) / max(0.001, size.y), 1)
                if room < 1 { object.simdScale *= room }
                return object
            }
            let top = cursor
            for (index, lane) in lanes.enumerated() {
                for (row, piece) in lane.enumerated() {
                    let x = laneX(index), cellTop = top - Float(row) * M.Column.drop
                    if piece.stands {
                        let trophy = fitCell(piece.build(M.Column.trophy), M.Column.drop - 0.2)
                        let span = measure(trophy).size.x
                        let shelfY = cellTop - M.Column.drop + 0.14
                        hangShelf(x, max(0.34, span * 1.5), shelfY, depth: 0.36, thickness: 0.05)
                        mount(trophy, x, shelfY, M.wallZ + 0.34, piece.record, standsOn: shelfY)
                    } else {
                        let scale = piece.hangs ? M.Column.pennant : M.Column.plaque
                        let z = piece.hangs ? M.wallZ + 0.2 : M.wallZ + 0.14
                        hangPiece(piece, fitCell(piece.build(scale)), x, cellTop - M.Column.drop / 2, z)
                    }
                }
            }
        }
    } else {
        hangFlag(1)
        func hangRow(_ pieces: [Piece], perRow: Int, gap: Float, drop: Float, rowGap: Float, caption: String, z: Float = 0.2, scale: Float = 1) {
            guard !pieces.isEmpty else { return }
            label(caption, 0, cursor, 1.9)
            let top = cursor - M.captionDrop
            let spots = spread(pieces.count, perRow: perRow, gap: gap, top: top, rowGap: drop + rowGap)
            for (i, piece) in pieces.enumerated() {
                hangPiece(piece, piece.build(scale), spots[i].x, spots[i].y - drop / 2, M.wallZ + z)
            }
            let rows = Float((pieces.count + perRow - 1) / perRow)
            cursor = top - rows * drop - (rows - 1) * rowGap - M.rowGap
        }
        hangRow(pennants, perRow: 6, gap: 0.88, drop: M.pennant * M.pennantBig + 0.16, rowGap: 0.24, caption: "PLAYOFF BERTHS", scale: M.pennantBig)

        // The shelf is always here, stocked or bare.
        label("TROPHIES", 0, cursor, 1.9)
        let hasTitle = locker.wall.trophies.contains { $0.place == 1 }
        let tallest = hasTitle ? M.trophy : M.bowl
        let rowGap = tallest + 0.28
        let rows = max(1, (trophies.count + 4) / 5)
        let firstY = cursor - M.captionDrop - tallest
        for row in 0..<rows { hangShelf(0, 4.6, firstY - Float(row) * rowGap) }
        let spots = spread(trophies.count, perRow: 5, gap: hasTitle ? 0.92 : 0.74, top: firstY, rowGap: rowGap)
        for (i, piece) in trophies.enumerated() {
            mount(piece.build(1), spots[i].x, spots[i].y, M.wallZ + 0.34, piece.record, standsOn: spots[i].y)
        }
        cursor = firstY - Float(rows - 1) * rowGap - 0.16 - M.rowGap

        hangRow(plaques, perRow: 6, gap: 0.90, drop: M.plaqueHalf * 2, rowGap: 0.2, caption: "PERSONAL BESTS", z: 0.14)
    }

    // Nothing on the wall may come down into the wainscot.
    var low: Float = .greatestFiniteMagnitude
    for item in items { low = min(low, Bounds.of(item.holder).min.y) }
    let floorLift = max(0, M.wallFloor - (low.isFinite ? low : M.wallFloor))
    wall.simdPosition.y = floorLift

    let poolImage = mat.image("blob") { Paint.radialBlob() }
    let poolMaterial = TrophyMaterials.glow(poolImage, additive: true)
    poolMaterial.multiply.contents = UIColor(trophyHex: accent).scaled(0.16)
    let pool = SCNNode.shared(Mesh.plane(narrow ? 4.6 : 7, 3.4), poolMaterial, at: [0, 0.02 - floorLift, M.wallZ + 1.6])
    pool.simdEulerAngles.x = -.pi / 2
    wall.addChildNode(pool.decorative())
    room.addChildNode(wall)

    // Measure each piece where it ended up, so inspecting one needs no guesswork.
    var lo = SIMD3<Float>(repeating: .greatestFiniteMagnitude), hi = SIMD3<Float>(repeating: -.greatestFiniteMagnitude)
    for item in items {
        let b = Bounds.of(item.holder)
        let size = b.max - b.min
        item.frameCentre = (b.min + b.max) / 2
        item.frameHalfWidth = hypot(size.x, size.z) / 2
        item.frameHalfHeight = size.y / 2
        lo = simd_min(lo, b.min)
        hi = simd_max(hi, b.max)
    }
    if items.isEmpty { lo = [0, 0, 0]; hi = [1, 1, 1] }
    lightWall(room, lo: lo, hi: hi)
    return LockerWallBuild(room: room, items: items, centre: (lo + hi) / 2, size: hi - lo, narrow: narrow)
}
