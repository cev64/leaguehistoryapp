import SwiftUI
import UIKit

/// Ask the League: the League Historian, an AI that answers questions about
/// the league from the league's own data (chat.js on the site). A sheet over
/// the league, half or full height, with the question box in Liquid Glass at
/// the bottom. The answer streams in as it's written; the AI's look-ups (box
/// scores, a player's history, trades...) run in the league's engine, on the
/// data the app already has, and go back to it, up to eight per question.
///
/// Members only: signed out, the same sheet shows what it is and the way
/// in. Nothing is sent to the AI before the member allows it (App Review
/// 5.1.2): the first question asks first, and the ⋯ menu takes it back.
struct ChatScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(AppModel.self) private var app
    @Environment(LeagueSession.self) private var session

    @State private var draft = ""
    @State private var detent: PresentationDetent = .large
    @State private var position = ScrollPosition(edge: .bottom)
    @FocusState private var focused: Bool
    /// Signing in from the chat happens over it, so the member lands back
    /// in the conversation.
    @State private var signingIn = false
    /// The member's yes to sharing with the AI providers.
    @AppStorage(ChatConversation.consentKey) private var consented = false
    /// A question held while the member decides whether to share.
    @State private var held: HeldQuestion?
    /// A report whose email couldn't be opened (no Mail account).
    @State private var reportUnsent = false

    private var chat: ChatConversation { ChatConversation.of(league: session.id) }
    private var name: String { chat.intro?.name ?? session.summary?.name ?? "the league" }

    /// The site's `pro()`: every signed-in member while plans are off (the
    /// function checks again: 402 pro_required).
    private var unlocked: Bool {
        #if DEBUG
        if DebugChat.mode != nil { return true }
        #endif
        return app.account.isPro
    }

    var body: some View {
        NavigationStack {
            Group {
                if unlocked {
                    conversation
                } else {
                    ChatLockedView(name: name, signedIn: app.account.isSignedIn) {
                        signingIn = true
                    }
                }
            }
            .background(Theme.page.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
        }
        .sheet(isPresented: $signingIn) {
            AccountScreen()
                .environment(app)
        }
        .sheet(item: $held) { question in
            ChatConsentSheet(name: name, allow: {
                consented = true
                held = nil
                // A stopped answer still unwinding: the question waits in the box.
                if chat.busy, draft.isEmpty { draft = question.text }
                else if !question.text.isEmpty { ask(question.text) }
            }, notNow: {
                // Nothing is sent; the question waits in the box.
                if draft.isEmpty { draft = question.text }
                held = nil
            })
        }
        .alert("Couldn't open Mail", isPresented: $reportUnsent) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("The report is copied. Email it to \(Legal.supportEmail) and we'll take a look.")
        }
        .presentationDetents([.medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .presentationBackgroundInteraction(.enabled(upThrough: .medium))
        .sensoryFeedback(.impact(weight: .light), trigger: chat.sentCount)
        .sensoryFeedback(.success, trigger: chat.answeredCount)
        .sensoryFeedback(.error, trigger: chat.failedCount)
        .task {
            await chat.prepare(engine: session.engine)
            // Start reading the league while they type.
            if unlocked { chat.warm(engine: session.engine) }
            #if DEBUG
            await DebugChat.run(chat, engine: session.engine, token: token)
            if DebugChat.mode == "long" { draft = String(repeating: "How many titles? ", count: 130) }
            if DebugChat.mode == "consent" { ask("Who has the most titles?") }
            #endif
        }
        .onChange(of: unlocked) { _, open in
            if open { chat.warm(engine: session.engine) }
        }
        .onChange(of: app.account.isSignedIn) { _, signedIn in
            // Signed in from here: back to the chat, not the account panel.
            if signedIn { signingIn = false }
        }
    }

    // MARK: Header

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button(role: .close) { dismiss() }
        }
        ToolbarItem(placement: .principal) {
            HStack(spacing: 10) {
                ChatMark(size: 30, working: chat.busy)
                VStack(alignment: .leading, spacing: 0) {
                    Text(name)
                        .font(.system(size: 10.5, weight: .bold))
                        .tracking(1.2)
                        .textCase(.uppercase)
                        .foregroundStyle(Theme.goldInk)
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        Text("League Historian")
                            .displayStyle(19)
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                        // Every answer here is written by an AI.
                        Text("AI")
                            .font(.system(size: 9.5, weight: .heavy))
                            .tracking(0.6)
                            .foregroundStyle(Theme.accentInk)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(Theme.accentSoft, in: Capsule())
                            .accessibilityLabel("AI-generated answers")
                    }
                }
            }
            .accessibilityElement(children: .combine)
        }
        if unlocked, !chat.shown.isEmpty || chat.busy {
            ToolbarItem(placement: .topBarTrailing) {
                Button("New chat", systemImage: "arrow.counterclockwise") {
                    chat.fresh()
                    draft = ""
                    focused = true
                }
            }
        }
        if unlocked {
            ToolbarItem(placement: .topBarTrailing) {
                Menu("More", systemImage: "ellipsis") {
                    if consented {
                        Button("Turn Off AI Sharing", systemImage: "hand.raised") {
                            // Nothing more goes out, the answer being written included.
                            consented = false
                            chat.stop()
                        }
                    } else {
                        Button("Turn On AI Sharing…", systemImage: "hand.raised") { held = HeldQuestion(text: "") }
                    }
                    Link(destination: Legal.privacy) {
                        Label("Privacy Policy", systemImage: "lock.shield")
                    }
                }
            }
        }
    }

    // MARK: The conversation

    private var conversation: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if chat.shown.isEmpty, !chat.busy {
                    ChatWelcome(name: name, suggestions: chat.intro?.suggestions ?? []) { ask($0) }
                    if let intro = chat.intro, intro.endpoint.isEmpty {
                        ChatNote(text: "Ask the League isn't available right now. Try again later.")
                    } else if let error = chat.introError {
                        ChatNote(text: error)
                    }
                }
                ForEach(chat.shown) { message in
                    ChatMessageRow(message: message,
                                   retry: { chat.retry(engine: session.engine, token: token) },
                                   signIn: { signingIn = true },
                                   report: { report(message) })
                        .transition(.asymmetric(insertion: .move(edge: message.role == .user ? .trailing : .bottom).combined(with: .opacity),
                                                removal: .opacity))
                }
                if let pending = chat.pending {
                    ChatPendingRow(pending: pending)
                        .transition(.opacity.combined(with: .move(edge: .bottom)))
                }
                if chat.long {
                    ChatNote(text: "This chat is getting long. Start a new one (↻ above) to keep going.")
                }
                if !consented, !chat.shown.isEmpty, !chat.busy {
                    ChatNote(text: "AI sharing is off. Nothing more is sent until you allow it again.")
                }
            }
            .animation(.snappy(duration: 0.35), value: chat.shown)
            .animation(.snappy(duration: 0.35), value: chat.pending == nil)
            .padding(.horizontal, Theme.gutter)
            .padding(.top, 14)
            .padding(.bottom, 10)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .scrollPosition($position)
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        .defaultScrollAnchor(.bottom, for: .sizeChanges)
        .defaultScrollAnchor(chat.shown.isEmpty && !chat.busy ? .center : .top, for: .alignment)
        .scrollDismissesKeyboard(.interactively)
        .safeAreaBar(edge: .bottom) { composer }
    }

    // MARK: The question box

    private var composer: some View {
        VStack(spacing: 7) {
            GlassEffectContainer(spacing: 10) {
                HStack(alignment: .bottom, spacing: 10) {
                    TextField("Ask about any season, rivalry, trade…", text: $draft, axis: .vertical)
                        .lineLimit(1...5)
                        .focused($focused)
                        .submitLabel(.send)
                        .onSubmit(send)
                        .disabled(chat.full && !chat.busy)
                        .accessibilityLabel("Your question")
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .frame(minHeight: 48)
                        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 24))

                    Button {
                        if chat.busy { chat.stop() } else { send() }
                    } label: {
                        Image(systemName: chat.busy ? "stop.fill" : "arrow.up")
                            .font(.system(size: chat.busy ? 15 : 18, weight: .bold))
                            .frame(width: 34, height: 34)
                            .contentTransition(.symbolEffect(.replace))
                    }
                    .buttonStyle(.glassProminent)
                    .buttonBorderShape(.circle)
                    .tint(chat.busy ? Theme.navy2 : Theme.accent)
                    .disabled(!chat.busy && (draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || chat.full))
                    .accessibilityLabel(chat.busy ? "Stop" : "Send")
                }
            }
            if draft.utf16.count >= ChatConversation.maxQuestion - 200 {
                // Near the function's limit: how much room is left.
                Text("\(draft.utf16.count.formatted()) / \(ChatConversation.maxQuestion.formatted())")
                    .font(.caption2.weight(.semibold).monospacedDigit())
                    .foregroundStyle(draft.utf16.count >= ChatConversation.maxQuestion ? Theme.red : Theme.ink3)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.trailing, 50)
            } else {
                Text("Answers are AI-generated and can be wrong. Check the record book for anything that matters.")
                    .font(.caption2)
                    .foregroundStyle(Theme.ink3)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, Theme.gutter)
        .padding(.top, 8)
        .padding(.bottom, 6)
        .frame(maxWidth: 720)
        .frame(maxWidth: .infinity)
        .onChange(of: draft) { old, new in
            // Return sends, as Enter does on the site; the box holds what
            // the function takes (2,000 characters).
            if new.hasSuffix("\n"), !old.hasSuffix("\n"), new.count == old.count + 1 {
                draft = String(new.dropLast())
                send()
                return
            }
            let clipped = ChatConversation.clipped(new)
            if clipped != new { draft = clipped }
        }
    }

    /// The member's token, as chat.js's post() takes Account.accessToken():
    /// refreshed first when it's about to run out (or, forced, after the
    /// function turned it down). Signed out, the request goes with the
    /// anon key and the function answers "sign in first".
    private var token: ChatToken {
        let account = app.account
        return { force in
            guard account.isSignedIn else { return nil }
            let fresh = await account.freshen(force: force)
            if force && !fresh { return nil }
            return account.accessToken
        }
    }

    private func send() {
        let question = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty, !chat.busy, !chat.full else { return }
        draft = ""
        ask(question)
    }

    private func ask(_ question: String) {
        // The first question asks before anything leaves the phone.
        guard consented else {
            focused = false
            held = HeldQuestion(text: question)
            return
        }
        chat.ask(question, engine: session.engine, token: token)
        withAnimation(.snappy) { position.scrollTo(edge: .bottom) }
    }

    /// Hides the answer and writes to support about it, with the question
    /// and the answer filled in.
    private func report(_ message: ChatMessage) {
        guard let (question, answer) = chat.report(message.id) else { return }
        let body = ChatReport.body(league: name, question: question, answer: answer)
        guard let url = ChatReport.mail(body: body) else { return }
        openURL(url) { opened in
            if !opened {
                UIPasteboard.general.string = body
                reportUnsent = true
            }
        }
    }
}

