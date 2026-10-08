import SwiftUI

/// The front page (index.html): the pitch and the two ways forward (open
/// your league, explore the demo), the league finder, the headline
/// features, how it works, and a few questions. A signed-in member's
/// leagues are one tap away in the hero and in the finder.
struct HomeView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var finder = FinderModel.shared
    @State private var sheet: HomeSheet?

    enum HomeSheet: Identifiable {
        case auth(AuthView.Mode)
        case gate(AccountStore.PendingLeague)
        case account

        var id: String {
            switch self {
            case .auth: return "auth"
            case .gate(let p): return "gate-\(p.id)"
            case .account: return "account"
            }
        }
    }

    private var wide: Bool { sizeClass == .regular }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 0) {
                        if wide {
                            HStack(alignment: .top, spacing: 32) {
                                HomeHero(find: { scrollToFinder(proxy) }, wide: true)
                                    .frame(maxWidth: .infinity)
                                finderSection
                                    .frame(width: 440)
                                    .padding(.top, 20)
                            }
                            .padding(.horizontal, 32)
                            .padding(.bottom, 36)
                            .frame(maxWidth: 1180)
                            .frame(maxWidth: .infinity)
                            .background(HeroBackground().ignoresSafeArea(edges: .top))
                        } else {
                            HomeHero(find: { scrollToFinder(proxy) }, wide: false)
                                .padding(.horizontal, Theme.gutter)
                                .padding(.bottom, 32)
                                .frame(maxWidth: .infinity)
                                .background(HeroBackground().ignoresSafeArea(edges: .top))
                            finderSection
                                .padding(.horizontal, Theme.gutter)
                                .padding(.top, 24)
                        }

                        VStack(spacing: 36) {
                            FeaturesSection(wide: wide)
                            HowSection(wide: wide)
                            FAQSection()
                            FinalSection(find: { scrollToFinder(proxy) })
                        }
                        .padding(.horizontal, wide ? 32 : Theme.gutter)
                        .padding(.top, 36)
                        .padding(.bottom, 28)
                        .frame(maxWidth: 1180)
                        .frame(maxWidth: .infinity)
                    }
                }
                .scrollDismissesKeyboard(.interactively)
                .background(Theme.page)
                .task {
                    // Launch settings for checks (debug builds only).
                    #if DEBUG
                    if let name = ProcessInfo.processInfo.environment["PP_SLEEPER"], finder.username.isEmpty {
                        finder.username = name
                        Task { await finder.findLeagues(name) }
                    }
                    if let find = ProcessInfo.processInfo.environment["PP_FIND"] {
                        try? await Task.sleep(for: .milliseconds(600))
                        // PP_FIND=private: down to the ESPN private-league panel.
                        if find == "private" {
                            withAnimation { proxy.scrollTo("espnPrivate", anchor: .top) }
                        } else {
                            scrollToFinder(proxy)
                        }
                    }
                    #endif
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { accountButton }
            }
            // The site's bar along the top (landing.css .lp-nav): navy, over
            // the navy hero, with light words and a light status bar.
            .toolbarBackground(Color(hex: 0x071827), for: .navigationBar)
            .toolbarBackgroundVisibility(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
        .accountToast()
        .sheet(item: $sheet, onDismiss: {
            if !app.account.isSignedIn { app.account.pending = nil }
        }) { sheet in
            switch sheet {
            case .auth(let mode):
                AuthView(mode: mode)
                    .environment(app)
                    .presentationDetents([.large])
            case .gate(let pending):
                AuthView(mode: app.account.hasSignedInBefore ? .signin : .signup, pending: pending)
                    .environment(app)
                    .presentationDetents([.large])
            case .account:
                AccountScreen()
                    .environment(app)
            }
        }
        .onChange(of: app.account.pending) { _, new in
            if let new { sheet = .gate(new) }
        }
        .alert(app.account.gateFailure.map { "Couldn't add \($0.name)" } ?? "",
               isPresented: Binding(get: { app.account.gateFailure != nil }, set: { if !$0 { app.account.gateFailure = nil } }),
               presenting: app.account.gateFailure) { failure in
            Button("Try again") { app.open(failure.id) }
            Button("Choose another league", role: .cancel) {}
        } message: { failure in
            Text(failure.message)
        }
        .task {
            finder.start(account: app.account)
            if let pending = app.account.pending { sheet = .gate(pending) }
            // PP_HOME opens a sheet or a league at launch (debug builds only).
            #if DEBUG
            switch ProcessInfo.processInfo.environment["PP_HOME"] {
            case "signin": sheet = .auth(.signin)
            case "signup": sheet = .auth(.signup)
            case "account": sheet = .account
            case "gate": app.open("1312115646644912128", name: "D201: History of a Decade of Dynasty!", avatar: nil)
            case "espn", "espnkeys":
                finder.platform = .espn
                finder.keysAnyway = ProcessInfo.processInfo.environment["PP_HOME"] == "espnkeys"
                finder.setPrivateOpen(true)
                await debugEspnKeys()
            default: break
            }
            #endif
        }
    }

    /// Debug builds: PP_ESPN_KEYS=<n> saves n made-up sets of ESPN keys on
    /// this device (ESPN turns them away), and PP_ESPN_FORGET=1 then forgets
    /// the first, to see the private panel with several accounts.
    private func debugEspnKeys() async {
        #if DEBUG
        let env = ProcessInfo.processInfo.environment
        guard let n = env["PP_ESPN_KEYS"].flatMap(Int.init), n > 0 else { return }
        for i in 1...n {
            finder.s2 = "AEBfake" + String(repeating: "\(i)", count: 60)
            finder.swid = "{0000000\(i)-AAAA-BBBB-CCCC-DDDDEEEEFFF\(i)}"
            await finder.saveKeys(app: app, account: app.account)
        }
        if env["PP_ESPN_FORGET"] == "1", let first = finder.connected.first {
            await finder.forget(first, account: app.account)
        }
        #endif
    }

    private var finderSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Kicker(text: "Get started")
                Text("Open your league")
                    .displayStyle(32)
                    .foregroundStyle(Theme.ink)
                Text("Free, and it takes about a minute. Sleeper needs only your username; ESPN needs your league's ID or link.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                Button {
                    app.open("demo")
                } label: {
                    Text("Not ready? Look around the demo league \(Image(systemName: "arrow.right"))")
                        .font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.accentInk)
                .padding(.top, 2)
            }
            FinderStack(finder: finder, signIn: { sheet = .auth(.signin) })
        }
        .id("find")
    }

    private func scrollToFinder(_ proxy: ScrollViewProxy) {
        withAnimation(.smooth(duration: 0.5)) { proxy.scrollTo("find", anchor: .top) }
    }

    // MARK: The account button

    @ViewBuilder
    private var accountButton: some View {
        let account = app.account
        if account.isSignedIn {
            Menu {
                Section("\(account.displayName) · \(account.user?.email ?? "")") {
                    if account.leagues.isEmpty {
                        Text("No leagues yet")
                    }
                    ForEach(account.leagues) { l in
                        Button(l.title, systemImage: "football") {
                            app.open(l.league_id, name: l.name, avatar: l.avatar)
                        }
                    }
                }
                Button("Account & leagues", systemImage: "person.crop.circle") { sheet = .account }
                Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                    Task {
                        await account.signOut()
                        account.say("Signed out.")
                    }
                }
            } label: {
                Text(account.initials)
                    .font(.system(size: 13, weight: .heavy))
                    .foregroundStyle(Theme.navy)
                    .frame(width: 32, height: 32)
                    .background(Theme.gold.gradient, in: Circle())
            }
            .accessibilityLabel("Account: \(account.displayName)")
        } else {
            // Signed out: "Sign in", in words, where the site has its account button.
            Button {
                sheet = .auth(.signin)
            } label: {
                Text("Sign in")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Theme.navy)
            }
            .buttonStyle(.glassProminent)
            .tint(Theme.gold)
            .accessibilityHint("Sign in or create a free account")
        }
    }
}

