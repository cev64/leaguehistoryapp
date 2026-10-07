import SceneKit
import SwiftUI

/// The trophy room's own pages on its navigation stack.
enum TrophyRoute: Hashable {
    /// A manager's locker, opened from their shield in the hall of fame.
    case locker(ownerId: String)
}

/// The trophy room (trophy.html): the league's 3D hall of champions, the hall
/// of fame, the record and lowlight walls and the cellar, with a locker for
/// every manager. The room is SceneKit, the hero of the page; around it is the
/// app's own chrome: a navigation bar, the rooms as glass chips along the top,
/// the exhibit's nameplate in glass above the tab bar, an inspect sheet, and
/// lockers pushed like any other page.
struct TrophyRoomScreen: View {
    @Environment(LeagueSession.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var stage = TrophyStage()

    var body: some View {
        NavigationStack(path: $stage.path) {
            TrophyHallView(stage: stage)
                .navigationDestination(for: TrophyRoute.self) { route in
                    switch route {
                    case .locker(let ownerId):
                        TrophyLockerView(stage: stage, ownerId: ownerId)
                    }
                }
                .leagueDestinations()
        }
        .onChange(of: stage.path.count) { stage.pathChanged() }
        .task {
            stage.calm = reduceMotion
            await stage.load(session: session)
        }
        .onChange(of: reduceMotion) { _, calm in stage.calm = calm }
    }
}

// MARK: The hall

private struct TrophyHallView: View {
    @Environment(LeagueSession.self) private var session
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Bindable var stage: TrophyStage

    private var ready: Bool { stage.phase == .ready }
    /// A phone on its side: the nameplate row alone, to leave the room its height.
    private var short: Bool { verticalSizeClass == .compact }

    var body: some View {
        ZStack {
            RoomCanvas(stage: stage, room: .hall)
            if ready, stage.showHint, !stage.focused {
                VStack {
                    Spacer()
                    HintPill(text: stage.upright
                             ? "Swipe up to walk the hall · tap a trophy to inspect it"
                             : "Drag to walk the hall · tap a trophy to inspect it")
                }
                .padding(.bottom, 10)
                .padding(.horizontal, 16)
                .allowsHitTesting(false)
                .transition(.opacity)
            }
            switch stage.phase {
            case .ready: EmptyView()
            case .loading: TrophyDoorway(note: nil)
            case .failed(let message): TrophyDoorway(note: message)
            }
        }
        .animation(.easeInOut(duration: 0.4), value: stage.showHint)
        .safeAreaBar(edge: .top) {
            if ready, let hall = stage.hall, let item = stage.currentItem {
                WingChips(wings: hall.wings, active: item.wing, calm: stage.calm) { stage.goToWing($0) }
                    .padding(.vertical, 6)
            }
        }
        .safeAreaBar(edge: .bottom) {
            if ready {
                HallControls(stage: stage, short: short)
            }
        }
        // The room is always lit for night: its bars read light on dark.
        .environment(\.colorScheme, .dark)
        // Inside the title and toolbar, so the panel's room never covers the bar.
        .modifier(RecordPresenter(stage: stage, shown: stage.mode == .focus) { stage.exitFocus() })
        .navigationTitle("The Hall")
        .navigationSubtitle(session.summary?.name ?? "League trophy room")
        .toolbarTitleDisplayMode(.inlineLarge)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .leagueToolbar()
        .onAppear { stage.setVisible(.hall, true) }
        .onDisappear { stage.setVisible(.hall, false) }
    }
}

/// The nameplate under the exhibit in front of you, between its arrows; the
/// wings as a rail; and the count and the league's line under it.
private struct HallControls: View {
    @Bindable var stage: TrophyStage
    let short: Bool

    var body: some View {
        if let hall = stage.hall, let item = stage.currentItem {
            VStack(spacing: 8) {
                GlassEffectContainer(spacing: 10) {
                    HStack(spacing: 10) {
                        StepButton(symbol: "chevron.left", label: "Previous exhibit") { stage.step(-1) }
                            .disabled(stage.current == 0)
                        Nameplate(item: item, short: short) { stage.inspectCurrent() }
                        StepButton(symbol: "chevron.right", label: "Next exhibit") { stage.step(1) }
                            .disabled(stage.current >= hall.rail.count - 1)
                    }
                }
                if !short {
                    WingProgress(wings: hall.wings, active: item.wing)
                        .padding(.horizontal, 6)
                    HStack(spacing: 6) {
                        Text("\(item.itemIndex + 1) / \(hall.wings[item.wingIndex].count)")
                            .monospacedDigit()
                        Text("·")
                        Text(hall.summary.line).lineLimit(1).minimumScaleFactor(0.75)
                    }
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.secondary)
                    .accessibilityElement(children: .combine)
                }
            }
            .frame(maxWidth: 600)
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 8)
            .frame(maxWidth: .infinity)
        }
    }
}