/// A question waiting on the member's answer to the consent sheet (empty
/// when the sheet was opened from the menu).
struct HeldQuestion: Identifiable {
    let id = UUID()
    let text: String
}

/// A report of an answer, as an email to support: the question and what
/// the AI said, cut short enough to travel in a mailto: link.
enum ChatReport {
    static let subject = "Ask the League report"

    static func body(league: String, question: String, answer: String) -> String {
        """
        What's wrong with this answer? (optional)


        ---
        League: \(clip(league, 120))
        Question: \(clip(question, 500))

        Answer (AI-generated):
        \(clip(answer, 1500))
        """
    }

    static func mail(body: String) -> URL? {
        URL(string: "mailto:\(Legal.supportEmail)?subject=\(encode(subject))&body=\(encode(body))")
    }

    private static func clip(_ text: String, _ limit: Int) -> String {
        text.count > limit ? String(text.prefix(limit)) + "…" : text
    }

    /// Everything but unreserved ASCII escaped, so `&`, `=` and `+` in an
    /// answer stay in it; line breaks as CRLF, as mailto: wants them.
    private static func encode(_ text: String) -> String {
        let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        return text.replacingOccurrences(of: "\n", with: "\r\n").addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
    }
}

// MARK: - Messages

/// The League Historian's mark: a gold spark on navy.
struct ChatMark: View {
    var size: CGFloat = 28
    var working = false

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.32, style: .continuous)
            .fill(LinearGradient(colors: [Theme.navy2, Theme.navy], startPoint: .topLeading, endPoint: .bottomTrailing))
            .frame(width: size, height: size)
            .overlay {
                Image(systemName: "sparkles")
                    .font(.system(size: size * 0.5, weight: .semibold))
                    .foregroundStyle(Theme.gold)
                    .symbolEffect(.breathe, isActive: working)
            }
            .shadow(color: Theme.navy.opacity(0.2), radius: 5, y: 3)
            .accessibilityHidden(true)
    }
}

