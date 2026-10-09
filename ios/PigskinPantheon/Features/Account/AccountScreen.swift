import SwiftUI

/// The account panel (account.js drawPanel): who's signed in, the leagues
/// on the account (open, unsync), the ESPN accounts whose keys are saved,
/// the profile, the legal pages, signing out and deleting the account.
/// Signed out, it's the sign-in dialog.
struct AccountScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if app.account.isSignedIn {
                    AccountPanel(close: { dismiss() })
                        .transition(.opacity)
                } else {
                    // Signed out, the account is the sign-in dialog (account.js
                    // openPanel → openAuth("signin")); "Create account" is a tab away.
                    AuthView(mode: .signin, embedded: true)
                        .transition(.opacity)
                }
            }
            .animation(.smooth(duration: 0.3), value: app.account.isSignedIn)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done", systemImage: "xmark") { dismiss() }
                }
            }
        }
        .accountToast()
    }
}

private struct AccountPanel: View {
    @Environment(AppModel.self) private var app
    let close: () -> Void

    @State private var finder = FinderModel.shared
    @State private var unsyncing: AccountStore.SyncedLeague?
    @State private var busyLeague: String?
    @State private var name = ""
    @State private var sleeper = ""
    @State private var profileError: String?
    @State private var savingProfile = false
    @State private var confirmSignOut = false
    @State private var confirmDelete = false
    @State private var deleting = false
    @State private var deleteError: String?

    private var account: AccountStore { app.account }

