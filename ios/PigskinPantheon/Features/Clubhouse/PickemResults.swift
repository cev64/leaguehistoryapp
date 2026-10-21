import SwiftUI

// A played week's pick'em on its Results tiles (as on the site): each game's
// tile carries how the league picked it, as a strip above "Box score":
// "PICK'EM · 6–4 for Taco Corp · 3 locks", the member's own pick right or
// wrong (and a lock if it was their Lock), and a thin split bar. The Pick'em
// card below keeps only the week's winner, the managers' points and the
// Leaderboard (PickemCard.swift).

/// The week's result tiles, each with its pick'em strip once the board is read.
struct ResultsGamesGrid: View {
    @Environment(LeagueSession.self) private var session
    @Environment(AppModel.self) private var app
    let season: Season
    let week: Int
    let games: [WeekGame]

    @State private var pickem: PickemWeek?

    private var club: ClubhouseStore { session.clubhouse }

    var body: some View {
        let data = pickem.flatMap { $0.week == week && $0.year == season.year ? $0 : nil }
        AdaptiveGrid(minWidth: 330) {
            ForEach(Array(games.enumerated()), id: \.offset) { _, game in
                let pick = data?.games.first { ($0.a == game.a && $0.b == game.b) || ($0.a == game.b && $0.b == game.a) }
                GameCard(season: season, week: week, game: game,
                         pickem: pick.flatMap { $0.picks.values.allSatisfy(\.isEmpty) ? nil : $0 })
            }
        }
        .task(id: "\(club.revision)|\(app.account.user?.id ?? "-")|\(season.year)|\(week)") {
            await club.prepare(year: season.year)
            let answer = await club.week(year: season.year, week: week)
            if answer != pickem {
                var quiet = Transaction()
                quiet.disablesAnimations = true
                withTransaction(quiet) { pickem = answer }
            }
        }
    }
}

/// One game's pick'em, on its Results tile.
struct PickemResultStrip: View {
    let season: Season
    let game: PickemWeek.Game

    var body: some View {
        let na = game.picks[game.a]?.count ?? 0
        let nb = game.picks[game.b]?.count ?? 0
        let total = max(1, na + nb)
        let leader = na == nb ? nil : (na > nb ? game.a : game.b)
        let split = leader.map { "\(max(na, nb))–\(min(na, nb)) for \(PickemWords.name($0, season))" } ?? "\(na)–\(nb) split"
        let locks = game.locks.count
        let right = verdict
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text("\(Text("Pick'em").font(.caption2.weight(.heavy)).foregroundStyle(Theme.goldInk)) · \(split)\(locks > 0 ? " · \(Fmt.plural(locks, "lock"))" : "")")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.ink2)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if game.myLock {
                    Image(systemName: "lock.fill")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(PickTint.gold)
                }
                if let right {
                    Image(systemName: right ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(right ? Theme.green : Theme.red)
                }
            }
            // The split: the first team's share from the left.
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.surface3)
                    Capsule().fill(Theme.accent.opacity(0.75))
                        .frame(width: na == 0 ? 0 : max(3, geo.size.width * Double(na) / Double(total)))
                }
            }
            .frame(height: 3)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(Theme.surface2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken(na: na, nb: nb, right: right))
    }

    /// The member's pick right or wrong, once the game is final (nil: no pick, a tie, or not final).
    private var verdict: Bool? {
        guard let mine = game.mine, let result = game.result, result != "tie" else { return nil }
        return result == mine
    }

    private func spoken(na: Int, nb: Int, right: Bool?) -> String {
        var s = "Pick'em: \(PickemWords.name(game.a, season)) \(na), \(PickemWords.name(game.b, season)) \(nb)"
        if !game.locks.isEmpty { s += ", \(Fmt.plural(game.locks.count, "lock"))" }
        if let mine = game.mine {
            s += ". You picked \(PickemWords.name(mine, season))\(game.myLock ? " as your Lock" : "")"
            if let right { s += right ? ", right" : ", wrong" }
        }
        return s
    }
}