private let userShape = UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 18, bottomTrailingRadius: 6,
                                               topTrailingRadius: 18, style: .continuous)
private let aiShape = UnevenRoundedRectangle(topLeadingRadius: 6, bottomLeadingRadius: 18, bottomTrailingRadius: 18,
                                             topTrailingRadius: 18, style: .continuous)

struct ChatMessageRow: View {
    let message: ChatMessage
    var retry: () -> Void = {}
    var signIn: () -> Void = {}
    /// Reports the answer (App Review 1.2: objectionable AI output can be
    /// flagged); nil where there's nothing to report.
    var report: (() -> Void)? = nil

    var body: some View {
        switch message.role {
        case .user:
            HStack {
                Spacer(minLength: 48)
                Text(message.text)
                    .font(.body)
                    .foregroundStyle(.white)
                    .textSelection(.enabled)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(LinearGradient(colors: [Color(hex: 0x2B7CF0), Color(hex: 0x1769E0), Color(hex: 0x0F56BD)],
                                               startPoint: .topLeading, endPoint: .bottomTrailing), in: userShape)
                    .shadow(color: Color(hex: 0x1769E0).opacity(0.22), radius: 9, y: 5)
            }
        case .assistant where message.reported:
            HStack(alignment: .top, spacing: 9) {
                ChatMark()
                    .padding(.top, 2)
                Label("Reported — thanks. This answer is hidden.", systemImage: "flag.fill")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.ink2)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 11)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.surface2, in: aiShape)
                    .overlay(aiShape.stroke(Theme.line, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            }
        case .assistant:
            HStack(alignment: .top, spacing: 9) {
                ChatMark()
                    .padding(.top, 2)
                Group {
                    if message.error {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(message.text)
                                .foregroundStyle(Theme.red)
                                .fixedSize(horizontal: false, vertical: true)
                            HStack(spacing: 8) {
                                if message.signIn {
                                    Button("Sign in", action: signIn)
                                        .buttonStyle(.glassProminent)
                                        .tint(Theme.accent)
                                }
                                if message.retry {
                                    Button("Try again", action: retry)
                                        .buttonStyle(.glass)
                                }
                            }
                            .font(.subheadline.weight(.semibold))
                        }
                    } else {
                        ChatMarkdownView(text: message.text)
                            .textSelection(.enabled)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(message.error ? Theme.redSoft : Theme.card, in: aiShape)
                .overlay(aiShape.stroke(message.error ? Theme.red.opacity(0.25) : Theme.line, lineWidth: 1))
                .contextMenu {
                    Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = message.text }
                    if !message.error, let report {
                        Button("Report Answer", systemImage: "flag", action: report)
                    }
                }
            }
        }
    }
}

