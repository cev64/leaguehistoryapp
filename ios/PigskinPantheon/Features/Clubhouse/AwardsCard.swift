import SwiftUI

// The week's awards on a played week's Recap view (Manager, Choke and
// Robbery of the Week), voted by the league from the week's results until
// the next week's first kickoff, the tallies hidden until then; and the
// "Share the week" picture for the group chat.

/// What the clubhouse adds to a played week's recap: the week's awards.
/// ("Share the week" is in the recap lead's Share menu, beside the recap's
/// own pictures: WeekShare.swift.)
struct ClubhouseRecapSection: View {
    let season: Season
    let week: Int

    var body: some View {
        AwardsCard(season: season, week: week)
    }
}

struct AwardsCard: View {
    @Environment(LeagueSession.self) private var session
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let season: Season
    let week: Int

    @State private var data: AwardsWeek?

    private var store: ClubhouseStore { session.clubhouse }

    var body: some View {
        VStack(spacing: 0) {
            // As the site's card: only a played regular-season week, the
            // ballot while voting is open, and once it has closed, the
            // winners if anyone voted (Bridge.clubhouse.awards' `show`).
            if let data, data.week == week, data.show, !data.awards.isEmpty {
                content(data)
            } else {
                Color.clear.frame(height: 0)
            }
        }
        .task(id: "\(store.revision)|\(app.account.user?.id ?? "-")|\(season.year)|\(week)") {
            await store.prepare(year: season.year)
            let answer = await store.awards(year: season.year, week: week)
            withAnimation(data == nil || reduceMotion ? nil : .smooth(duration: 0.25)) { data = answer }
        }
    }

    /// Everyone who could vote: the demo's managers, or the league's members.
    private func members(_ data: AwardsWeek) -> Int {
        let most = data.awards.map(\.voters).max() ?? 0
        return store.isDemo ? season.teams.count : max(store.claimed.count, most)
    }

    private func content(_ data: AwardsWeek) -> some View {
        let voted = data.awards.map(\.voters).max() ?? 0
        let meta = data.closed ? "Voting closed" : "Results \(PickemWords.when(data.closesDate))"
        return Card {
            CardHead(title: "Week \(data.week) Awards", symbol: "medal.fill", meta: meta)
            if !data.closed {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Vote for the week's three awards. The tallies stay hidden until the first kickoff of Week \(data.week + 1).")
                        .font(.subheadline)
                        .foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                    ClubhouseGateBanner(action: "vote")
                    if let error = store.voteError {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(Theme.red)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.top, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            AdaptiveGrid(minWidth: 290, spacing: 10) {
                ForEach(data.awards) { award in
                    if data.closed {
                        AwardResult(season: season, award: award, mine: store.vote(award, year: season.year, week: data.week))
                    } else {
                        AwardBallot(season: season, award: award, week: data.week, act: act)
                    }
                }
            }
            .padding(12)
            if !data.closed, members(data) > 0 {
                Rectangle().fill(Theme.line).frame(height: 1)
                Text("\(voted) of \(members(data)) have voted · results \(PickemWords.when(data.closesDate))")
                    .font(.caption)
                    .foregroundStyle(Theme.ink3)
                    .monospacedDigit()
                    .padding(.horizontal, 14)
                    .padding(.vertical, 11)
            }
        }
    }

    private func act(_ action: @escaping () -> Void) {
        if let sheet = store.gate {
            store.afterClaim = sheet == .claim ? action : nil
            session.sheet = sheet
        } else {
            withAnimation(reduceMotion ? nil : .snappy(duration: 0.25)) { action() }
        }
    }
}

/// An award still being voted on: the nominees and why, "Someone else…"
/// for any other team, the member's vote tinted (a second tap takes it back).
private struct AwardBallot: View {
    @Environment(LeagueSession.self) private var session
    let season: Season
    let award: AwardsWeek.Award
    let week: Int
    let act: (@escaping () -> Void) -> Void

    private var store: ClubhouseStore { session.clubhouse }

    var body: some View {
        let mine = store.vote(award, year: season.year, week: week)
        let nominated = Set(award.nominees.map(\.team))
        VStack(alignment: .leading, spacing: 0) {
            AwardHead(award: award, note: award.voters > 0 ? Fmt.plural(award.voters, "vote") : "No votes yet")
            ForEach(award.nominees, id: \.team) { n in
                Rectangle().fill(Theme.line).frame(height: 1)
                NomineeButton(season: season, team: n.team, reason: n.reason, voted: mine == n.team) {
                    act { store.vote(for: n.team, award: award, year: season.year, week: week) }
                }
            }
            if let mine, !nominated.contains(mine) {
                Rectangle().fill(Theme.line).frame(height: 1)
                NomineeButton(season: season, team: mine, reason: "Your write-in", voted: true) {
                    act { store.vote(for: mine, award: award, year: season.year, week: week) }
                }
            }
            Rectangle().fill(Theme.line).frame(height: 1)
            Menu {
                ForEach(season.teamIds.filter { !nominated.contains($0) }, id: \.self) { id in
                    Button {
                        act { store.vote(for: id, award: award, year: season.year, week: week) }
                    } label: {
                        if mine == id { Label(PickemWords.name(id, season), systemImage: "checkmark") } else { Text(PickemWords.name(id, season)) }
                    }
                }
            } label: {
                HStack {
                    Image(systemName: "person.2")
                    Text("Someone else…")
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down").font(.caption)
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.accentInk)
                .padding(.horizontal, 12)
                .padding(.vertical, 11)
                .contentShape(Rectangle())
            }
            .accessibilityLabel("Vote for someone else for \(award.title)")
        }
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.line))
        .sensoryFeedback(.selection, trigger: mine)
    }
}

