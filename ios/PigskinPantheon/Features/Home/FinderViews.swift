import SwiftUI

/// The league finder's cards (index.html #find): the member's own leagues,
/// the leagues opened before, the Sleeper / ESPN form, and the leagues found.
struct FinderStack: View {
    @Environment(AppModel.self) private var app
    @Bindable var finder: FinderModel
    var signIn: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            if app.account.isSignedIn {
                MyLeaguesCard()
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
            if !app.recents.isEmpty {
                RecentCard()
                    .transition(.opacity)
            }
            FindCard(finder: finder, signIn: signIn)
            if finder.hasListing {
                FoundCard(finder: finder)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .animation(.smooth(duration: 0.3), value: app.account.isSignedIn)
        .animation(.smooth(duration: 0.3), value: app.recents)
    }
}

// MARK: Rows

/// One league in a list: its badge, name and a line about it, and a chevron.
struct LeagueRow: View {
    let name: String
    let avatar: String?
    let detail: String
    var live = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                LeagueMark(name: name, avatar: avatar, size: 38)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(name)
                            .font(.system(size: 15.5, weight: .semibold))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                        if live {
                            Text("LIVE")
                                .font(.system(size: 9.5, weight: .heavy))
                                .tracking(0.6)
                                .foregroundStyle(.white)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Theme.green, in: Capsule())
                        }
                    }
                    Text(detail)
                        .font(.system(size: 12.5))
                        .foregroundStyle(Theme.ink3)
                        .lineLimit(2)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.ink3)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(RowPressStyle())
    }
}

/// A row that dims while pressed, like a list row.
struct RowPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Theme.surface3 : Color.clear)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

private struct RowDivider: View {
    var body: some View { Rectangle().fill(Theme.line).frame(height: 1).padding(.leading, 64) }
}

private struct EmptyLine: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(Theme.ink2)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: My leagues

/// A signed-in member's leagues (account.js drawSyncedCard).
private struct MyLeaguesCard: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let leagues = app.account.leagues
        Card {
            CardHead(title: "My leagues", symbol: "star.fill", meta: Fmt.plural(leagues.count, "league"))
            if leagues.isEmpty {
                EmptyLine(text: "Find your league below and open it to add it to your account.")
            }
            ForEach(Array(leagues.enumerated()), id: \.element.id) { i, l in
                if i > 0 { RowDivider() }
                LeagueRow(name: l.title, avatar: l.avatar, detail: "Synced \(AccountStore.fmtDate(l.syncedDate))") {
                    app.open(l.league_id, name: l.name, avatar: l.avatar)
                }
            }
        }
    }
}

// MARK: Recently opened

private struct RecentCard: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Card {
            CardHead(title: "Recently opened", symbol: "clock")
            ForEach(Array(app.recents.enumerated()), id: \.element.id) { i, l in
                if i > 0 { RowDivider() }
                HStack(spacing: 0) {
                    LeagueRow(name: l.name, avatar: l.avatar, detail: detail(l)) {
                        app.open(l.id, name: l.name, avatar: l.avatar)
                    }
                    Button {
                        withAnimation(.smooth) { app.forget(l.id) }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Theme.ink3)
                            .frame(width: 36, height: 36)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Forget \(l.name)")
                    .padding(.trailing, 6)
                }
            }
        }
    }

    private func detail(_ l: RecentLeague) -> String {
        let source = l.id.hasPrefix("espn-") || l.platform == "espn" ? "ESPN" : "Sleeper"
        if let season = l.season { return "Latest season \(season) · \(source)" }
        return "\(source) league"
    }
}

// MARK: Find your leagues

