/* Bridge.clubhouse: the league's pick'em and the week's awards, as the app
   draws them, worked out by the site's own clubhouse.js (window.Clubhouse)
   from the league's results. Nothing here talks to the network: the app
   fetches a league's boards from Supabase (pickem_board, award_board) and
   hands them in, as JSON text or objects, and the demo league's boards are
   made up here on the device (Clubhouse.demoBoard). Plain data only.

     key()                         the league's lasting name, null for the demo
     source()                      "sleeper" | "espn"
     info()                        what claim_manager is sent, and the managers
                                   who can be claimed (the newest season's)
     deadline(year, week)          when a week's picks lock (pick_deadline's
                                   formula: Thursday 8:15 PM Eastern)
     slate(year, week)             the week's games with the records going in
     grade(year, board)            the season's pick'em standings
     week(year, week, board)       one week of pick'em: every game with how the
                                   league picked it, and everyone's score
     nominees(year, week)          the three awards and who's up for each
     winners(awardBoard)           { week: { award: [team ids] } }
     awards(year, week, board)     one week's awards: the count so far, or the
                                   tallies and winners once voting has closed
                                   (show: false where the Recap draws none)
     seasonAwards(year, board)     every closed week's winners
     demo(year, me, mine)          the demo league's boards, as JSON text
     share(year, week, pickem, awards)
                                   what the "Share the week" picture shows */