/// The answer being written: a status line while it works (it reads the
/// league, then names each look-up), then the words as they arrive.
struct ChatPendingRow: View {
    let pending: ChatPending

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            ChatMark(working: true)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 10) {
                if !pending.text.isEmpty {
                    ChatMarkdownView(text: pending.text, caret: !pending.looking)
                }
                if pending.text.isEmpty || pending.looking {
                    ChatStatusLine(status: pending.status)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: aiShape)
            .overlay(aiShape.stroke(pending.looking ? Theme.accent.opacity(0.35) : Theme.line, lineWidth: 1))
            .background(aiShape.stroke(Theme.accent.opacity(pending.looking ? 0.08 : 0), lineWidth: 8))
            .animation(.easeInOut(duration: 0.25), value: pending.looking)
        }
        .accessibilityElement(children: .combine)
    }
}

struct ChatStatusLine: View {
    let status: String

    var body: some View {
        HStack(spacing: 10) {
            ChatDots()
            Text("\(status)…")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.ink2)
                .id(status)
                .transition(.asymmetric(insertion: .opacity.combined(with: .offset(y: 5)), removal: .opacity))
        }
        .animation(.easeOut(duration: 0.35), value: status)
    }
}

/// Three dots that bounce in turn: blue, lighter blue, gold.
struct ChatDots: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { i in
                    let phase = (t / 1.2 - Double(i) * 0.125).truncatingRemainder(dividingBy: 1)
                    let lift = phase < 0.3 ? sin(phase / 0.3 * .pi) : 0
                    Circle()
                        .fill([Theme.accent, Color(hex: 0x4F8FF0), Theme.gold][i])
                        .frame(width: 6, height: 6)
                        .offset(y: reduceMotion ? 0 : -5 * lift)
                        .opacity(0.5 + 0.5 * lift)
                }
            }
        }
        .frame(height: 12)
        .accessibilityHidden(true)
    }
}

