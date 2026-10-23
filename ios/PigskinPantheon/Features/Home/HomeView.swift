import SwiftUI

/// The home screen: the member's leagues, the leagues opened before, the
/// way to open one (Sleeper or ESPN) and the demo, as grouped sections
/// under a large title. First time in, a welcome card leads with the demo;
/// what's inside and the questions people ask are in About.
struct HomeView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var finder = FinderModel.shared
    @State private var sheet: HomeSheet?
    /// The sheet last up, so its dismissal knows whether it was the ESPN
    /// sign-in or another one the sign-in was waiting on.
    @State private var shownSheet: String?

    enum HomeSheet: Identifiable {
        case auth(AuthView.Mode)
        case gate(AccountStore.PendingLeague)
        case account
        case about
        case espnSignIn

        var id: String {
            switch self {
            case .auth: return "auth"
            case .gate(let p): return "gate-\(p.id)"
            case .account: return "account"
            case .about: return "about"
            case .espnSignIn: return "espnSignIn"
            }
        }
    }

    private var wide: Bool { sizeClass == .regular }

    /// The demo's own section, until it's among the leagues opened before.
    private var showDemo: Bool { !app.recents.contains { $0.id == "demo" } }

    /// No leagues of their own and none opened yet: the welcome card leads.
    private var firstTime: Bool {
        app.recents.isEmpty && !(app.account.isSignedIn && !app.account.leagues.isEmpty)
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    content
                    .padding(.horizontal, wide ? 28 : Theme.gutter)
                    .padding(.top, 8)
                    .padding(.bottom, 32)
                    .frame(maxWidth: .infinity)
                    .animation(.smooth(duration: 0.3), value: app.account.isSignedIn)
                    .animation(.smooth(duration: 0.3), value: app.recents)
                }
                .scrollDismissesKeyboard(.interactively)
                .background(Theme.page)
                // "Private league?" from a note, or a private league that
                // wouldn't open: down to the panel once it's drawn.
                .onChange(of: finder.showPrivate) {
                    Task {
                        try? await Task.sleep(for: .milliseconds(200))
                        withAnimation(.smooth(duration: 0.5)) { proxy.scrollTo("espnPrivate", anchor: .top) }
                    }
                }
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
            .navigationTitle("Pigskin Pantheon")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { accountButton }
            }
        }
        .accountToast()
        .sheet(item: $sheet, onDismiss: {
            if !app.account.isSignedIn { app.account.pending = nil }
            // The ESPN sign-in asked for over another sheet: up now that
            // that one has gone.
            if finder.signInOpen && shownSheet != HomeSheet.espnSignIn.id && sheet == nil {
                sheet = .espnSignIn
            } else {
                finder.signInOpen = false
            }
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
            case .about:
                AboutSheet(openDemo: {
                    self.sheet = nil
                    app.open("demo")
                })
            case .espnSignIn:
                EspnSignInSheet { keys in
                    Task { await finder.didSignIn(keys, app: app, account: app.account) }
                }
            }
        }
        .onChange(of: sheet?.id) { _, id in
            if let id { shownSheet = id }
        }
        // Over another sheet, that one goes first (onDismiss brings the
        // sign-in up), so the request isn't lost.
        .onChange(of: finder.signInOpen) { _, open in
            guard open else { return }
            if sheet == nil { sheet = .espnSignIn } else if sheet?.id != HomeSheet.espnSignIn.id { sheet = nil }
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
            if finder.signInOpen && sheet == nil { sheet = .espnSignIn }
            // PP_HOME opens a sheet or a league at launch (debug builds only).
            #if DEBUG
            switch ProcessInfo.processInfo.environment["PP_HOME"] {
            case "signin": sheet = .auth(.signin)
            case "signup": sheet = .auth(.signup)
            case "account": sheet = .account
            case "about": sheet = .about
            case "gate": app.open("1312115646644912128", name: "D201: History of a Decade of Dynasty!", avatar: nil)
            case "espn":
                finder.platform = .espn
                finder.setPrivateOpen(true)
                await debugEspnKeys()
            default: break
            }
            // PP_SHEET=espn: the ESPN sign-in sheet over the private-league panel.
            if DebugLaunch.espnSignIn {
                finder.showSignIn()
                finder.signInOpen = true
            }
            #endif
        }
    }

    /// Debug builds: PP_ESPN_KEYS=<n> saves n made-up sets of ESPN keys on
    /// this device, as the sign-in sheet would (ESPN turns them away), and
    /// PP_ESPN_FORGET=1 then forgets the first, to see the private panel
    /// with several accounts.
    private func debugEspnKeys() async {
        #if DEBUG
        let env = ProcessInfo.processInfo.environment
        guard let n = env["PP_ESPN_KEYS"].flatMap(Int.init), n > 0 else { return }
        for i in 1...n {
            let keys = EspnSignIn.Keys(s2: "AEBfake" + String(repeating: "\(i)", count: 60),
                                       swid: "{0000000\(i)-AAAA-BBBB-CCCC-DDDDEEEEFFF\(i)}")
            await finder.didSignIn(keys, app: app, account: app.account)
        }
        if env["PP_ESPN_FORGET"] == "1", let first = finder.connected.first {
            await finder.forget(first, account: app.account)
        }
        #endif
    }

    /// The sections: one column on a phone; on a wide screen the leagues on
    /// the left and the finder on the right.
    @ViewBuilder
    private var content: some View {
        if wide {
            HStack(alignment: .top, spacing: 28) {
                VStack(spacing: 28) {
                    if firstTime { WelcomeCard() }
                    leagueSections
                    if showDemo { DemoSection() }
                    HomeAboutSection(about: { sheet = .about })
                }
                .frame(maxWidth: .infinity)
                findSections
                    .frame(width: 420)
            }
            .frame(maxWidth: 1100)
        } else {
            VStack(spacing: 28) {
                if firstTime { WelcomeCard() }
                leagueSections
                findSections
                if showDemo { DemoSection() }
                HomeAboutSection(about: { sheet = .about })
            }
        }
    }

    /// The member's leagues and the ones opened before.
    @ViewBuilder
    private var leagueSections: some View {
        if app.account.isSignedIn {
            MyLeaguesSection()
                .transition(.opacity.combined(with: .move(edge: .top)))
        }
        if !app.recents.isEmpty {
            RecentSection()
                .transition(.opacity)
        }
    }

    /// Open a league, and what it found.
    private var findSections: some View {
        VStack(spacing: 28) {
            FindSection(finder: finder, signIn: { sheet = .auth(.signin) })
            if finder.hasListing {
                FoundSection(finder: finder)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
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
                Button("Account", systemImage: "person.crop.circle") { sheet = .account }
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
            Button("Sign In") {
                sheet = .auth(.signin)
            }
            .fontWeight(.semibold)
            .accessibilityHint("Sign in or create an account")
        }
    }
}

