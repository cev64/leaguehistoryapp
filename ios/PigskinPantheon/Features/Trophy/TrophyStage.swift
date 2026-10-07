import SceneKit
import SwiftUI
import UIKit
import simd

/// trophy/app.js: the hall itself. Builds the room, hangs the exhibits along
/// one rail, and turns pans, pinches and taps into movement through it.
///
/// Two states and one transition between them, as on the site: in `hall` you
/// travel past the pedestals; in `focus` one exhibit lifts off its plinth and
/// turns under your finger while its record opens beside it. A manager's
/// shield opens their `locker`, a wall you can zoom into (`lockerFocus`). The
/// camera is never driven directly — every frame it eases toward a target
/// pose, which is what makes a flick, a tap and a button feel like one room.
///
/// In the app a locker is a page of its own, pushed on the trophy room's
/// navigation stack (`path`) with its own scene, so the system's back button
/// and swipe take you back to the hall exactly where you left it.
@MainActor
@Observable
final class TrophyStage {
    enum Phase: Equatable { case loading, ready, failed(String) }
    enum Mode { case intro, hall, focus, locker, lockerFocus }
    /// The two rooms, each drawn by its own view.
    enum Room: Hashable { case hall, locker }

    // MARK: What the HUD reads

    var phase: Phase = .loading
    private(set) var hall: TrophyHall?
    private(set) var mode: Mode = .intro
    /// The exhibit nearest the camera (the nameplate's).
    private(set) var current = 0
    private(set) var focusIndex = -1
    private(set) var lockerId: String?
    private(set) var lockerIndex = -1
    private(set) var lockerRecords: [TrophyRecord] = []
    /// The locker's wall is built and hung (its curtain can lift).
    private(set) var lockerReady = false
    var showHint = false
    private(set) var upright = true
    /// The trophy room's navigation stack: lockers, and the league's pages.
    var path = NavigationPath()

    var currentItem: TrophyExhibit? { hall.flatMap { $0.rail.indices.contains(current) ? $0.rail[current] : nil } }
    var locker: TrophyLocker? { lockerId.flatMap { hall?.lockers[$0] } }
    var inLocker: Bool { mode == .locker || mode == .lockerFocus }
    var focused: Bool { mode == .focus || mode == .lockerFocus }

    /// The record the sheet shows, whatever is being inspected.
    var record: TrophyRecord? {
        if mode == .lockerFocus, lockerRecords.indices.contains(lockerIndex) { return lockerRecords[lockerIndex] }
        if mode == .focus, let hall, hall.rail.indices.contains(focusIndex) {
            var record = TrophyRecord(exhibit: hall.rail[focusIndex])
            record.routes = teamRoutes(hall.rail[focusIndex])
            return record
        }
        return nil
    }

    // MARK: The scene

    @ObservationIgnored let scene = SCNScene()
    @ObservationIgnored let cameraNode = SCNNode()
    @ObservationIgnored weak var view: SCNView?
    @ObservationIgnored let lockerScene = SCNScene()
    @ObservationIgnored let lockerCamera = SCNNode()
    @ObservationIgnored weak var lockerView: SCNView?
    @ObservationIgnored private let lockerFill = SCNNode()
    @ObservationIgnored private var lockerLook = SIMD3<Float>(0, 3, 0)
    /// How deep the locker sits on `path`; a shorter path means it was popped.
    @ObservationIgnored private var lockerDepth: Int?
    @ObservationIgnored private var visibleRooms = Set<Room>()
    @ObservationIgnored private var kit: TrophyKit?
    @ObservationIgnored private let hallGroup = SCNNode()
    @ObservationIgnored private let exhibitRoot = SCNNode()
    @ObservationIgnored private var roomNode: SCNNode?
    @ObservationIgnored private var lights: TravellingLights?
    @ObservationIgnored private var dust: SCNNode?
    @ObservationIgnored private let focusFill = SCNNode()
    @ObservationIgnored private var exhibits: [Exhibit] = []
    @ObservationIgnored private var layout: HallLayout?
    @ObservationIgnored private var lockerWall: LockerWallBuild?
    @ObservationIgnored private var summary: LeagueSummary?
    @ObservationIgnored private var link: CADisplayLink?
    @ObservationIgnored private var last: CFTimeInterval = 0
    @ObservationIgnored private var started = false

    // MARK: Motion state

    @ObservationIgnored private var rail: Float = 0
    @ObservationIgnored private var railTarget: Float = 0
    @ObservationIgnored private var velocity: Float = 0
    @ObservationIgnored private var dragging = false
    @ObservationIgnored private var focusYaw: Float = 0
    @ObservationIgnored private var focusPitch: Float = 0
    @ObservationIgnored private var focusZoom: Float = 1
    @ObservationIgnored private var lift: Float = 0
    @ObservationIgnored private var intro: Float = 1
    @ObservationIgnored private var lockerPan = SIMD2<Float>(0, 0)
    @ObservationIgnored private var wallZoom: Float = 1
    @ObservationIgnored private var lookAt = SIMD3<Float>(0, 1.8, 0)
    @ObservationIgnored private var camTarget = (position: SIMD3<Float>(0, 2.1, 6.4), look: SIMD3<Float>(0, 1.8, 0))
    @ObservationIgnored private var fillColor = SIMD3<Float>(1, 0.94, 0.84)
    @ObservationIgnored var calm = false
    @ObservationIgnored private var lastAccent = UIColor(trophyRGB: 0xF2C14A)