// MARK: A locker

/// One manager's locker, pushed from their shield: the wall in its own room,
/// the system's back button (and swipe) to the hall.
private struct TrophyLockerView: View {
    @Bindable var stage: TrophyStage
    let ownerId: String

    private var locker: TrophyLocker? { stage.hall?.lockers[ownerId] }
    private var ready: Bool { stage.lockerReady && stage.lockerId == ownerId }

    var body: some View {
        ZStack {
            RoomCanvas(stage: stage, room: .locker)
            if !ready, let locker {
                LockerCurtain(locker: locker, logo: stage.hall?.logos[ownerId])
                    .transition(.opacity)
            }
        }
        .safeAreaBar(edge: .bottom) {
            if ready, stage.mode == .locker, let locker {
                VStack(spacing: 8) {
                    Text(locker.summary)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                    HintPill(text: stage.upright
                             ? "Tap anything on the wall to see it up close"
                             : "Drag to look around the wall · tap anything to see it up close")
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
                .transition(.opacity)
            }
        }
        .animation(.smooth(duration: 0.3), value: stage.mode == .locker)
        .environment(\.colorScheme, .dark)
        .modifier(RecordPresenter(stage: stage, shown: stage.mode == .lockerFocus) { stage.exitLockerFocus() })
        .navigationTitle(locker?.team ?? "Team Locker")
        .navigationSubtitle(locker.map { "Team Locker · \($0.name)" } ?? "Team Locker")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task(id: ownerId) { await stage.enterLocker(ownerId) }
        .onAppear { stage.setVisible(.locker, true) }
        .onDisappear { stage.setVisible(.locker, false) }
    }
}

/// The curtain a locker is built behind: the team's colour and crest.
private struct LockerCurtain: View {
    let locker: TrophyLocker
    let logo: String?

