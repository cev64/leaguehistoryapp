import SwiftUI

/// The sign-in dialog (account.js drawAuth): sign in, create an account,
/// reset a password, and the "check your email" note. When a real league
/// is waiting on it (the gate), it says which, and opens that league once
/// the member is in.
struct AuthView: View {
    enum Mode: Hashable {
        case signin, signup, forgot
        case sent(String)
    }

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State var mode: Mode
    var reason: String? = nil
    var pending: AccountStore.PendingLeague? = nil
    /// Inside another screen's navigation (the account screen, signed out).
    var embedded = false

    @State private var email = ""
    @State private var password = ""
    @State private var name = ""
    @State private var error: String?
    @State private var busy = false
    @State private var succeeded = 0
    @FocusState private var focus: Field?

    private enum Field: Hashable { case name, email, password }

    var body: some View {
        if embedded {
            form
        } else {
            NavigationStack {
                form
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Close", systemImage: "xmark") { dismiss() }
                        }
                    }
            }
        }
    }

    private var title: String {
        switch mode {
        case .signin: return "Welcome back"
        case .signup: return "Create your account"
        case .forgot: return "Reset your password"
        case .sent: return "Check your email"
        }
    }

    private var tab: Binding<Mode> {
        Binding(get: { mode == .signup ? .signup : .signin }, set: { new in
            withAnimation(.smooth(duration: 0.25)) { mode = new; error = nil }
        })
    }

    private var form: some View {
        Form {
            if let pending {
                Section { GateHeader(pending: pending) }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }

            if mode == .signin || mode == .signup {
                Section {
                    Picker("Account", selection: tab) {
                        Text("Sign in").tag(Mode.signin)
                        Text("Create account").tag(Mode.signup)
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }

            switch mode {
            case .signin: signInFields
            case .signup: signUpFields
            case .forgot: forgotFields
            case .sent(let note): sentView(note)
            }

            // Signed out, the account screen is this form: the legal pages
            // and support are still a tap away.
            if embedded && (mode == .signin || mode == .signup) {
                AboutSection()
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.page)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .animation(.smooth(duration: 0.25), value: mode)
        .sensoryFeedback(.error, trigger: error) { _, new in new != nil }
        .sensoryFeedback(.success, trigger: succeeded)
        .disabled(busy)
        .task { debugFill() }
    }

    /// For checks on the simulator (debug builds only): PP_AUTH_EMAIL and
    /// PP_AUTH_PASSWORD fill the form, PP_AUTH_SUBMIT=1 sends it. Use an
    /// address that can't be anyone's (…@example.invalid).
    private func debugFill() {
        #if DEBUG
        let env = ProcessInfo.processInfo.environment
        guard email.isEmpty, let mail = env["PP_AUTH_EMAIL"] else { return }
        email = mail
        password = env["PP_AUTH_PASSWORD"] ?? ""
        if env["PP_AUTH_SUBMIT"] == "1" { submit() }
        #endif
    }

    // MARK: Views

    private var reasonText: String? {
        if let reason, !reason.isEmpty { return reason }
        if mode == .signup {
            return "It's free: every league you add, every season it played, and the league AI."
        }
        return nil
    }

    @ViewBuilder
    private var signInFields: some View {
        Section {
            emailField
            SecureField("Password", text: $password)
                .textContentType(.password)
                .focused($focus, equals: .password)
                .submitLabel(.go)
                .onSubmit(submit)
        } header: {
            if let reasonText, pending == nil { Text(reasonText).textCase(nil) }
        } footer: {
            errorLine
        }
        .listRowBackground(Theme.card)
        Section {
            primaryButton("Sign in")
            Button("Forgot your password?") {
                withAnimation { mode = .forgot; error = nil }
            }
            .frame(maxWidth: .infinity)
            .font(.subheadline)
            if !embedded {
                legalLine("[Terms of Service](\(Legal.terms.absoluteString)) · [Privacy Policy](\(Legal.privacy.absoluteString))")
            }
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
        .listRowSeparator(.hidden)
    }

    @ViewBuilder
    private var signUpFields: some View {
        Section {
            TextField("Name", text: $name, prompt: Text("Name: what the league calls you"))
                .textContentType(.nickname)
                .focused($focus, equals: .name)
                .submitLabel(.next)
                .onSubmit { focus = .email }
                .onChange(of: name) { _, v in if v.count > 60 { name = String(v.prefix(60)) } }
            emailField
            SecureField("Password", text: $password, prompt: Text("Password: at least 8 characters"))
                .textContentType(.newPassword)
                .focused($focus, equals: .password)
                .submitLabel(.go)
                .onSubmit(submit)
        } header: {
            if let reasonText, pending == nil { Text(reasonText).textCase(nil) }
        } footer: {
            errorLine
        }
        .listRowBackground(Theme.card)
        Section {
            primaryButton("Create free account")
            legalLine("By creating an account you agree to the [Terms of Service](\(Legal.terms.absoluteString)) and [Privacy Policy](\(Legal.privacy.absoluteString)).")
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
        .listRowSeparator(.hidden)
    }

    @ViewBuilder
    private var forgotFields: some View {
        Section {
            emailField
        } header: {
            Text("We'll email you a link to choose a new one.").textCase(nil)
        } footer: {
            errorLine
        }
        .listRowBackground(Theme.card)
        Section {
            primaryButton("Send reset link")
            Button("Back to sign in") {
                withAnimation { mode = .signin; error = nil }
            }
            .frame(maxWidth: .infinity)
            .font(.subheadline)
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
        .listRowSeparator(.hidden)
    }

    private func sentView(_ note: String) -> some View {
        Section {
            VStack(spacing: 14) {
                Image(systemName: "envelope.badge")
                    .font(.system(size: 44))
                    .foregroundStyle(Theme.accent)
                    .symbolEffect(.bounce, value: note)
                Text(note)
                    .font(.body)
                    .foregroundStyle(Theme.ink2)
                    .multilineTextAlignment(.center)
                Button {
                    if embedded { withAnimation { mode = .signin } } else { dismiss() }
                } label: {
                    Text("Done").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
            }
            .padding(.vertical, 8)
        }
        .listRowBackground(Color.clear)
    }

    private var emailField: some View {
        // The email is the account's username: `.username` is what pairs it
        // with the password field for Password AutoFill (and saving a new
        // account's password), on the email keyboard.
        TextField("Email", text: $email)
            .textContentType(mode == .forgot ? .emailAddress : .username)
            .keyboardType(.emailAddress)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .focused($focus, equals: .email)
            .submitLabel(mode == .forgot ? .send : .next)
            .onSubmit { if mode == .forgot { submit() } else { focus = .password } }
    }

    @ViewBuilder
    private var errorLine: some View {
        if let error {
            Label(error, systemImage: "exclamationmark.circle.fill")
                .font(.footnote.weight(.medium))
                .foregroundStyle(Theme.red)
                .transition(.opacity.combined(with: .move(edge: .top)))
        }
    }

    /// Small print with links (Markdown), under the button.
    private func legalLine(_ markdown: String) -> some View {
        Text((try? AttributedString(markdown: markdown)) ?? AttributedString(markdown))
            .font(.caption)
            .foregroundStyle(Theme.ink3)
            .tint(Theme.accentInk)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.top, 4)
    }

    private func primaryButton(_ label: String) -> some View {
        Button(action: submit) {
            ZStack {
                Text(label).opacity(busy ? 0 : 1)
                if busy { ProgressView() }
            }
            .font(.headline)
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.glassProminent)
        .controlSize(.large)
        .padding(.vertical, 4)
    }

    // MARK: Submitting

    private func submit() {
        let mail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        let needsPassword = mode != .forgot
        if mail.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) == nil {
            error = "Enter a valid email address."
            focus = .email
            return
        }
        if needsPassword && password.count < 8 {
            error = "Use a password of at least 8 characters."
            focus = .password
            return
        }
        error = nil
        busy = true
        focus = nil
        let account = app.account
        let mode = self.mode
        Task {
            defer { busy = false }
            do {
                switch mode {
                case .signin:
                    try await account.signIn(email: mail, password: password)
                    succeeded += 1
                    account.say("Signed in.")
                    finish()
                case .signup:
                    let confirm = try await account.signUp(email: mail, password: password, name: name.trimmingCharacters(in: .whitespaces))
                    succeeded += 1
                    if confirm {
                        withAnimation { self.mode = .sent("We sent a confirmation link to \(mail). Follow it to finish creating your account.") }
                    } else {
                        account.say("Welcome! Your account is ready.")
                        finish()
                    }
                case .forgot:
                    try await account.resetPassword(email: mail)
                    withAnimation { self.mode = .sent("If there's an account for \(mail), a reset link is on its way.") }
                case .sent:
                    break
                }
            } catch {
                withAnimation { self.error = error.localizedDescription }
            }
        }
    }

    /// Signed in: close, and open the league that was waiting, if any.
    private func finish() {
        password = ""
        if embedded { return }
        let waiting = pending ?? app.account.pending
        dismiss()
        if let waiting {
            Task {
                try? await Task.sleep(for: .milliseconds(350))
                app.open(waiting.id)
            }
        }
    }
}

/// The gate over a league (account.js drawGate, signed out): which league,
/// and what an account gets you.
private struct GateHeader: View {
    let pending: AccountStore.PendingLeague

    var body: some View {
        VStack(spacing: 10) {
            LeagueMark(name: pending.name ?? "", avatar: pending.avatar, size: 60)
            Text("Sign in to open \(pending.name ?? "this league")")
                .font(.title3.weight(.bold))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
            Text("Pigskin Pantheon is free with an account: every season your league has played, the trophy room and the league AI.")
                .font(.subheadline)
                .foregroundStyle(Theme.ink2)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }
}

/// A league's picture, or its first letter on the site's blue (the front
/// page's team-badge).
struct LeagueMark: View {
    let name: String
    let avatar: String?
    var size: CGFloat = 40

    var body: some View {
        ZStack {
            Circle().fill(Color(hex: avatar == nil ? 0x304F91 : 0x102B43))
            Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased().ifEmpty("?"))
                .font(.system(size: size * 0.42, weight: .heavy))
                .foregroundStyle(.white)
            if let avatar, avatar.hasPrefix("http"), let url = URL(string: avatar) {
                RemoteImage(url: url) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() }
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(.white.opacity(0.15)))
        .accessibilityHidden(true)
    }
}

extension String {
    func ifEmpty(_ fallback: String) -> String { isEmpty ? fallback : self }
}

// MARK: Toast

/// account.js's toast: a short note at the foot of the screen for a moment.
struct AccountToast: ViewModifier {
    @Environment(AppModel.self) private var app

    func body(content: Content) -> some View {
        content.overlay(alignment: .bottom) {
            if let toast = app.account.toast {
                Text(toast.message)
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 18)
                    .padding(.vertical, 12)
                    .glassEffect(.regular, in: Capsule())
                    .padding(.bottom, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .id(toast.id)
                    .task(id: toast.id) {
                        try? await Task.sleep(for: .seconds(3.2))
                        withAnimation(.smooth) { if app.account.toast?.id == toast.id { app.account.toast = nil } }
                    }
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .animation(.smooth(duration: 0.3), value: app.account.toast)
    }
}

extension View {
    func accountToast() -> some View { modifier(AccountToast()) }
}