    // MARK: The screen

    /// Where a room's view sits on screen (points, global) and how much of
    /// its top and foot the bars cover: the room is framed in what is left.
    struct Port: Equatable {
        var frame = CGRect(x: 0, y: 0, width: 402, height: 874)
        var top: CGFloat = 160
        var bottom: CGFloat = 230
        var leading: CGFloat = 0
        var trailing: CGFloat = 0
        var size: CGSize { frame.size }
    }

    @ObservationIgnored private var hallPort = Port()
    @ObservationIgnored private var lockerPort = Port()
    /// The inspect sheet's size, while it is up.
    @ObservationIgnored private var sheetSize: CGSize?

    init() {
        for (s, camera) in [(scene, cameraNode), (lockerScene, lockerCamera)] {
            s.background.contents = UIColor(trophyRGB: 0x070D17)
            camera.camera = Self.makeCamera()
            s.rootNode.addChildNode(camera)
        }
        scene.fogColor = UIColor(trophyRGB: 0x070D17)
        scene.fogStartDistance = 17
        scene.fogEndDistance = 62
        scene.fogDensityExponent = 1
        cameraNode.simdPosition = [0, 2.1, 6.4]

        let ambient = SCNNode()
        ambient.light = SCNLight()
        ambient.light!.type = .ambient
        ambient.light!.color = UIColor(trophyRGB: 0x5A6C8E)
        ambient.light!.intensity = 220
        scene.rootNode.addChildNode(ambient)

        for (fill, s) in [(focusFill, scene), (lockerFill, lockerScene)] {
            fill.light = SCNLight()
            fill.light!.type = .omni
            fill.light!.intensity = 0
            fill.light!.attenuationEndDistance = 9
            fill.light!.attenuationFalloffExponent = 2
            s.rootNode.addChildNode(fill)
        }

        hallGroup.addChildNode(exhibitRoot)
        scene.rootNode.addChildNode(hallGroup)
    }

    /// The hall's lens. Exposure sits under the room's brightest lights and
    /// bloom only catches what is truly hot (a glint, a lamp strip), so
    /// engraved plates, banners and names hold their detail.
    private static func makeCamera() -> SCNCamera {
        let camera = SCNCamera()
        camera.fieldOfView = 52
        camera.projectionDirection = .vertical
        camera.zNear = 0.1
        camera.zFar = 220
        camera.wantsHDR = true
        camera.wantsExposureAdaptation = false
        camera.exposureOffset = -0.3
        camera.whitePoint = 1.4
        camera.bloomIntensity = 0.16
        camera.bloomThreshold = 1.45
        camera.bloomBlurRadius = 5
        camera.vignettingIntensity = 0.45
        camera.vignettingPower = 0.9
        camera.grainIntensity = 0.02
        camera.grainScale = 1
        return camera
    }

    // MARK: Loading