    var body: some View {
        let tint = Color(css: locker.color) ?? Theme.gold
        ZStack {
            LinearGradient(colors: [tint.opacity(0.9), Color(hex: 0x070D17)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
            VStack(spacing: 16) {
                ZStack {
                    Circle().strokeBorder(.white.opacity(0.35), lineWidth: 2).frame(width: 96, height: 96)
                    TeamBadge(name: locker.team, icon: locker.icon ?? "🏈", color: locker.color, logo: logo, size: 72)
                }
                Text("Opening \(locker.team)")
                    .displayStyle(22)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
            }
            .padding(24)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: The scene

/// A room's SceneKit view, under the bars (it is the page's backdrop), telling
/// the stage how much of it the bars cover so the camera frames what is clear:
/// the scene's full frame against the frame of the safe area inside the bars.
private struct RoomCanvas: View {
    let stage: TrophyStage
    let room: TrophyStage.Room
    @State private var full: CGRect = .zero
    @State private var safe: CGRect = .zero

    var body: some View {
        Color.clear
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { safe = $0; report() }
            .background {
                TrophySceneView(stage: stage, room: room)
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { full = $0; report() }
                    .ignoresSafeArea()
                    .background(Color(hex: 0x070D17))
            }
    }

    private func report() {
        guard full.width > 100, full.height > 100, safe.height > 0 else { return }
        stage.viewport(room, TrophyStage.Port(frame: full,
                                              top: max(0, safe.minY - full.minY),
                                              bottom: max(0, full.maxY - safe.maxY),
                                              leading: max(0, safe.minX - full.minX),
                                              trailing: max(0, full.maxX - safe.maxX)))
    }
}

private struct TrophySceneView: UIViewRepresentable {
    let stage: TrophyStage
    let room: TrophyStage.Room

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView(frame: .zero, options: [SCNView.Option.preferredRenderingAPI.rawValue: SCNRenderingAPI.metal.rawValue])
        view.scene = room == .hall ? stage.scene : stage.lockerScene
        view.pointOfView = room == .hall ? stage.cameraNode : stage.lockerCamera
        view.backgroundColor = UIColor(trophyRGB: 0x070D17)
        view.antialiasingMode = .multisampling4X
        view.preferredFramesPerSecond = 60
        view.rendersContinuously = true
        view.isPlaying = true
        view.isUserInteractionEnabled = true
        if room == .hall { stage.view = view } else { stage.lockerView = view }

        let pan = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.pan(_:)))
        pan.maximumNumberOfTouches = 1
        let pinch = UIPinchGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.pinch(_:)))
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tap(_:)))
        [pan, pinch, tap].forEach {
            $0.delegate = context.coordinator
            view.addGestureRecognizer($0)
        }
        view.isAccessibilityElement = true
        if room == .hall {
            view.accessibilityLabel = "The trophy hall"
            view.accessibilityHint = "Use the buttons below to walk the hall and inspect each exhibit."
        } else {
            view.accessibilityLabel = "The team's locker wall"
            view.accessibilityHint = "Tap a piece to see it up close."
        }
        return view
    }

    func updateUIView(_ view: SCNView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(stage: stage, room: room) }

    @MainActor
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        let stage: TrophyStage
        let room: TrophyStage.Room
        init(stage: TrophyStage, room: TrophyStage.Room) {
            self.stage = stage
            self.room = room
        }

        @objc func pan(_ g: UIPanGestureRecognizer) {
            switch g.state {
            case .began: stage.panBegan(in: room); fallthrough
            case .changed: stage.panChanged(translation: g.translation(in: g.view), velocity: g.velocity(in: g.view))
            default: stage.panEnded()
            }
        }

        @objc func pinch(_ g: UIPinchGestureRecognizer) {
            switch g.state {
            case .began: stage.pinch(g.scale, began: true, in: room)
            case .changed: stage.pinch(g.scale, began: false, in: room)
            default: break
            }
        }

        @objc func tap(_ g: UITapGestureRecognizer) {
            stage.tap(at: g.location(in: g.view), in: room)
        }

        func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
            // Leave the leading edge of a locker to the system's swipe back.
            if room == .locker, g is UIPanGestureRecognizer, let view = g.view {
                let x = g.location(in: view).x
                let leading = view.effectiveUserInterfaceLayoutDirection == .rightToLeft ? view.bounds.width - x : x
                if leading < 28 { return false }
            }
            return true
        }

        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            g is UIPinchGestureRecognizer || other is UIPinchGestureRecognizer
        }
    }
}

// MARK: Chrome

private struct HintPill: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.footnote.weight(.medium))
            .foregroundStyle(.primary)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .glassEffect(.regular, in: Capsule())
    }
}

private struct StepButton: View {
    let symbol: String
    let label: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .bold))
                .frame(width: 30, height: 40)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .accessibilityLabel(label)
    }
}

/// The nameplate under the exhibit in front of you; it is also the door.
private struct Nameplate: View {
    let item: TrophyExhibit
    let short: Bool
    let action: () -> Void

    private var sub: String {
        if item.kind == "plaque" { return "\(item.bigValue ?? "") · \(item.subtitle ?? "")" }
        let owner = (item.owner != nil && item.owner != item.subtitle) ? " · \(item.owner!)" : ""
        return "\(item.subtitle ?? "")\(owner)"
    }