// MARK: Hero

/// The navy hero (landing.css .lp-hero): yard lines, a blue glow and a gold
/// one, and the red line along its foot.
private struct HeroBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: 0x071827), Color(hex: 0x0D2238)], startPoint: .top, endPoint: .bottom)
            RadialGradient(colors: [Color(hex: 0x1769E0, alpha: 0.30), .clear], center: UnitPoint(x: 0.85, y: 0.12), startRadius: 0, endRadius: 420)
            RadialGradient(colors: [Color(hex: 0xF6B73C, alpha: 0.13), .clear], center: UnitPoint(x: 0.1, y: 1), startRadius: 0, endRadius: 360)
            Canvas { context, size in
                var x: CGFloat = 74
                while x < size.width {
                    context.fill(Path(CGRect(x: x, y: 0, width: 1, height: size.height)), with: .color(.white.opacity(0.045)))
                    x += 75
                }
            }
        }
        .overlay(alignment: .bottom) { Rectangle().fill(Color(hex: 0xD71920)).frame(height: 4) }
    }
}

private struct HomeHero: View {
    @Environment(AppModel.self) private var app
    let find: () -> Void
    let wide: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 10) {
                Image("Crest").resizable().scaledToFit().frame(width: 40, height: 40)
                BrandWordmark(size: 24)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)

            HStack(spacing: 8) {
                Circle().fill(Theme.green).frame(width: 7, height: 7)
                Text("Free for Sleeper and ESPN leagues")
                    .font(.caption.weight(.bold))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .glassEffect(.regular, in: Capsule())

            Text("Your league has stories. \(Text("Give them a home.").foregroundStyle(Theme.gold))")
                .font(.display(wide ? 54 : 42, weight: .heavy))
                .textCase(.uppercase)
                .lineSpacing(-4)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 8) {
                Text("Pigskin Pantheon turns your fantasy league's whole history into:")
                    .font(.body)
                    .foregroundStyle(.white.opacity(0.8))
                feature("🏆", "A walk-through 3D trophy room")
                feature("✨", "An AI historian")
                feature("📰", "Weekly recaps")
                feature("📚", "An all-time record book")
            }

            VStack(spacing: 10) {
                Button(action: find) {
                    Text("Open your league, free")
                        .font(.headline)
                        .foregroundStyle(Theme.navy)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .tint(Theme.gold)
                .controlSize(.large)

                Button {
                    app.open("demo")
                } label: {
                    Label("Explore the demo league", systemImage: "arrow.right")
                        .labelStyle(TrailingIconLabel())
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glass)
                .controlSize(.large)
            }
            .frame(maxWidth: wide ? 380 : .infinity)

            welcome

            VStack(alignment: .leading, spacing: 6) {
                proof("Sleeper: just your username")
                proof("Public and private ESPN leagues")
                proof("Every season, back to year one")
            }
        }
        .foregroundStyle(.white)
        .environment(\.colorScheme, .dark)
        .padding(.top, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// "Jump back in:" a signed-in member's leagues, one tap away.
    @ViewBuilder
    private var welcome: some View {
        let leagues = app.account.isSignedIn ? Array(app.account.leagues.prefix(4)) : []
        if !leagues.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Jump back in:")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.75))
                ScrollView(.horizontal, showsIndicators: false) {
                    GlassEffectContainer(spacing: 8) {
                        HStack(spacing: 8) {
                            ForEach(leagues) { l in
                                Button {
                                    app.open(l.league_id, name: l.name, avatar: l.avatar)
                                } label: {
                                    HStack(spacing: 8) {
                                        LeagueMark(name: l.title, avatar: l.avatar, size: 24)
                                        Text(l.name ?? "Your league")
                                            .font(.subheadline.weight(.semibold))
                                            .lineLimit(1)
                                    }
                                }
                                .buttonStyle(.glass)
                            }
                        }
                    }
                }
                .scrollClipDisabled()
            }
            .transition(.opacity)
        }
    }

    private func feature(_ emoji: String, _ text: String) -> some View {
        HStack(spacing: 10) {
            Text(emoji).font(.system(size: 17))
            Text(text).font(.body.weight(.semibold))
        }
    }

    private func proof(_ text: String) -> some View {
        Label {
            Text(text).font(.footnote.weight(.medium)).foregroundStyle(.white.opacity(0.78))
        } icon: {
            Image(systemName: "checkmark").font(.caption.weight(.heavy)).foregroundStyle(Theme.gold)
        }
    }
}