private struct FindCard: View {
    @Environment(AppModel.self) private var app
    @Bindable var finder: FinderModel
    var signIn: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        Card {
            HStack(spacing: 10) {
                Image(systemName: "person.fill")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.card)
                    .frame(width: 24, height: 24)
                    .background(Theme.ink, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                Text("Find your leagues")
                    .displayStyle(20)
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Spacer(minLength: 8)
                Picker("Where your league is played", selection: $finder.platform.animation(.smooth(duration: 0.25))) {
                    ForEach(FinderModel.Platform.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .fixedSize()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }

            Group {
                switch finder.platform {
                case .sleeper: sleeperForm
                case .espn: EspnForm(finder: finder, signIn: signIn)
                }
            }
            .padding(14)
        }
        .sensoryFeedback(.selection, trigger: finder.platform)
    }

    private var sleeperForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            FieldBox(symbol: finder.byId ? "number" : "person") {
                TextField(finder.sleeperPlaceholder, text: $finder.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(finder.byId ? .numberPad : .asciiCapable)
                    .submitLabel(.search)
                    .focused($focused)
                    .onSubmit { finder.submitSleeper(app: app) }
                    .accessibilityLabel(finder.byId ? "Sleeper league ID" : "Sleeper username")
            }
            Button {
                focused = false
                finder.submitSleeper(app: app)
            } label: {
                ZStack {
                    Text(finder.sleeperButton).opacity(finder.looking ? 0 : 1)
                    if finder.looking { ProgressView() }
                }
                .font(.headline)
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .disabled(finder.looking || finder.username.trimmingCharacters(in: .whitespaces).isEmpty)

            noteView(finder.sleeperNote, standard: sleeperStandard)
                .environment(\.openURL, OpenURLAction { url in
                    if url.host == "byid" {
                        withAnimation(.smooth) { finder.toggleById() }
                        focused = true
                        return .handled
                    }
                    return .systemAction
                })
        }
    }

    private var sleeperStandard: AttributedString {
        let link = finder.byId ? "username" : "league ID"
        return (try? AttributedString(markdown: "Sleeper's league data is public, so your username is all it takes: no password, nothing to connect. Or paste a [\(link)](pp://byid).")) ?? AttributedString()
    }
}

/// A form's note: its standard words, a message, or an error in red.
@ViewBuilder
func noteView(_ note: FinderModel.Note, standard: AttributedString) -> some View {
    Group {
        switch note {
        case .standard:
            Text(standard).foregroundStyle(Theme.ink2)
        case .message(let text):
            Text(text).foregroundStyle(Theme.ink2)
        case .error(let text):
            Text(text).foregroundStyle(Theme.red)
        case .notEspnId:
            Text((try? AttributedString(markdown: "That isn't an ESPN league ID. It's the number after `leagueId=` in your league's address on fantasy.espn.com. [Private league?](pp://private)")) ?? AttributedString())
                .foregroundStyle(Theme.red)
        }
    }
    .font(.footnote)
    .fixedSize(horizontal: false, vertical: true)
    .frame(maxWidth: .infinity, alignment: .leading)
    .contentTransition(.opacity)
}

/// The site's .signin-field: an icon and a text box on a soft panel.
struct FieldBox<Content: View>: View {
    let symbol: String
    @ViewBuilder var content: Content

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.ink3)
                .frame(width: 20)
            content
                .font(.system(size: 16))
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 48)
        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.line))
    }
}

// MARK: ESPN

private struct EspnForm: View {
    @Environment(AppModel.self) private var app
    @Bindable var finder: FinderModel
    var signIn: () -> Void
    @FocusState private var focus: EspnFormFocus?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            FieldBox(symbol: "trophy") {
                TextField("ESPN league ID or league link", text: $finder.espnInput)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .submitLabel(.go)
                    .focused($focus, equals: .league)
                    .onSubmit { finder.submitEspn(app: app) }
            }
            Button {
                focus = nil
                finder.submitEspn(app: app)
            } label: {
                Text("Open league").font(.headline).frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .disabled(finder.espnInput.trimmingCharacters(in: .whitespaces).isEmpty)

            noteView(finder.espnNote, standard: standard)
                .environment(\.openURL, OpenURLAction { url in
                    if url.host == "private" {
                        finder.setPrivateOpen(!finder.privateOpen)
                        return .handled
                    }
                    return .systemAction
                })

            privateToggle
            if finder.privateOpen {
                PrivatePanel(finder: finder, focus: $focus, signIn: signIn)
                    .transition(.opacity.combined(with: .move(edge: .top)))
                    .id("espnPrivate")
            }
        }
        .task { await finder.loadState() }
    }

    private var standard: AttributedString {
        (try? AttributedString(markdown: "Your league ID is the number after `leagueId=` in your league's address on fantasy.espn.com; pasting the whole link works too. A league that's viewable to the public needs nothing else.")) ?? AttributedString()
    }

    /// "Private league?", or where the keys stand once connected.
    private var privateToggle: some View {
        Button {
            finder.setPrivateOpen(!finder.privateOpen)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: finder.isConnected ? "lock.open.fill" : "lock.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(finder.isConnected ? Theme.green : Theme.accent)
                    .frame(width: 36, height: 36)
                    .background((finder.isConnected ? Theme.green : Theme.accent).opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .contentTransition(.symbolEffect(.replace))
                VStack(alignment: .leading, spacing: 2) {
                    Text(finder.toggleTitle)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(Theme.ink)
                    Text(finder.toggleSubtitle)
                        .font(.caption)
                        .foregroundStyle(Theme.ink2)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 6)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.ink3)
                    .rotationEffect(.degrees(finder.privateOpen ? 90 : 0))
            }
            .padding(12)
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.line))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(finder.privateOpen ? "Hides the private league steps" : "Shows how to open a private league")
    }
}