// MARK: Welcome

/// The navy of the site's hero (landing.css .lp-hero): yard lines, a blue
/// glow and a gold one.
private struct HeroBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: 0x071827), Color(hex: 0x0D2238)], startPoint: .top, endPoint: .bottom)
            RadialGradient(colors: [Color(hex: 0x1769E0, alpha: 0.30), .clear], center: UnitPoint(x: 0.9, y: 0.05), startRadius: 0, endRadius: 320)
            RadialGradient(colors: [Color(hex: 0xF6B73C, alpha: 0.12), .clear], center: UnitPoint(x: 0.05, y: 1), startRadius: 0, endRadius: 280)
            Canvas { context, size in
                var x: CGFloat = 52
                while x < size.width {
                    context.fill(Path(CGRect(x: x, y: 0, width: 1, height: size.height)), with: .color(.white.opacity(0.04)))
                    x += 53
                }
            }
        }
    }
}

/// First time in: what the app is, in a line and four features, and the
/// demo a tap away.
private struct WelcomeCard: View {
    @Environment(AppModel.self) private var app

    private let features: [(String, String)] = [
        ("trophy.fill", "3D trophy room"),
        ("sparkles", "AI historian"),
        ("newspaper.fill", "Weekly recaps"),
        ("books.vertical.fill", "Record book"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Image("Crest").resizable().scaledToFit().frame(width: 40, height: 40)
                    .accessibilityHidden(true)
                Text("Every season your league has played, in one place.")
                    .font(.title2.weight(.bold))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
            }

            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                ForEach(features, id: \.1) { f in
                    HStack(spacing: 8) {
                        Image(systemName: f.0)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.gold)
                            .frame(width: 18)
                        Text(f.1)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 9)
                    .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }

            Button {
                app.open("demo")
            } label: {
                Label("Explore the Demo League", systemImage: "play.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(Felt(.glass))
            .controlSize(.large)
        }
        .foregroundStyle(.white)
        .environment(\.colorScheme, .dark)
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HeroBackground())
        .clipShape(RoundedRectangle(cornerRadius: HomeSection<EmptyView>.radius, style: .continuous))
    }
}

// MARK: Demo and About