(function () {
  "use strict";

  const B = window.Bridge;
  const C = () => {
    if (!window.Clubhouse) throw new Error("The clubhouse isn't loaded.");
    return window.Clubhouse;
  };

  // A board as the app sends it: JSON text, an object, or nothing.
  function boardIn(board) {
    if (typeof board === "string") {
      if (!board) return null;
      try { return JSON.parse(board); } catch (_) { return null; }
    }
    return board && typeof board === "object" ? board : null;
  }

  const season = (year) => {
    const s = B.model().season(Number(year));
    if (!s) throw new Error(`There is no ${year} season.`);
    return s;
  };

  const fmt = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* ------------------------------------------------------------ the league */

  function info() {
    const m = B.model();
    const newest = m.seasons[m.seasons.length - 1];
    const managers = newest
      ? Object.entries(newest.teams)
        .sort((x, y) => (x[1].rosterId || 0) - (y[1].rosterId || 0))
        .map(([team, t]) => ({
          owner: t.ownerId || "",
          team,
          name: t.name,
          manager: t.owner,
          claimable: Boolean(t.ownerId) && !/^open-/.test(t.ownerId) && /^[A-Za-z0-9{}_-]{1,80}$/.test(t.ownerId),
        }))
      : [];
    return {
      key: C().leagueKey(m),
      source: C().source(m),
      demo: Boolean(m.demo) || m.leagueId === "demo",
      // The current season's league id (model.current; an ESPN league keeps one id).
      leagueId: (() => {
        if (C().source(m) !== "sleeper") return m.leagueId;
        const id = (m.current && m.current.leagueId) || (newest && newest.leagueId);
        return /^\d{6,24}$/.test(String(id || "")) ? String(id) : m.leagueId;
      })(),
      season: newest ? newest.year : null,
      // The week the newest season's picks are open for, or null.
      pickWeek: (() => { try { return newest ? B.seasonEngine(newest.year).pickWeek() : null; } catch (_) { return null; } })(),
      name: m.name,
      managers,
    };
  }

  /* pick_deadline(season, week)'s fallback, for the demo (whose board says
     only "open"): the Thursday of the week, 8:15 PM in New York, 12:30 PM
     on Thanksgiving. Week 1's Thursday is the one after Labor Day. */
  function deadline(year, week) {
    const y = Number(year), w = Number(week);
    const sep1 = new Date(Date.UTC(y, 8, 1));
    const laborDay = 1 + ((8 - (sep1.getUTCDay() || 7)) % 7);
    const thursday = new Date(Date.UTC(y, 8, laborDay + 3 + 7 * (w - 1)));
    const nov1 = new Date(Date.UTC(y, 10, 1));
    const thanksgiving = 1 + ((4 - nov1.getUTCDay() + 7) % 7) + 21;
    const isThanksgiving = thursday.getUTCMonth() === 10 && thursday.getUTCDate() === thanksgiving;
    const [hh, mm] = isThanksgiving ? [12, 30] : [20, 15];
    // New York is UTC−4 until the first Sunday of November, then UTC−5.
    const dstEnd = 1 + ((7 - nov1.getUTCDay()) % 7);
    const edt = thursday < new Date(Date.UTC(y, 10, dstEnd)) && thursday >= new Date(Date.UTC(y, 2, 8));
    const at = new Date(Date.UTC(thursday.getUTCFullYear(), thursday.getUTCMonth(), thursday.getUTCDate(), hh + (edt ? 4 : 5), mm));
    return at.toISOString();
  }

  /* The demo's boards say only "open" (2999) or "long past" (2000): it's
     always the week before Week 9 there. Like the site (clubhouse-ui.js),
     an open demo week locks, and its awards close, at the next Thursday
     night kickoff from now, 8:15 PM in New York, so the demo always looks
     live (App Review, screenshots). */
  function nextThursdayKickoff() {
    const ny = (t) => {
      const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(new Date(t));
      const get = (k) => (p.find((x) => x.type === k) || {}).value;
      return { y: +get("year"), m: +get("month"), d: +get("day"), h: +get("hour"), min: +get("minute"), wd: get("weekday") };
    };
    try {
      const now = Date.now();
      for (let i = 0; i < 8; i++) {
        const day = ny(now + i * 864e5);
        if (day.wd !== "Thu") continue;
        const guess = Date.UTC(day.y, day.m - 1, day.d, 20, 15);
        const at = ny(guess);
        const offset = Date.UTC(at.y, at.m - 1, at.d, at.h, at.min) - guess;
        const t = guess - offset;
        if (t > now) return new Date(t).toISOString();
      }
    } catch (_) { /* no time zones: a day and a bit from now will do */ }
    return new Date(Date.now() + 36e5 * 30).toISOString();
  }

  const isDemoBoard = (board) => Boolean(board && board.demo);
  const placeholder = (d) => /^2999-/.test(d) || /^2000-/.test(d);

  // When a week locks by its board: the server's deadline; the demo's
  // rolling kickoff for its open weeks; else pick_deadline's formula.
  function deadlineFor(year, week, board) {
    const d = board && board.deadlines && board.deadlines[week];
    if (d && !placeholder(d)) return d;
    if (isDemoBoard(board) && d && /^2999-/.test(d)) return nextThursdayKickoff();
    return deadline(year, week);
  }

  // When a week's award voting closes: the board's time (the server's),
  // the demo's rolling kickoff while it's open, else the formula (the
  // next week's first kickoff).
  function closesFor(year, week, board) {
    const d = board && board.closes && board.closes[week];
    if (d && !placeholder(d)) return d;
    if (isDemoBoard(board) && d) return /^2999-/.test(d) ? nextThursdayKickoff() : d;
    return deadline(year, Number(week) + 1);
  }

  function lockedFor(week, board) {
    const d = board && board.deadlines && board.deadlines[week];
    if (!d) return false;
    return Date.now() >= Date.parse(d);
  }

  /* ------------------------------------------------------------ pick'em */

  function slate(year, week) {
    const s = season(year);
    const w = Number(week);
    const games = C().slate(s, w);
    const E = B.seasonEngine(year);
    // Records as they stood going into the week.
    const prior = w > 1 ? E.buildPicture(Math.min(w - 1, E.lastPlayedWeek, E.REGULAR_WEEKS)).stats : null;
    const rec = (id) => (prior && prior[id] ? prior[id].record : "0–0");
    const out = C().outcomes(s, w);
    return {
      year: s.year,
      week: w,
      games: games.map((g) => ({ a: g.a, b: g.b, key: g.key, ar: rec(g.a), br: rec(g.b), result: out[g.key] || null })),
      final: games.length > 0 && games.every((g) => g.key in out),
      open: E.pickWeek() === w,
      deadline: deadline(s.year, w),
    };
  }

  function grade(year, board) {
    const s = season(year);
    const b = boardIn(board);
    const g = C().grade(s, b);
    const weeks = Object.keys(g.weeks).map(Number).sort((x, y) => x - y).map((w) => {
      const wk = g.weeks[w];
      return { week: w, final: wk.final, games: wk.games, best: wk.best, rows: wk.rows.slice().sort((x, y) => (y.points - x.points) || (y.correct - x.correct)) };
    });
    // Ranks, a tie sharing one.
    let rank = 0, last = null;
    const rows = g.rows.map((r, i) => {
      const k = `${r.points}|${r.correct}|${r.wrong}`;
      if (k !== last) { rank = i + 1; last = k; }
      return { ...r, rank };
    });
    return { rows, weeks, members: (b && b.members) || [], me: (b && b.me) || null };
  }

  /* One week of pick'em, as the card draws it: each game with who picked
     which side (once the week has locked; until then only the member's own
     picks are on the board), the result once it's final, everyone's score,
     and who has picked a week that's still open. */
  function week(year, wk, board) {
    const s = season(year);
    const w = Number(wk);
    const b = boardIn(board) || {};
    const sl = slate(year, w);
    const me = b.me || null;
    const picks = (b.picks || []).filter((p) => Number(p.week) === w);
    const games = sl.games.map((g) => {
      const here = picks.filter((p) => p.game === g.key);
      const side = (id) => here.filter((p) => p.winner === id).map((p) => p.owner);
      const mine = here.find((p) => p.owner === me);
      return {
        ...g,
        picks: { [g.a]: side(g.a), [g.b]: side(g.b) },
        locks: here.filter((p) => p.lock).map((p) => p.owner),
        mine: mine ? mine.winner : null,
        myLock: Boolean(mine && mine.lock),
      };
    });
    const graded = C().grade(s, b).weeks[w];
    const rows = graded ? graded.rows.slice().sort((x, y) => (y.points - x.points) || (y.correct - x.correct) || (x.wrong - y.wrong)) : [];
    const picked = ((b.picked || {})[w] || []).slice();
    // The member's own picks count them as having picked, board or not.
    if (me && !picked.includes(me) && picks.some((p) => p.owner === me)) picked.push(me);
    const locked = lockedFor(w, b) || sl.final;
    return {
      year: s.year,
      week: w,
      final: sl.final,
      open: sl.open && !locked,
      locked,
      deadline: deadlineFor(s.year, w, b),
      games,
      rows: rows.filter((r) => r.picked > 0),
      best: graded ? graded.best : [],
      picked: locked ? [...new Set(picks.map((p) => p.owner))] : picked,
      members: (b.members || []).length,
      me,
    };
  }

  /* ------------------------------------------------------------ awards */

  function nominees(year, wk) {
    const s = season(year);
    const n = C().nominees(s, Number(wk));
    if (!n) return null;
    return C().AWARDS.map((a) => ({ ...a, nominees: n[a.id] || [] }));
  }

  function winners(board) {
    return C().awardWinners(boardIn(board));
  }

  /* One week's awards, as the Recap's card draws them (as the site's
     awardsCard does): only for a played regular-season week; the ballot
     while voting is open (until the board's close time, or the formula's
     for a member without a board), and once it has closed, the winners if
     anyone voted. `show` is false when there's nothing to draw. */
  function awards(year, wk, board) {
    const w = Number(wk);
    const s = season(year);
    const E = B.seasonEngine(year);
    const b = boardIn(board) || {};
    const list = nominees(year, w) || [];
    const results = (b.results || []).filter((r) => Number(r.week) === w);
    const played = (s.playedWeeks || []).includes(w);
    const closesAt = closesFor(year, w, b);
    const open = played && w <= E.REGULAR_WEEKS && results.length === 0 && Date.now() < Date.parse(closesAt);
    const closed = !open;
    const show = played && w <= E.REGULAR_WEEKS && list.length > 0 && (open || results.length > 0);
    const won = C().awardWinners({ results })[w] || {};
    const mine = {};
    (b.mine || []).filter((v) => Number(v.week) === w).forEach((v) => { mine[v.award] = v.nominee; });
    const voted = (b.voters || {})[w] || {};
    return {
      week: w,
      show,
      closed,
      closes: closesAt,
      awards: list.map((a) => ({
        id: a.id, title: a.title, short: a.short, blurb: a.blurb, emoji: a.emoji,
        nominees: a.nominees,
        mine: mine[a.id] || null,
        voters: closed
          ? results.filter((r) => r.award === a.id).reduce((sum, r) => sum + r.votes, 0)
          : (voted[a.id] || 0),
        tally: results.filter((r) => r.award === a.id).sort((x, y) => y.votes - x.votes).map((r) => ({ nominee: r.nominee, votes: r.votes })),
        winners: won[a.id] || [],
      })),
    };
  }

  function seasonAwards(year, board) {
    const b = boardIn(board) || {};
    const won = C().awardWinners(b);
    const votesOf = (w, award, nominee) => {
      const r = (b.results || []).find((x) => Number(x.week) === Number(w) && x.award === award && x.nominee === nominee);
      return r ? r.votes : 0;
    };
    return Object.keys(won).map(Number).sort((x, y) => y - x).map((w) => ({
      week: w,
      awards: C().AWARDS.filter((a) => won[w][a.id]).map((a) => ({
        id: a.id, title: a.title, short: a.short, emoji: a.emoji,
        winners: won[w][a.id], votes: votesOf(w, a.id, won[w][a.id][0]),
      })),
    }));
  }

  /* ------------------------------------------------------------ the demo */

  function demo(year, me, mine) {
    const m = B.model();
    const s = season(year);
    const kept = boardIn(mine) || { picks: [], votes: [] };
    const out = C().demoBoard(m, s, me || null, kept);
    return { pickem: JSON.stringify(out.pickem), awards: JSON.stringify(out.awards) };
  }

  /* ------------------------------------------------------------ the share card */

  // The order the standings put every team in after a week.
  function orderAfter(E, s, w) {
    const p = E.buildPicture(w);
    const seen = new Set(p.seeds || []);
    const rest = [];
    Object.values(p.divisions || {}).forEach((ids) => ids.forEach((id) => { if (!seen.has(id)) rest.push(id); }));
    const order = (p.seeds || []).concat(rest);
    Object.keys(s.teams).forEach((id) => { if (!order.includes(id)) order.push(id); });
    return { order, stats: p.stats };
  }

  async function share(year, wk, pickem, awardBoard) {
    const E = B.seasonEngine(year);
    const s = season(year);
    const w = Number(wk);
    const games = s.results[w] || [];
    if (!games.length) return null;
    const notes = B.season.week(year, w).superlatives;
    const now = orderAfter(E, s, Math.min(w, E.REGULAR_WEEKS));
    const before = w > 1 ? orderAfter(E, s, Math.min(w - 1, E.REGULAR_WEEKS)).order : null;
    const standings = now.order.slice(0, 3).map((id, i) => ({
      team: id,
      rank: i + 1,
      record: now.stats[id] ? now.stats[id].record : "",
      move: before ? before.indexOf(id) - i : 0,
    }));
    // The week's biggest climb and fall in the standings.
    let riser = null, faller = null;
    if (before) {
      now.order.forEach((id, i) => {
        const move = before.indexOf(id) - i;
        if (move > 0 && (!riser || move > riser.move)) riser = { team: id, move, rank: i + 1 };
        if (move < 0 && (!faller || move < faller.move)) faller = { team: id, move, rank: i + 1 };
      });
    }
    let blunder = null;
    try {
      const b = await B.season.blunder(year, w);
      if (b && b.teamId && b.benched) blunder = { team: b.teamId, benched: b.benched.name, pts: b.benched.pts, costGame: Boolean(b.costGame), started: b.started ? b.started.name : null };
    } catch (_) { /* no lineups */ }

    // The clubhouse's part, where there are boards: the week's pick'em
    // winner and the awards once voting has closed.
    let pickWinner = null;
    const pb = boardIn(pickem);
    if (pb) {
      const wkp = C().grade(s, pb).weeks[w];
      if (wkp && wkp.final && wkp.best.length) {
        const row = wkp.rows.find((r) => r.owner === wkp.best[0]);
        const teamOf = (owner) => Object.keys(s.teams).find((id) => s.teams[id].ownerId === owner) || null;
        pickWinner = { teams: wkp.best.map(teamOf).filter(Boolean), points: row ? row.points : 0, correct: row ? row.correct : 0, games: wkp.games };
      }
    }
    let awardsOut = null;
    const ab = boardIn(awardBoard);
    if (ab) {
      const won = C().awardWinners(ab)[w];
      if (won) awardsOut = C().AWARDS.filter((a) => won[a.id]).map((a) => ({ id: a.id, title: a.title, emoji: a.emoji, teams: won[a.id] }));
    }

    const m = B.model();
    return {
      league: m.name,
      year: s.year,
      week: w,
      title: `Week ${w}`,
      kicker: `${s.year} season · ${w > E.REGULAR_WEEKS ? "playoffs" : `${games.length} games`}`,
      high: notes ? { team: notes.high.id, score: fmt(notes.high.score) } : null,
      low: notes ? { team: notes.low.id, score: fmt(notes.low.score) } : null,
      blowout: notes ? { winner: notes.blowout.winner, loser: notes.blowout.loser, margin: fmt(notes.blowout.margin) } : null,
      closest: notes ? { winner: notes.closest.winner, loser: notes.closest.loser, margin: fmt(notes.closest.margin) } : null,
      standings,
      riser,
      faller,
      blunder: blunder ? { ...blunder, pts: fmt(blunder.pts) } : null,
      pickWinner,
      awards: awardsOut && awardsOut.length ? awardsOut : null,
      host: "pigskinpantheon.com",
    };
  }

  B.clubhouse = {
    key: () => C().leagueKey(B.model()),
    source: () => C().source(B.model()),
    info,
    deadline,
    slate,
    grade,
    week,
    nominees,
    winners,
    awards,
    seasonAwards,
    demo,
    share,
  };
})();