struct ChatNote: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(Theme.ink2)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity)
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.line, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
    }
}

// MARK: - Welcome

/// Before the first question: the football in its orbit, what it knows,
/// and four questions to start with.
struct ChatWelcome: View {
    let name: String
    let suggestions: [String]
    let ask: (String) -> Void
    @State private var shown = false

    var body: some View {
        VStack(spacing: 0) {
            ChatOrb()
            Text("Ask me anything about \(name)")
                .displayStyle(26)
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
                .padding(.top, 18)
                .padding(.bottom, 6)
            Text("Every season, game, trade, draft and box score in the league's history. Rivalries, records, who choked, who got fleeced.")
                .font(.subheadline)
                .foregroundStyle(Theme.ink2)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 330)
                .padding(.bottom, 18)
            VStack(spacing: 8) {
                ForEach(Array(suggestions.enumerated()), id: \.offset) { i, q in
                    Button { ask(q) } label: {
                        HStack(spacing: 10) {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(LinearGradient(colors: [Theme.gold, Theme.accent], startPoint: .topLeading, endPoint: .bottomTrailing))
                                .frame(width: 7, height: 7)
                                .rotationEffect(.degrees(45))
                            Text(q)
                                .font(.system(size: 14.5, weight: .semibold))
                                .foregroundStyle(Theme.ink)
                                .multilineTextAlignment(.leading)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.tint(Theme.card.opacity(0.6)).interactive(), in: .rect(cornerRadius: 14))
                    .opacity(shown ? 1 : 0)
                    .offset(y: shown ? 0 : 10)
                    .animation(.spring(duration: 0.55).delay(0.2 + Double(i) * 0.07), value: shown)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .onAppear { shown = true }
    }
}

/// The football in a navy orb, with gold and blue sparks in orbit.
struct ChatOrb: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            ZStack {
                Circle()
                    .fill(RadialGradient(colors: [Color(hex: 0x1D4A73), Theme.navy2, Theme.navy],
                                         center: UnitPoint(x: 0.35, y: 0.3), startRadius: 2, endRadius: 46))
                    .padding(14)
                    .shadow(color: Theme.navy.opacity(0.28), radius: 17, y: 16)
                    .overlay(Circle().stroke(Theme.accent.opacity(0.1), lineWidth: 6).padding(11))
                Image(systemName: "football.fill")
                    .font(.system(size: 34))
                    .foregroundStyle(Color(hex: 0x8A4B2A))
                    .rotationEffect(.degrees(reduceMotion ? 0 : 1 + 7 * sin(t / 3.6 * 2 * .pi)))
                    .offset(y: reduceMotion ? 0 : -1 - 2 * sin(t / 3.6 * 2 * .pi))
                ZStack {
                    Circle().fill(Theme.gold).frame(width: 9, height: 9).shadow(color: Theme.gold.opacity(0.8), radius: 5)
                        .offset(y: -44)
                    Circle().fill(Color(hex: 0x6EA8FF)).frame(width: 6, height: 6).shadow(color: Color(hex: 0x6EA8FF).opacity(0.8), radius: 5)
                        .offset(x: -36, y: 26)
                    Circle().fill(Theme.gold).frame(width: 5, height: 5)
                        .offset(x: 42, y: 18)
                }
                .rotationEffect(.degrees(reduceMotion ? 0 : (t / 7).truncatingRemainder(dividingBy: 1) * 360))
            }
            .frame(width: 96, height: 96)
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Signed out

/// What someone without the chat sees: a glimpse of a conversation, what
/// it does, and the way in. Signed out, that's signing in (the rest of the
/// app works without an account); signed in to an account the function
/// won't answer, just that it isn't available.
struct ChatLockedView: View {
    let name: String
    let signedIn: Bool
    let signIn: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                teaser
                card
            }
            .padding(Theme.gutter)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
    }

    private var teaser: some View {
        VStack(spacing: 12) {
            ChatMessageRow(message: ChatMessage(role: .user, text: "Who has the most titles?"))
            skeleton([0.88, 0.72, 0.54])
            ChatMessageRow(message: ChatMessage(role: .user, text: "Worst trade ever?"))
            skeleton([0.8, 0.62])
        }
        .opacity(0.55)
        .mask(LinearGradient(colors: [.black, .black.opacity(0.2)], startPoint: .top, endPoint: .bottom))
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func skeleton(_ widths: [CGFloat]) -> some View {
        HStack(alignment: .top, spacing: 9) {
            ChatMark()
            VStack(alignment: .leading, spacing: 7) {
                ForEach(Array(widths.enumerated()), id: \.offset) { _, w in
                    Capsule().fill(Theme.surface3).frame(height: 9)
                        .containerRelativeFrame(.horizontal) { length, _ in length * w * 0.6 }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 13)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: aiShape)
            .overlay(aiShape.stroke(Theme.line, lineWidth: 1))
            Spacer(minLength: 60)
        }
    }

    private var card: some View {
        VStack(spacing: 12) {
            Image(systemName: signedIn ? "lock.fill" : "person.fill")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Theme.navy)
                .frame(width: 48, height: 48)
                .background(Theme.gold, in: Circle())
            Text("Ask the League")
                .font(.system(size: 11, weight: .bold))
                .tracking(1.4)
                .textCase(.uppercase)
                .foregroundStyle(Theme.goldInk)
            if signedIn {
                Text("Not available right now")
                    .displayStyle(26)
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.center)
                Text("Ask the League isn't available for this account right now.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
                    .multilineTextAlignment(.center)
            } else {
                Text("Sign in to use Ask the League")
                    .displayStyle(26)
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.center)
                Text("Ask anything about \(name) and get the answer in seconds, straight from every season you've played.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
                    .multilineTextAlignment(.center)
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(features, id: \.self) { line in
                        Label {
                            Text(line).foregroundStyle(Theme.ink)
                        } icon: {
                            Image(systemName: "checkmark").fontWeight(.bold).foregroundStyle(Theme.green)
                        }
                        .font(.subheadline.weight(.medium))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 4)
                Button(action: signIn) {
                    Text("Sign In").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .tint(Theme.accent)
                Text("Everything else in the app works without an account.")
                    .font(.caption)
                    .foregroundStyle(Theme.ink3)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(20)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Theme.line, lineWidth: 1))
        .shadow(color: .black.opacity(0.06), radius: 14, y: 6)
    }

    private var features: [String] {
        ["Records, rivalries and head-to-head",
         "Every trade, draft and waiver pickup",
         "Box scores and player histories"]
    }
}

// MARK: - Sharing with the AI

/// Asked before the first question goes out (App Review 5.1.2(i)): what is
/// sent, to whom and why, with Allow and Not Now. What it lists is what
/// chat.js's digestOf and toolkit write out and the app sends with each
/// question: keep it in step with them.
struct ChatConsentSheet: View {
    let name: String
    let allow: () -> Void
    let notNow: () -> Void
    @State private var height: CGFloat = 560

    var body: some View {
        ScrollView {
            content
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(Theme.page.ignoresSafeArea())
        .presentationDetents([.height(height)])
        // A choice either way: swiping it away would leave the question hanging.
        .interactiveDismissDisabled()
    }

    private var content: some View {
        VStack(spacing: 0) {
            ChatMark(size: 44)
            Text("Ask the League")
                .font(.system(size: 11, weight: .bold))
                .tracking(1.4)
                .textCase(.uppercase)
                .foregroundStyle(Theme.goldInk)
                .padding(.top, 14)
            Text("Share league data with AI?")
                .displayStyle(24)
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
                .padding(.top, 4)
            Text("To answer, Ask the League sends the following to \(Legal.aiProviders), through Pigskin Pantheon's server:")
                .font(.subheadline)
                .foregroundStyle(Theme.ink2)
                .multilineTextAlignment(.center)
                .padding(.top, 8)

            VStack(alignment: .leading, spacing: 12) {
                item("text.bubble", "Your questions, and this chat so far")
                item("list.bullet.rectangle", "A summary of \(name): manager and team names, every season's standings, scores and playoff results, records, head-to-heads and most-started players")
                item("magnifyingglass", "Details the AI looks up as it answers: lineups and box scores, player histories, trades, waiver pickups and drafts")
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous).stroke(Theme.line, lineWidth: 1))
            .padding(.top, 16)

            Text("It's used only to write the answer. Your email and account details aren't sent to the AI.")
                .font(.footnote)
                .foregroundStyle(Theme.ink2)
                .multilineTextAlignment(.center)
                .padding(.top, 12)
            Link("Privacy Policy", destination: Legal.privacy)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.accentInk)
                .padding(.top, 6)

            VStack(spacing: 8) {
                Button(action: allow) {
                    Text("Allow").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .tint(Theme.accent)
                Button(action: notNow) {
                    Text("Not Now").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glass)
            }
            .controlSize(.large)
            .fontWeight(.semibold)
            .padding(.top, 18)
            Text("You can turn this off any time from the ⋯ menu in Ask the League.")
                .font(.caption)
                .foregroundStyle(Theme.ink3)
                .multilineTextAlignment(.center)
                .padding(.top, 10)
        }
        .padding(.horizontal, 22)
        .padding(.top, 26)
        .padding(.bottom, 16)
        .frame(maxWidth: 520)
        .frame(maxWidth: .infinity)
    }

    private func item(_ icon: String, _ text: String) -> some View {
        Label {
            Text(text)
                .font(.subheadline)
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: icon)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.accent)
        }
    }
}

