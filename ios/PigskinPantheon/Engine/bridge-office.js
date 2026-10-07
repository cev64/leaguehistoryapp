/* Bridge.office: the front office (moves.html), read through insights.js.

   The page's own script (frontOffice in moves.html) lifted as it is: the
   same tabs and season wheel, the same cards in the same order, the same
   words and numbers. Where the page writes HTML this writes plain data the
   app draws natively:

     Bridge.office.nav()            the tabs, and the season each opens on
     Bridge.office.wheel(tab)       a tab's wheel of seasons (ALL = 0)
     Bridge.office.panel(tab, year) everything a tab shows for a season:
                                    { tab, year, title, wheel, cards, empty }

   A card is { title, icon, meta, kind, rows | items | trades, note, empty }:
     rows    a ranked team or manager with a big number, a bar, small stats
             (and for draft picks, a row of chips per draft)
     items   a line of what happened (a benching, a pickup), a number at the end
     trades  a trade per entry, one block per side
   Text that the page sets in <em> or .muted comes as segments
   [{ t, em?, muted?, pid? }]; a pid makes it a link to that player. */
(function () {
  "use strict";

  const B = window.Bridge;
  const ALL = 0;

  const fmt = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pctTxt = (n) => `${(n * 100).toFixed(1)}%`;

  /* ------------------------------------------------------------ the page's state */

  let tradeYears = null;   // seasons with a trade, once the trades are read
  let pickYears = null;    // drafts still to come, once the ledger is read
  let tradesJob = null;
  let tradesModel = null;

  function shape() {
    const model = B.model();
    const played = model.seasons.filter((s) => s.playedWeeks.length);
    const years = played.map((s) => s.year).sort((a, b) => b - a);
    const newest = model.seasons[model.seasons.length - 1];
    const picksShown = Boolean(newest && newest.settings.leagueType > 0 && model.platform !== "espn");
    const live = new Set(model.seasons.filter((s) => s.live).map((s) => s.year));
    const asc = years.slice().sort((a, b) => a - b);
    return { model, played, years, asc, newest, picksShown, live };
  }

  function tabsOf(picksShown) {
    return [
      { id: "lineups", label: "Lineups", short: null },
      { id: "trades", label: "Trades", short: null },
      { id: "waivers", label: "Waivers", short: null },
      ...(picksShown ? [{ id: "picks", label: "Draft Picks", short: "Picks" }] : []),
    ];
  }

  function nav() {
    const { years, picksShown, model } = shape();
    return {
      tabs: tabsOf(picksShown),
      // Each tab keeps its own season; these are where they start.
      start: { lineups: years[0] || ALL, trades: ALL, waivers: years[0] || ALL, picks: ALL },
      hasGames: years.length > 0,
      seasons: years.length,
      source: League.sourceName(),
      name: model.name,
    };
  }

  /* The capsule's wheel (wheelFor): ALL first where a tab has one. The
     rings use the season rail's shape: { w, num, played, playoff, now, label }. */
  function wheel(tab) {
    const { asc, live } = shape();
    const all = { w: ALL, num: "ALL", played: true, playoff: false, now: false, label: "All-time" };
    const season = (y, extra = {}) => ({ w: y, num: String(y), played: true, playoff: false, now: live.has(y), label: `${y} season${live.has(y) ? " · in progress" : ""}`, ...extra });
    if (tab === "lineups") return [...(asc.length > 1 ? [all] : []), ...asc.map((y) => season(y))];
    if (tab === "waivers") return asc.map((y) => season(y));
    if (tab === "trades") return [all, ...asc.map((y) => season(y, tradeYears && !tradeYears.has(y) ? { played: false, label: `${y} · no trades` } : {}))];
    return [all, ...(pickYears || []).map((y) => ({ w: y, num: String(y), played: false, playoff: false, now: false, label: `${y} draft` }))];
  }

  /* yearNow: a season the tab's wheel doesn't have falls back to its last. */
  function settle(tab, year) {
    const items = wheel(tab);
    let y = Number(year) || ALL;
    if (tab === "picks" && !pickYears) return y;
    if (!items.some((k) => k.w === y)) y = items.length ? items[items.length - 1].w : ALL;
    return y;
  }

  function titleOf(tab, y) {
    const t = tabsOf(true).find((x) => x.id === tab) || { label: "Front Office" };
    return `${t.label} · ${y === ALL ? "All-time" : tab === "picks" ? `${y} draft` : y}`;
  }

  /* ------------------------------------------------------------ who */

  // A team as it was in a season, or a manager across all of them.
  // (a drawn data: picture is the team's initials, which the app draws
  // itself, so only its kind is sent, not the whole picture)
  function logoOf(model, ownerId, fallback) {
    const src = (model.logos && model.logos[ownerId]) || fallback || null;
    if (src && src.startsWith("data:")) return src.startsWith("data:image/svg") ? "data:image/svg+xml" : null;
    return src;
  }
  function seasonTeam(model, year, teamId) {
    const t = model.season(year).teams[teamId];
    return { year: Number(year), teamId, ownerId: t.ownerId, name: t.name, sub: t.owner, icon: t.icon || "", color: t.color || null, logo: logoOf(model, t.ownerId, t.logo) };
  }
  function manager(model, ownerId) {
    const o = model.owners[ownerId];
    return { year: null, teamId: null, ownerId, name: o.currentTeam, sub: o.name, icon: o.icon || "", color: o.color || null, logo: logoOf(model, ownerId, o.logo) };
  }
  const teamName = (model, year, teamId) => model.season(year).teams[teamId].name;

  const card = (title, icon, meta, kind, body) => ({ title, icon, meta: meta == null ? null : String(meta), kind, rows: [], items: [], trades: [], note: null, empty: null, ...body });
  const stat = (label, value, extra = {}) => ({ label, value: String(value), tone: null, tail: null, ...extra });
  const seg = (t, extra = {}) => ({ t: String(t), em: false, muted: false, pid: null, ...extra });

  /* ------------------------------------------------------------ lineups */

  async function drawLineups(m, y, db) {
    const { model, played } = m;
    const player = (pid) => (db[pid] ? db[pid][0] : `Player ${pid}`);
    const note = "Hindsight: the best lineup each team could have set from the players it had that week, against the one it set. Players who stayed on a taxi squad all season aren't counted.";
    if (y === ALL) {
      const rows = await Insights.lineupAllTime(model);
      const best = Math.max(...rows.map((r) => r.efficiency), 0);
      return [card("Lineup efficiency · All-time", "lineup", `${played.length} seasons`, "rows", {
        rows: rows.map((r, i) => ({
          rank: i + 1, who: manager(model, r.ownerId),
          big: pctTxt(r.efficiency), bigSub: "of the best lineup", tone: null,
          meter: r.efficiency / (best || 1),
          stats: [stat("Left on the bench", fmt(r.left)), stat("Games lost to the lineup", r.costGames), stat("Perfect weeks", r.perfect, { tail: `of ${r.weeks}` })],
          picks: [],
        })),
        note,
      })];
    }
    const s = await Insights.lineupSeason(model, y);
    if (!s) return [];
    const best = Math.max(...s.rows.map((r) => r.efficiency), 0);
    const table = card(`Lineup efficiency · ${y}`, "lineup", `${s.weeks.length} week${s.weeks.length === 1 ? "" : "s"}`, "rows", {
      rows: s.rows.map((r, i) => ({
        rank: i + 1, who: seasonTeam(model, y, r.teamId),
        big: pctTxt(r.efficiency), bigSub: `${fmt(r.actual)} of ${fmt(r.optimal)}`, tone: null,
        meter: r.efficiency / (best || 1),
        stats: [stat("Left on the bench", fmt(r.left)), stat("Games lost to the lineup", r.costGames, { tone: r.costGames ? "bad" : null }), stat("Perfect weeks", r.perfect)],
        picks: [],
      })),
      note,
    });
    const lost = new Set(s.lostGames.map((g) => `${g.week}|${g.teamId}`));
    const blunders = card("Costliest benchings", "star", y, "items", s.blunders.length ? {
      items: s.blunders.slice(0, 12).map((b) => ({
        title: `${teamName(model, y, b.teamId)} · Week ${b.week}`,
        tag: lost.has(`${b.week}|${b.teamId}`) ? "Cost the game" : null, tagSoft: false,
        line: [
          seg("Benched "), seg(player(b.benched.pid), { em: true, pid: b.benched.pid }), seg(` (${fmt(b.benched.pts)})`),
          ...(b.started ? [seg(" and started "), seg(player(b.started.pid), { em: true, pid: b.started.pid }), seg(` (${fmt(b.started.pts)})`)] : [seg(" and left a slot empty")]),
        ],
        big: `−${fmt(b.cost)}`, bigSub: "points", tone: "bad",
        pid: b.benched.pid, team: seasonTeam(model, y, b.teamId), week: b.week, opponent: null,
      })),
    } : { empty: "Not one benching cost a point. Remarkable." });
    const cards = [table, blunders];
    if (s.lostGames.length) {
      cards.push(card("Games lost to the lineup", "lineup", `${s.lostGames.length}`, "items", {
        items: s.lostGames.slice().sort((a, b) => a.week - b.week).map((g) => {
          const opp = (model.season(y).results[g.week] || []).map(([a, as, b, bs]) => (a === g.teamId ? [b, bs] : b === g.teamId ? [a, as] : null)).find(Boolean) || [null, 0];
          return {
            title: `${teamName(model, y, g.teamId)} · Week ${g.week}`, tag: null, tagSoft: false,
            line: [seg(`Lost ${fmt(g.actual)}–${fmt(opp[1])} to ${opp[0] ? teamName(model, y, opp[0]) : "their opponent"}. The best lineup scored `), seg(fmt(g.optimal), { em: true }), seg(".")],
            big: fmt(g.left), bigSub: "on the bench", tone: null,
            pid: null, team: seasonTeam(model, y, g.teamId), week: g.week, opponent: opp[0],
          };
        }),
      }));
    }
    return cards;
  }

  /* ------------------------------------------------------------ trades */

  async function drawTrades(m, ty) {
    const { model } = m;
    if (!tradesJob || tradesModel !== model) { tradesJob = Insights.trades(model); tradesModel = model; }
    const { trades, traders: allTime } = await tradesJob;
    if (!tradeYears) tradeYears = new Set(trades.map((t) => t.year));
    if (!trades.length) return { empty: "No trades in this league's history yet." };
    const list = trades.filter((t) => ty === ALL || t.year === ty);
    if (!list.length) return { empty: `No trades were made in ${ty}.` };
    const traders = ty === ALL ? allTime : Insights.tradersOf(list);
    const board = card("Best and worst traders", "trade", ty === ALL ? "All-time" : ty, "rows", {
      rows: traders.map((o, i) => ({
        rank: i + 1, who: ty === ALL ? manager(model, o.ownerId) : seasonTeam(model, ty, o.teamId),
        big: `${o.net > 0 ? "+" : ""}${fmt(o.net)}`, bigSub: "net points", tone: o.net > 0 ? "good" : o.net < 0 ? "bad" : null,
        meter: null,
        stats: [stat("Trades", o.trades), stat("Won", o.won), stat("Got", fmt(o.got)), stat("Gave away", fmt(o.gave))],
        picks: [],
      })),
      note: "A trade is scored by the points each side's players went on to put up in its starting lineup. A traded pick counts once it's used, through the player drafted with it.",
    });

    const item = (g, year) => {
      if (g.kind === "player") return { label: [seg(g.name, { pid: g.pid }), seg(` ${g.pos}`, { muted: true })], value: fmt(g.pts), valueMuted: false, pid: g.pid };
      if (g.kind === "faab") return { label: [seg(`$${g.amount} FAAB`)], value: "—", valueMuted: true, pid: null };
      const label = [seg(`${g.season} round ${g.round} pick`)];
      if (g.origin && model.season(year).teams[g.origin]) label.push(seg(` (${teamName(model, year, g.origin)})`, { muted: true }));
      if (g.became) {
        label.push(seg(" → "), seg(g.became.name, { pid: g.became.pid }));
        if (g.passedOn) label.push(seg(" traded on", { muted: true }));
      } else if (g.pending) label.push(seg(" not yet drafted", { muted: true }));
      const counts = g.became && !g.passedOn;
      return { label, value: counts ? fmt(g.pts) : "—", valueMuted: !counts, pid: g.became ? g.became.pid : null };
    };
    const verdict = (t) => {
      if (!t.winner) return { text: t.sides.every((s) => !s.total) ? "Too early to call" : "Dead even", won: false };
      return { text: `${teamName(model, t.year, t.winner)} +${fmt(t.margin)}${t.pending || t.live ? " so far" : ""}`, won: true };
    };
    const when = (t) => (t.created ? new Date(t.created).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : `Week ${t.week}`);
    const every = card(ty === ALL ? "Every trade" : `${ty} trades`, "trade", `${list.length}`, "trades", {
      trades: list.map((t, i) => ({
        id: `${t.id}:${i}`, year: t.year, week: t.week,
        head: `${t.year} · ${when(t)}`,
        verdict: verdict(t),
        sides: t.sides.map((s) => ({
          who: seasonTeam(model, t.year, s.teamId),
          total: fmt(s.total), winner: t.winner === s.teamId,
          got: s.got.map((g) => item(g, t.year)),
        })),
      })),
    });
    return { cards: [board, every] };
  }

  /* ------------------------------------------------------------ waivers */

  async function drawWaivers(m, y) {
    const { model } = m;
    const w = await Insights.waivers(model, y);
    if (!w || !w.pickups.length) return { empty: `No waiver claims or free-agent pickups in ${y}.` };
    const report = card(`Waiver report · ${y}`, "wire", w.faab ? `$${w.budget} FAAB budget` : "Rolling waivers", "rows", {
      rows: w.rows.map((r, i) => ({
        rank: i + 1, who: seasonTeam(model, y, r.teamId),
        big: fmt(r.pts), bigSub: "pts from pickups", tone: null, meter: null,
        stats: [
          stat("Pickups", r.adds), stat("Started 3+ times", r.hits),
          ...(w.faab ? [stat("FAAB spent", `$${r.spent}`), stat("Pts per $1", r.perDollar != null ? r.perDollar.toFixed(1) : "—")] : []),
        ],
        picks: [],
      })),
      note: `Points a pickup scored in the starting lineup of the team that added him, for the rest of that season.${w.failed ? ` ${w.failed} claim${w.failed === 1 ? "" : "s"} lost out to a higher bid or priority.` : ""}`,
    });
    const pickupRow = (p) => ({
      title: p.name, tag: p.pos || null, tagSoft: true,
      line: [seg(`${teamName(model, y, p.teamId)} · Week ${p.week} · ${p.kind === "waiver" ? (w.faab && p.bid != null ? `$${p.bid} bid` : "waiver claim") : "free agent"} · ${p.starts} start${p.starts === 1 ? "" : "s"}`)],
      big: fmt(p.pts), bigSub: "pts", tone: null,
      pid: p.pid, team: seasonTeam(model, y, p.teamId), week: p.week, opponent: null,
    });
    const cards = [report, card("Best pickups", "star", y, "items", { items: w.pickups.slice(0, 12).map(pickupRow) })];
    if (w.faab) {
      const big = w.pickups.filter((p) => p.bid).sort((a, b) => b.bid - a.bid).slice(0, 10);
      if (big.length) cards.push(card("Biggest bids", "wire", "and what they bought", "items", { items: big.map(pickupRow) }));
    }
    return { cards };
  }

  /* ------------------------------------------------------------ draft picks */

  async function drawPicks(m, picked) {
    const { model } = m;
    const ledger = await Insights.pickLedger(model);
    if (!ledger) return { empty: "This league has no rookie draft picks to track." };
    if (!pickYears) pickYears = ledger.seasons;
    const y = ledger.year;
    const one = picked === ALL ? null : picked;
    const seasons = one ? [one] : ledger.seasons;
    const value = (r) => (one ? (ledger.parYear ? r.byYear[one] / ledger.parYear : 1) : r.vsPar);
    const rows = ledger.rows.slice().sort((a, b) => value(b) - value(a)).map((r, i) => {
      const v = value(r);
      return {
        rank: i + 1, who: seasonTeam(model, y, r.teamId),
        big: `${Math.round(v * 100)}%`, bigSub: "pick capital", tone: v > 1.001 ? "good" : v < 0.999 ? "bad" : null,
        meter: null, stats: [],
        picks: seasons.map((year) => ({
          year,
          chips: [
            ...r.picks.filter((p) => p.year === year).sort((a, b) => a.round - b.round)
              .map((p) => ({ round: p.round, text: `${p.round}${p.own ? "" : "*"}`, kind: p.own ? "own" : "got", hint: p.own ? "Own pick" : `From ${teamName(model, y, p.origin)}` })),
            ...r.lost.filter((p) => p.year === year).map((p) => ({ round: p.round, text: String(p.round), kind: "lost", hint: "Traded away" })),
          ],
        })),
      };
    });
    const span = one ? `${one} · ${ledger.rounds} rounds` : `${ledger.seasons[0]}–${ledger.seasons[ledger.seasons.length - 1]} · ${ledger.rounds} rounds`;
    return {
      cards: [card(one ? `${one} draft picks` : "Future draft picks", "pick", span, "rows", {
        rows,
        note: "Each number is a round. Blue with a * came in a trade (hover or long-press for whose); dashed and struck through was traded away. Pick capital weighs a first-round pick most and each later round a little over half the one before; 100% is a team's own picks.",
      })],
    };
  }

  /* ------------------------------------------------------------ a tab, a season */

  async function panel(tab, year) {
    const m = shape();
    const out = (y, body) => ({
      tab, year: y, title: titleOf(tab, y), wheel: wheel(tab),
      cards: body.cards || [], empty: body.empty || null,
    });
    if (!m.years.length) return out(ALL, { empty: "No games have been played in this league yet." });
    const db = await League.players();
    let y = settle(tab, year);
    let body;
    if (tab === "lineups") body = { cards: await drawLineups(m, y, db) };
    else if (tab === "trades") {
      body = await drawTrades(m, y);
      // the wheel now knows which seasons had trades
      const y2 = settle(tab, y);
      if (y2 !== y) { y = y2; body = await drawTrades(m, y); }
    } else if (tab === "waivers") body = await drawWaivers(m, y);
    else if (tab === "picks") {
      if (!m.picksShown) return out(ALL, { empty: "This league has no rookie draft picks to track." });
      body = await drawPicks(m, y);
      // the wheel now knows the drafts to come
      const y2 = settle(tab, y);
      if (y2 !== y) { y = y2; body = await drawPicks(m, y); }
    } else throw new Error(`There is no ${tab} tab.`);
    return out(y, body);
  }

  B.office = { nav, wheel, panel };
})();
