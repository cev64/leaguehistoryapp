import SwiftUI

/// The player search (ui.js playerFinder over PlayerCard.search): names
/// containing every word typed, in any order, accents and punctuation
/// ignored, the most-started first. Before anything is typed, the players
/// opened lately and the league's most-started players.
struct PlayerSearchScreen: View {
    @Environment(LeagueSession.self) private var session
    @Environment(\.horizontalSizeClass) private var sizeClass

    @State private var query = PlayerSearchScreen.launchQuery
    /// nil while nothing is typed (or the first answer is on its way).
    @State private var hits: [PlayerHit]?
    @State private var popular: [PlayerHit]?
    @State private var recents: [PlayerHit] = []
    @State private var failed: String?
    /// The first hit, opened by the keyboard's Search key (the site's Enter).
    @State private var submitted: String?

    /// SIMCTL_CHILD_PP_QUERY=<text> opens the search with that typed, for screenshots.
    private static var launchQuery: String {
        #if DEBUG
        return ProcessInfo.processInfo.environment["PP_QUERY"] ?? ""
        #else
        return ""
        #endif
    }

    private var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        PageScroll(maxWidth: 1000) {
            if trimmed.isEmpty {
                DemoBanner()
                if !recents.isEmpty {
                    PCHitSection(title: "Recently viewed", symbol: "clock.arrow.circlepath", meta: nil, hits: recents) { hit in
                        Button(role: .destructive) {
                            PCRecents.remove(hit.id, league: session.id)
                            withAnimation { recents.removeAll { $0.id == hit.id } }
                        } label: {
                            Label("Remove from recents", systemImage: "minus.circle")
                        }
                    }
                }
                if let popular {
                    PCHitSection(title: "Most started", symbol: "star", meta: "All seasons", hits: popular)
                } else if let failed {
                    EmptyCard(title: "Players couldn't be loaded", detail: failed, symbol: "exclamationmark.triangle")
                } else {
                    LoadingCard(title: "Loading players…")
                }
            } else if let hits {
                if hits.isEmpty {
                    Card {
                        ContentUnavailableView {
                            Label("No results", systemImage: "magnifyingglass")
                        } description: {
                            Text("No one by that name has played in this league.")
                        }
                        .padding(.vertical, 8)
                    }
                } else {
                    PCHitSection(title: "Players", symbol: "person.2", meta: Fmt.plural(hits.count, "match", "matches"), hits: hits)
                }
            } else {
                LoadingCard(title: "Searching…")
            }
        }
        .animation(.smooth(duration: 0.2), value: hits)
        .navigationTitle("Players")
        .searchable(text: $query, prompt: "Search any player")
        .autocorrectionDisabled()
        .textInputAutocapitalization(.words)
        .onSubmit(of: .search) {
            if let first = hits?.first { submitted = first.id }
        }
        .navigationDestination(item: $submitted) { id in
            PlayerCardView(playerId: id)
        }
        .leagueToolbar()
        .task(id: trimmed) { await search() }
        .task { await loadPopular() }
        .onAppear { Task { await loadRecents() } }
    }

    private func search() async {
        let q = trimmed
        guard !q.isEmpty else { hits = nil; return }
        // Wait for a pause in the typing.
        try? await Task.sleep(for: .milliseconds(120))
        guard !Task.isCancelled else { return }
        do {
            let found = try await session.engine.call([PlayerHit].self, "Bridge.player.search(q, 25)", ["q": q])
            guard !Task.isCancelled else { return }
            hits = found
        } catch {
            guard !Task.isCancelled else { return }
            hits = []
        }
    }

    private func loadPopular() async {
        guard popular == nil else { return }
        do {
            popular = try await session.engine.call([PlayerHit].self, "Bridge.player.popular(12)")
            failed = nil
        } catch {
            failed = error.localizedDescription
        }
    }

    private func loadRecents() async {
        let ids = PCRecents.load(session.id)
        guard !ids.isEmpty else { recents = []; return }
        if let found = try? await session.engine.call([PlayerHit].self, "Bridge.player.brief(ids)", ["ids": ids]) {
            recents = found
        }
    }
}

// MARK: Results

private struct PCHitSection<Menu: View>: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    let title: String
    let symbol: String
    let meta: String?
    let hits: [PlayerHit]
    @ViewBuilder var menu: (PlayerHit) -> Menu

    var body: some View {
        let columns = sizeClass == .regular ? 2 : 1
        Card {
            CardHead(title: title, symbol: symbol, meta: meta)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0, alignment: .top), count: columns), spacing: 0) {
                ForEach(Array(hits.enumerated()), id: \.element.id) { i, hit in
                    NavigationLink(value: LeagueRoute.player(id: hit.id)) {
                        PCHitRow(hit: hit)
                            .overlay(alignment: .top) {
                                if i >= columns { Rectangle().fill(Theme.line.opacity(0.7)).frame(height: 1).padding(.leading, 66) }
                            }
                    }
                    .buttonStyle(PCHitPressStyle())
                    .contextMenu { menu(hit) }
                    .transition(.opacity)
                }
            }
        }
    }
}

extension PCHitSection where Menu == EmptyView {
    init(title: String, symbol: String, meta: String?, hits: [PlayerHit]) {
        self.init(title: title, symbol: symbol, meta: meta, hits: hits) { _ in EmptyView() }
    }
}

private struct PCHitRow: View {
    let hit: PlayerHit

    var body: some View {
        HStack(spacing: 12) {
            PCPhoto(photo: hit.photo, club: hit.club, size: 42)
                .overlay(Circle().strokeBorder(Theme.line))
            VStack(alignment: .leading, spacing: 3) {
                Text(hit.name)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    ClubChip(club: hit.club)
                    Text(hit.detail)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
                if let first = hit.teams.first {
                    HStack(spacing: 3) {
                        ForEach(hit.teams, id: \.ownerId) { team in
                            PCMark(team: team, size: 15, corner: 4)
                        }
                        Text(first.name + (hit.teams.count > 1 ? " +\(hit.teams.count - 1)" : ""))
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.ink3)
                            .lineLimit(1)
                            .padding(.leading, 2)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 0) {
                Text(String(hit.starts))
                    .font(.system(size: 17, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(Theme.ink)
                Text("starts")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.muted)
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Theme.ink3)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(hit.name), \(hit.pos), \(hit.club), \(hit.years). \(hit.starts) starts.")
        .accessibilityAddTraits(.isButton)
    }
}

private struct PCHitPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(Theme.accent.opacity(configuration.isPressed ? 0.08 : 0))
            .scaleEffect(configuration.isPressed ? 0.99 : 1)
            .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}