// MARK: - Debug

#if DEBUG
/// Launch settings for checking the chat without an account
/// (SIMCTL_CHILD_PP_CHAT=...):
///   signedin   the member's view (questions go out signed out: the
///              function answers "Sign in first.")
///   sample     a finished conversation with every mark the renderer knows
///   tools      runs three of the AI's tools in the engine and shows them
///   ask:<q>    asks <q> as soon as the sheet opens
///   stop:<q>   asks <q>, then presses stop four seconds in
///   long       fills the question box past the 2,000-character limit
///   consent    asks a question, so the consent sheet opens (unless already allowed)
/// Questions go out only once AI sharing is allowed: tap Allow, or launch
/// with the arguments `-aiConsent.v1 YES`. And SIMCTL_CHILD_PP_CHAT_URL=http://127.0.0.1:<port> sends the questions
/// to a stand-in for the league-chat function instead.
enum DebugChat {
    static var mode: String? { ProcessInfo.processInfo.environment["PP_CHAT"] }

    @MainActor
    static func run(_ chat: ChatConversation, engine: LeagueEngine, token: @escaping ChatToken) async {
        guard let mode else { return }
        if mode == "sample" {
            chat.loadSample(sample)
        } else if mode == "tools" {
            await chat.sampleTools(engine: engine)
        } else if mode.hasPrefix("ask:"), chat.shown.isEmpty {
            chat.ask(String(mode.dropFirst(4)), engine: engine, token: token)
        } else if mode.hasPrefix("stop:"), chat.shown.isEmpty {
            chat.ask(String(mode.dropFirst(5)), engine: engine, token: token)
            try? await Task.sleep(for: .seconds(4))
            chat.stop()
        }
    }