private struct AwardHead: View {
    let award: AwardsWeek.Award
    let note: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text(award.emoji)
                .font(.title2)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(award.title)
                    .displayStyle(17)
                    .foregroundStyle(Theme.ink)
                Text(award.blurb)
                    .font(.caption)
                    .foregroundStyle(Theme.ink3)
            }
            Spacer(minLength: 6)
            Text(note)
                .font(.caption2.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(Theme.ink3)
                .fixedSize()
        }
        .padding(12)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

private struct NomineeButton: View {
    let season: Season
    let team: String
    let reason: String
    let voted: Bool
    let action: () -> Void

    var body: some View {
        let name = PickemWords.name(team, season)
        Button(action: action) {
            HStack(spacing: 10) {
                if let t = season.team(team) { TeamBadge(team: t, size: 28, corner: 8) }
                VStack(alignment: .leading, spacing: 1) {
                    Text(name)
                        .font(.subheadline.weight(voted ? .bold : .semibold))
                        .foregroundStyle(voted ? Theme.accentInk : Theme.ink)
                        .lineLimit(1)
                    Text(reason)
                        .font(.caption)
                        .foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                ZStack {
                    Circle().strokeBorder(Theme.line2, lineWidth: 1.5)
                    if voted {
                        Circle().fill(Theme.accent)
                        Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
                    }
                }
                .frame(width: 20, height: 20)
                .accessibilityHidden(true)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(voted ? Theme.accentSoft : Color.clear)
            .overlay(alignment: .leading) {
                if voted { Rectangle().fill(Theme.accent).frame(width: 3) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(PanelRowPressStyle())
        .accessibilityLabel("\(name). \(reason)")
        .accessibilityValue(voted ? "Your vote" : "")
        .accessibilityAddTraits(voted ? [.isButton, .isSelected] : .isButton)
        .accessibilityHint(voted ? "Double-tap to take your vote back" : "Double-tap to vote for \(name)")
    }
}

/// An award whose voting has closed: the winner (a tie shares it) and the tally.
private struct AwardResult: View {
    let season: Season
    let award: AwardsWeek.Award
    let mine: String?

    var body: some View {
        let top = award.tally.first?.votes ?? 0
        let total = award.tally.reduce(0) { $0 + $1.votes }
        VStack(alignment: .leading, spacing: 0) {
            AwardHead(award: award, note: Fmt.plural(total, "vote"))
            Rectangle().fill(Theme.line).frame(height: 1)
            if award.winners.isEmpty {
                Text("Nobody voted.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink3)
                    .padding(12)
            } else {
                ForEach(award.winners, id: \.self) { id in
                    HStack(spacing: 10) {
                        if let t = season.team(id) { TeamBadge(team: t, size: 34) }
                        VStack(alignment: .leading, spacing: 1) {
                            Text(PickemWords.name(id, season))
                                .font(.headline)
                                .foregroundStyle(Theme.ink)
                            Text("\(Fmt.plural(top, "vote"))\(award.winners.count > 1 ? ", a tie" : "")")
                                .font(.caption)
                                .foregroundStyle(Theme.ink3)
                        }
                        Spacer()
                        Text("🏆").accessibilityHidden(true)
                    }
                    .padding(12)
                    .background(Theme.goldSoft.opacity(0.5))
                    .accessibilityElement(children: .combine)
                }
                let rest = award.tally.filter { !award.winners.contains($0.nominee) }
                if !rest.isEmpty {
                    Text(rest.map { "\(PickemWords.name($0.nominee, season)) \($0.votes)" }.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 9)
                }
            }
            if let mine {
                Text("You voted \(PickemWords.name(mine, season)).")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.accentInk)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 10)
            }
        }
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.line))
    }
}