/// "Opening a private ESPN league": where the keys are, the boxes for them,
/// the ESPN accounts connected, and what the keys are used for.
private struct PrivatePanel: View {
    @Environment(AppModel.self) private var app
    @Bindable var finder: FinderModel
    var focus: FocusState<EspnFormFocus?>.Binding
    var signIn: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Opening a private ESPN league")
                .font(.headline)
                .foregroundStyle(Theme.ink)

            if !finder.relay {
                Text("This site isn't set up to open private ESPN leagues yet.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
            } else {
                if finder.showDesktop { desktopSteps }
                if finder.showKeyFields { keyFields }
                if !finder.connected.isEmpty { savedAccounts }
                if let hint = finder.savedHint {
                    Text(hint).font(.footnote).foregroundStyle(Theme.ink2)
                } else if !finder.connected.isEmpty && finder.accountsAvailable && !finder.espnSignedIn {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Button("Sign in", action: signIn).font(.footnote.weight(.semibold))
                        Text("to save them to your account, so your private leagues open on your other devices too.")
                            .font(.footnote).foregroundStyle(Theme.ink2)
                    }
                }
                if !finder.showDesktop {
                    Text(fine)
                        .font(.caption)
                        .foregroundStyle(Theme.ink3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(14)
        .background(Theme.surface2.opacity(0.6), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.line))
    }

    private var fine: AttributedString {
        let text = finder.accountsAvailable
            ? "These keys work like your ESPN password, so keep them to yourself. Add a set for each ESPN account you play on. Signed in, they're saved to your account, encrypted, so your private leagues open on any device you sign in on; otherwise they stay on this device. Either way they're only used to read your leagues, through this site's relay to ESPN. *Forget* removes an account's keys everywhere, and signing out of ESPN ends them."
            : "These keys work like your ESPN password, so keep them to yourself. Add a set for each ESPN account you play on. They stay on this device, and are only used to read your leagues, through this site's relay to ESPN. *Forget* removes them, and signing out of ESPN ends them."
        return (try? AttributedString(markdown: text)) ?? AttributedString(text)
    }

    @ViewBuilder
    private var keyFields: some View {
        Text((try? AttributedString(markdown: "**A one-time setup, on a computer.** A private league opens with your ESPN keys: two values ESPN keeps in your browser once you're signed in. Save them here once and, signed in, your private leagues open on every device you sign in on.")) ?? AttributedString())
            .font(.subheadline)
            .foregroundStyle(Theme.ink2)
            .fixedSize(horizontal: false, vertical: true)
        VStack(alignment: .leading, spacing: 8) {
            step(1, "Sign in at [fantasy.espn.com](https://fantasy.espn.com/football/) and open your league.")
            step(2, "Open the browser's developer tools (F12, or ⌥⌘I on a Mac) ▸ **Application** (Chrome, Edge) or **Storage** (Firefox, Safari) ▸ Cookies ▸ espn.com.")
            step(3, "Copy the values of `espn_s2` and `SWID` into the boxes below.")
        }
        VStack(spacing: 8) {
            FieldBox(symbol: "key") {
                SecureField("espn_s2", text: $finder.s2)
                    .textContentType(.oneTimeCode)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused(focus, equals: .s2)
                    .submitLabel(.next)
                    .onSubmit { focus.wrappedValue = .swid }
                    .accessibilityLabel("espn_s2")
            }
            FieldBox(symbol: "person.badge.key") {
                TextField("SWID  {XXXXXXXX-XXXX-…}", text: $finder.swid)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .focused(focus, equals: .swid)
                    .submitLabel(.done)
                    .onSubmit { save() }
                    .accessibilityLabel("SWID")
            }
            if finder.espnSignedIn && finder.accountsAvailable {
                Toggle(isOn: $finder.toAccount) {
                    Text("Also save them to my account, so my private leagues open on my other devices too. Untick to keep them on this device only.")
                        .font(.footnote)
                        .foregroundStyle(Theme.ink2)
                }
                .toggleStyle(.switch)
                .padding(.vertical, 2)
            }
            Button(action: save) {
                ZStack {
                    Text("Save").opacity(finder.savingKeys ? 0 : 1)
                    if finder.savingKeys { ProgressView() }
                }
                .font(.headline)
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .disabled(finder.savingKeys || finder.s2.isEmpty || finder.swid.isEmpty)
        }
    }

    /// Phones and tablets (index.html #espnDesktop): the keys are copied out
    /// of a desktop browser, once, and the account brings them here.
    @ViewBuilder
    private var desktopSteps: some View {
        Text((try? AttributedString(markdown: "**Open Pigskin Pantheon on a computer and continue there.** It's a one-time setup on desktop (about two minutes), and then your private leagues work on your phone too.")) ?? AttributedString())
            .font(.subheadline)
            .foregroundStyle(Theme.ink2)
            .fixedSize(horizontal: false, vertical: true)
        VStack(alignment: .leading, spacing: 8) {
            if finder.espnSignedIn, let email = app.account.user?.email {
                step(1, "On a computer, go to pigskinpantheon.com and sign in as **\(email)**.")
            } else {
                step(1, "On a computer, go to pigskinpantheon.com and sign in (or make a free account). [Sign in on this phone too](pp://signin), with the same account, so it carries over.")
            }
            step(2, "Choose **ESPN** ▸ **Private league?** and follow the steps there.")
            step(3, "That's it. Your private leagues show up here on your phone, with nothing to type.")
        }
        .environment(\.openURL, OpenURLAction { url in
            if url.host == "signin" { signIn(); return .handled }
            return .systemAction
        })
        ShareLink(item: LeagueEngine.siteURL, subject: Text("Pigskin Pantheon"),
                  message: Text("Finish connecting my ESPN league on a computer")) {
            Label("Send the link to your computer", systemImage: "laptopcomputer.and.arrow.down")
                .font(.footnote.weight(.semibold))
        }
        .buttonStyle(.glass)
        Button("Have your keys already? Enter them here") {
            withAnimation(.smooth) { finder.keysAnyway = true }
            focus.wrappedValue = .s2
        }
        .font(.footnote.weight(.semibold))
        .buttonStyle(.plain)
        .foregroundStyle(Theme.accentInk)
    }

    private func save() {
        focus.wrappedValue = nil
        Task { await finder.saveKeys(app: app, account: app.account) }
    }

    private func step(_ n: Int, _ markdown: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("\(n)")
                .font(.caption.weight(.heavy))
                .foregroundStyle(.white)
                .frame(width: 20, height: 20)
                .background(Theme.accent, in: Circle())
            Text((try? AttributedString(markdown: markdown)) ?? AttributedString(markdown))
                .font(.footnote)
                .foregroundStyle(Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var savedAccounts: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(finder.connected.count == 1 ? "ESPN connected" : "\(finder.connected.count) ESPN accounts connected",
                  systemImage: "checkmark.circle.fill")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(Theme.green)
            ForEach(Array(finder.connected.enumerated()), id: \.element.id) { index, row in
                VStack(alignment: .leading, spacing: 6) {
                    Text(finder.title(for: row, index: index))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                    Group {
                        if finder.refusedSwids.contains(row.swid) {
                            Text("ESPN turned these keys away: copy them again. ").bold().foregroundStyle(Theme.red)
                                + Text(finder.detail(for: row))
                        } else {
                            Text(finder.detail(for: row))
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(Theme.ink3)
                    HStack(spacing: 8) {
                        if row.local && !row.account && finder.espnSignedIn {
                            Button("Save to my account") { Task { await finder.saveToAccount(row.swid, account: app.account) } }
                        }
                        Button("Forget", role: .destructive) { Task { await finder.forget(row, account: app.account) } }
                        if finder.busySwid == row.swid { ProgressView() }
                    }
                    .buttonStyle(.glass)
                    .font(.footnote.weight(.semibold))
                    .disabled(finder.busySwid != nil)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.line))
            }
            if !finder.adding {
                Button {
                    withAnimation(.smooth) { finder.adding = true; finder.keysAnyway = true }
                    focus.wrappedValue = .s2
                } label: {
                    Label("Add another ESPN account", systemImage: "plus")
                        .font(.footnote.weight(.semibold))
                }
                .buttonStyle(.glass)
            }
        }
    }
}

enum EspnFormFocus: Hashable { case league, s2, swid }

// MARK: Leagues found

/// One list of the leagues found on both platforms: a Sleeper username's,
/// and the member's own ESPN leagues from their keys.
private struct FoundCard: View {
    @Environment(AppModel.self) private var app
    let finder: FinderModel

    var body: some View {
        Card {
            CardHead(title: "Leagues found", symbol: "trophy.fill", meta: finder.listingMeta.isEmpty ? nil : finder.listingMeta)
            let sleeper = finder.sleeperLeagues ?? []
            let espn = finder.espnLeagues ?? []
            ForEach(Array(sleeper.enumerated()), id: \.element.id) { i, l in
                if i > 0 { RowDivider() }
                LeagueRow(name: l.name, avatar: l.avatar, detail: "Sleeper · \(l.describe)", live: l.live) {
                    app.open(l.id, name: l.name, avatar: l.avatar)
                }
            }
            ForEach(Array(espn.enumerated()), id: \.element.id) { i, l in
                if i > 0 || !sleeper.isEmpty { RowDivider() }
                LeagueRow(name: l.name, avatar: l.logo, detail: l.describe) {
                    app.open(l.id, name: l.name, avatar: l.logo)
                }
            }
            if let note = finder.sleeperEmptyNote { EmptyLine(text: note) }
            if let note = finder.espnListNote { EmptyLine(text: note) }
        }
    }
}