/// A small coloured tile with a symbol, like the Settings app's rows.
private struct IconTile: View {
    let symbol: String
    let color: Color
    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 30, height: 30)
            .background(color.gradient, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

/// A plain row: a tile, a title and what's at the end of it.
private struct MenuRow: View {
    let symbol: String
    let color: Color
    let title: String
    var external = false

    var body: some View {
        HStack(spacing: 12) {
            IconTile(symbol: symbol, color: color)
            Text(title)
                .font(.body)
                .foregroundStyle(Theme.ink)
            Spacer(minLength: 8)
            Image(systemName: external ? "arrow.up.right" : "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .contentShape(Rectangle())
    }
}

/// The demo league, Sunday Scaries, always a tap away.
private struct DemoSection: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        HomeSection(title: "Demo League") {
            Button {
                app.open("demo")
            } label: {
                HStack(spacing: 12) {
                    Image("Crest")
                        .resizable()
                        .scaledToFit()
                        .padding(7)
                        .frame(width: 40, height: 40)
                        .background(Theme.navy, in: Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Sunday Scaries")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Theme.ink)
                        Text("Dynasty · 10 teams")
                            .font(.subheadline)
                            .foregroundStyle(Theme.ink3)
                            .lineLimit(2)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .contentShape(Rectangle())
            }
            .buttonStyle(Felt(RowPressStyle()))
        }
    }
}

/// About the app, and the legal pages (reachable signed out too; they open
/// in Safari).
private struct HomeAboutSection: View {
    let about: () -> Void

    var body: some View {
        HomeSection(footer: AnyView(
            Text(Legal.disclaimer)
                .font(.footnote)
                .foregroundStyle(Theme.ink3)
                .fixedSize(horizontal: false, vertical: true)
        )) {
            Button(action: about) {
                MenuRow(symbol: "info", color: Theme.accent, title: "About Pigskin Pantheon")
            }
            .buttonStyle(Felt(RowPressStyle()))
            RowDivider(inset: 58)
            Link(destination: Legal.privacy) {
                MenuRow(symbol: "hand.raised.fill", color: Color(hex: 0x667085), title: "Privacy Policy", external: true)
            }
            .buttonStyle(Felt(RowPressStyle()))
            RowDivider(inset: 58)
            Link(destination: Legal.terms) {
                MenuRow(symbol: "doc.text.fill", color: Color(hex: 0x667085), title: "Terms of Use", external: true)
            }
            .buttonStyle(Felt(RowPressStyle()))
            RowDivider(inset: 58)
            Link(destination: Legal.support) {
                MenuRow(symbol: "questionmark", color: Theme.green, title: "Support", external: true)
            }
            .buttonStyle(Felt(RowPressStyle()))
        }
    }
}

// MARK: About sheet

/// What's inside and the questions people ask (index.html's FAQ), as a
/// grouped list.
private struct AboutSheet: View {
    @Environment(\.dismiss) private var dismiss
    let openDemo: () -> Void

    private let features: [(String, Color, String)] = [
        ("sparkles", Theme.gold, "Ask the League, the AI historian"),
        ("trophy.fill", Color(hex: 0xC9A227), "3D trophy room"),
        ("newspaper.fill", Theme.accent, "Weekly recaps and power rankings"),
        ("tablecells.fill", Theme.green, "All-time record book and head-to-head"),
        ("arrow.left.arrow.right", Color(hex: 0x7A5AF8), "Trades, waivers and drafts"),
        ("person.text.rectangle.fill", Theme.red, "Player cards"),
    ]

    private let faq = [
        ("Do I need an account?", "No. Any league opens without one. An account keeps your leagues on every device, saves private ESPN keys and unlocks Ask the League."),
        ("Do you need my Sleeper or ESPN password?", "No. A Sleeper username or a public ESPN league ID is enough. For a private ESPN league you sign in on ESPN's own page: the password goes to ESPN alone, and the app keeps only the two keys ESPN hands back (encrypted, if saved to your account)."),
        ("Which leagues work?", "Sleeper and ESPN: redraft, keeper and dynasty, any scoring, as far back as each platform keeps."),
        ("What does the AI know?", "Only your league's own data. It can be wrong now and then; the record book has the final word."),
        ("Is this made by Sleeper or ESPN?", "No. Pigskin Pantheon is independent and isn't affiliated with or endorsed by Sleeper, ESPN, the NFL or the NFLPA."),
    ]

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(spacing: 10) {
                        Image("Crest").resizable().scaledToFit().frame(width: 64, height: 64)
                            .accessibilityHidden(true)
                        BrandWordmark(size: 26)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
                    .listRowBackground(Color.clear)
                }

                Section("What's Inside") {
                    ForEach(features, id: \.2) { f in
                        HStack(spacing: 12) {
                            IconTile(symbol: f.0, color: f.1)
                            Text(f.2).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                        }
                    }
                }

                Section("Questions") {
                    ForEach(faq, id: \.0) { item in
                        DisclosureGroup {
                            Text(item.1)
                                .font(.subheadline)
                                .foregroundStyle(Theme.ink2)
                        } label: {
                            Text(item.0).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                        }
                    }
                }

                Section {
                    Button("Explore the Demo League", systemImage: "play.fill", action: openDemo)
                        .fontWeight(.semibold)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Theme.page)
            .navigationTitle("About")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark") { dismiss() }
                }
            }
        }
    }
}