/// Text first, then the icon ("Explore the demo league →").
private struct TrailingIconLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.title
            configuration.icon
        }
    }
}

// MARK: Sections

private struct Kicker: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .heavy))
            .tracking(1.4)
            .textCase(.uppercase)
            .foregroundStyle(Theme.accentInk)
    }
}

private struct SectionHead: View {
    let kicker: String
    let title: String
    var lede: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Kicker(text: kicker)
            Text(title)
                .displayStyle(30)
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            if let lede {
                Text(lede)
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// "What's inside": the headline features, briefly.
private struct FeaturesSection: View {
    let wide: Bool

    private let features: [(String, Color, String, String)] = [
        ("sparkles", Theme.gold, "Ask anything. Get roasted with receipts.",
         "An AI that has read every score, trade, waiver claim, draft and lineup your league ever made. Ask who owns who or who lost the worst trade ever, and get the numbers with a little smack."),
        ("trophy.fill", Color(hex: 0xC9A227), "Walk your league's hall of fame.",
         "Champions in the Cup Room, a Hall of Fame and a Record Wall, the Lowlight Wall and the Cellar. Every manager gets a locker with their banner, pennants and cups."),
        ("newspaper.fill", Theme.accent, "The recap the group chat actually reads.",
         "Every week gets a headline and a story for every game: upsets, blowouts, streaks, the bench that cost someone the win. Power rankings and the playoff race come with it."),
        ("tablecells.fill", Theme.green, "Settle every argument, permanently.",
         "All-time standings, titles, last places and playoff records, plus head-to-head against every manager in the league with points for, against and the margin."),
        ("arrow.left.arrow.right", Color(hex: 0x7A5AF8), "Who won the trade? Now it's on the record.",
         "Every trade judged in hindsight, every waiver pickup and FAAB dollar, lineup efficiency and where every draft pick ended up."),
        ("person.text.rectangle.fill", Theme.red, "Every player's life in your league.",
         "Who rostered him and when, his best games, his record as a starter and the rings he won you."),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionHead(kicker: "What's inside", title: "Your league's lore, finally in one place",
                        lede: "Sleeper and ESPN show you this week. Pigskin Pantheon remembers everything else: who won, who choked, who got fleeced, and by how much.")
            AdaptiveGrid(minWidth: 320, spacing: 12) {
                ForEach(features, id: \.2) { f in
                    Card(padding: 16) {
                        HStack(alignment: .top, spacing: 14) {
                            Image(systemName: f.0)
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundStyle(f.1)
                                .frame(width: 40, height: 40)
                                .background(f.1.opacity(0.13), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                            VStack(alignment: .leading, spacing: 5) {
                                Text(f.2)
                                    .font(.headline)
                                    .foregroundStyle(Theme.ink)
                                    .fixedSize(horizontal: false, vertical: true)
                                Text(f.3)
                                    .font(.subheadline)
                                    .foregroundStyle(Theme.ink2)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
            }
            alsoInTheBox
        }
    }

    private var alsoInTheBox: some View {
        Card(padding: 16) {
            Text("Also in the box")
                .displayStyle(20)
                .foregroundStyle(Theme.ink)
                .padding(.bottom, 10)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 14, alignment: .top)], alignment: .leading, spacing: 12) {
                extra("Every season", "Week-by-week results, standings as they stood and every box score.")
                extra("The playoff picture", "Seeds, clinches and the bracket, projected or as played.")
                extra("Sleeper and ESPN", "Both in one list, private ESPN leagues and several ESPN accounts included.")
                extra("Redraft, keeper, dynasty", "Divisions, medians, toilet bowls, traded picks: all of it.")
                extra("Share cards", "Recaps as 1080 × 1350 pictures or text for the group chat.")
            }
        }
    }

    private func extra(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.subheadline.weight(.bold)).foregroundStyle(Theme.ink)
            Text(text).font(.footnote).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// "How it works": three steps.
private struct HowSection: View {
    let wide: Bool
    private let steps = [
        ("Find your league", "Type your Sleeper username, or paste an ESPN league ID or link. Every season the league has played comes in at once."),
        ("Keep it on your account", "Make a free account and your leagues stay on it, on every device. Or skip it: any league opens without one."),
        ("Send it to the league", "Drop a recap, a head-to-head or the trophy room in the group chat and let the arguments begin."),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionHead(kicker: "How it works", title: "Up and running before your next waiver run")
            AdaptiveGrid(minWidth: 260, spacing: 12) {
                ForEach(Array(steps.enumerated()), id: \.offset) { i, step in
                    Card(padding: 16) {
                        HStack(alignment: .top, spacing: 14) {
                            Text("\(i + 1)")
                                .font(.display(22, weight: .heavy))
                                .foregroundStyle(Theme.navy)
                                .frame(width: 38, height: 38)
                                .background(Theme.gold, in: Circle())
                            VStack(alignment: .leading, spacing: 4) {
                                Text(step.0).font(.headline).foregroundStyle(Theme.ink)
                                Text(step.1).font(.subheadline).foregroundStyle(Theme.ink2)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
            }
        }
    }
}

/// "The fine print, minus the fine print."
private struct FAQSection: View {
    private let faq = [
        ("Is it really free?", "Yes. Every league, every season, the trophy room and the League Historian AI are free. An account is only needed to keep your leagues on it and to ask the AI."),
        ("Do you need my Sleeper or ESPN password?", "No. Sleeper's league data is public, so your username is enough. A public ESPN league needs only its ID. A private ESPN league needs two keys ESPN keeps in your web browser (the finder shows you where to find them), which are encrypted if you save them to your account."),
        ("Which leagues work?", "Sleeper and ESPN leagues: redraft, keeper and dynasty, with or without divisions, any scoring. The history goes back as far as each platform keeps it."),
        ("What does the AI know?", "Only your league: every score, standing, trade, waiver claim, draft and lineup the app has read. It quotes the numbers, and it can be wrong now and then, so the record book has the final word."),
        ("Is this made by Sleeper or ESPN?", "No. Pigskin Pantheon is independent and isn't affiliated with or endorsed by Sleeper or ESPN. It reads each platform's league data to build your history."),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionHead(kicker: "Questions", title: "The fine print, minus the fine print")
            Card {
                ForEach(Array(faq.enumerated()), id: \.offset) { i, item in
                    if i > 0 { Rectangle().fill(Theme.line).frame(height: 1) }
                    FAQItem(question: item.0, answer: item.1)
                }
            }
        }
    }
}

private struct FAQItem: View {
    let question: String
    let answer: String
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.smooth(duration: 0.3)) { open.toggle() }
            } label: {
                HStack(spacing: 10) {
                    Text(question)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 8)
                    Image(systemName: "plus")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.accent)
                        .rotationEffect(.degrees(open ? 45 : 0))
                }
                .padding(14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(open ? "Hides the answer" : "Shows the answer")
            if open {
                Text(answer)
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 14)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .clipped()
    }
}

/// "Every season. Every grudge. One hall of fame." and the footer.
private struct FinalSection: View {
    @Environment(AppModel.self) private var app
    let find: () -> Void

    var body: some View {
        VStack(spacing: 22) {
            VStack(spacing: 16) {
                Image("Crest").resizable().scaledToFit().frame(width: 56, height: 56)
                Text("Every season. Every grudge. \(Text("One hall of fame.").foregroundStyle(Theme.gold))")
                    .font(.display(30, weight: .heavy))
                    .textCase(.uppercase)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white)
                HStack(spacing: 10) {
                    Button(action: find) {
                        Text("Open your league, free").font(.subheadline.weight(.bold)).foregroundStyle(Theme.navy)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(Theme.gold)
                    Button("See the demo league") { app.open("demo") }
                        .font(.subheadline.weight(.bold))
                        .buttonStyle(.glass)
                }
                .environment(\.colorScheme, .dark)
            }
            .padding(24)
            .frame(maxWidth: .infinity)
            .background(HeroBackground())
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))

            VStack(spacing: 6) {
                BrandWordmark(size: 16)
                Text("\(Legal.disclaimer) League data from the Sleeper API and ESPN Fantasy.")
                    .font(.caption)
                    .foregroundStyle(Theme.ink3)
                    .multilineTextAlignment(.center)
                // The legal pages, reachable signed out too (they open in Safari).
                HStack(spacing: 8) {
                    Link("Privacy", destination: Legal.privacy)
                    Text("·").foregroundStyle(Theme.ink3)
                    Link("Terms", destination: Legal.terms)
                    Text("·").foregroundStyle(Theme.ink3)
                    Link("Support", destination: Legal.support)
                }
                .font(.caption.weight(.semibold))
                .tint(Theme.accentInk)
                .padding(.top, 2)
            }
        }
    }
}
