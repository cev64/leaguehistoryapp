import SwiftUI

// What Bridge.rivalry answers (Engine/bridge-rivalry.js, through
// insights.js's Insights.rivalry, which the site runs too).

struct RivalryPreview: Decodable {
    let year: Int
    let week: Int
    let end: Int
    let kind: String
    let label: String
    let played: Bool
    let score: Score?
    let a: Side
    let b: Side
    let met: Bool
    let series: Series
    let stakesTitle: String
    let stakes: [Stake]
    let noStakes: String
    let note: String

    struct Score: Decodable { let a: Double; let b: Double; let aText: String; let bText: String }

    struct Side: Decodable {
        let key: String
        let teamId: String
        let ownerId: String
        let team: String
        let owner: String
        let season: SeasonLine
        let career: Career
    }

    struct SeasonLine: Decodable {
        let record: String
        let pfText: String
        let games: Int
    }

    struct Career: Decodable {
        let seasons: Int
        let record: String
        let pct: String
        let playoffs: String
        let titles: Int
        let pfg: String
        let high: High?
        let streak: Streak?
        struct High: Decodable { let pts: Double; let text: String; let year: Int; let week: Int }
        struct Streak: Decodable { let n: Int; let text: String; let years: String }
    }

    struct Split: Decodable { let a: Int; let b: Int; let t: Int; let games: Int; let record: String }

    struct Meeting: Decodable, Hashable {
        let year: Int
        let week: Int
        let kind: String
        let label: String
        let teamA: String
        let teamB: String
        let aScore: Double
        let bScore: Double
        let aText: String
        let bText: String
        let winner: String?
        let current: Bool
        /// The two teams that season (side a's manager first), and whether
        /// the week has a box score (Engine/bridge-rivalry.js).
        let teamIdA: String?
        let teamIdB: String?
        let box: Bool?
    }

    struct BigWin: Decodable {
        let marginText: String
        let year: Int
        let week: Int
        let kind: String
        let label: String
        let aText: String
        let bText: String
    }

    struct Series: Decodable {
        let games: Int
        let lead: String
        let all: Split
        let regular: Split
        let playoffs: Split
        let consolation: Split
        let streak: SeriesStreak
        let last: Meeting?
        let biggest: Biggest
        let avg: Avg?
        let sweeps: Sweeps
        let meetings: [Meeting]
        struct SeriesStreak: Decodable { let side: String?; let n: Int; let text: String }
        struct Biggest: Decodable { let a: BigWin?; let b: BigWin? }
        struct Avg: Decodable { let aText: String; let bText: String }
        struct Sweeps: Decodable { let a: [Int]; let b: [Int] }
    }

    struct Stake: Decodable, Hashable {
        let side: String?
        let kind: String
        let tone: String
        let text: String
        let when: String
        let hit: Bool?
    }

    func side(_ key: String?) -> Side? { key == "a" ? a : key == "b" ? b : nil }
}

/// One game read against the league's history (season.html's
/// openRivalry): the managers' all-time series, their seasons and careers,
/// and what this game can settle. For a game already played, what was on
/// the line going in, each marked with whether it happened.
struct RivalryView: View {
    @Environment(LeagueSession.self) private var session
    let year: Int
    let week: Int
    let a: String
    let b: String

    @State private var preview: RivalryPreview?
    @State private var error: String?
    /// The page has room for the cards in two columns of at least 320
    /// points: an iPad, or the unfolded Duo with its sidebar folded away.
    @State private var twoColumns = false

    var body: some View {
        PageScroll(maxWidth: 1040) {
            if let error {
                EmptyCard(title: "The rivalry couldn't be read", detail: error, symbol: "exclamationmark.triangle")
            } else if let preview, let season = session.summary?.season(year) {
                content(preview, season: season)
                    .transition(.opacity)
            } else {
                LoadingCard(title: "Reading the history")
            }
        }
        .navigationTitle(preview.map { "\(String(year)) · \($0.kind == "regular" ? "Week \(week)" : $0.label)" } ?? "\(String(year)) · Week \(week)")
        .navigationSubtitle(preview.map { $0.played ? "Rivalry · Final" : "Rivalry preview" } ?? "")
        .toolbarTitleDisplayMode(.inline)
        .task(id: "\(year)-\(week)-\(a)-\(b)") { await load() }
    }