    var body: some View {
        let accent = Color(css: item.accent) ?? Theme.gold
        Button(action: action) {
            VStack(spacing: 2) {
                Text(item.wingName)
                    .font(.system(size: 10, weight: .bold))
                    .tracking(1.6)
                    .textCase(.uppercase)
                    .foregroundStyle(accent)
                Text(item.title)
                    .displayStyle(short ? 20 : 24)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(sub)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                if !short {
                    Text(item.opensLocker ? "Open team locker →" : "Tap to inspect")
                        .font(.system(size: 10, weight: .semibold))
                        .tracking(1.2)
                        .textCase(.uppercase)
                        .foregroundStyle(accent.opacity(0.9))
                        .padding(.top, 2)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, short ? 6 : 10)
            .padding(.horizontal, 12)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .accessibilityLabel("\(item.wingName): \(item.title), \(sub)")
        .accessibilityHint(item.opensLocker ? "Opens the team locker" : "Inspects this exhibit")
        .id(item.id)
    }
}

/// The rail, a segment per wing sized by how many exhibits it holds.
private struct WingProgress: View {
    let wings: [TrophyWing]
    let active: String

    var body: some View {
        GeometryReader { proxy in
            let total = CGFloat(max(1, wings.reduce(0) { $0 + $1.count }))
            let gap: CGFloat = 4
            let room = proxy.size.width - gap * CGFloat(max(0, wings.count - 1))
            HStack(spacing: gap) {
                ForEach(wings) { wing in
                    Capsule()
                        .fill((Color(css: wing.accent) ?? Theme.gold).opacity(wing.id == active ? 1 : 0.28))
                        .frame(width: max(4, room * CGFloat(wing.count) / total))
                }
            }
        }
        .frame(height: 3)
        .animation(.easeInOut(duration: 0.3), value: active)
        .accessibilityHidden(true)
    }
}

/// The rooms, as glass chips: "Champions 4", "Hall of Fame 10", "Record Wall 10"…
private struct WingChips: View {
    let wings: [TrophyWing]
    let active: String
    let calm: Bool
    let go: (TrophyWing) -> Void

    var body: some View {
        ScrollViewReader { reader in
            ScrollView(.horizontal, showsIndicators: false) {
                GlassEffectContainer(spacing: 8) {
                    HStack(spacing: 8) {
                        ForEach(wings) { wing in
                            let tint = Color(css: wing.accent) ?? Theme.gold
                            let on = wing.id == active
                            Button {
                                go(wing)
                            } label: {
                                HStack(spacing: 6) {
                                    Text(wing.name).font(.subheadline.weight(.semibold))
                                    Text("\(wing.count)")
                                        .font(.caption.weight(.bold))
                                        .monospacedDigit()
                                        .foregroundStyle(on ? Color(hex: 0x0B1726) : tint)
                                }
                                .foregroundStyle(on ? Color(hex: 0x0B1726) : .white)
                                .padding(.horizontal, 2)
                            }
                            .buttonStyle(.glass(on ? .regular.tint(tint).interactive() : .regular.interactive()))
                            .id(wing.id)
                            .accessibilityLabel("\(wing.name), \(wing.count) exhibits")
                            .accessibilityAddTraits(on ? .isSelected : [])
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 2)
                }
            }
            .scrollClipDisabled()
            .onChange(of: active) { _, id in
                withAnimation(calm ? nil : .smooth) { reader.scrollTo(id, anchor: .center) }
            }
            .onAppear { reader.scrollTo(active, anchor: .center) }
        }
    }
}

// MARK: The inspect sheet

/// Where the record goes: a sheet with detents on a phone held upright (an
/// inspector column on a wide screen); on a phone on its side, where a sheet
/// would cover the room, a glass panel down the trailing side.
private struct RecordPresenter: ViewModifier {
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let stage: TrophyStage
    let shown: Bool
    let dismiss: () -> Void

    // A glass panel floating at the side of the room, on every screen with
    // the width for one: an inspector would take the navigation bar with it
    // on iPad (the sidebar's button among it).
    func body(content: Content) -> some View {
        if verticalSizeClass == .compact || sizeClass == .regular {
            content
                .safeAreaBar(edge: .trailing) {
                    if shown {
                        RecordPanel(stage: stage)
                            .frame(width: 340)
                            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
                            .padding(.vertical, 8)
                            .padding(.trailing, 8)
                            .transition(reduceMotion ? .opacity : .move(edge: .trailing).combined(with: .opacity))
                    }
                }
                .animation(.smooth(duration: 0.3), value: shown)
        } else {
            content
                .inspector(isPresented: Binding(get: { shown }, set: { if !$0 { dismiss() } })) {
                    RecordPanel(stage: stage)
                }
        }
    }
}

/// The exhibit's record (the site's #sheet): wing, the big title, who, the
/// blurb, the stats and the links. A sheet with detents on a phone, so the
/// piece stays in view above it and can still be turned; an inspector column
/// beside the room on a wide screen.
private struct RecordPanel: View {
    @Bindable var stage: TrophyStage
    @Environment(\.colorScheme) private var scheme
    @State private var detent: PresentationDetent = .fraction(0.4)

    var body: some View {
        Group {
            if let record = stage.record {
                content(record)
            } else {
                Color.clear
            }
        }
        .presentationDetents([.fraction(0.4), .medium, .large], selection: $detent)
        .presentationBackgroundInteraction(.enabled(upThrough: .medium))
        .presentationContentInteraction(.scrolls)
        .inspectorColumnWidth(min: 320, ideal: 360, max: 420)
        .onGeometryChange(for: CGSize.self) { $0.size } action: { stage.sheet(size: $0) }
        .onDisappear { stage.sheet(size: nil) }
    }

    private func content(_ record: TrophyRecord) -> some View {
        let accent = TrophyInk.readable(record.accent, on: scheme)
        return ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header(record, accent: accent)
                if !record.blurb.isEmpty {
                    Text(record.blurb)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !record.stats.isEmpty { stats(record) }
                links(record, accent: accent)
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollBounceBehavior(.basedOnSize)
        .safeAreaBar(edge: .bottom) { foot }
        .id(record.title + record.kicker)
    }

    private func header(_ record: TrophyRecord, accent: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(record.kicker)
                    .font(.caption.weight(.bold))
                    .tracking(1.6)
                    .textCase(.uppercase)
                    .foregroundStyle(accent)
                Spacer()
                Button {
                    stage.closeSheet()
                } label: {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .accessibilityLabel(stage.inLocker ? "Back to the wall" : "Back to the hall")
            }
            Text(record.title)
                .displayStyle(32)
                .foregroundStyle(.primary)
                .lineLimit(2)
                .minimumScaleFactor(0.6)
            Text("\(Text(record.lead).bold().foregroundStyle(.primary))\(Text(record.rest.map { " · \($0)" } ?? "").foregroundStyle(.secondary))")
                .font(.subheadline)
                .lineLimit(2)
        }
    }

    private func stats(_ record: TrophyRecord) -> some View {
        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 8) {
            ForEach(record.stats, id: \.self) { stat in
                GridRow {
                    Text(stat.label)
                        .font(.caption.weight(.semibold))
                        .tracking(0.8)
                        .textCase(.uppercase)
                        .foregroundStyle(.secondary)
                    Text(stat.value)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .monospacedDigit()
                        .fixedSize(horizontal: false, vertical: true)
                }
                Divider().gridCellColumns(2)
            }
        }
    }

    @ViewBuilder private func links(_ record: TrophyRecord, accent: Color) -> some View {
        let rows: [(String, LeagueRoute)] = record.links.compactMap { link in link.route.map { (link.label, $0) } }
            + record.routes.map { ($0.label, $0.route) }
        if !rows.isEmpty {
            VStack(spacing: 8) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    Button {
                        stage.open(row.1)
                    } label: {
                        HStack {
                            Text(row.0).font(.subheadline.weight(.semibold)).lineLimit(1)
                            Spacer()
                            Image(systemName: "chevron.right").font(.footnote.weight(.bold))
                        }
                        .foregroundStyle(.primary)
                        .padding(.vertical, 4)
                        .frame(maxWidth: .infinity)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.glass(.regular.tint(accent.opacity(0.18)).interactive()))
                }
            }
        }
    }