    func load(session: LeagueSession) async {
        guard !started else { return }
        started = true
        summary = session.summary
        do {
            let hall = try await session.engine.call(TrophyHall.self, "Bridge.trophy.hall()")
            let logos = await TrophyLogos.load(hall.logos)
            let built = await Task.detached(priority: .userInitiated) { () -> (TrophyKit, [Exhibit], UIImage) in
                let kit = TrophyKit(logos: logos)
                let exhibits = hall.rail.enumerated().map { Exhibit(index: $0.offset, item: $0.element, kit: kit) }
                return (kit, exhibits, Paint.environment())
            }.value
            self.kit = built.0
            self.exhibits = built.1
            for s in [scene, lockerScene] {
                s.lightingEnvironment.contents = built.2
                s.lightingEnvironment.intensity = 0.8
            }
            self.hall = hall
            exhibits.forEach { exhibitRoot.addChildNode($0.stand) }
            applyLayout(vertical: wantsUpright)
            applyLaunchTarget()
            phase = .ready
            startLoop()
            enterHall()
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func upright(_ size: CGSize) -> Bool {
        switch TrophyLaunch.layout {
        case "corridor": return false
        case "shaft": return true
        default: return size.width <= 860 && size.height > size.width
        }
    }

    private var wantsUpright: Bool { upright(hallPort.size) }

    /// The SwiftUI side reports where a room's view is and what its bars cover.
    func viewport(_ room: Room, _ port: Port) {
        guard port.frame.width > 10, port.frame.height > 10 else { return }
        switch room {
        case .hall:
            guard port != hallPort else { return }
            hallPort = port
            if hall != nil, layout != nil, wantsUpright != layout!.vertical {
                // A corridor and a shaft are different buildings: turning the
                // phone rebuilds the room around the same exhibits.
                applyLayout(vertical: wantsUpright)
            }
        case .locker:
            guard port != lockerPort else { return }
            lockerPort = port
            if let locker, let wall = lockerWall, wall.narrow != upright(port.size), inLocker {
                rebuildLocker(locker, keepFocus: true)
            }
        }
    }

    /// The inspect sheet reports its size (nil once it has gone).
    func sheet(size: CGSize?) { sheetSize = size }

    /// How much of a room's foot the inspect sheet covers: a sheet rises from
    /// the foot across the room's width (with a little air under a floating
    /// one); an inspector column beside the room covers none of it.
    private func sheetCover(_ port: Port) -> CGFloat {
        guard let sheet = sheetSize, focused, sheet.width >= port.frame.width * 0.8 else { return 0 }
        return min(port.frame.height, sheet.height + 8)
    }

    private func applyLayout(vertical: Bool) {
        guard let hall, let kit else { return }
        let layout = HallLayout(hall: hall, vertical: vertical)
        self.layout = layout
        upright = vertical
        roomNode?.removeFromParentNode()
        lights?.nodes.forEach { $0.removeFromParentNode() }
        dust?.removeFromParentNode()

        let room = HallBuilder(kit: kit, hall: hall, layout: layout).build()
        hallGroup.addChildNode(room)
        roomNode = room
        let lights = TravellingLights(vertical: vertical, shadows: true)
        lights.nodes.forEach(hallGroup.addChildNode)
        self.lights = lights
        if !calm {
            let dust = dustNode(kit: kit, vertical: vertical)
            hallGroup.addChildNode(dust)
            self.dust = dust
        }
        for exhibit in exhibits {
            exhibit.place = layout.place(layout.positions[exhibit.index])
            exhibit.stand.simdPosition = exhibit.place
            exhibit.shadow.opacity = vertical ? 0.7 : 1
        }
        // Land the camera where it would be, so a rebuild never swoops.
        updateCameraTarget(dt: 1, snap: true)
    }

    private func applyLaunchTarget() {
        guard let target = TrophyLaunch.target, let hall else { return }
        if target.hasPrefix("wing:"), let wing = hall.wings.first(where: { $0.id == target.dropFirst(5) }) {
            rail = Float(wing.start); railTarget = rail
        } else if target.hasPrefix("focus:"), let item = hall.rail.first(where: { $0.id == target.split(separator: ":")[1] }) {
            rail = Float(item.railIndex); railTarget = rail
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.focusExhibit(item.railIndex) }
            if target.hasSuffix(":link") {
                // As tapping the record's first link does.
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
                    guard let record = self.record else { return }
                    if let route = record.links.compactMap(\.route).first ?? record.routes.first?.route { self.open(route) }
                }
            }
        } else if target.hasPrefix("locker:") {
            let parts = target.split(separator: ":").map(String.init)
            if parts.count >= 2, hall.lockers[parts[1]] != nil {
                if let shield = hall.rail.first(where: { $0.wing == "hall" && $0.ownerId == parts[1] }) {
                    rail = Float(shield.railIndex); railTarget = rail
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    self.openLocker(parts[1])
                    if parts.count >= 3, let index = Int(parts[2]) {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { self.focusLockerItem(index) }
                    } else if parts.count >= 3, parts[2] == "back" {
                        // As the back button does: pop the locker off the stack.
                        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { if !self.path.isEmpty { self.path.removeLast() } }
                    }
                }
            }
        } else if let item = hall.rail.first(where: { $0.id == target }) {
            rail = Float(item.railIndex); railTarget = rail
        }
        current = Int(rail.rounded())
    }