    private func load() async {
        do {
            let result = try await session.engine.call(RivalryPreview.self, "Bridge.rivalry.preview(year, week, a, b)",
                                                       ["year": year, "week": week, "a": a, "b": b])
            withAnimation(.smooth(duration: 0.3)) { preview = result; error = nil }
        } catch {
            if !Task.isCancelled { self.error = error.localizedDescription }
        }
    }

    @ViewBuilder private func content(_ p: RivalryPreview, season: Season) -> some View {
        RivalryHero(p: p, season: season)
            .onGeometryChange(for: Bool.self) { $0.size.width >= 320 * 2 + 14 } action: { twoColumns = $0 }
        if twoColumns {
            HStack(alignment: .top, spacing: 14) {
                VStack(spacing: 14) {
                    StakesCard(p: p, season: season)
                    TapeCard(p: p)
                }
                .frame(maxWidth: .infinity)
                SeriesCard(p: p)
                    .frame(maxWidth: .infinity)
            }
        } else {
            StakesCard(p: p, season: season)
            SeriesCard(p: p)
            TapeCard(p: p)
        }
        if !p.series.meetings.isEmpty {
            MeetingsCard(p: p)
        }
        if p.played {
            NavigationLink(value: LeagueRoute.boxScore(year: year, week: p.end, a: a, b: b)) {
                Label("Box score", systemImage: "tablecells")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.accentInk)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous).strokeBorder(Theme.line))
                    .contentShape(Rectangle())
            }
            .buttonStyle(Felt(.plain))
        }
        Text(p.note)
            .font(.caption)
            .foregroundStyle(Theme.ink3)
            .padding(.horizontal, 4)
    }
}

