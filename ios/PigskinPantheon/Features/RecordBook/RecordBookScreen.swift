import SwiftUI

/// The league's whole record (alltime.html): the hero's "Through 2026 ·
/// Week 8 / All-Time", the Champions and Last Places tables, and the
/// all-time standings with their sort menu. Every manager links to their
/// profile; the "Search any player" field finds anyone who has played in
/// the league.
struct RecordBookScreen: View {
    @Environment(LeagueSession.self) private var session

    @State private var book: RecordBook?
    @State private var error: String?
    @State private var sort = BookSort(key: "wins", direction: "desc")
    @State private var query = ""

    var body: some View {
        PageScroll {
            DemoBanner()
            if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                BookSearchResults(query: query)
            } else if let error {
                EmptyCard(title: "This league couldn't be loaded", detail: error, symbol: "exclamationmark.triangle")
            } else if let book {
                RecordBookHero(badge: book.badge)
                PageTitle(text: "Record Book")
                    .padding(.top, 4)
                AdaptiveGrid(minWidth: 320) {
                    BookTitlesCard(title: "Champions", symbol: "trophy", countHeader: "Titles", rows: book.champions, book: book)
                    BookTitlesCard(title: "Last Places", symbol: CardIcon.toilet, countHeader: "Last", rows: book.lastPlaces, book: book)
                }
                BookAllTimeStandingsCard(book: book, sort: $sort)
            } else {
                LoadingCard(title: "Loading the record book",
                            detail: "Reading every season from \(session.summary?.source ?? "Sleeper")…")
            }
        }
        .navigationTitle("Record Book")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search any player")
        .autocorrectionDisabled()
        .textInputAutocapitalization(.words)
        .leagueToolbar()
        .task {
            guard book == nil else { return }
            do {
                let b = try await session.engine.call(RecordBook.self, "Bridge.records.book()")
                withAnimation(.smooth) {
                    book = b
                    sort = b.start
                }
                // Start reading the players the search needs while the page is idle.
                try? await session.engine.run("Bridge.records.warm()")
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

// MARK: Hero

/// The navy band at the top: how far the record runs, and "All-Time".
private struct RecordBookHero: View {
    let badge: String

    private var live: Bool { badge.hasPrefix("Through") }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                if live { Circle().fill(Theme.red).frame(width: 7, height: 7) }
                Text(badge).font(.system(size: 12, weight: .bold)).textCase(.uppercase).tracking(0.8)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .frosted(Capsule(), opacity: 0.12)
            Text("All-Time").displayStyle(40).foregroundStyle(.white)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(
            LinearGradient(colors: [Theme.navy, Theme.navy2], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
        )
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.gold).frame(height: 3).clipShape(RoundedRectangle(cornerRadius: 2)).padding(.horizontal, 18)
        }
    }
}

// MARK: Card head with a control

/// CardHead with a control on the right (the standings' sort).
struct BookCardHead<Trailing: View>: View {
    let title: String
    var symbol: String? = nil
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 10) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.card)
                    .frame(width: 24, height: 24)
                    .background(Theme.ink, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            }
            Text(title)
                .displayStyle(20)
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 8)
            trailing
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .frame(minHeight: 48)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
    }
}

// MARK: Champions / Last Places

private struct BookTitlesCard: View {
    let title: String
    let symbol: String
    let countHeader: String
    let rows: [BookTitleLine]
    let book: RecordBook

    var body: some View {
        Card {
            CardHead(title: title, symbol: symbol)
            HStack(spacing: 8) {
                Text("Rk").frame(width: 22, alignment: .leading)
                Text("Team").frame(maxWidth: .infinity, alignment: .leading)
                Text(countHeader).frame(width: 64, alignment: .leading)
                Text("Years").frame(width: 84, alignment: .trailing)
            }
            .font(.system(size: 10.5, weight: .bold))
            .textCase(.uppercase)
            .foregroundStyle(Theme.ink3)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Theme.surface2)

            if rows.isEmpty {
                Text("None yet.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink3)
                    .padding(14)
            }
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                if let manager = book.manager(row.ownerId) {
                    NavigationLink(value: LeagueRoute.manager(ownerId: row.ownerId)) {
                        HStack(spacing: 8) {
                            Text("\(row.rank)")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(Theme.ink3)
                                .frame(width: 22, alignment: .leading)
                            BookManagerLabel(face: manager)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Text(row.marks)
                                .font(.system(size: 13, weight: .heavy))
                                .foregroundStyle(Theme.ink)
                                .lineLimit(2)
                                .minimumScaleFactor(0.7)
                                .frame(width: 64, alignment: .leading)
                            Text(row.years)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.ink2)
                                .monospacedDigit()
                                .multilineTextAlignment(.trailing)
                                .frame(width: 84, alignment: .trailing)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens \(manager.currentTeam)'s history")
                    if index < rows.count - 1 { Divider().overlay(Theme.line).padding(.leading, 14) }
                }
            }
        }
    }
}

// MARK: All-time standings