    private func enterHall() {
        guard mode == .intro else { return }
        mode = .hall
        if calm { intro = 0 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak self] in self?.showHint = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 6.5) { [weak self] in self?.showHint = false }
    }

    // MARK: The loop

    func startLoop() {
        guard link == nil else { link?.isPaused = false; return }
        let link = CADisplayLink(target: DisplayTarget(self), selector: #selector(DisplayTarget.tick(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
        link.add(to: .main, forMode: .common)
        link.isPaused = visibleRooms.isEmpty
        self.link = link
        last = CACurrentMediaTime()
    }

    /// A room's view came on or went off screen: nothing animates, and no
    /// view renders, while nobody can see it.
    func setVisible(_ room: Room, _ on: Bool) {
        if on { visibleRooms.insert(room) } else { visibleRooms.remove(room) }
        link?.isPaused = visibleRooms.isEmpty
        for (v, room) in [(view, Room.hall), (lockerView, Room.locker)] {
            v?.isPlaying = visibleRooms.contains(room)
            v?.rendersContinuously = visibleRooms.contains(room)
        }
        last = CACurrentMediaTime()
    }

    fileprivate func tick(_ now: CFTimeInterval) {
        let dt = Float(min(0.05, max(0.001, now - last)))
        last = now
        let time = Float(now)
        SCNTransaction.begin()
        SCNTransaction.disableActions = true
        defer { SCNTransaction.commit() }

        if mode != .intro { intro = damp(intro, 0, 2.4, dt) }
        if mode == .hall, !dragging {
            rail = damp(rail, railTarget, 6.5, dt)
            velocity = damp(velocity, 0, 6, dt)
        }

        if inLocker {
            updateLocker(dt: dt, time: time)
            updateCameraTarget(dt: dt)
            lockerFill.light?.intensity = CGFloat(damp(Float(lockerFill.light?.intensity ?? 0), mode == .lockerFocus ? 120 : 0, 4, dt))
            lockerFill.simdPosition = lockerCamera.simdPosition + [-0.6, 0.4, -0.3]
            return
        }

        lift = damp(lift, mode == .focus ? 0.42 : 0, 5, dt)
        updateExhibits(dt: dt, time: time)
        updateCameraTarget(dt: dt)

        let nearest = nearestIndex
        if nearest != current { current = nearest }

        if let hall, let layout, let lights {
            let index = mode == .focus ? focusIndex : nearest
            if hall.rail.indices.contains(index) {
                let along = layout.positions[index]
                lastAccent = UIColor(trophyHex: hall.rail[index].accent)
                lights.update(along: layout.vertical ? -along : along, accent: lastAccent)
            }
        }
        dust?.simdPosition = layout?.vertical == true
            ? [0, cameraNode.simdPosition.y, (HallMetrics.wallZ + HallMetrics.frontZ) / 2]
            : [cameraNode.simdPosition.x, 2.9, (HallMetrics.wallZ + HallMetrics.frontZ) / 2]

        // The fill rides off the camera's shoulder and takes the wing's colour.
        focusFill.light?.intensity = CGFloat(damp(Float(focusFill.light?.intensity ?? 0), mode == .focus ? 120 : 0, 4, dt))
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        lastAccent.getRed(&r, green: &g, blue: &b, alpha: &a)
        let goal = simd_mix(SIMD3<Float>(1, 0.94, 0.84), SIMD3<Float>(Float(r), Float(g), Float(b)), SIMD3(repeating: 0.35))
        fillColor = simd_mix(fillColor, goal, SIMD3(repeating: 0.08))
        focusFill.light?.color = UIColor(red: CGFloat(fillColor.x), green: CGFloat(fillColor.y), blue: CGFloat(fillColor.z), alpha: 1)
        focusFill.simdPosition = cameraNode.simdPosition + [-0.9, 0.5, -0.4]
    }

    private func damp(_ x: Float, _ y: Float, _ lambda: Float, _ dt: Float) -> Float {
        x + (y - x) * (1 - exp(-lambda * dt))
    }

    private var nearestIndex: Int {
        let i = mode == .focus ? Float(focusIndex) : rail
        return max(0, min(exhibits.count - 1, Int(i.rounded())))
    }

    private func updateExhibits(dt: Float, time: Float) {
        let centre = mode == .focus ? Float(focusIndex) : rail
        for exhibit in exhibits {
            let distance = abs(Float(exhibit.index) - centre)
            let near = distance < 4.5
            exhibit.stand.isHidden = distance >= 9
            if exhibit.stand.isHidden { continue }
            let focused = mode == .focus && exhibit.index == focusIndex
            if focused {
                exhibit.spinner.simdEulerAngles.y = damp(exhibit.spinner.simdEulerAngles.y, focusYaw, 9, dt)
                exhibit.pivot.simdEulerAngles.x = damp(exhibit.pivot.simdEulerAngles.x, focusPitch, 9, dt)
                exhibit.riser.simdPosition.y = damp(exhibit.riser.simdPosition.y, exhibit.topY + lift, 5, dt)
            } else {
                let sway = calm ? 0 : sin(time * 0.32 + exhibit.idlePhase) * exhibit.sway
                exhibit.spinner.simdEulerAngles.y = damp(exhibit.spinner.simdEulerAngles.y, sway, 2.2, dt)
                exhibit.pivot.simdEulerAngles.x = damp(exhibit.pivot.simdEulerAngles.x, 0, 4, dt)
                exhibit.riser.simdPosition.y = damp(exhibit.riser.simdPosition.y, exhibit.topY, 4, dt)
            }
            let lifted = focused ? lift : 0
            exhibit.shadow.childNodes.first?.opacity = CGFloat(1 - lifted * 0.8)
            exhibit.shadow.simdScale = SIMD3(repeating: 1 + lifted * 0.5)
            if !calm {
                for (node, speed) in exhibit.spin { node.simdEulerAngles.y += speed * dt * (focused ? 0.35 : 1) }
            }
            for (i, glint) in exhibit.glints.enumerated() {
                glint.isHidden = !near
                guard near else { continue }
                let pulse = calm ? 0.7 : 0.5 + 0.5 * sin(time * (1.1 + Float(i) * 0.37) + exhibit.idlePhase * 3)
                let proximity = min(1, max(0, 1 - distance / 4.5))
                glint.opacity = CGFloat(pulse * proximity * (focused ? 0.6 : 0.38))
                glint.simdScale = SIMD3(repeating: (0.22 + pulse * 0.2) / 0.34)
            }
        }
    }

    private func updateLocker(dt: Float, time: Float) {
        guard let wall = lockerWall else { return }
        for (index, item) in wall.items.enumerated() {
            if mode == .lockerFocus, index == lockerIndex {
                item.spinner.simdEulerAngles.y = damp(item.spinner.simdEulerAngles.y, min(max(focusYaw, -item.yaw), item.yaw), 9, dt)
                item.spinner.simdEulerAngles.x = damp(item.spinner.simdEulerAngles.x, min(max(focusPitch, -item.pitch), item.pitch), 9, dt)
                item.holder.simdPosition.y = damp(item.holder.simdPosition.y, item.home.y + item.lift, 6, dt)
                item.holder.simdPosition.z = damp(item.holder.simdPosition.z, item.home.z + item.push, 6, dt)
            } else {
                let sway = calm ? 0 : sin(time * 0.28 + Float(index)) * 0.03
                item.spinner.simdEulerAngles.y = damp(item.spinner.simdEulerAngles.y, sway, 2.4, dt)
                item.spinner.simdEulerAngles.x = damp(item.spinner.simdEulerAngles.x, 0, 4, dt)
                item.holder.simdPosition.y = damp(item.holder.simdPosition.y, item.home.y, 5, dt)
                item.holder.simdPosition.z = damp(item.holder.simdPosition.z, item.home.z, 5, dt)
            }
        }
    }

    // MARK: Camera

    /// The lens for a view's shape: 52° top to bottom, narrowed on a wide,
    /// short screen so the picture never stretches past ~75° side to side.
    private func fov(_ port: Port) -> (vertical: Float, horizontal: Float) {
        let aspect = Float(port.size.width / max(1, port.size.height))
        let most = Float(52 * Double.pi / 180)
        let v = min(most, 2 * atan(tan(Float(37.5 * Double.pi / 180)) / aspect))
        return (v, 2 * atan(tan(v / 2) * aspect))
    }

    /// Fits a box (half sizes; `reach` is how far it comes toward the lens)
    /// into the band of the view the bars and the sheet leave clear: how far
    /// back the camera stands, and how far it shifts (never tilts) so the box
    /// lands in the middle of that band.
    private func fit(_ port: Port, halfWidth: Float, halfHeight: Float, reach: Float, pad: Float, margin: Float)
        -> (distance: Float, offsetX: Float, offsetY: Float) {
        let W = Float(port.size.width), H = Float(port.size.height)
        let left = Float(port.leading) + pad, right = W - Float(port.trailing) - pad
        let top = Float(port.top) + pad
        let bottom = H - max(Float(port.bottom), Float(sheetCover(port))) - pad
        let bandW = max(140, right - left), bandH = max(110, bottom - top)
        let (v, h) = fov(port)
        let fitHeight = halfHeight / (tan(v / 2) * min(1, bandH / H)) + reach
        let fitWidth = halfWidth / (tan(h / 2) * min(1, bandW / W)) + reach
        let distance = max(fitHeight, fitWidth) * margin
        let visibleH = 2 * distance * tan(v / 2)
        let visibleW = visibleH * W / H
        let centreY = bottom - top >= 110 ? (top + bottom) / 2 : top + bandH / 2
        return (distance, (0.5 - (left + right) / 2 / W) * visibleW, (centreY / H - 0.5) * visibleH)
    }

    /// Framing an inspected piece, clear of the bars and the inspect sheet.
    private func focusFraming(_ port: Port, halfWidth: Float, halfHeight: Float) -> (distance: Float, offsetX: Float, offsetY: Float) {
        fit(port, halfWidth: halfWidth, halfHeight: halfHeight, reach: halfWidth, pad: 14, margin: 1.06 * focusZoom)
    }

    private func wallFraming() -> (distance: Float, offsetY: Float) {
        guard let wall = lockerWall else { return (12, 0) }
        let f = fit(lockerPort, halfWidth: wall.size.x / 2, halfHeight: wall.size.y / 2, reach: wall.size.z / 2,
                    pad: 12, margin: 1.05 / wallZoom)
        return (f.distance, f.offsetY)
    }

    /// Walking the hall: the exhibit in front of you, plinth and all, sized
    /// to the band between the room chips and the nameplate with a little of
    /// the room around it, seen from a touch above.
    private func hallFraming(_ index: Int) -> (distance: Float, offsetY: Float, centreY: Float) {
        let exhibit = exhibits[index]
        let height = exhibit.topY + exhibit.focusHeight + exhibit.focusHalfHeight
        let f = fit(hallPort, halfWidth: max(0.8, exhibit.focusHalfWidth), halfHeight: height / 2, reach: 0.6, pad: 10, margin: 1.3)
        let distance = min(max(f.distance, 4.2), 12)
        return (distance, f.offsetY * distance / max(0.01, f.distance), height / 2)
    }

    private func updateCameraTarget(dt: Float, snap: Bool = false) {
        if mode == .lockerFocus, let wall = lockerWall, wall.items.indices.contains(lockerIndex) {
            let item = wall.items[lockerIndex]
            let framing = focusFraming(lockerPort, halfWidth: item.frameHalfWidth, halfHeight: item.frameHalfHeight)
            let distance = max(framing.distance, 2.4 * focusZoom)
            let shownY = item.frameCentre.y + item.lift, shownZ = item.frameCentre.z + item.push
            camTarget.position = [item.frameCentre.x + framing.offsetX, shownY + framing.offsetY, shownZ + distance]
            camTarget.look = [item.frameCentre.x + framing.offsetX, shownY + framing.offsetY, shownZ]
        } else if mode == .locker, let wall = lockerWall {
            let framing = wallFraming()
            let x = wall.centre.x + lockerPan.x, y = wall.centre.y + lockerPan.y + framing.offsetY
            camTarget.position = [x, y, wall.centre.z + framing.distance]
            camTarget.look = [x, y, wall.centre.z]
        } else if mode == .focus, exhibits.indices.contains(focusIndex) {
            let exhibit = exhibits[focusIndex]
            let centerY = exhibit.place.y + exhibit.topY + lift + exhibit.focusHeight
            let framing = focusFraming(hallPort, halfWidth: exhibit.focusHalfWidth, halfHeight: exhibit.focusHalfHeight)
            let axisY = centerY + framing.offsetY
            camTarget.position = [exhibit.place.x + framing.offsetX, axisY, HallMetrics.itemZ + framing.distance]
            camTarget.look = [exhibit.place.x + framing.offsetX, axisY, HallMetrics.itemZ]
        } else if let layout, !exhibits.isEmpty, !inLocker {
            let spot = layout.place(layout.along(rail))
            let lean = min(max(velocity * 0.14, -0.7), 0.7)
            let ease = intro * intro
            // Between two exhibits, the framing slides from one to the next.
            let t = min(max(rail, 0), Float(exhibits.count - 1))
            let low = Int(t.rounded(.down)), high = min(exhibits.count - 1, low + 1), f = t - Float(low)
            let a = hallFraming(low), b = hallFraming(high)
            let distance = a.distance + (b.distance - a.distance) * f
            let offsetY = a.offsetY + (b.offsetY - a.offsetY) * f
            let centreY = a.centreY + (b.centreY - a.centreY) * f
            let aim = spot.y + centreY + offsetY
            let eye = aim + distance * 0.16
            let z = HallMetrics.itemZ + distance
            if layout.vertical {
                camTarget.position = [spot.x, eye + ease * 2.2 - lean * 0.55, z + ease * 6.6]
                camTarget.look = [spot.x, aim + ease * 0.25 - lean * 1.6, HallMetrics.itemZ]
            } else {
                camTarget.position = [spot.x + lean * 0.55, eye + ease * 2.2, z + ease * 6.6]
                camTarget.look = [spot.x + lean * 1.6, aim + ease * 0.25, HallMetrics.itemZ]
            }
        }

        let locker = inLocker
        let camera = locker ? lockerCamera : cameraNode
        var speed: Float = (mode == .focus || mode == .lockerFocus) ? 5.4 : 4.2
        if calm { speed *= 2.2 }
        var position = camera.simdPosition
        var look = locker ? lockerLook : lookAt
        if snap {
            position = camTarget.position
            look = camTarget.look
        } else {
            position.x = damp(position.x, camTarget.position.x, speed, dt)
            position.y = damp(position.y, camTarget.position.y, speed, dt)
            position.z = damp(position.z, camTarget.position.z, speed, dt)
            look.x = damp(look.x, camTarget.look.x, speed, dt)
            look.y = damp(look.y, camTarget.look.y, speed, dt)
            look.z = damp(look.z, camTarget.look.z, speed, dt)
        }
        if locker { lockerLook = look } else { lookAt = look }
        camera.simdPosition = position
        camera.simdLook(at: look, up: [0, 1, 0], localFront: [0, 0, -1])
        let lens = CGFloat(fov(locker ? lockerPort : hallPort).vertical * 180 / .pi)
        if abs((camera.camera?.fieldOfView ?? lens) - lens) > 0.01 { camera.camera?.fieldOfView = lens }
    }

    // MARK: Navigation

    func goTo(_ index: Int, exitFocus leave: Bool = false) {
        if leave, mode == .focus { exitFocus() }
        railTarget = Float(max(0, min(exhibits.count - 1, index)))
        velocity = 0
        if mode == .focus {
            focusIndex = Int(railTarget)
            rail = railTarget
            resetFocusPose()
        }
    }

    func goToWing(_ wing: TrophyWing) {
        guard !inLocker else { return }
        goTo(wing.start, exitFocus: true)
    }

    func step(_ direction: Int) {
        if mode == .lockerFocus { stepLocker(direction); return }
        if mode == .focus {
            let next = max(0, min(exhibits.count - 1, focusIndex + direction))
            guard next != focusIndex else { return }
            focusIndex = next
            rail = Float(next)
            railTarget = rail
            resetFocusPose()
            return
        }
        goTo(Int(railTarget.rounded()) + direction)
    }

    private func resetFocusPose() {
        focusYaw = 0
        focusPitch = 0
        focusZoom = 1
    }

    /// The nameplate is the same door the exhibit is.
    func inspectCurrent() {
        guard mode == .hall, let item = currentItem else { return }
        if item.opensLocker, let ownerId = item.ownerId { openLocker(ownerId) } else { focusExhibit(current) }
    }

    func focusExhibit(_ index: Int) {
        guard mode != .intro, !exhibits.isEmpty else { return }
        let i = max(0, min(exhibits.count - 1, index))
        if exhibits[i].item.opensLocker, let ownerId = exhibits[i].item.ownerId { openLocker(ownerId); return }
        mode = .focus
        focusIndex = i
        rail = Float(i)
        railTarget = rail
        velocity = 0
        showHint = false
        resetFocusPose()
    }

    func exitFocus() {
        guard mode == .focus else { return }
        railTarget = Float(focusIndex)
        rail = railTarget
        mode = .hall
        focusIndex = -1
    }

    /// The links a record gets natively on top of the site's: the team's own
    /// season page, wherever the exhibit names one team in one season.
    private func teamRoutes(_ item: TrophyExhibit) -> [TrophyRecord.RouteLink] {
        guard let year = item.year, let ownerId = item.ownerId, let season = summary?.season(year),
              let (teamId, team) = season.teams.first(where: { $0.value.ownerId == ownerId }) else { return [] }
        return [.init(label: "\(team.name) · \(year)", route: .team(year: year, teamId: teamId))]
    }

    // MARK: Lockers and links

    /// A manager's shield is a door: their locker is pushed on the stack.
    func openLocker(_ ownerId: String) {
        guard hall?.lockers[ownerId] != nil, lockerDepth == nil, !inLocker else { return }
        showHint = false
        lockerDepth = path.count + 1
        push(TrophyRoute.locker(ownerId: ownerId))
    }

    /// A league page (a season, a manager, a team) from a record's links:
    /// the sheet goes down and the page is pushed on the trophy room's stack.
    func open(_ route: LeagueRoute) {
        push(route)
    }

    /// Down with the inspect sheet, then in with the page. A sheet is let go
    /// first; an inspector column beside the room needs no wait.
    private func push<Route: Hashable>(_ route: Route) {
        let port = inLocker ? lockerPort : hallPort
        let wait = focused && (sheetSize.map { $0.width >= port.frame.width * 0.8 } ?? false)
        if mode == .lockerFocus { exitLockerFocus() } else { exitFocus() }
        guard wait else { path.append(route); return }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(320))
            path.append(route)
        }
    }

    /// The stack changed: popped below the locker means it was left.
    func pathChanged() {
        if let depth = lockerDepth, path.count < depth { leaveLocker() }
    }

    /// The locker's page appeared: build its wall (once) in the locker's scene.
    func enterLocker(_ ownerId: String) async {
        guard let hall, let locker = hall.lockers[ownerId], let kit else { return }
        if lockerId == ownerId, lockerWall != nil { return }
        lockerReady = false
        exitFocus()
        lockerId = ownerId
        mode = .locker
        lockerIndex = -1
        lockerPan = .zero
        wallZoom = 1
        let narrow = upright(lockerPort.size)
        let build = await Task.detached(priority: .userInitiated) { buildLockerWall(kit: kit, locker: locker, narrow: narrow) }.value
        // Popped while it was being built.
        guard lockerId == ownerId, inLocker else { return }
        installLocker(build, locker: locker)
        updateCameraTarget(dt: 1, snap: true)
        withAnimation(.easeOut(duration: calm ? 0.2 : 0.45)) { lockerReady = true }
    }

    private func installLocker(_ build: LockerWallBuild, locker: TrophyLocker) {
        lockerWall?.room.removeFromParentNode()
        lockerWall = build
        lockerId = locker.ownerId
        lockerRecords = build.items.map(\.record)
        lockerScene.rootNode.addChildNode(build.room)
    }

    private func rebuildLocker(_ locker: TrophyLocker, keepFocus: Bool) {
        guard let kit else { return }
        let focused = mode == .lockerFocus ? lockerIndex : -1
        let build = buildLockerWall(kit: kit, locker: locker, narrow: upright(lockerPort.size))
        installLocker(build, locker: locker)
        lockerPan = .zero
        wallZoom = 1
        if keepFocus, focused >= 0 { lockerIndex = min(focused, build.items.count - 1) }
    }

    /// Back in the hall, standing where you were: in front of the manager's shield.
    private func leaveLocker() {
        lockerDepth = nil
        let returning = lockerId
        lockerWall?.room.removeFromParentNode()
        lockerWall = nil
        lockerId = nil
        lockerIndex = -1
        lockerRecords = []
        lockerReady = false
        mode = .hall
        if let shield = hall?.rail.first(where: { $0.wing == "hall" && $0.ownerId == returning }) {
            rail = Float(shield.railIndex)
            railTarget = rail
        }
        velocity = 0
        updateCameraTarget(dt: 1, snap: true)
    }

    func focusLockerItem(_ index: Int) {
        guard let wall = lockerWall, wall.items.indices.contains(index) else { return }
        mode = .lockerFocus
        lockerIndex = index
        resetFocusPose()
    }

    func exitLockerFocus() {
        guard mode == .lockerFocus else { return }
        mode = .locker
        lockerIndex = -1
    }

    func stepLocker(_ direction: Int) {
        guard let wall = lockerWall, mode == .lockerFocus else { return }
        let next = max(0, min(wall.items.count - 1, lockerIndex + direction))
        if next != lockerIndex { focusLockerItem(next) }
    }

    func closeSheet() {
        if mode == .lockerFocus { exitLockerFocus() } else { exitFocus() }
    }

    // MARK: Input

    @ObservationIgnored private var startRail: Float = 0
    @ObservationIgnored private var startYaw: Float = 0
    @ObservationIgnored private var startPitch: Float = 0
    @ObservationIgnored private var startPan = SIMD2<Float>(0, 0)
    @ObservationIgnored private var movedAlong: CGFloat = 0
    @ObservationIgnored private var zoomStart: Float = 1

    /// Whether a gesture on `room`'s view is for the room on show.
    private func live(_ room: Room) -> Bool { mode != .intro && (room == .locker) == inLocker }

    func panBegan(in room: Room) {
        guard live(room) else { return }
        dragging = true
        movedAlong = 0
        startRail = rail
        startYaw = focusYaw
        startPitch = focusPitch
        startPan = lockerPan
        velocity = 0
        showHint = false
    }

    func panChanged(translation t: CGPoint, velocity v: CGPoint) {
        guard dragging else { return }
        let dx = Float(t.x), dy = Float(t.y)
        switch mode {
        case .focus, .lockerFocus:
            // Drag right and it turns to show its right side; drag down and it tips.
            focusYaw = startYaw + dx * 0.0085
            focusPitch = min(max(startPitch + dy * 0.0055, -0.55), 0.55)
        case .locker:
            let metresPerPixel = wallFraming().distance * 0.0016
            lockerPan.x = min(max(startPan.x - dx * metresPerPixel, -3.2), 3.2)
            lockerPan.y = min(max(startPan.y + dy * metresPerPixel, -2.6), 2.6)
        case .hall:
            let vertical = layout?.vertical ?? true
            let along = vertical ? dy : dx
            let span = Float(vertical ? hallPort.size.height : hallPort.size.width)
            let stopsPerPixel = 4.2 / max(360, span)
            movedAlong = max(movedAlong, CGFloat(abs(along)))
            rail = min(max(startRail - along * stopsPerPixel, -0.4), Float(exhibits.count) - 0.6)
            velocity = -Float(vertical ? v.y : v.x) * stopsPerPixel
        case .intro:
            break
        }
    }

    func panEnded() {
        guard dragging else { return }
        dragging = false
        if mode == .hall, movedAlong >= 9 {
            // Carry the flick a little way, then let the stops pull the camera in.
            let projected = rail + min(max(velocity * 0.28, -3.2), 3.2)
            railTarget = Float(max(0, min(exhibits.count - 1, Int(projected.rounded()))))
        } else if mode == .hall {
            railTarget = Float(max(0, min(exhibits.count - 1, Int(rail.rounded()))))
        }
    }

    func pinch(_ scale: CGFloat, began: Bool, in room: Room) {
        guard live(room) else { return }
        if began { zoomStart = mode == .locker ? wallZoom : focusZoom }
        if mode == .focus || mode == .lockerFocus {
            focusZoom = min(max(zoomStart / Float(scale), 0.62), 2.2)
        } else if mode == .locker {
            wallZoom = min(max(zoomStart * Float(scale), 0.85), 3.2)
        }
    }

    func tap(at point: CGPoint, in room: Room) {
        guard live(room) else { return }
        showHint = false
        if inLocker {
            guard let wall = lockerWall, let view = lockerView else { return }
            let hits = view.hitTest(point, options: [.searchMode: SCNHitTestSearchMode.closest.rawValue,
                                                    .ignoreHiddenNodes: true, .rootNode: wall.room,
                                                    .categoryBitMask: TrophyCategory.solid])
            guard let index = hits.lazy.compactMap({ Self.tagged($0.node, "locker:") }).first else {
                if mode == .lockerFocus { exitLockerFocus() }
                return
            }
            if mode == .lockerFocus, index == lockerIndex { exitLockerFocus() } else { focusLockerItem(index) }
            return
        }
        guard let view else { return }
        let hits = view.hitTest(point, options: [.searchMode: SCNHitTestSearchMode.closest.rawValue,
                                                .ignoreHiddenNodes: true, .rootNode: exhibitRoot,
                                                .categoryBitMask: TrophyCategory.solid])
        guard let index = hits.lazy.compactMap({ Self.tagged($0.node, "exhibit:") }).first else {
            if mode == .focus { exitFocus() }
            return
        }
        let item = exhibits[index].item
        // A manager in the hall of fame is a door, not an exhibit.
        if item.opensLocker, let ownerId = item.ownerId { openLocker(ownerId); return }
        if mode == .focus {
            if index == focusIndex { exitFocus() } else { focusIndex = index; rail = Float(index); railTarget = rail; resetFocusPose() }
            return
        }
        focusExhibit(index)
    }

    private static func tagged(_ node: SCNNode, _ prefix: String) -> Int? {
        var node: SCNNode? = node
        while let n = node {
            if let name = n.name, name.hasPrefix(prefix) { return Int(name.dropFirst(prefix.count)) }
            node = n.parent
        }
        return nil
    }
}

