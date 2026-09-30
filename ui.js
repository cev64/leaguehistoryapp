/* Shared motion and season navigation for every page of the record book.

   Loaded (not deferred) in each page's <head>, ahead of the page's own
   script, so `UI` and `SeasonNav` exist by the time that script runs. Only
   definitions and a couple of passive listeners run here; nothing touches
   the page until it asks.

   UI.roll(el, text, dir)      a heading's text rolls out and the new text
                               rolls in, up when moving forward, down when
                               going back.
   UI.measureRows(root)        snapshot every team row in root's tables...
   UI.shuffleRows(root, snap)  ...then slide each row from where it was to
                               where it is now, washing green if it climbed
                               and red if it dropped.
   SeasonNav.mount(el, opts)   the season pages' pinned navigation: the view
   SeasonNav.render(state)     switcher across the top of a frosted capsule
                               and the week wheel under it (see below).
   (cards, automatic)          the team drawer, box score and player card
                               arrive in choreographed steps, and on a
                               desktop grow out of whatever opened them.

   Every animation is skipped under prefers-reduced-motion. */
(() => {
  "use strict";

  const REDUCE = matchMedia("(prefers-reduced-motion: reduce)");
  const FINE = matchMedia("(hover: hover) and (pointer: fine)");
  const COARSE = matchMedia("(pointer: coarse)");
  // phones: the season capsule lives at the bottom of the screen, in thumb reach
  const PHONE = matchMedia("(max-width: 760px)");
  const EASE = "cubic-bezier(.22,1,.36,1)";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const raf2 = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));

  /* Short taps on phones that support vibration (Android): a tick for each
     week the wheel passes, a tap when something is chosen. */
  const HAPTIC = { tick: 4, tap: 6 };
  function haptic(kind) {
    if (!COARSE.matches || !navigator.vibrate) return;
    try { navigator.vibrate(HAPTIC[kind] || kind); } catch (_) { /* not allowed yet */ }
  }

  /* ---------------------------------------------------------------
     Title roll. The old text is laid over the new one and both run
     their half of the roll; the old copy is dropped once it is gone.
     --------------------------------------------------------------- */
  function roll(el, text, dir = "up") {
    if (!el) return;
    const old = el.dataset.t;
    if (old === text) return;
    el.dataset.t = text;
    if (old == null || REDUCE.matches) { el.innerHTML = `<span class="ui-roll"><span>${esc(text)}</span></span>`; return; }
    el.innerHTML = `<span class="ui-roll"><span class="ui-roll-out ${dir}" aria-hidden="true">${esc(old)}</span><span class="ui-roll-in ${dir}">${esc(text)}</span></span>`;
    clearTimeout(el._roll);
    el._roll = setTimeout(() => {
      if (el.dataset.t === text) el.innerHTML = `<span class="ui-roll"><span>${esc(text)}</span></span>`;
    }, 650);
  }

  /* ---------------------------------------------------------------
     Row shuffle (FLIP). A row is keyed by its table and the team it
     names, and measured against the top of its own table body, so a
     panel that grows or shrinks above it doesn't count as a move.
     --------------------------------------------------------------- */
  const UP = "22,131,74", DOWN = "215,25,32";
  function rowMap(root) {
    const m = new Map();
    root.querySelectorAll("tbody").forEach((tb, ti) => {
      if (!tb.offsetParent) return;
      const top = tb.getBoundingClientRect().top;
      [...tb.rows].forEach((tr) => {
        const t = tr.querySelector("[data-team]");
        if (t) m.set(`${ti}|${t.dataset.team}`, { el: tr, y: tr.getBoundingClientRect().top - top });
      });
    });
    return m;
  }
  function measureRows(root) {
    if (!root || REDUCE.matches || !root.offsetParent) return null;
    const m = rowMap(root);
    return m.size ? m : null;
  }
  function tint(el, rgb) {
    // fade back to the row's own fill rather than to transparent, so a
    // shaded row (a playoff seed, the champion) doesn't flash at the end
    const rest = getComputedStyle(el).backgroundColor;
    el.animate([{ backgroundColor: `rgba(${rgb},.16)` }, { backgroundColor: rest }], { duration: 1400, easing: "ease-out" });
  }
  function shuffleRows(root, before, { wash = true } = {}) {
    if (!before || !root) return false;
    let moved = false;
    rowMap(root).forEach(({ el, y }, k) => {
      const was = before.get(k);
      if (!was) return;
      const dy = was.y - y;
      if (Math.abs(dy) < 1) return;
      moved = true;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 650, easing: EASE, fill: "backwards" });
      if (wash) tint(el, dy > 0 ? UP : DOWN);
    });
    return moved;
  }

  /* Sorting a table by a column header (or the phone's sort menu) slides
     the rows into their new order instead of redrawing them in place. The
     page's own handler re-renders during the click; the rows are measured
     before it runs (capture phase) and animated in the frame after. */
  function sortFlip(event) {
    const trigger = event.target.closest && event.target.closest(".sort-button, .mobile-sort-direction, .mobile-sort-control select");
    if (!trigger) return;
    const card = trigger.closest(".card, section") || document;
    const before = measureRows(card);
    if (before) requestAnimationFrame(() => shuffleRows(card, before, { wash: false }));
  }
  document.addEventListener("click", sortFlip, true);
  document.addEventListener("change", sortFlip, true);

  /* The header gains a soft shadow once the page scrolls under it. */
  let scrollRaf = 0;
  window.addEventListener("scroll", () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const bar = document.querySelector(".topbar");
      if (bar) bar.classList.toggle("scrolled", window.scrollY > 4);
    });
  }, { passive: true });

  /* ---------------------------------------------------------------
     Pinning, shared by the season capsule and the all-time search.

     At the top (desktops, tablets, the all-time page): a sentinel just
     above the pill marks where it pins under the header, and the pill's
     box in the page keeps its open height (the capsule shrinks inside
     it, and a search drops out of it over the page), so neither pinning
     nor searching ever moves the page.

     At the bottom (a season's capsule on a phone, where a thumb can
     reach it): the pill is fixed to the bottom of the screen and out of
     the page's flow. It rests as a docked bar while the page is at its
     top and "pins" into a floating capsule as soon as the page scrolls;
     the page keeps room for it at its foot (--sn-space).
     --------------------------------------------------------------- */
  function pinnable(root, { onStick, bottom = () => false } = {}) {
    root.insertAdjacentHTML("beforebegin", '<div class="sn-sentinel" aria-hidden="true"></div>');
    const sentinel = root.previousElementSibling;
    const cap = root.querySelector(".sn-cap");
    // for the bottom pill: has the page left its top?
    const mark = document.createElement("div");
    mark.className = "sn-scroll-mark";
    mark.setAttribute("aria-hidden", "true");
    document.body.prepend(mark);
    let io = null;
    /* How far down it pins: under a header that runs across the top, or
       at the very top beside the desktop sidebar. */
    function top() {
      const bar = document.querySelector(".topbar");
      if (!bar) return 0;
      const pos = getComputedStyle(bar).position;
      if (pos !== "sticky" && pos !== "fixed") return 0;
      if (!bottom() && bar.getBoundingClientRect().right <= root.getBoundingClientRect().left + 1) return 0;
      return bar.offsetHeight;
    }
    const setStuck = (on) => root.classList.toggle("stuck", on);
    /* measure the resting, open layout with transitions off and without
       the pinned or searching states, which are put back unseen */
    function measure() {
      if (!root.offsetParent && !bottom()) return;
      root.style.setProperty("--sn-top", `${top()}px`);
      const stuck = root.classList.contains("stuck"), open = root.classList.contains("searching");
      root.classList.add("measuring");
      if (stuck) setStuck(false);
      if (open) root.classList.remove("searching");
      root.style.height = "";
      if (bottom()) document.documentElement.style.setProperty("--sn-space", `${cap.offsetHeight}px`);
      else root.style.height = `${cap.offsetHeight}px`;
      if (open) root.classList.add("searching");
      if (stuck) setStuck(true);
      void cap.offsetHeight;
      raf2(() => root.classList.remove("measuring"));
    }
    function watch() {
      if (io) io.disconnect();
      sentinel.hidden = bottom();
      if (!("IntersectionObserver" in window)) return;
      const flip = (stuck) => {
        if (stuck === root.classList.contains("stuck")) return;
        setStuck(stuck);
        if (onStick) onStick(stuck);
      };
      if (bottom()) {
        io = new IntersectionObserver(([e]) => flip(!e.isIntersecting), { threshold: 0 });
        io.observe(mark);
        return;
      }
      const t = top();
      io = new IntersectionObserver(([e]) => flip(!e.isIntersecting && e.boundingClientRect.top < t + 1),
        { rootMargin: `-${t + 1}px 0px 0px 0px`, threshold: 0 });
      io.observe(sentinel);
    }
    /* The top of the content: where the pill lets go, or (with the pill
       at the bottom) just under the header. By default only scrolls back
       up to it; { down: true } also scrolls down to it, past whatever sits
       above the content. */
    function toTop({ up = true, down = false } = {}) {
      const from = bottom() ? (root.nextElementSibling || root) : sentinel;
      const y = Math.max(0, from.getBoundingClientRect().top + window.scrollY - top() - (bottom() ? 6 : 0));
      const d = window.scrollY - y;
      if ((up && d > 1) || (down && d < -1)) window.scrollTo({ top: y, behavior: REDUCE.matches ? "auto" : "smooth" });
    }
    return { sentinel, top, measure, watch, toTop };
  }

  const ICON_FIND = '<svg class="ic-find" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>';
  const ICON_X = '<svg class="ic-x" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

  /* ---------------------------------------------------------------
     Player search results, shared by every search box. PlayerCard
     (player-card.js) owns the data, the search and the card; each
     result carries data-player, which player-card.js opens on a tap.
     onChange(hasContent) says whether there is a list to show.
     --------------------------------------------------------------- */
  function playerFinder(input, list, { limit = 8, onChange } = {}) {
    let seq = 0, shown = false;
    const tell = (has) => { if (has !== shown) { shown = has; if (onChange) onChange(has); } };
    const photo = (h) => {
      if (h.headshot && h.pos !== "DST") {
        return `<img src="https://sleepercdn.com/content/nfl/players/thumb/${esc(h.headshot)}.jpg" alt="" loading="lazy" data-club="${esc(h.club)}">`;
      }
      return window.PlayerCard && window.PlayerCard.nflLogo ? window.PlayerCard.nflLogo(h.club, "pr-logo") : "";
    };
    function run() {
      const q = input.value.trim();
      const mine = ++seq;
      if (!q || !window.PlayerCard) { list.innerHTML = ""; tell(false); return; }
      window.PlayerCard.search(q, limit).then((hits) => {
        if (mine !== seq) return;
        list.innerHTML = hits.length ? hits.map((h, i) => {
          const yrs = h.seasons.length > 1 ? `${h.seasons[0]}–${String(h.seasons[h.seasons.length - 1]).slice(2)}` : h.seasons[0];
          return `<button type="button" class="player-result" role="option" style="--ui-i:${i}" data-player="${encodeURIComponent(h.id)}">
            <span class="pr-photo">${photo(h)}</span>
            <span class="pr-who"><strong>${esc(h.name)}</strong><small>${esc(h.pos)} · ${esc(h.club)} · ${yrs}</small></span>
            <span class="pr-nums"><b>${h.starts}</b><small>starts</small></span>
          </button>`;
        }).join("") : `<div class="player-empty">No one by that name has played in this league.</div>`;
        tell(true);
      });
    }
    input.addEventListener("input", run);
    // a photo that can't load (offline, say) gives way to the player's club chip
    list.addEventListener("error", (e) => {
      const img = e.target;
      if (!img || img.tagName !== "IMG" || !img.dataset.club) return;
      const slot = img.closest(".pr-photo");
      if (slot && window.PlayerCard && window.PlayerCard.nflLogo) slot.innerHTML = window.PlayerCard.nflLogo(img.dataset.club, "pr-logo");
    }, true);
    // start loading the player data the moment someone looks like searching
    input.addEventListener("focus", () => window.PlayerCard && window.PlayerCard.search("", 0));
    input.addEventListener("keydown", (e) => {
      const first = list.querySelector("[data-player]");
      if (e.key === "Enter" && first) { e.preventDefault(); first.click(); }
      if (e.key === "ArrowDown" && first) { e.preventDefault(); first.focus(); }
    });
    // up and down move through the results; up from the first returns to the field
    list.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = [...list.querySelectorAll("[data-player]")], i = items.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const next = items[i + (e.key === "ArrowDown" ? 1 : -1)];
      (next || (e.key === "ArrowUp" ? input : items[i])).focus();
    });
    return {
      run,
      clear() { seq++; input.value = ""; list.innerHTML = ""; tell(false); },
      get shown() { return shown; },
    };
  }

  /* "/" opens search from anywhere, as on most sites, unless a field or
     an open card already has the keyboard. */
  function slashOpens(open) {
    document.addEventListener("keydown", (e) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && t.closest && t.closest("input, select, textarea, [contenteditable]")) return;
      if (document.querySelector(".team-drawer.open, .bx-modal.open, .pc.open")) return;
      e.preventDefault();
      open();
    });
  }

  /* ===============================================================
     SEASON NAV

     One frosted capsule holding the season's views (Results,
     Standings, Playoffs, ...) as a segmented control that spans its
     whole width, and the week wheel under it. It pins under the
     header as the page scrolls and tightens into a floating card; its
     box in the page keeps its open height, so pinning never makes the
     page jump.

     Weeks are progress rings: a played week's ring is closed, a
     week still to come is an open track, and a navy disc glides to
     the selected one.
       Mouse: every week on one row, magnified under the pointer like
              the macOS Dock.
       Touch: an iOS-picker-style wheel. The week under the centre
              line is magnified, snaps into place and is chosen once
              the swipe settles.

     The page stays in charge of its data: it calls render() with the
     weeks and views it has, and hears back through onWeek / onView.
     =============================================================== */
  const SeasonNav = (() => {
    let root = null, cap = null, seg = null, segInd = null, wkbar = null, rail = null, pin = null;
    let findBtn = null, findInput = null, finder = null;
    let opts = {};
    let weeks = [], views = [], week = null, view = null, prevWeek = null;
    let chips = [], railWeek = null, visWeek = null, segIds = "";
    let userScroll = false, touching = false, swiping = false, lastCentre = null, sraf = 0, mraf = 0, mx = 0, settleT = 0;
    const arrow = (d) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

    function mount(el, options = {}) {
      root = typeof el === "string" ? document.querySelector(el) : el;
      if (!root) return;
      opts = options;
      root.classList.add("season-nav");
      root.innerHTML = `<div class="sn-cap">
        <div class="sn-top">
          <div class="sn-seg" role="tablist" aria-label="${esc(opts.viewsLabel || "Views")}"><span class="sn-seg-ind" aria-hidden="true"></span></div>
          <div class="sn-find" role="search">${ICON_FIND}<input type="search" placeholder="Search any player" aria-label="Search players"
            autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="search" tabindex="-1"></div>
          <button class="sn-search" type="button" aria-label="Search players" aria-expanded="false" title="Search players (/)">${ICON_FIND}${ICON_X}</button>
        </div>
        <div class="sn-drop"><div><div class="player-results" role="listbox" aria-label="Players"></div></div></div>
        <div class="sn-wkwrap"><div class="sn-wkbar"><div class="sn-wkcap">
          <button class="sn-arrow l" type="button" aria-label="Earlier weeks" tabindex="-1">${arrow("m15 18-6-6 6-6")}</button>
          <div class="sn-rail" role="tablist" aria-label="Week"></div>
          <button class="sn-arrow r" type="button" aria-label="Later weeks" tabindex="-1">${arrow("m9 18 6-6-6-6")}</button>
        </div></div></div>
      </div>`;
      cap = root.querySelector(".sn-cap");
      root.classList.toggle("sn-bottom", PHONE.matches);
      // ring sizes animate for ~.55s as it pins; keep the disc and the edges in step
      pin = pinnable(root, { bottom: () => PHONE.matches, onStick: () => {
        const t0 = performance.now();
        const follow = () => { placeDisc(); railEdges(); if (performance.now() - t0 < 650) requestAnimationFrame(follow); };
        requestAnimationFrame(follow);
      } });
      findBtn = root.querySelector(".sn-search");
      findInput = root.querySelector(".sn-find input");
      seg = root.querySelector(".sn-seg");
      segInd = root.querySelector(".sn-seg-ind");
      wkbar = root.querySelector(".sn-wkbar");
      rail = root.querySelector(".sn-rail");
      wire();
    }

    /* ---- views ---------------------------------------------------- */
    function label(v) {
      return v.short && v.short !== v.label
        ? `<span class="l-lg">${esc(v.label)}</span><span class="l-sm">${esc(v.short)}</span>`
        : `<span>${esc(v.label)}</span>`;
    }
    function renderViews() {
      const ids = views.map((v) => v.id).join("|");
      if (ids !== segIds) {
        const first = !segIds;
        segIds = ids;
        seg.querySelectorAll("button").forEach((b) => b.remove());
        seg.insertAdjacentHTML("beforeend", views.map((v, i) =>
          `<button type="button" role="tab" data-view="${esc(v.id)}" style="--i:${i}">${label(v)}</button>`).join(""));
        seg.dataset.n = views.length;
        // a different set of views (a playoff week, the season overview)
        // ripples in; the white pill glides over to its new place
        if (!first && !REDUCE.matches) { seg.classList.remove("swap"); void seg.offsetWidth; seg.classList.add("swap"); }
      } else {
        // same views, a label may have changed (Results <-> Matchups)
        seg.querySelectorAll("button").forEach((b, i) => { const h = label(views[i]); if (b.innerHTML !== h) b.innerHTML = h; });
      }
      seg.querySelectorAll("button").forEach((b) => {
        const on = b.dataset.view === view;
        b.setAttribute("aria-selected", on);
        b.tabIndex = on ? 0 : -1;
      });
      placeSegInd();
    }
    /* The pill is placed by index, not measured in pixels: its size and
       offset are fractions of the track (see .sn-seg-ind), so it stays on
       its button at any width, including while the capsule pins and the
       track narrows under it. */
    function placeSegInd() {
      if (!seg) return;
      const k = views.findIndex((v) => v.id === view);
      if (k < 0) return;
      seg.style.setProperty("--n", views.length);
      seg.style.setProperty("--k", k);
      if (!segInd.classList.contains("ready") && seg.offsetParent) raf2(() => segInd.classList.add("ready"));
    }

    /* ---- weeks ---------------------------------------------------- */
    function buildRail() {
      rail.innerHTML = `<div class="sn-track"><span class="sn-disc" aria-hidden="true"></span>${
        weeks.map((k, i) => `<button type="button" class="sn-wk${String(k.num).length > 2 ? " txt" : ""}${k.playoff ? " po" : ""}${k.playoff && !(weeks[i - 1] || {}).playoff ? " po-first" : ""}" role="tab" data-w="${k.w}" style="--i:${i}">
          <span class="sn-wk-in">
            <svg class="sn-ring" viewBox="0 0 40 40" aria-hidden="true"><circle class="trk" cx="20" cy="20" r="18"/><circle class="prg" cx="20" cy="20" r="18" pathLength="100"/></svg>
            <span class="sn-num">${esc(k.num)}</span>
          </span><span class="sn-dot"></span></button>`).join("")}</div>`;
      chips = [...rail.querySelectorAll(".sn-wk")];
      if (!REDUCE.matches) { wkbar.classList.add("enter"); setTimeout(() => wkbar.classList.remove("enter"), 1300); }
    }
    const chipOf = (w) => chips.find((c) => +c.dataset.w === w);
    function renderWeeks() {
      if (chips.length !== weeks.length) buildRail();
      weeks.forEach((k, i) => {
        const c = chips[i];
        c.classList.toggle("final", !!k.played);
        c.classList.toggle("zero", !k.played);
        c.classList.toggle("now", !!k.now);
        if (!swiping) c.classList.toggle("on", k.w === week);
        c.setAttribute("aria-selected", k.w === week);
        c.tabIndex = k.w === week ? 0 : -1;
        c.setAttribute("aria-label", k.label || `Week ${k.w}`);
        c.title = k.label || `Week ${k.w}`;
        c.querySelector(".prg").style.strokeDashoffset = k.played ? "0" : "100";
      });
      if (!swiping) visWeek = week;
      layoutRail();
      if (railWeek !== week && rail.offsetParent) {
        centerWeek(week, railWeek === null || REDUCE.matches ? "auto" : "smooth");
        railWeek = week;
      }
      lensUpdate();
      placeDisc();
    }
    function setVis(w) {
      if (w === visWeek) return;
      const was = chipOf(visWeek);
      if (was) was.classList.remove("on");
      visWeek = w;
      const c = chipOf(w);
      if (c) c.classList.add("on");
      placeDisc();
    }
    function centerWeek(w, behavior) {
      const c = chipOf(w);
      if (c) rail.scrollTo({ left: c.offsetLeft + c.offsetWidth / 2 - rail.clientWidth / 2, behavior });
    }
    /* the disc follows the selected ring, magnification and all */
    function placeDisc() {
      const disc = rail && rail.querySelector(".sn-disc"), c = chipOf(visWeek == null ? week : visWeek);
      if (!disc || !c || !rail.offsetParent) return;
      const sc = parseFloat(c.style.getPropertyValue("--s")) || 1;
      // CSS centres the disc on x (left: -ring/2), so it stays true while ring sizes animate
      disc.style.transform = `translate(${c.offsetLeft + c.offsetWidth / 2}px, ${(sc - 1) * -12}px) scale(${sc})`;
      if (!disc.classList.contains("ready")) raf2(() => disc.classList.add("ready"));
    }
    /* Spacers at both ends let the first and last weeks reach the centre
       line. Their width is set in px here: Safari can size a max-content
       track from the rings rather than the slots, and padding past
       overflowing items isn't scrollable, so the last week could never be
       centred. */
    function setRailEdge() {
      if (rail && rail.clientWidth) rail.style.setProperty("--edge", `${rail.clientWidth / 2 - 29}px`);
    }
    function layoutRail() {
      wkbar.classList.toggle("lens", !FINE.matches);
      setRailEdge();
      railEdges();
    }
    function railEdges() {
      const max = rail.scrollWidth - rail.clientWidth, x = rail.scrollLeft;
      const over = max > 1, canL = over && x > 2, canR = over && x < max - 2;
      wkbar.classList.toggle("over", over);
      wkbar.classList.toggle("can-l", canL);
      wkbar.classList.toggle("can-r", canR);
      rail.style.setProperty("--fl", canL ? "32px" : "0px");
      rail.style.setProperty("--fr", canR ? "32px" : "0px");
    }
    /* touch: magnify toward the centre line; returns the centred week */
    function lensUpdate() {
      if (!wkbar.classList.contains("lens") || !rail.offsetParent) return null;
      const r = rail.getBoundingClientRect(), cx = r.left + r.width / 2;
      let best = null, bd = Infinity;
      chips.forEach((c) => {
        const b = c.getBoundingClientRect(), d = Math.abs(b.left + b.width / 2 - cx);
        if (!REDUCE.matches) {
          c.style.setProperty("--s", (1 + 0.2 * Math.exp(-(d * d) / (2 * 58 * 58))).toFixed(3));
          c.style.setProperty("--o", (0.4 + 0.6 * Math.exp(-(d * d) / (2 * 120 * 120))).toFixed(3));
        }
        if (d < bd) { bd = d; best = c; }
      });
      return best;
    }
    function goWeek(w) {
      if (w === week) return;
      if (opts.onWeek) opts.onWeek(w);
      toContentTop(false);
    }

    /* ---- pinning (shared with the all-time search: pinnable) -------- */
    const measure = () => pin && pin.measure();
    const watch = () => pin && pin.watch();
    /* Changing view from the pinned capsule starts the new view at its
       top: the page scrolls back to where the capsule just lets go. With
       opts.hideHero (the finished seasons) the bottom capsule on a phone
       also scrolls down to it, tucking the champion and last-place cards
       away under the header so the content gets the screen. A new week
       only ever scrolls down: flipping weeks mid-table keeps your place. */
    const toContentTop = (up = true) => pin && pin.toTop({ up, down: !!opts.hideHero && PHONE.matches });

    /* ---- search ----------------------------------------------------
       The magnifier opens a search field across the capsule: the views
       blur away, the field grows out of the button, the week wheel folds
       up and the results drop out of the capsule over the page. A tap on
       a result opens that player's card and leaves the search open for
       the next one; the button (now a cross), Escape, or a tap anywhere
       else closes it. */
    function setSearch(on) {
      if (on === root.classList.contains("searching")) return;
      root.classList.toggle("searching", on);
      findBtn.setAttribute("aria-expanded", on);
      findBtn.setAttribute("aria-label", on ? "Close search" : "Search players");
      findInput.tabIndex = on ? 0 : -1;
      seg.inert = on;
      root.querySelector(".sn-wkwrap").inert = on;
      followKeyboard(on && PHONE.matches);
      if (on) findInput.focus({ preventScroll: true });
      else { finder.clear(); if (root.contains(document.activeElement)) findBtn.focus({ preventScroll: true }); }
    }
    /* With the capsule at the bottom of a phone, the on-screen keyboard
       would cover it: while searching it rides on top of the keyboard,
       following the visual viewport, and its results fit what's left. */
    let kbUpdate = null;
    function followKeyboard(on) {
      const vv = window.visualViewport;
      if (!vv) return;
      if (kbUpdate) { vv.removeEventListener("resize", kbUpdate); vv.removeEventListener("scroll", kbUpdate); kbUpdate = null; }
      root.style.removeProperty("--kb");
      root.style.removeProperty("--vvh");
      if (!on) return;
      kbUpdate = () => {
        root.style.setProperty("--kb", `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`);
        root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
      };
      vv.addEventListener("resize", kbUpdate);
      vv.addEventListener("scroll", kbUpdate);
      kbUpdate();
    }
    function wireSearch() {
      finder = playerFinder(findInput, root.querySelector(".sn-drop .player-results"),
        { onChange: (has) => root.classList.toggle("found", has) });
      findBtn.addEventListener("click", () => { haptic("tap"); setSearch(!root.classList.contains("searching")); });
      document.addEventListener("click", (e) => {
        if (!root.classList.contains("searching") || root.contains(e.target)) return;
        if (e.target.closest && e.target.closest(".pc, .pc-backdrop")) return;   // a player card opened from the results
        setSearch(false);
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && root.classList.contains("searching")) setSearch(false);
      });
      slashOpens(() => setSearch(true));
    }
    const relayout = () => {
      // (a fixed element has no offsetParent, so ask whether it has a box)
      if (!root || !root.getClientRects().length) return;
      layoutRail(); measure(); centerWeek(week, "auto"); lensUpdate(); placeDisc(); placeSegInd();
    };

    /* ---- events --------------------------------------------------- */
    function wire() {
      wireSearch();
      seg.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-view]");
        if (!b) return;
        // the view you're already on: back to its top, like a tab bar
        if (b.dataset.view === view) { toContentTop(); return; }
        haptic("tap");
        if (opts.onView) opts.onView(b.dataset.view);
        toContentTop();
      });
      // arrow keys move along the tabs, as in any tab list
      seg.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const bs = [...seg.querySelectorAll("button")], i = bs.findIndex((b) => b.dataset.view === view);
        const next = bs[i + (e.key === "ArrowRight" ? 1 : -1)];
        if (!next) return;
        e.preventDefault(); e.stopPropagation();
        next.click(); next.focus();
      });

      rail.addEventListener("click", (e) => {
        const c = e.target.closest(".sn-wk");
        if (!c) return;
        if (+c.dataset.w !== week) haptic("tap");
        goWeek(+c.dataset.w);
      });
      /* mouse: Dock-style magnification under the pointer */
      rail.addEventListener("pointermove", (e) => {
        if (e.pointerType !== "mouse" || wkbar.classList.contains("lens") || REDUCE.matches) return;
        mx = e.clientX;
        if (!mraf) mraf = requestAnimationFrame(() => {
          mraf = 0;
          wkbar.classList.add("mag");
          const amp = root.classList.contains("stuck") ? 0.18 : 0.3;
          chips.forEach((c) => {
            const b = c.getBoundingClientRect(), d = b.left + b.width / 2 - mx;
            c.style.setProperty("--s", (1 + amp * Math.exp(-(d * d) / (2 * 50 * 50))).toFixed(3));
          });
          placeDisc();
        });
      });
      rail.addEventListener("pointerleave", () => {
        if (wkbar.classList.contains("lens")) return;
        cancelAnimationFrame(mraf); mraf = 0;
        wkbar.classList.remove("mag");
        chips.forEach((c) => c.style.setProperty("--s", 1));
        placeDisc();
      });
      /* touch: a swipe only "settles" once the finger is up and momentum
         and snapping are done; a pause mid-drag never selects anything */
      const HAS_SCROLLEND = "onscrollend" in window;
      rail.addEventListener("touchstart", () => { userScroll = true; touching = true; clearTimeout(settleT); }, { passive: true });
      rail.addEventListener("touchmove", () => { if (wkbar.classList.contains("lens")) swiping = true; }, { passive: true });
      /* Safari doesn't always fire scrollend, and iOS momentum can pause
         for a moment mid-glide, so the fallback only settles once the rail
         has actually stopped moving. Settling twice is harmless. */
      const settleWhenStill = (n = 0) => {
        clearTimeout(settleT);
        settleT = setTimeout(() => {
          const x = rail.scrollLeft;
          raf2(() => {
            if (touching) return;
            if (Math.abs(rail.scrollLeft - x) > 0.5 && n < 20) settleWhenStill(n + 1);
            else railSettle();
          });
        }, n ? 80 : 180);
      };
      const touchUp = () => { touching = false; settleWhenStill(); };
      rail.addEventListener("touchend", touchUp, { passive: true });
      rail.addEventListener("touchcancel", touchUp, { passive: true });
      rail.addEventListener("pointerdown", () => { userScroll = true; }, { passive: true });
      function railSettle() {
        clearTimeout(settleT);
        if (touching) return;
        wkbar.classList.remove("scrolling");
        const was = userScroll;
        userScroll = false; swiping = false;
        if (!wkbar.classList.contains("lens")) return;
        const c = lensUpdate();
        if (!c) return;
        const w = +c.dataset.w;
        if (was && w !== week) { railWeek = w; haptic("tap"); goWeek(w); return; }
        // otherwise the disc and the centre line must agree: bring the chosen week back
        setVis(week);
        if (w !== week) centerWeek(week, "smooth");
      }
      rail.addEventListener("scroll", () => {
        wkbar.classList.add("scrolling");
        if (!sraf) sraf = requestAnimationFrame(() => {
          sraf = 0;
          railEdges();
          const c = lensUpdate();
          if (c && userScroll && wkbar.classList.contains("lens")) swiping = true;
          if (c && swiping) setVis(+c.dataset.w); else placeDisc();
          if (c && c !== lastCentre) {
            if (lastCentre && swiping) haptic("tick");
            lastCentre = c;
          }
        });
        if (!touching) settleWhenStill();
      }, { passive: true });
      if (HAS_SCROLLEND) rail.addEventListener("scrollend", railSettle);
      /* a mouse wheel scrolls the row sideways when the weeks overflow */
      rail.addEventListener("wheel", (e) => {
        if (!wkbar.classList.contains("over") || wkbar.classList.contains("lens")) return;
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { rail.scrollLeft += e.deltaY; e.preventDefault(); }
      }, { passive: false });
      root.querySelector(".sn-arrow.l").addEventListener("click", () => rail.scrollBy({ left: -rail.clientWidth * 0.7, behavior: "smooth" }));
      root.querySelector(".sn-arrow.r").addEventListener("click", () => rail.scrollBy({ left: rail.clientWidth * 0.7, behavior: "smooth" }));
      // the rail gets its size late when the page opens scrolled or hidden
      if ("ResizeObserver" in window) new ResizeObserver(setRailEdge).observe(rail);

      /* Left and right arrow keys step through the weeks, unless something
         else has the keyboard (a field, an open drawer or box score, a
         table that scrolls sideways). */
      document.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
        const t = e.target;
        if (t && t.closest && t.closest("input, select, textarea, [contenteditable], .sn-seg, .table-wrap, .bracket-scroll")) return;
        if (document.querySelector(".team-drawer.open, .bx-modal.open, .pc-card.open, [aria-modal='true'][aria-hidden='false']")) return;
        const i = weeks.findIndex((k) => k.w === week);
        const next = weeks[i + (e.key === "ArrowRight" ? 1 : -1)];
        if (next) { e.preventDefault(); goWeek(next.w); }
      });

      let rz = 0;
      window.addEventListener("resize", () => {
        cancelAnimationFrame(rz);
        rz = requestAnimationFrame(() => { watch(); relayout(); });
      });
      if (FINE.addEventListener) FINE.addEventListener("change", relayout);
      // crossing the phone breakpoint moves the capsule between top and bottom
      const place = () => {
        root.classList.remove("stuck");
        root.classList.toggle("sn-bottom", PHONE.matches);
        if (root.classList.contains("searching")) followKeyboard(PHONE.matches);
        watch(); relayout();
      };
      if (PHONE.addEventListener) PHONE.addEventListener("change", place);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
    }

    /* The page calls this with whatever changed: {weeks, week} after a
       week change, {views, view} after a view change, or both. */
    let started = false;
    function render(s) {
      if (!root) return;
      if (s.weeks) weeks = s.weeks;
      if (s.views) views = s.views;
      if (s.week !== undefined && s.week !== week) { prevWeek = week; week = s.week; }
      if (s.view !== undefined) view = s.view;
      if (s.weeks || s.week !== undefined) renderWeeks();
      if (s.views || s.view !== undefined) renderViews();
      if (!started && weeks.length && views.length) {
        started = true;
        raf2(() => { measure(); watch(); relayout(); });
      }
    }

    return {
      mount,
      render,
      /* which way the week just moved, for rolling a heading with it */
      get dir() { return prevWeek != null && week < prevWeek ? "down" : "up"; },
      relayout,
    };
  })();

  /* ===============================================================
     CARDS

     The team drawer (and the all-time profile), the box score and the
     player card are opened and closed by their own code; this only
     watches for it and choreographs what that code already does:

     - Desktop: a centred card (the box score, a player card that isn't
       docked) grows out of whatever was tapped to open it, and shrinks
       back into it on the way out.
     - Every card: its parts settle in, in order (.ui-enter in ui.css),
       and its headline numbers count up to their exact values.

     The phone sheets keep their own slide and swipe-to-close; docked
     player cards keep their own slide. Nothing here writes content: a
     counting number always ends on the text the page put there.
     =============================================================== */
  (() => {
    const DESKTOP = matchMedia("(min-width: 761px)");
    const ZOOM_EASE = "cubic-bezier(.2, 1.08, .3, 1)";

    /* what was pressed last, as the likely thing that opened a card */
    let pressed = null;
    const remember = (e) => { if (e.target && e.target.closest) pressed = e.target; };
    document.addEventListener("pointerdown", remember, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") remember(e); }, true);
    const sourceFor = (el) => {
      if (!pressed || !pressed.isConnected) return null;
      const pick = el.classList.contains("pc")
        ? pressed.closest("[data-player], .player-result")
        : pressed.closest("[data-bx-week], .bx-link, .bx-open, .bx-cue-row");
      return pick && !el.contains(pick) ? pick : null;
    };

    /* Centred cards sit at left/top 50% with translate(-50%, -50%), so
       their transform origin (the centre of the laid-out box) and their
       resting centre are both known without measuring mid-transition.
       The zoom uses the individual translate/scale properties, which
       compose with the card's own transform instead of fighting its
       transition. */
    function zoomGeometry(el, src) {
      const s = src.getBoundingClientRect();
      if (!s.width || !s.height || s.bottom < 0 || s.top > innerHeight) return null;
      const w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h) return null;
      const cx = innerWidth / 2, cy = innerHeight / 2;
      const ox = cx + w / 2, oy = cy + h / 2;
      const k = Math.max(0.16, Math.min(0.55, s.width / w));
      const sx = s.left + s.width / 2, sy = s.top + s.height / 2;
      return { k, tx: sx - ox - k * (cx - ox), ty: sy - oy - k * (cy - oy) };
    }
    const centred = (el) => DESKTOP.matches && !el.classList.contains("docked") && !el.classList.contains("bx-docked") &&
      (el.classList.contains("pc") || el.classList.contains("bx-modal"));
    function stopZoom(el) { el.getAnimations().forEach((a) => { if (a.id === "ui-zoom") a.cancel(); }); }
    function zoomIn(el) {
      stopZoom(el);
      el._zoomFrom = null;
      if (REDUCE.matches || !centred(el)) return;
      const src = sourceFor(el);
      const g = src && zoomGeometry(el, src);
      if (!g) return;
      el._zoomFrom = src;
      const a = el.animate([
        { translate: `${g.tx}px ${g.ty}px`, scale: String(g.k) },
        { translate: "0px 0px", scale: "1" },
      ], { duration: 620, easing: ZOOM_EASE });
      a.id = "ui-zoom";
    }
    function zoomOut(el) {
      const src = el._zoomFrom;
      el._zoomFrom = null;
      stopZoom(el);
      if (REDUCE.matches || !src || !src.isConnected || !centred(el)) return;
      const g = zoomGeometry(el, src);
      if (!g) return;
      const a = el.animate([
        { translate: "0px 0px", scale: "1" },
        { translate: `${g.tx}px ${g.ty}px`, scale: String(g.k) },
      ], { duration: 340, easing: "cubic-bezier(.4, 0, .7, .2)", fill: "forwards" });
      a.id = "ui-zoom";
      a.onfinish = () => a.cancel();   // it has faded out by now; put it back
    }

    /* Number the repeated parts within each parent, for the stagger. */
    const REPEATS = [".schedule-row", ".roster-row", ".bx-row", ".drawer-stat", ".drawer-team > div > *",
      ".pc-tile", ".pc-tl-row", ".pc-mgr", ".pc-medal", ".pc-log-row", ".pc-body > *", ".pc-id > *",
      ".drawer-body > *", ".hl-grid > *"];
    function number(el) {
      REPEATS.forEach((sel) => {
        const seen = new Map();
        el.querySelectorAll(sel).forEach((n) => {
          const i = seen.get(n.parentNode) || 0;
          seen.set(n.parentNode, i + 1);
          n.style.setProperty("--ui-i", i);
        });
      });
    }

    /* Headline numbers count up (plain numbers only: "237.68", "1,248.18",
       "72"; a record like "6–3" or a seed like "#9" is left as it is). */
    const COUNT = ".drawer-stat strong, .pc-tile strong, .bx-total b";
    function countUp(el) {
      if (REDUCE.matches) return;
      el.querySelectorAll(COUNT).forEach((n, i) => {
        const text = n.textContent.trim();
        if (!/^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/.test(text) || n.children.length) return;
        const end = parseFloat(text.replace(/,/g, ""));
        if (!end) return;
        const dec = (text.split(".")[1] || "").length, commas = text.includes(",");
        const show = (v) => (commas
          ? v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })
          : v.toFixed(dec));
        const t0 = performance.now() + 140 + i * 45, dur = 750;
        let wrote = show(0);
        n.textContent = wrote;
        const step = (now) => {
          // the page rewrote it (a new team, say): leave its text alone
          if (n.textContent !== wrote) return;
          const t = Math.min(1, Math.max(0, (now - t0) / dur));
          wrote = t < 1 ? show(end * (1 - Math.pow(2, -10 * t))) : text;
          n.textContent = wrote;
          if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }

    function enter(el) {
      if (REDUCE.matches) return;
      number(el);
      el.classList.remove("ui-enter");
      void el.offsetWidth;
      el.classList.add("ui-enter");
      clearTimeout(el._enterT);
      el._enterT = setTimeout(() => el.classList.remove("ui-enter"), 1700);
      countUp(el);
    }

    /* One observer for every card: a card opening, closing, or having its
       contents replaced while it's open (a new team, a new player). */
    const cards = new Set();
    const open = new WeakMap();
    const mo = new MutationObserver((records) => {
      // class changes that aren't open/close (compact on scroll, docking)
      // only count if they flipped "open"; new children always count
      const touched = new Map();
      records.forEach((r) => {
        const card = [...cards].find((c) => c === r.target || c.contains(r.target));
        if (card) touched.set(card, touched.get(card) || r.type === "childList");
      });
      touched.forEach((newContent, card) => {
        const now = card.classList.contains("open"), was = open.get(card) || false;
        open.set(card, now);
        if (now && !was) { zoomIn(card); enter(card); }
        else if (!now && was) zoomOut(card);
        else if (now && newContent) enter(card);   // same card, new contents
      });
    });
    function watch(card) {
      if (!card || cards.has(card)) return;
      cards.add(card);
      open.set(card, card.classList.contains("open"));
      // one call: observing the same node again would replace these options.
      // Its class (open / close), its own children, and (below) the
      // scrolling body inside it.
      mo.observe(card, { attributes: true, attributeFilter: ["class"], childList: true });
      card.querySelectorAll("#drawerBody, #profileBody, #bxCols, #drawerStats, #profileStats").forEach((b) =>
        mo.observe(b, { childList: true }));
    }
    function start() {
      ["teamDrawer", "profilePanel", "bxModal"].forEach((id) => watch(document.getElementById(id)));
      document.querySelectorAll(".pc").forEach(watch);
      // the player card is built the first time one is opened
      new MutationObserver((rs) => rs.forEach((r) => r.addedNodes.forEach((n) => {
        if (n.nodeType === 1 && n.classList.contains("pc")) watch(n);
      }))).observe(document.body, { childList: true });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  })();


  /* ===============================================================
     FIND PILL (the all-time page)

     The player search as a pill of its own: it pins under the header
     like a season's capsule and turns to frosted glass as it does, and
     its results drop out of it over the page rather than pushing the
     page down. The markup is the page's (#findPill); this wires it.
     =============================================================== */
  function findPill(el) {
    const root = typeof el === "string" ? document.querySelector(el) : el;
    if (!root) return;
    root.classList.add("season-nav", "find-pill");
    const input = root.querySelector("input");
    const list = root.querySelector(".player-results");
    const clear = root.querySelector(".sn-clear");
    const pin = pinnable(root);
    const finder = playerFinder(input, list, { onChange: (has) => root.classList.toggle("found", has) });
    const open = (on) => {
      root.classList.toggle("searching", on);
      root.classList.toggle("found", on && finder.shown);
    };
    const sync = () => { clear.hidden = !input.value; };
    input.addEventListener("focus", () => open(true));
    input.addEventListener("input", sync);
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      finder.clear(); sync(); input.blur(); open(false);
    });
    clear.addEventListener("click", () => { finder.clear(); sync(); input.focus({ preventScroll: true }); });
    // a tap anywhere else folds the results away (the text stays for next time)
    document.addEventListener("click", (e) => {
      if (root.contains(e.target) || (e.target.closest && e.target.closest(".pc, .pc-backdrop"))) return;
      open(false);
    });
    slashOpens(() => input.focus({ preventScroll: true }));
    const layout = () => { pin.watch(); pin.measure(); };
    raf2(layout);
    let rz = 0;
    window.addEventListener("resize", () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(layout); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(pin.measure);
  }

  window.UI = { roll, measureRows, shuffleRows, haptic, findPill, reduced: () => REDUCE.matches };
  window.SeasonNav = SeasonNav;
})();