/// Both teams this season, and the series (or the final) between them.
private struct RivalryHero: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    let p: RivalryPreview
    let season: Season

    var body: some View {
        Card {
            HStack(alignment: .center, spacing: 10) {
                // Both sides from the top, the series between them centred.
                side(p.a, trailing: false)
                    .frame(maxHeight: .infinity, alignment: .top)
                centre
                    .frame(width: sizeClass == .regular ? 190 : 112)
                side(p.b, trailing: true)
                    .frame(maxHeight: .infinity, alignment: .top)
            }
            .fixedSize(horizontal: false, vertical: true)
            .padding(14)
        }
    }

    @ViewBuilder private var centre: some View {
        VStack(spacing: 3) {
            Text(p.played ? "Final" : "All-time")
                .font(.system(size: 10, weight: .heavy)).tracking(1.1).textCase(.uppercase)
                .foregroundStyle(Theme.ink3)
            if let score = p.score {
                HStack(spacing: 4) {
                    Text(score.aText).foregroundStyle(score.a > score.b ? Theme.accentInk : Theme.ink3)
                    Text("–").foregroundStyle(Theme.ink3)
                    Text(score.bText).foregroundStyle(score.b > score.a ? Theme.accentInk : Theme.ink3)
                }
                .font(.system(size: 17, weight: .bold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                Text(p.met ? "All-time \(p.series.all.record)" : "First meeting")
                    .font(.caption).foregroundStyle(Theme.ink2)
            } else {
                Text(p.met ? p.series.all.record : "0–0")
                    .displayStyle(34)
                    .foregroundStyle(Theme.ink)
                    .monospacedDigit()
                Text(p.met ? p.series.streak.text : "First meeting")
                    .font(.caption)
                    .foregroundStyle(Theme.ink2)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func side(_ s: RivalryPreview.Side, trailing: Bool) -> some View {
        NavigationLink(value: LeagueRoute.manager(ownerId: s.ownerId)) {
            VStack(alignment: trailing ? .trailing : .leading, spacing: 6) {
                if let team = season.team(s.teamId) {
                    TeamBadge(team: team, size: 42, corner: 12)
                }
                VStack(alignment: trailing ? .trailing : .leading, spacing: 1) {
                    Text(s.team)
                        .font(.headline)
                        .foregroundStyle(Theme.ink)
                        .multilineTextAlignment(trailing ? .trailing : .leading)
                        .lineLimit(2)
                    Text(s.owner).font(.caption).foregroundStyle(Theme.ink3).lineLimit(1)
                    Text(s.season.record)
                        .font(.subheadline.weight(.bold))
                        .monospacedDigit()
                        .foregroundStyle(Theme.ink2)
                        .padding(.top, 2)
                    if s.season.games > 0 {
                        Text("\(s.season.pfText) PF")
                            .font(.caption)
                            .monospacedDigit()
                            .foregroundStyle(Theme.ink3)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: trailing ? .trailing : .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(Felt(.plain))
        .accessibilityLabel("\(s.team), \(s.owner), \(s.season.record) this season")
        .accessibilityHint("Opens the manager's history")
    }
}

/// Records within reach (or what was on the line), the most interesting first.
private struct StakesCard: View {
    let p: RivalryPreview
    let season: Season

    var body: some View {
        Card {
            CardHead(title: p.stakesTitle, symbol: "flag.checkered", meta: p.played ? "Going in" : "This game")
            if p.stakes.isEmpty {
                Text(p.noStakes)
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
                    .padding(14)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(p.stakes.enumerated()), id: \.offset) { i, stake in
                        if i > 0 { Divider().overlay(Theme.line) }
                        row(stake)
                    }
                }
            }
        }
    }

    private func row(_ stake: RivalryPreview.Stake) -> some View {
        let tone = StakeTone(stake.tone)
        let side = p.side(stake.side)
        return HStack(alignment: .center, spacing: 12) {
            Image(systemName: StakeTone.symbol(stake.kind))
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tone.ink)
                .frame(width: 32, height: 32)
                .background(tone.soft, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                .accessibilityHidden(true)
            Text(stake.text)
                .font(.subheadline)
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let hit = stake.hit {
                // The side's logo stays beside the result, so it's plain whose
                // line it was; one width for both capsules lines the logos up.
                HStack(spacing: 8) {
                    if let side, let team = season.team(side.teamId) {
                        TeamBadge(team: team, size: 22, corner: 6)
                            .accessibilityHidden(true)
                    }
                    Text(hit ? "Happened" : "Didn’t")
                        .font(.system(size: 10.5, weight: .heavy))
                        .textCase(.uppercase)
                        .foregroundStyle(hit ? Theme.green : Theme.ink3)
                        .lineLimit(1)
                        .padding(.vertical, 4)
                        .frame(width: 80)
                        .background(hit ? Theme.green.opacity(0.12) : Theme.surface2, in: Capsule())
                }
            } else if let side, let team = season.team(side.teamId) {
                TeamBadge(team: team, size: 22, corner: 6)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(stake.text)
        .accessibilityValue([side.map { $0.team }, stake.hit.map { $0 ? "Happened" : "Didn't happen" }].compactMap { $0 }.joined(separator: ", "))
    }
}

/// The series in numbers: regular season, playoffs, the last meeting, the
/// average score, the biggest win each way and season sweeps.
private struct SeriesCard: View {
    let p: RivalryPreview

    var body: some View {
        let s = p.series
        Card {
            CardHead(title: "The Series", symbol: CardIcon.versus, meta: s.games > 0 ? s.lead : "Never met")
            if s.games == 0 {
                Text("These two managers have never met. Here is how each has fared against the league.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
                    .padding(14)
            } else {
                AdaptiveGrid(minWidth: 140, spacing: 10) {
                    Superlative(label: "Regular season", title: s.regular.games > 0 ? s.regular.record : "—", detail: splitDetail(s.regular))
                    Superlative(label: "Playoffs", title: s.playoffs.games > 0 ? s.playoffs.record : "—", detail: s.playoffs.games > 0 ? splitDetail(s.playoffs) : "Never met")
                    if s.consolation.games > 0 {
                        Superlative(label: "Consolation", title: s.consolation.record, detail: splitDetail(s.consolation))
                    }
                    if let last = s.last {
                        Superlative(label: "Last meeting", title: "\(last.aText)–\(last.bText)",
                                    detail: "\(meetLine(last)) · \(last.winner.flatMap { p.side($0)?.team }.map { "\($0) won" } ?? "a tie")")
                    }
                    if let avg = s.avg {
                        Superlative(label: "Average score", title: "\(avg.aText)–\(avg.bText)", detail: "per meeting")
                    }
                    big(p.a, s.biggest.a, flip: false)
                    big(p.b, s.biggest.b, flip: true)
                    if !s.sweeps.a.isEmpty || !s.sweeps.b.isEmpty {
                        Superlative(label: "Season sweeps", title: [sweeps(p.a, s.sweeps.a), sweeps(p.b, s.sweeps.b)].compactMap { $0 }.joined(separator: " · "), detail: "")
                    }
                }
                .padding(12)
            }
        }
    }

    private func splitDetail(_ r: RivalryPreview.Split) -> String {
        r.a > r.b ? "\(p.a.team) ahead" : r.b > r.a ? "\(p.b.team) ahead" : "Even"
    }

    private func meetLine(_ m: RivalryPreview.Meeting) -> String {
        "\(String(m.year)) \(m.kind == "regular" ? "week \(m.week)" : m.label)"
    }

    @ViewBuilder private func big(_ side: RivalryPreview.Side, _ w: RivalryPreview.BigWin?, flip: Bool) -> some View {
        if let w {
            Superlative(label: "\(side.team)’s biggest win", title: "+\(w.marginText)",
                        detail: "\(flip ? "\(w.bText)–\(w.aText)" : "\(w.aText)–\(w.bText)") · \(String(w.year)) \(w.kind == "regular" ? "week \(w.week)" : w.label)")
        } else {
            Superlative(label: "\(side.team)’s biggest win", title: "—", detail: "Hasn’t won one yet")
        }
    }

    private func sweeps(_ side: RivalryPreview.Side, _ years: [Int]) -> String? {
        years.isEmpty ? nil : "\(side.team) \(years.map(String.init).joined(separator: ", "))"
    }
}

/// Both careers side by side, the better mark in blue.
private struct TapeCard: View {
    let p: RivalryPreview

    var body: some View {
        let ca = p.a.career, cb = p.b.career
        let pa = Double(ca.pct) ?? 0, pb = Double(cb.pct) ?? 0
        Card {
            CardHead(title: "Tale of the Tape", symbol: CardIcon.standings, meta: "All-time")
            VStack(spacing: 0) {
                HStack {
                    Text(p.a.team).frame(maxWidth: .infinity, alignment: .leading)
                    Text(p.b.team).frame(maxWidth: .infinity, alignment: .trailing)
                }
                .font(.footnote.weight(.bold))
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Theme.surface2)
                row("Record", ca.record, cb.record, pa - pb)
                row("Win pct", ca.pct, cb.pct, pa - pb)
                row("Playoffs", ca.playoffs, cb.playoffs, 0)
                row("Titles", String(ca.titles), String(cb.titles), Double(ca.titles - cb.titles))
                row("Points / game", ca.pfg, cb.pfg, (Double(ca.pfg) ?? 0) - (Double(cb.pfg) ?? 0))
                row("Best week", ca.high?.text ?? "—", cb.high?.text ?? "—", (ca.high?.pts ?? 0) - (cb.high?.pts ?? 0))
                row("Win streak", ca.streak.map { String($0.n) } ?? "—", cb.streak.map { String($0.n) } ?? "—", Double((ca.streak?.n ?? 0) - (cb.streak?.n ?? 0)))
                row("Seasons", String(ca.seasons), String(cb.seasons), 0)
            }
        }
    }

    private func row(_ label: String, _ x: String, _ y: String, _ cmp: Double) -> some View {
        VStack(spacing: 0) {
            Divider().overlay(Theme.line)
            HStack(spacing: 8) {
                Text(x)
                    .font(.subheadline.weight(cmp > 0 ? .bold : .medium))
                    .foregroundStyle(cmp > 0 ? Theme.accentInk : Theme.ink2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(label)
                    .font(.system(size: 10, weight: .heavy)).tracking(0.9).textCase(.uppercase)
                    .foregroundStyle(Theme.ink3)
                    .fixedSize()
                Text(y)
                    .font(.subheadline.weight(cmp < 0 ? .bold : .medium))
                    .foregroundStyle(cmp < 0 ? Theme.accentInk : Theme.ink2)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .monospacedDigit()
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(label): \(p.a.team) \(x), \(p.b.team) \(y)")
        }
    }
}

/// Every meeting, newest first and grouped by season, the first few
/// showing: the week or the round (a playoff game in gold), then both teams
/// with their scores, the winner in bold. A meeting with a box score opens it.
private struct MeetingsCard: View {
    @Environment(LeagueSession.self) private var session
    @Environment(\.horizontalSizeClass) private var sizeClass
    let p: RivalryPreview
    @State private var all = false
    private let shown = 6

    private struct SeasonGroup: Identifiable {
        let year: Int
        let meetings: [RivalryPreview.Meeting]
        var id: Int { year }
    }

    private func groups(_ list: [RivalryPreview.Meeting]) -> [SeasonGroup] {
        var out: [SeasonGroup] = []
        for m in list {
            if let last = out.last, last.year == m.year {
                out[out.count - 1] = SeasonGroup(year: m.year, meetings: last.meetings + [m])
            } else {
                out.append(SeasonGroup(year: m.year, meetings: [m]))
            }
        }
        return out
    }

    var body: some View {
        let list = p.series.meetings
        let visible = all ? list : Array(list.prefix(shown))
        Card {
            CardHead(title: "Every Meeting", symbol: CardIcon.schedule, meta: Fmt.plural(list.count, "game"))
            VStack(spacing: 0) {
                ForEach(groups(visible)) { group in
                    seasonHeader(group)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: sizeClass == .regular ? 380 : 280), spacing: 0, alignment: .top)], spacing: 0) {
                        ForEach(group.meetings, id: \.self) { m in
                            MeetingRow(p: p, m: m, season: session.summary?.season(m.year))
                        }
                    }
                }
                if list.count > shown && !all {
                    Button {
                        withAnimation(.smooth) { all = true }
                    } label: {
                        Text("Show \(list.count - shown) more")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.accentInk)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 11)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(Felt(.plain))
                }
            }
        }
    }

    /// "2025", and how the season's meetings went for the first team.
    private func seasonHeader(_ group: SeasonGroup) -> some View {
        let w = group.meetings.filter { $0.winner == "a" }.count
        let l = group.meetings.filter { $0.winner == "b" }.count
        let t = group.meetings.count - w - l
        let name = group.meetings.first?.teamA ?? p.a.team
        return HStack(spacing: 8) {
            Text(String(group.year))
                .font(.caption.weight(.heavy))
                .tracking(0.9)
                .foregroundStyle(Theme.ink2)
            Spacer(minLength: 8)
            Text("\(name) \(Fmt.record(w, l, t))")
                .font(.caption.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(Theme.ink3)
                .lineLimit(1)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface2)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// One meeting: the week (or the round on a chip, gold for the playoffs) on
/// a line of its own, then both teams a line each (the first team on top)
/// with badge, name and score, the winner in ink and bold, the loser grey
/// with a dimmed badge. A tap opens its box score; a week without one says so.
private struct MeetingRow: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let p: RivalryPreview
    let m: RivalryPreview.Meeting
    let season: Season?

    private var route: LeagueRoute? {
        guard m.box == true, let a = m.teamIdA, let b = m.teamIdB else { return nil }
        return .boxScore(year: m.year, week: m.week, a: a, b: b)
    }

    var body: some View {
        if let route {
            NavigationLink(value: route) { content(link: true) }
                .buttonStyle(PanelRowPressStyle())
                .accessibilityHint("Opens the box score")
        } else {
            content(link: false)
        }
    }

    private func content(link: Bool) -> some View {
        HStack(alignment: .center, spacing: 12) {
            // The week (or the round) on a line of its own above the two
            // teams, so the names have the row's width.
            VStack(alignment: .leading, spacing: 6) {
                aside(link: link)
                teams
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.line2)
                .opacity(link ? 1 : 0)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(m.current ? Theme.accentSoft : Theme.card)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
        .accessibilityValue(link ? "" : "No box score")
    }

    /// Both teams, the first team on top.
    private var teams: some View {
        VStack(alignment: .leading, spacing: 5) {
            line(id: m.teamIdA, name: m.teamA, score: m.aText, won: m.winner == "a", lost: m.winner == "b")
            line(id: m.teamIdB, name: m.teamB, score: m.bText, won: m.winner == "b", lost: m.winner == "a")
        }
    }

    private func line(id: String?, name: String, score: String, won: Bool, lost: Bool) -> some View {
        HStack(spacing: 8) {
            if let team = season?.team(id) {
                TeamBadge(team: team, size: 20, corner: 6)
                    .opacity(lost ? 0.55 : 1)
            }
            Text(name)
                .font(.subheadline.weight(won ? .bold : .medium))
                .foregroundStyle(lost ? Theme.ink3 : Theme.ink)
                .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
            Spacer(minLength: 6)
            Text(score)
                .font(.subheadline.weight(won ? .bold : .regular))
                .monospacedDigit()
                .foregroundStyle(lost ? Theme.ink3 : Theme.ink)
                .fixedSize()
        }
    }

    /// "Week 14" (or the round's chip), "Tie" for a tie (neither side is
    /// bold), and "No box score" where the week has none.
    private func aside(link: Bool) -> some View {
        HStack(alignment: .center, spacing: 8) {
            when
            if m.winner == nil {
                Text("Tie")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.ink2)
            }
            Spacer(minLength: 6)
            if !link {
                Text("No box score")
                    .font(.caption2)
                    .foregroundStyle(Theme.ink3)
            }
        }
    }

    /// "Week 14", or the round on a chip: gold for the playoffs, grey for
    /// the consolation bracket. "This game" where it's the one previewed.
    private var when: some View {
        HStack(spacing: 6) {
            if m.kind == "regular" {
                Text("Week \(m.week)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.ink3)
            } else {
                let gold = m.kind == "playoffs"
                Label(m.label, systemImage: gold ? "trophy.fill" : "arrow.down.to.line")
                    .labelStyle(ChipLabelStyle())
                    .font(.system(size: 10, weight: .heavy))
                    .textCase(.uppercase)
                    .foregroundStyle(gold ? Theme.goldInk : Theme.ink2)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .lineLimit(1)
                    .background(gold ? Theme.goldSoft : Theme.surface3, in: Capsule())
            }
            if m.current {
                Text("This game")
                    .font(.system(size: 10, weight: .heavy))
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.accentInk)
            }
        }
    }

    /// "2025 Week 6: Hamilton Administration 135.20, Roll Bill 116.88",
    /// the winner first.
    private var spoken: String {
        let when = m.kind == "regular" ? "Week \(m.week)" : m.label
        let a = "\(m.teamA) \(m.aText)", b = "\(m.teamB) \(m.bText)"
        var line = "\(String(m.year)) \(when): \(m.winner == "b" ? "\(b), \(a)" : "\(a), \(b)")"
        if m.winner == nil { line += ", a tie" }
        return m.current ? "\(line). This game" : line
    }
}

/// An icon and a title, close together, for a chip.
private struct ChipLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon.font(.system(size: 9, weight: .bold))
            configuration.title
        }
    }
}

/// A stake's colour and symbol.
private struct StakeTone {
    let ink: Color
    let soft: Color

    init(_ tone: String) {
        switch tone {
        case "gold": ink = Theme.goldInk; soft = Theme.goldSoft
        case "fire": ink = Color(light: 0xC2410C, dark: 0xFB923C); soft = Color(light: 0xFFF0E5, dark: 0x3A1F0C)
        case "blue": ink = Theme.accentInk; soft = Theme.accentSoft
        case "red": ink = Theme.red; soft = Theme.redSoft
        case "purple": ink = Color(light: 0x6D28D9, dark: 0xB794F6); soft = Color(light: 0xF3EFFF, dark: 0x2A1A47)
        default: ink = Theme.ink; soft = Theme.surface3
        }
    }

    static func symbol(_ kind: String) -> String {
        switch kind {
        case "title": "trophy.fill"
        case "playoffs": "medal.fill"
        case "rematch": "arrow.triangle.2.circlepath"
        case "first-meeting": "hand.wave.fill"
        case "first-win": "scope"
        case "series-streak", "series-wins": "bolt.fill"
        case "series-lead", "500": "scalemass.fill"
        case "sweep": "checkmark.seal.fill"
        case "win-streak": "chart.line.uptrend.xyaxis"
        case "loss-streak": "snowflake"
        case "wins": "star.fill"
        case "games": "calendar"
        case "points": "sum"
        case "high": "flame.fill"
        default: "circle.fill"
        }
    }
}