    static let sample: [ChatMessage] = [
        ChatMessage(role: .user, text: "Who has won the most championships?"),
        ChatMessage(role: .assistant, text: """
        **GridironGreg** owns this league: **2 titles** (2023, 2025) and a **47-23** regular-season record. Everyone else is playing for second.

        | Manager | Titles | Record | PF/game |
        | --- | --- | --- | --- |
        | GridironGreg | 2 (2023, 2025) | 47-23 | 118.42 |
        | TDTommy | 1 (2024) | 38-32 | 109.87 |
        | FlexLuthor | 1 (2022) | 36-34 | 111.05 |

        *FlexLuthor* has been chasing that 2022 high ever since.
        """),
        ChatMessage(role: .user, text: "Worst trade ever?"),
        ChatMessage(role: .assistant, text: """
        ### The heist
        SackMasterSam sent away the `1.01` for a bag of magic beans:
        - **Bijan Robinson**: 232.54 pts in 15 starts for Greg
        - _two_ second-rounders: 41.10 pts, total
        ---
        1. Lopsided by **191.44**
        2. Aged like milk
        """),
        ChatMessage(role: .user, text: "And this season?"),
        ChatMessage(role: .assistant, text: "Sign in first.", error: true, retry: true, signIn: true),
        ChatMessage(role: .user, text: "Who choked hardest?"),
        ChatMessage(role: .assistant, text: "**WaiverWendy** went 11-3 and lost her first playoff game by **0.42**\n\n*(stopped)*"),
    ]
}
#endif