private struct BookAllTimeStandingsCard: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    let book: RecordBook
    @Binding var sort: BookSort

    private var rows: [BookAllTimeLine] {
        (book.orders[sort.id] ?? book.managers.map(\.ownerId)).compactMap(book.manager)
    }

    var body: some View {
        Card {
            BookCardHead(title: "Standings", symbol: CardIcon.standings) {
                if sizeClass != .regular {
                    BookSortControl(options: BookSortOptions.allTime, state: $sort, defaults: book.defaults)
                }
            }
            if sizeClass == .regular { wideHeader }
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                NavigationLink(value: LeagueRoute.manager(ownerId: row.ownerId)) {
                    Group {
                        if sizeClass == .regular { wideRow(row, rank: index + 1) } else { phoneRow(row, rank: index + 1) }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens \(row.currentTeam)'s history")
                if index < rows.count - 1 { Divider().overlay(Theme.line).padding(.leading, 14) }
            }
        }
        .animation(.snappy, value: sort)
    }

    private func rank(_ n: Int) -> some View {
        Text("\(n)")
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(Theme.ink3)
            .monospacedDigit()
            .frame(width: 22, alignment: .leading)
    }

    private func phoneRow(_ row: BookAllTimeLine, rank n: Int) -> some View {
        HStack(alignment: .top, spacing: 8) {
            rank(n).padding(.top, 7)
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    BookManagerLabel(face: row)
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.ink3)
                }
                HStack(spacing: 6) {
                    BookMiniStat(label: "W–L", value: row.record)
                    BookMiniStat(label: "PCT", value: row.pct)
                    BookMiniStat(label: "PF", value: row.pfText)
                    BookMiniStat(label: "PA", value: row.paText)
                    BookMiniStat(label: "Diff", value: row.diffText, color: .bookDiff(row.diff))
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(row.currentTeam) all-time statistics")
            }
        }
    }

    private var wideHeader: some View {
        HStack(spacing: 8) {
            Text("Rk").frame(width: 22, alignment: .leading)
                .font(.system(size: 10.5, weight: .bold)).foregroundStyle(Theme.ink3)
            BookSortHeader(title: "Team", key: "team", state: $sort, defaults: book.defaults, alignment: .leading)
                .frame(maxWidth: .infinity)
            BookSortHeader(title: "Record", key: "wins", state: $sort, defaults: book.defaults).frame(width: 64)
            BookSortHeader(title: "PCT", key: "pct", state: $sort, defaults: book.defaults).frame(width: 50)
            BookSortHeader(title: "PF", key: "pf", state: $sort, defaults: book.defaults).frame(width: 82)
            BookSortHeader(title: "PA", key: "pa", state: $sort, defaults: book.defaults).frame(width: 82)
            BookSortHeader(title: "PF/G", key: "pfg", state: $sort, defaults: book.defaults).frame(width: 56)
            BookSortHeader(title: "Diff", key: "diff", state: $sort, defaults: book.defaults).frame(width: 78)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Theme.surface2)
        .sensoryFeedback(.selection, trigger: sort)
    }

    private func wideRow(_ row: BookAllTimeLine, rank n: Int) -> some View {
        HStack(spacing: 8) {
            rank(n)
            BookManagerLabel(face: row).frame(maxWidth: .infinity, alignment: .leading)
            Group {
                Text(row.record).fontWeight(.bold).frame(width: 64, alignment: .trailing)
                Text(row.pct).frame(width: 50, alignment: .trailing)
                Text(row.pfText).frame(width: 82, alignment: .trailing)
                Text(row.paText).frame(width: 82, alignment: .trailing)
                Text(row.pfgText).frame(width: 56, alignment: .trailing)
                Text(row.diffText).foregroundStyle(Color.bookDiff(row.diff)).frame(width: 78, alignment: .trailing)
            }
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(Theme.ink)
            .monospacedDigit()
        }
    }
}

// MARK: Player search

/// The "Search any player" results: names containing every word typed,
/// the most-started first (player-card.js `search`), each opening the
/// player's card.
private struct BookSearchResults: View {
    @Environment(LeagueSession.self) private var session
    let query: String

    @State private var hits: [BookPlayerHit] = []
    @State private var searched = ""
    @State private var failed = false

    var body: some View {
        Card {
            CardHead(title: "Players", symbol: "magnifyingglass")
            if searched.isEmpty && !failed {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Searching…").font(.subheadline).foregroundStyle(Theme.ink2)
                }
                .padding(14)
            } else if failed {
                Text("The players couldn't be loaded.")
                    .font(.subheadline).foregroundStyle(Theme.ink2).padding(14)
            } else if hits.isEmpty {
                Text("No one by that name has played in this league.")
                    .font(.subheadline).foregroundStyle(Theme.ink2).padding(14)
            } else {
                ForEach(Array(hits.enumerated()), id: \.element.id) { index, hit in
                    NavigationLink(value: LeagueRoute.player(id: hit.id)) {
                        HStack(spacing: 12) {
                            BookPlayerPhoto(hit: hit)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(hit.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
                                Text(hit.line).font(.system(size: 12)).foregroundStyle(Theme.ink3)
                            }
                            Spacer(minLength: 6)
                            VStack(alignment: .trailing, spacing: 0) {
                                Text("\(hit.starts)").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.ink).monospacedDigit()
                                Text("starts").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.ink3)
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if index < hits.count - 1 { Divider().overlay(Theme.line).padding(.leading, 66) }
                }
            }
        }
        .task(id: query) {
            try? await Task.sleep(for: .milliseconds(120))
            guard !Task.isCancelled else { return }
            do {
                let found = try await session.engine.call([BookPlayerHit].self, "Bridge.records.search(q)", ["q": query])
                guard !Task.isCancelled else { return }
                withAnimation(.snappy) {
                    hits = found
                    searched = query
                    failed = false
                }
            } catch {
                guard !Task.isCancelled else { return }
                failed = true
            }
        }
    }
}

/// A player's photo, or his club's chip where there is none (a defence,
/// or offline).
private struct BookPlayerPhoto: View {
    let hit: BookPlayerHit

    var body: some View {
        ZStack {
            Circle().fill(Theme.surface3)
            if let photo = hit.photo, let url = URL(string: photo) {
                RemoteImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else if phase.failed {
                        ClubChip(club: hit.club)
                    } else {
                        Color.clear
                    }
                }
            } else {
                ClubChip(club: hit.club)
            }
        }
        .frame(width: 40, height: 40)
        .clipShape(Circle())
    }
}