    private var foot: some View {
        HStack {
            Text("Drag to turn · pinch to zoom")
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
            Spacer()
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) {
                    StepButton(symbol: "chevron.left", label: "Previous") { stage.step(-1) }
                    StepButton(symbol: "chevron.right", label: "Next") { stage.step(1) }
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
    }
}

/// An exhibit's accent made to read on the sheet: the wings' pale accents
/// darkened on a light sheet, a dark team colour lifted on a dark one.
enum TrophyInk {
    static func readable(_ css: String?, on scheme: ColorScheme) -> Color {
        var color = UIColor(trophyHex: css, fallback: 0xF2C14A)
        let target: CGFloat = scheme == .dark ? 0.5 : 0.32
        for _ in 0..<8 {
            let l = luminance(color)
            if scheme == .dark ? l >= target : l <= target { break }
            color = color.mixed(with: scheme == .dark ? .white : .black, 0.18)
        }
        return Color(color)
    }

    private static func luminance(_ c: UIColor) -> CGFloat {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.getRed(&r, green: &g, blue: &b, alpha: &a)
        func lin(_ v: CGFloat) -> CGFloat { v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }
}

// MARK: The doorway

/// The doorway the hall is built behind, and where a failure is explained.
private struct TrophyDoorway: View {
    let note: String?

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: 0x0B1626), Color(hex: 0x05090F)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
            VStack(spacing: 14) {
                Text("🏆").font(.system(size: 56))
                Text(note ?? "Championships, the managers who won them, the records nobody has beaten, and the seats at the very bottom of the table.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 340)
                if note == nil { ProgressView().tint(Theme.gold).padding(.top, 6) }
            }
            .padding(24)
        }
    }
}