    var body: some View {
        Form {
            Section {
                HStack(spacing: 14) {
                    Text(account.initials)
                        .font(.system(size: 22, weight: .heavy))
                        .foregroundStyle(Theme.navy)
                        .frame(width: 56, height: 56)
                        .background(Theme.gold.gradient, in: Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text(account.displayName)
                            .font(.title3.weight(.bold))
                            .foregroundStyle(Theme.ink)
                        Text(account.user?.email ?? "")
                            .font(.subheadline)
                            .foregroundStyle(Theme.ink2)
                    }
                }
                .padding(.vertical, 4)
            }

            leaguesSection
            espnSection
            profileSection

            Section {
                Button("Sign out", role: .destructive) { confirmSignOut = true }
                    .frame(maxWidth: .infinity)
            }

            AboutSection()
            deleteSection
        }
        .disabled(deleting)
        .interactiveDismissDisabled(deleting)
        .scrollContentBackground(.hidden)
        .background(Theme.page)
        .navigationTitle("Your account")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable {
            await account.refresh()
            await finder.drawPrivate()
        }
        .task {
            name = account.profile?.display_name ?? ""
            sleeper = account.profile?.sleeper_username ?? ""
            await account.refresh()
            name = account.profile?.display_name ?? name
            sleeper = account.profile?.sleeper_username ?? sleeper
            finder.start(account: account)
            await finder.drawPrivate()
        }
        .confirmationDialog("Unsync this league?", isPresented: Binding(get: { unsyncing != nil }, set: { if !$0 { unsyncing = nil } }),
                            titleVisibility: .visible, presenting: unsyncing) { row in
            Button("Unsync", role: .destructive) { Task { await unsync(row) } }
        } message: { row in
            Text("\(row.name ?? "This league") comes off your account. You can add it back any time.")
        }
        .confirmationDialog("Sign out?", isPresented: $confirmSignOut, titleVisibility: .hidden) {
            Button("Sign out", role: .destructive) { Task { await signOut() } }
        }
        .alert("Delete your account?", isPresented: $confirmDelete) {
            Button("Delete Account", role: .destructive) { Task { await deleteAccount() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This permanently deletes your account, the leagues synced to it and any ESPN keys saved to it. It can't be undone.")
        }
    }

    // MARK: Leagues

    private var leaguesSection: some View {
        Section {
            if account.leagues.isEmpty {
                Text("No leagues yet. Find one and open it, and it's added to your account.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
            }
            ForEach(account.leagues) { row in
                Button {
                    open(row)
                } label: {
                    HStack(spacing: 12) {
                        LeagueMark(name: row.title, avatar: row.avatar, size: 40)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.title)
                                .font(.body.weight(.semibold))
                                .foregroundStyle(Theme.ink)
                                .lineLimit(1)
                            Text("Synced \(AccountStore.fmtDate(row.syncedDate))")
                                .font(.caption)
                                .foregroundStyle(Theme.ink3)
                        }
                        Spacer(minLength: 8)
                        if busyLeague == row.league_id {
                            ProgressView()
                        } else if app.league?.id == row.league_id {
                            Text("Open").font(.caption.weight(.bold)).foregroundStyle(Theme.green)
                        } else {
                            Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(Theme.ink3)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .swipeActions {
                    Button("Unsync", systemImage: "minus.circle", role: .destructive) { unsyncing = row }
                }
                .contextMenu {
                    Button("Open", systemImage: "arrow.up.right") { open(row) }
                    Button("Unsync", systemImage: "minus.circle", role: .destructive) { unsyncing = row }
                }
            }
            Button {
                findLeague()
            } label: {
                Label("Find a league", systemImage: "magnifyingglass")
            }
        } header: {
            HStack {
                Text("Your leagues")
                Spacer()
                if !account.leagues.isEmpty { Text(Fmt.plural(account.leagues.count, "league")) }
            }
        } footer: {
            Text("Add as many leagues as you like, and remove them any time. Swipe a league to unsync it.")
        }
    }

    private func open(_ row: AccountStore.SyncedLeague) {
        close()
        if app.league?.id != row.league_id { app.open(row.league_id, name: row.name, avatar: row.avatar) }
    }

    /// Taking a league off the account: with none left, or with the league
    /// on screen gone, the next thing to do is find a league.
    private func unsync(_ row: AccountStore.SyncedLeague) async {
        busyLeague = row.league_id
        defer { busyLeague = nil }
        do {
            try await account.unsync(row.league_id)
            account.say("League removed.")
            let wasOpen = app.league.map { row.ids.contains($0.id) } ?? false
            if wasOpen || account.leagues.isEmpty { findLeague() }
        } catch {
            account.say(error.localizedDescription)
        }
    }

    private func findLeague() {
        close()
        if app.league != nil { app.closeLeague() }
    }

    // MARK: ESPN

    private var espnSection: some View {
        Section {
            if finder.connected.isEmpty {
                Text("No ESPN keys saved. A private ESPN league opens with your ESPN keys (espn_s2 and SWID): add them with Connect ESPN.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
            }
            ForEach(Array(finder.connected.enumerated()), id: \.element.id) { index, row in
                VStack(alignment: .leading, spacing: 6) {
                    Text(finder.title(for: row, index: index))
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                    if finder.refusedSwids.contains(row.swid) {
                        Text("ESPN turned these keys away: copy them again.")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(Theme.red)
                    }
                    Text(finder.detail(for: row))
                        .font(.caption)
                        .foregroundStyle(Theme.ink3)
                    HStack {
                        if row.local && !row.account && finder.espnSignedIn {
                            Button("Save to my account") { Task { await finder.saveToAccount(row.swid, account: account) } }
                                .buttonStyle(.glass)
                        }
                        Button("Forget", role: .destructive) { Task { await finder.forget(row, account: account) } }
                            .buttonStyle(.glass)
                        if finder.busySwid == row.swid { ProgressView().padding(.leading, 4) }
                    }
                    .font(.footnote.weight(.semibold))
                    .disabled(finder.busySwid != nil)
                }
                .padding(.vertical, 4)
            }
            Button {
                close()
                finder.platform = .espn
                finder.adding = !finder.connected.isEmpty
                finder.setPrivateOpen(true)
                if app.league != nil { app.closeLeague() }
            } label: {
                Label(finder.connected.isEmpty ? "Connect ESPN" : "Add another ESPN account", systemImage: "plus")
            }
        } header: {
            Text("ESPN accounts")
        } footer: {
            Text("Keys saved to your account are encrypted and only used to read your leagues, through Pigskin Pantheon's relay to ESPN. Forget removes an account's keys everywhere.")
        }
    }

    // MARK: Profile

    private var profileSection: some View {
        Section {
            TextField("Name", text: $name, prompt: Text("What the league calls you"))
                .textContentType(.nickname)
                .onChange(of: name) { _, v in if v.count > 60 { name = String(v.prefix(60)) } }
            TextField("Sleeper username", text: $sleeper, prompt: Text("Fills in the league finder"))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onChange(of: sleeper) { _, v in if v.count > 40 { sleeper = String(v.prefix(40)) } }
            Button {
                Task { await saveProfile() }
            } label: {
                HStack {
                    Text("Save profile")
                    if savingProfile { Spacer(); ProgressView() }
                }
            }
            .disabled(savingProfile)
        } header: {
            Text("Profile")
        } footer: {
            if let profileError {
                Text(profileError).foregroundStyle(Theme.red)
            }
        }
    }

    private func saveProfile() async {
        savingProfile = true
        profileError = nil
        defer { savingProfile = false }
        do {
            try await account.saveProfile(name: name, sleeperUsername: sleeper)
            account.say("Profile saved.")
        } catch {
            profileError = error.localizedDescription
        }
    }

    private func signOut() async {
        await account.signOut()
        account.say("Signed out.")
        // On the site's rule a real league is for signed-in members; in the
        // app it stays open.
        if Supabase.requireAccount, let league = app.league, !league.isDemo { app.closeLeague() }
    }

    // MARK: Deleting the account

    private var deleteSection: some View {
        Section {
            Button(role: .destructive) {
                confirmDelete = true
            } label: {
                HStack {
                    Text("Delete Account")
                    if deleting { Spacer(); ProgressView() }
                }
                .frame(maxWidth: .infinity)
            }
        } footer: {
            if let deleteError {
                Text(deleteError).foregroundStyle(Theme.red)
            }
        }
    }

    /// Gone on the server first; only then signed out here, and the sheet
    /// shows the signed-out account (the sign-in dialog).
    private func deleteAccount() async {
        deleting = true
        deleteError = nil
        defer { deleting = false }
        do {
            try await account.deleteAccount()
            account.say("Your account has been deleted.")
        } catch {
            deleteError = error.localizedDescription
        }
    }
}

/// The legal pages, support and the app's version (App Review wants them
/// reachable from inside the app). The pages open in Safari.
struct AboutSection: View {
    private var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(short) (\(build))"
    }

    var body: some View {
        Section {
            Link(destination: Legal.privacy) { row("Privacy Policy", "hand.raised") }
            Link(destination: Legal.terms) { row("Terms of Service", "doc.text") }
            Link(destination: Legal.support) { row("Support", "questionmark.circle") }
            if let mail = URL(string: "mailto:\(Legal.supportEmail)") {
                Link(destination: mail) { row("Email Support", "envelope") }
            }
            LabeledContent("Version", value: version)
        } header: {
            Text("About")
        } footer: {
            Text(Legal.disclaimer)
        }
    }

    private func row(_ title: String, _ icon: String, detail: String? = nil) -> some View {
        HStack {
            Label(title, systemImage: icon)
            Spacer(minLength: 8)
            if let detail {
                Text(detail).font(.subheadline).foregroundStyle(Theme.ink3).lineLimit(1)
            }
            Image(systemName: "arrow.up.right").font(.caption.weight(.bold)).foregroundStyle(Theme.ink3)
        }
    }
}