/// CADisplayLink keeps its target strongly; this keeps the stage out of that.
private final class DisplayTarget: NSObject {
    weak var stage: TrophyStage?
    init(_ stage: TrophyStage) { self.stage = stage }
    @objc func tick(_ link: CADisplayLink) {
        MainActor.assumeIsolated { stage?.tick(link.targetTimestamp) }
    }
}

// MARK: Exhibits

/// One exhibit on its pedestal, and what the camera needs to frame it.
final class Exhibit {
    let index: Int
    let item: TrophyExhibit
    let stand = SCNNode()
    let riser = SCNNode()
    let pivot = SCNNode()
    let spinner = SCNNode()
    let shadow: SCNNode
    let topY: Float
    let focusHeight: Float
    let focusHalfWidth: Float
    let focusHalfHeight: Float
    let spin: [(node: SCNNode, speed: Float)]
    let glints: [SCNNode]
    let sway: Float
    let idlePhase = Float.random(in: 0..<(2 * .pi))
    var place = SIMD3<Float>(0, 0, 0)

    init(index: Int, item: TrophyExhibit, kit: TrophyKit) {
        self.index = index
        self.item = item
        topY = HallMetrics.plinthHeight(item.kind)
        let pedestal = kit.pedestal(item, height: topY)
        riser.simdPosition.y = topY
        let sculpture = kit.exhibit(item)
        spinner.addChildNode(sculpture.node)

        // Measure what was built: half-width is the footprint's diagonal,
        // because the piece turns under the finger and must stay in frame.
        let bounds = Bounds.of(sculpture.node)
        let size = bounds.max - bounds.min
        focusHeight = (bounds.min.y + bounds.max.y) / 2
        focusHalfWidth = hypot(size.x, size.z) / 2
        focusHalfHeight = size.y / 2
        pivot.addChildNode(spinner)
        riser.addChildNode(pivot)

        shadow = SCNNode()
        shadow.addChildNode(contactShadow(kit: kit, radius: 0.95, opacity: 0.6))

        let glintMaterial = TrophyMaterials.glow(kit.mat.image("glint") { Paint.glint() }, additive: true)
        glintMaterial.multiply.contents = UIColor(trophyRGB: 0xFFF0CF)
        glintMaterial.readsFromDepthBuffer = true
        let glintGeometry = kit.geometry("glint") { Mesh.plane(0.34, 0.34) }
        glints = sculpture.glints.map { offset in
            let node = SCNNode.shared(glintGeometry, glintMaterial, at: offset)
            node.constraints = [SCNBillboardConstraint()]
            node.isHidden = true
            node.renderingOrder = 3
            _ = node.decorative()
            return node
        }
        glints.forEach(spinner.addChildNode)

        spin = sculpture.spin
        sway = sculpture.faceForward ? 0.07 : 0.2
        stand.name = "exhibit:\(index)"
        stand.adding(shadow, pedestal, riser)
    }
}
