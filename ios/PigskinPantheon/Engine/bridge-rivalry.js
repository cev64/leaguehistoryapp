/* Bridge.rivalry: the rivalry preview for one game (season.html's
   openRivalry), through the same shared computation the site runs
   (insights.js, Insights.rivalry), so the numbers and words match.

     Bridge.rivalry.preview(year, week, a, b)   the two managers' all-time
                                                series, both seasons and
                                                careers, and what's within
                                                reach in this game */
(function () {
  "use strict";

  const B = window.Bridge;

  async function preview(year, week, a, b) {
    const m = B.model();
    const out = window.Insights.rivalry(m, year, week, a, b);
    // Each side as the app's TeamBadge draws it: the season's team carries
    // the logo, so only the ids are needed; no data: pictures in the JSON.
    // Every meeting with its two teams' ids that season (side a's manager
    // first; insights.js gives them, else they're found by manager) and
    // whether its week has a box score, so a tap can open it.
    const series = out && out.series;
    if (series && Array.isArray(series.meetings)) {
      const oa = out.a.ownerId, ob = out.b.ownerId;
      const boxes = {};
      const years = [...new Set(series.meetings.map((g) => g.year))];
      await Promise.all(years.map(async (y) => {
        try { boxes[y] = await m.boxWeeks(Number(y)); } catch (_) { boxes[y] = new Set(); }
      }));
      const teamOf = (y, owner) => {
        const s = m.season(Number(y));
        if (!s) return null;
        const hit = Object.entries(s.teams).find(([, t]) => t.ownerId === owner);
        return hit ? hit[0] : null;
      };
      series.meetings = series.meetings.map((g) => {
        const idA = g.teamIdA || teamOf(g.year, oa), idB = g.teamIdB || teamOf(g.year, ob);
        const weeks = boxes[g.year];
        const box = Boolean(idA && idB && weeks && (weeks.has ? weeks.has(g.week) : [].concat(weeks).includes(g.week)));
        return { ...g, teamIdA: idA, teamIdB: idB, box };
      });
    }
    return out;
  }

  B.rivalry = { preview };
})();
