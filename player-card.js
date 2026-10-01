/* Player card: everything one player has done in this league.

   Opens over any page from an element carrying data-player="<Sleeper player
   id>" (box score rows, a team's Starters list, the all-time Most-Started
   card) or from PlayerCard.open(id), which the player search calls.

   Its data is the league's player index, built by sleeper.js from every
   week's matchups the first time it is needed. Styles are injected here so
   every page gets the same card without carrying a copy of them. */
(function () {
  /* Each club's primary colour for the card's header, which carries white
     text: the same table the box scores use, except Pittsburgh's gold, too
     light for white on it, gives way to its black. */
  const NFL_COLORS = {
    ARI: "#97233F", ATL: "#A71930", BAL: "#241773", BUF: "#00338D",
    CAR: "#0085CA", CHI: "#0B162A", CIN: "#FB4F14", CLE: "#311D00",
    DAL: "#041E42", DEN: "#FB4F14", DET: "#0076B6", GB: "#203731",
    HOU: "#03202F", IND: "#002C5F", JAX: "#101820", KC: "#E31837",
    LAC: "#0080C6", LAR: "#003594", LV: "#111111", MIA: "#008E97",
    MIN: "#4F2683", NE: "#002244", NO: "#A08A5B", NYG: "#0B2265",
    NYJ: "#125740", PHI: "#004C54", PIT: "#101820", SEA: "#002244",
    SF: "#AA0000", TB: "#D50A0A", TEN: "#0C2340", WSH: "#5A1414",
  };
  const SLOT_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "K", "D/ST", "BE", "IR"];

  const CSS = `
  .pc-backdrop {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(7, 24, 39, .3);
    opacity: 0; pointer-events: none; transition: opacity .35s cubic-bezier(.22, 1, .36, 1);
    -webkit-backdrop-filter: blur(14px) saturate(1.35); backdrop-filter: blur(14px) saturate(1.35);
  }
  .pc-backdrop.open { opacity: 1; pointer-events: auto; }

  .pc {
    --pc-ink: #0b1726; --pc-muted: #637083; --pc-line: #e3e8ee; --pc-soft: #f5f7fa;
    position: fixed; z-index: 201; left: 50%; top: 50%;
    width: min(900px, calc(100vw - 32px)); max-height: 92vh;
    transform: translate(-50%, -48%) scale(.98); opacity: 0; pointer-events: none;
    transition: opacity .18s ease, transform .18s ease;
    display: flex; flex-direction: column;
    /* frosted glass (tokens from ui.css), with a hairline of light on its edge */
    background: var(--glass-sheet, rgba(240, 244, 249, .76)); border-radius: 24px; overflow: hidden;
    -webkit-backdrop-filter: blur(34px) saturate(1.9); backdrop-filter: blur(34px) saturate(1.9);
    box-shadow: var(--sheet-shadow, 0 30px 80px rgba(7, 18, 30, .35));
    color: var(--pc-ink); font-size: 12px; line-height: 1.35;
    -webkit-text-size-adjust: 100%; text-size-adjust: 100%;
  }
  .pc.open { opacity: 1; pointer-events: auto; transform: translate(-50%, -50%); }
  .pc::after {
    content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; z-index: 7;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .35), inset 0 1px 0 rgba(255, 255, 255, .45);
  }
  /* Desktop: opens generously with a little spring, closes quickly. (Phones
     keep the sheet curve further down.) */
  @media (min-width: 761px) {
    .pc { transition: opacity .2s cubic-bezier(.22, 1, .36, 1), transform .25s cubic-bezier(.22, 1, .36, 1); }
    .pc.open { transition: opacity .3s cubic-bezier(.22, 1, .36, 1), transform .5s cubic-bezier(.34, 1.4, .64, 1); }
  }
  .pc *, .pc *::before, .pc *::after { box-sizing: border-box; }
  .pc-scroll { overflow: auto; overscroll-behavior: contain; overflow-anchor: none; }
  #bxCols, #drawerBody, #profileBody { overscroll-behavior: contain; }

  /* The header stays pinned while the card scrolls and folds down to a
     slim bar (photo, name, close), so the player is always named on screen.

     The fold follows the scroll itself rather than switching at a
     threshold: over the first stretch of scrolling (the difference between
     the full and slim header, --hd) it goes from open to folded. Where the
     browser can tie an animation to the scroll (animation-timeline), the
     fold is such an animation and moves in step with the scroll on the
     compositor; elsewhere foldHeader sets --p (0 to 1) each frame. Either
     way only transforms and opacity change, so nothing is laid out or
     repainted as it goes: the header keeps its full height, its background
     slides up (.pc-hero-bg, clipped by the scroller) with its lower edge
     travelling exactly with the content while the glass inside it slides
     back down to stay put, and the photo, name and close button glide to
     their places in the bar as the tags fade. The colour thins towards
     tinted glass on the way, so the stats show through it. A scroll that
     comes to rest partway settles to the nearer end (see foldHeader). */
  .pc-hero {
    --p: 0;
    position: sticky; top: 0; z-index: 5;
    display: flex; align-items: center; gap: 16px;
    padding: 20px 60px 20px 22px;
    color: #fff;
    pointer-events: none;   /* the part below the bar lets taps through to the content */
  }
  .pc-hero .pc-close { pointer-events: auto; }
  .pc-hero-bg, .pc-hero-shade {
    position: absolute; inset: 0; pointer-events: none;
    transform: translate3d(0, calc(var(--hd, 0px) * var(--p) * -1), 0); will-change: transform;
  }
  .pc-hero-bg { overflow: hidden; }
  /* the shadow the folded bar casts on the stats */
  .pc-hero-shade { box-shadow: 0 8px 20px -12px rgba(7, 24, 39, .5); opacity: var(--p); }
  .pc-hero-bg::after {
    content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 1px;
    background: rgba(255, 255, 255, .12);
  }
  .pc-hero-glass {
    position: absolute; inset: 0; overflow: hidden;
    transform: translate3d(0, calc(var(--hd, 0px) * var(--p)), 0); will-change: transform;
    -webkit-backdrop-filter: blur(22px) saturate(1.7); backdrop-filter: blur(22px) saturate(1.7);
  }
  /* the club's colour, lit from the top left */
  .pc-hero-glass::before {
    content: ""; position: absolute; inset: 0;
    background:
      radial-gradient(120% 160% at 0% 0%, rgba(255, 255, 255, .24), rgba(255, 255, 255, 0) 55%),
      linear-gradient(120deg,
        color-mix(in srgb, var(--pc-color) 88%, #fff) 0%,
        var(--pc-color) 40%,
        color-mix(in srgb, var(--pc-color) 55%, #071827) 100%);
    opacity: calc(1 - var(--p) * .09);
  }
  .pc-hero-glass::after {
    content: ""; position: absolute; right: -60px; top: -80px; width: 240px; height: 240px;
    border-radius: 50%; background: radial-gradient(circle, rgba(255, 255, 255, .2), rgba(255, 255, 255, 0) 68%);
    animation: pcDrift 14s ease-in-out infinite alternate;
  }
  @keyframes pcDrift { from { transform: none; } to { transform: translate(-40px, 26px) scale(1.18); } }
  /* each moving part: from where it sits in the full header (--dx, --dy,
     --k measured against where it sits in the slim one) */
  .pc-hero [data-fold] {
    transform-origin: 0 0; will-change: transform;
    transform: translate(calc(var(--dx, 0px) * var(--p)), calc(var(--dy, 0px) * var(--p))) scale(calc(1 + (var(--k, 1) - 1) * var(--p)));
  }
  .pc-hero .pc-tags, .pc-hero .pc-champ { opacity: calc(1 - var(--p) * 1.8); }
  .pc-hero .pc-photo .pc-club { opacity: calc(1 - var(--p) * 1.6); }
  /* The same fold as a scroll-driven animation: the same values, keyed to
     the first --hd of the card's scroll instead of to --p. */
  @supports (animation-timeline: scroll()) {
    .pc-hero-bg, .pc-hero-shade, .pc-hero-glass, .pc-hero-glass::before,
    .pc-hero [data-fold], .pc-hero .pc-tags, .pc-hero .pc-champ, .pc-hero .pc-photo .pc-club {
      animation-duration: auto; animation-timing-function: linear; animation-fill-mode: both;
      animation-timeline: scroll(nearest block); animation-range: 0px var(--hd, 0px);
    }
    .pc-hero-bg { animation-name: pcFoldUp; }
    .pc-hero-shade { animation-name: pcFoldUp, pcFoldIn; }
    .pc-hero-glass { animation-name: pcFoldDown; }
    .pc-hero-glass::before { animation-name: pcFoldThin; }
    .pc-hero [data-fold] { animation-name: pcFoldPart; }
    .pc-hero .pc-tags[data-fold], .pc-hero .pc-champ[data-fold] { animation-name: pcFoldPart, pcFoldFade; }
    .pc-hero .pc-photo .pc-club { animation-name: pcFoldFadeLate; }
    .pc .pc-hero.pc-nofold *, .pc .pc-hero.pc-nofold *::before { animation-name: none; }
  }
  @keyframes pcFoldUp { from { transform: translate3d(0, 0, 0); } to { transform: translate3d(0, calc(var(--hd, 0px) * -1), 0); } }
  @keyframes pcFoldDown { from { transform: translate3d(0, 0, 0); } to { transform: translate3d(0, var(--hd, 0px), 0); } }
  @keyframes pcFoldIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes pcFoldThin { from { opacity: 1; } to { opacity: .91; } }
  @keyframes pcFoldPart {
    from { transform: translate(0px, 0px) scale(1); }
    to { transform: translate(var(--dx, 0px), var(--dy, 0px)) scale(var(--k, 1)); }
  }
  @keyframes pcFoldFade { from { opacity: 1; } 55% { opacity: 0; } to { opacity: 0; } }
  @keyframes pcFoldFadeLate { from { opacity: 1; } 62% { opacity: 0; } to { opacity: 0; } }
  .pc-photo {
    position: relative; flex: 0 0 auto; width: 84px; height: 84px; border-radius: 50%;
    background: rgba(255,255,255,.95); box-shadow: 0 0 0 4px rgba(255,255,255,.25), 0 14px 30px -10px rgba(0, 0, 0, .5);
    display: grid; place-items: center;
  }
  .pc-photo > img.pc-face { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; object-position: top; opacity: 0; transition: opacity .3s ease; }
  .pc-photo > img.pc-face.loaded { opacity: 1; }
  .pc-photo > .pc-club-big {
    width: 100%; height: 100%; border-radius: 50%; display: grid; place-items: center;
    background: #e7ebef; color: #4b5866; font-size: 22px; font-weight: 900; letter-spacing: .04em;
  }
  .pc-photo .pc-club {
    position: absolute; right: -5px; bottom: -2px; width: 34px; height: 34px; border-radius: 50%;
    background: #fff; display: grid; place-items: center; box-shadow: 0 2px 8px rgba(0,0,0,.25);
    padding: 2px;
  }
  /* the club's colour fills the badge, its letters centred in the disc */
  .pc-photo .pc-club .pc-chip {
    width: 100%; height: 100%; padding: 0; border-radius: 50%;
    display: grid; place-items: center; font-size: 9px; line-height: 1; letter-spacing: -.01em;
  }
  .pc-id { position: relative; z-index: 1; min-width: 0; }
  .pc-id h2 { margin: 0; font-size: 26px; line-height: 1.05; letter-spacing: -.02em; }
  .pc-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .pc-tag {
    padding: 3px 8px; border-radius: 999px; background: rgba(255,255,255,.18);
    -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .18);
    font-size: 10.5px; font-weight: 800; letter-spacing: .03em;
  }
  /* A champion's name sits on gold, with the winning years above it. */
  .pc-id h2.pc-gold {
    display: inline-block; max-width: 100%; padding: 2px 10px 3px; border-radius: 10px;
    background: linear-gradient(135deg, #fbe08a, #e0a82e); color: #2a2112;
    box-shadow: 0 2px 10px rgba(224, 168, 46, .35), inset 0 0 0 1px rgba(255,255,255,.35);
  }
  .pc-champ {
    margin-bottom: 5px; color: #fbe08a; font-size: 10.5px; font-weight: 900;
    letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    max-height: 20px;
  }
  .pc-close {
    position: absolute; z-index: 2; top: 14px; right: 14px; width: 34px; height: 34px;
    display: grid; place-items: center; padding: 0;
    border: 1px solid rgba(255,255,255,.28); border-radius: 50%; background: rgba(255,255,255,.16);
    -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, .25), 0 4px 12px -4px rgba(0, 0, 0, .3);
    color: #fff; font-size: 21px; line-height: 1; cursor: pointer;
  }
  .pc-close:hover { background: rgba(255,255,255,.28); }
  .pc-tags { max-height: 60px; overflow: hidden; }
  /* The slim bar's layout. It is never shown as such: foldHeader lays the
     header out this way for a moment, unseen, to measure where each part
     goes, and the fold glides them there. */
  .pc.pc-small, .pc.pc-small * { transition: none !important; animation: none !important; }
  .pc.pc-small .pc-hero { padding-top: 8px; padding-bottom: 8px; }
  .pc.pc-small .pc-photo { width: 40px; height: 40px; }
  .pc.pc-small .pc-champ { max-height: 0; margin-bottom: 0; }
  .pc.pc-small .pc-tags { max-height: 0; margin-top: 0; }
  .pc.pc-small .pc-id h2 { font-size: 18px; }
  /* centred by its offset, not a transform, so the measurement sees it */
  .pc.pc-small .pc-close { top: calc(50% - 17px); }

  /* Desktop: opened from a team panel or a box score, the card docks on the
     right beside it instead of covering it. */
  .pc.docked {
    left: auto; right: 16px; top: 16px; bottom: 16px; max-height: none;
    transform: translateX(-56px); opacity: 0;
    transition: opacity .3s ease, transform .45s cubic-bezier(.2,.8,.2,1);
  }
  .pc.docked.from-panel { transform: translateX(calc(-1 * var(--pc-slide, 420px))); }
  .pc.docked.open { transform: none; opacity: 1; }
  .pc-backdrop.docked { display: none; }
  .bx-modal {
    transition: opacity .2s cubic-bezier(.22, 1, .36, 1), transform .25s cubic-bezier(.22, 1, .36, 1),
      left .45s cubic-bezier(.22, 1, .36, 1), width .45s cubic-bezier(.22, 1, .36, 1);
  }
  @media (min-width: 761px) {
    .bx-modal.open {
      transition: opacity .3s cubic-bezier(.22, 1, .36, 1), transform .5s cubic-bezier(.34, 1.4, .64, 1),
        left .45s cubic-bezier(.22, 1, .36, 1), width .45s cubic-bezier(.22, 1, .36, 1);
    }
  }
  .bx-modal.bx-docked { left: calc(16px + var(--bx-dw) / 2); width: var(--bx-dw); }
  #teamDrawer, #profilePanel { transition: transform .3s cubic-bezier(.22, 1, .36, 1), width .45s cubic-bezier(.22, 1, .36, 1); }
  @media (min-width: 761px) {
    #teamDrawer.open, #profilePanel.open { transition: transform .5s cubic-bezier(.22, 1, .36, 1), width .45s cubic-bezier(.22, 1, .36, 1); }
  }

  .pc-body { padding: 14px; display: grid; gap: 12px; }

  .pc-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
  /* tiles and cards are printed on the glass: near-white, edged with light */
  .pc-tile {
    background: var(--glass-tile, #fff); border: 1px solid var(--glass-edge, var(--pc-line)); border-radius: 16px;
    box-shadow: var(--tile-shadow, none); padding: 10px 12px; min-width: 0;
  }
  .pc-tile small { display: block; color: var(--pc-muted); font-size: 8.5px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
  .pc-tile strong { display: block; margin-top: 4px; font-size: 21px; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .pc-tile span { display: block; margin-top: 2px; color: var(--pc-muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .pc-card {
    background: var(--glass-tile, #fff); border: 1px solid var(--glass-edge, var(--pc-line)); border-radius: 18px;
    box-shadow: var(--tile-shadow, none); overflow: hidden;
  }
  .pc-card-head {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 10px 14px; border-bottom: 1px solid rgba(7, 24, 39, .07);
  }
  .pc-card-head h3 { margin: 0; font-size: 13.5px; display: flex; align-items: center; gap: 7px; }
  .pc-card-head > span { color: var(--pc-muted); font-size: 10px; }

  .pc-cols { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, .9fr); gap: 12px; align-items: start; }

  /* Ownership timeline: a strip per season, a cell per week, in the colour of
     whichever team had him that week, and that team's logo at the end. */
  .pc-tl-row {
    display: grid; grid-template-columns: 38px minmax(0, 1fr) 72px; gap: 10px; align-items: center;
    padding: 7px 14px; border-top: 1px solid rgba(7, 24, 39, .06);
  }
  .pc-tl-row:first-child { border-top: 0; }
  .pc-tl-year { font-weight: 900; font-size: 12px; }
  .pc-tl-row.pc-tl-head { padding-top: 6px; padding-bottom: 2px; }
  .pc-wk-label { text-align: center; color: #8793a0; font-size: 8.5px; font-weight: 800; font-variant-numeric: tabular-nums; }
  /* The playoff weeks stand apart by a spacer column of their own; a margin on
     the first playoff cell would narrow that one week. */
  .pc-tl-strip { display: grid; grid-template-columns: repeat(var(--reg), minmax(0, 1fr)) 3px repeat(var(--po), minmax(0, 1fr)); gap: 2px; }
  .pc-gap { width: 0; }
  .pc-wk { height: 16px; border-radius: 3px; background: #f1f4f7; }
  .pc-wk.start { background: var(--c); }
  .pc-wk.bench { background: #fff; box-shadow: inset 0 0 0 1.5px var(--c); }
  .pc-wk.none { background: transparent; }
  .pc-wk.future { background: transparent; box-shadow: inset 0 0 0 1px #e3e8ee; }
  .pc-more { display: grid; place-items: center; min-width: 22px; height: 22px; padding: 0 3px; border-radius: 6px; background: #eef1f4; color: var(--pc-muted); font-size: 9px; font-weight: 900; }
  /* A fixed column, three logos wide, so every season's strip is the same
     width and the weeks line up from row to row. */
  .pc-tl-who { display: flex; justify-content: flex-start; gap: 3px; }
  .pc-tl-who .pc-mark { width: 22px; height: 22px; border-radius: 6px; }
  .pc-tl-key { display: flex; flex-wrap: wrap; gap: 4px 14px; padding: 8px 14px; border-top: 1px solid #eef1f4; color: var(--pc-muted); font-size: 10px; }
  .pc-tl-key i { display: inline-block; width: 11px; height: 11px; border-radius: 3px; vertical-align: -1px; margin-right: 5px; }

  .pc-mark {
    flex: 0 0 auto; width: 28px; height: 28px; border-radius: 8px; overflow: hidden;
    display: grid; place-items: center; background: var(--c); color: #fff; font-weight: 900; font-size: 11px;
    box-shadow: 0 0 0 1px rgba(0,0,0,.06);
  }
  .pc-mark img { width: 100%; height: 100%; object-fit: contain; background: #fff; }

  .pc-mgr {
    display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 10px; align-items: center;
    padding: 9px 14px; border-top: 1px solid rgba(7, 24, 39, .06);
  }
  .pc-mgr:first-child { border-top: 0; }
  .pc-mgr-name { min-width: 0; }
  .pc-mgr-name strong { display: block; font-size: 12.5px; }
  .pc-mgr-name span { display: block; color: var(--pc-muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Fixed-width columns, so GS, points and record line up down the list. */
  /* Each column is as wide as its longest value (--gs/--pts/--rec, in
     characters), so a long record like 13–10 still fits on a phone. */
  .pc-mgr-nums {
    display: grid; gap: 8px; text-align: right; font-variant-numeric: tabular-nums;
    font-size: 13px; font-weight: 700;
    grid-template-columns: max(30px, calc(var(--gs, 2) * 1ch + 2px)) max(50px, calc(var(--pts, 5) * 1ch + 2px)) max(44px, calc(var(--rec, 4) * 1ch + 2px));
  }
  .pc-mgr-nums b { display: block; font-size: inherit; white-space: nowrap; }
  .pc-mgr-nums small { display: block; color: var(--pc-muted); font-size: 8.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; }
  .pc-bar { grid-column: 2 / -1; height: 4px; border-radius: 2px; background: #eef1f4; overflow: hidden; margin-top: -4px; }
  .pc-bar i { display: block; height: 100%; background: var(--c); }

  /* Top three, as medals. */
  .pc-top { display: grid; gap: 8px; padding: 12px; }
  .pc-medal {
    display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px; align-items: center;
    padding: 10px 12px; border-radius: 12px; color: #2a2112;
    background: linear-gradient(135deg, var(--m1), var(--m2));
    box-shadow: inset 0 1px 0 rgba(255,255,255,.5), 0 1px 2px rgba(0,0,0,.08);
  }
  .pc-medal.gold { --m1: #fbe08a; --m2: #e0a82e; }
  .pc-medal.silver { --m1: #f1f3f5; --m2: #b5bec8; color: #1f2933; }
  .pc-medal.bronze { --m1: #f2c29b; --m2: #b8733f; color: #2b1809; }
  .pc-medal-rank {
    width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center;
    background: rgba(255,255,255,.55); box-shadow: inset 0 0 0 2px rgba(0,0,0,.08);
    font-size: 15px; font-weight: 900;
  }
  .pc-medal-info { min-width: 0; }
  .pc-medal-info strong { display: block; font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pc-medal-info span { display: block; font-size: 10px; opacity: .8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pc-medal b { font-size: 22px; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }

  /* Game log */
  .pc-log-tools { display: flex; align-items: center; gap: 8px; }
  .pc-tabs {
    display: flex; gap: 2px; flex-wrap: wrap; justify-content: flex-end;
    padding: 2px; border-radius: 999px; background: rgba(12, 28, 45, .06);
  }
  .pc-tabs button {
    border: 0; background: transparent; color: var(--pc-muted);
    border-radius: 999px; padding: 4px 10px; font: inherit; font-size: 10.5px; font-weight: 800; cursor: pointer;
    transition: background-color .25s cubic-bezier(.22, 1, .36, 1), color .25s cubic-bezier(.22, 1, .36, 1), box-shadow .25s, transform .18s;
  }
  @media (hover: hover) { .pc-tabs button:not(.active):hover { color: var(--pc-ink); } }
  .pc-tabs button:active { transform: scale(.94); }
  .pc-tabs button.active { background: #fff; color: var(--pc-ink); box-shadow: 0 1px 3px rgba(16, 24, 40, .14), 0 1px 1px rgba(16, 24, 40, .05); }
  .pc-year {
    display: none; border: 1px solid var(--pc-line); border-radius: 8px; background: #fff; color: var(--pc-ink);
    font: inherit; font-size: 12px; font-weight: 800; padding: 4px 6px;
  }

  .pc-info {
    width: 17px; height: 17px; border-radius: 50%; padding: 0;
    border: 1px solid var(--pc-line); background: var(--pc-soft); color: var(--pc-muted);
    font: italic 900 10px/1 Georgia, serif; display: inline-grid; place-items: center; cursor: pointer;
  }
  .pc-info:hover, .pc-info[aria-expanded="true"] { background: #1769e0; border-color: #1769e0; color: #fff; }
  .pc-help { padding: 10px 14px; border-bottom: 1px solid var(--pc-line); background: #fafbfc; font-size: 11px; }
  .pc-help[hidden] { display: none; }
  .pc-help ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
  .pc-help li { display: flex; align-items: center; gap: 8px; }
  .pc-help .pc-pts { min-width: 44px; padding: 2px 6px; font-size: 10px; }

  /* The log is rows of a grid, not a <table>: the season pages give every
     table a phone min-width, which would push the points off the card. */
  .pc-log { font-variant-numeric: tabular-nums; }
  .pc-log-row {
    display: grid; grid-template-columns: 58px minmax(0, 1fr) auto; gap: 10px; align-items: center;
    padding: 5px 14px; border-top: 1px solid rgba(7, 24, 39, .06); font-size: 11.5px;
    transition: background-color .2s cubic-bezier(.22, 1, .36, 1);
  }
  @media (hover: hover) { .pc-log-row:not(.head):hover { background: rgba(255, 255, 255, .9); } }
  .pc-log-row.head {
    padding-top: 6px; padding-bottom: 6px; border-top: 0; background: rgba(236, 241, 246, .75); color: #788696;
    font-size: 8.5px; font-weight: 900; letter-spacing: .07em; text-transform: uppercase;
  }
  .pc-log.all .pc-log-row { grid-template-columns: 78px minmax(0, 1fr) auto; }
  .pc-log .wk { white-space: nowrap; color: var(--pc-muted); font-weight: 800; }
  .pc-log .wk sup { color: #b8733f; font-size: 8px; margin-left: 1px; }
  .pc-log .num { text-align: right; }
  .pc-log-row.gap .pc-team span { color: var(--pc-muted); font-weight: 600; font-style: italic; }
  .pc-log-row.gap .pc-mark { opacity: .45; }
  .pc-mark-off { background: transparent; box-shadow: inset 0 0 0 1.5px #d3dae2; border: 0; }
  .pc-pts.off { background: #f1f4f7; color: #9aa6b2; font-weight: 700; text-align: center; }
  .pc-team { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .pc-team .pc-mark { width: 20px; height: 20px; border-radius: 6px; font-size: 8px; }
  .pc-team span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
  .pc-pts {
    display: inline-block; min-width: 58px; padding: 3px 8px; border-radius: 6px;
    text-align: right; font-weight: 900; font-size: 11.5px;
  }
  .pc-pts.start { background: color-mix(in srgb, var(--c) calc(var(--fill) * 100%), #fff); color: var(--pi); }
  .pc-pts.bench { background: #fff; box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--c) 55%, #fff); color: var(--pc-muted); font-weight: 700; }

  .pc-chip { display: inline-block; padding: 1px 4px; border-radius: 4px; background: #e7ebef; color: #4b5866; font-size: 8px; font-weight: 900; }
  .pc-empty { padding: 36px; text-align: center; color: var(--pc-muted); }

  /* Player names that open the card read as links everywhere: a dotted
     underline at rest (the only cue a phone gets), blue with a solid line on
     hover, and a tint while tapped. */
  [data-player] { cursor: pointer; }
  html.pc-lock, html.pc-lock body { overflow: hidden; }

  /* ---- App feel, shared by every page (this script is on all of them) ----
     No grey tap flash or double-tap zoom delay; instead a quick press-down
     on whatever was tapped, as a native app gives. */
  html { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
  :where(button, a, select, .week-pill, .view-tab, .game-side, .bx-open, .bx-cue-row,
    .schedule-opponent, .player-result, .season-link, .team-button, [data-player], [data-owner]) {
    transition-property: transform, opacity, background-color, color, border-color, box-shadow;
    transition-duration: .16s; transition-timing-function: ease;
  }
  @media (hover: none) {
    /* Named controls only, never every button: a button stretched over its
       row (a results card's team row) must not change size while pressed,
       or the tap lands outside it and is lost. */
    :where(.week-pill, .view-tab, .bx-open, .bx-cue-row, .player-result, .pc-tabs button,
      .pc-close, .bx-close, .drawer-close, .close-profile, .trophy-room-link):active {
      transform: scale(.97); transition-duration: .06s;
    }
    :where(.game-side, .season-link, .schedule-opponent):active { background-color: rgba(23, 105, 224, .07); transition-duration: .06s; }
  }

  /* Every sheet on a phone rises and settles on the same iOS curve. (The
     'html' prefix outranks each page's own rule without !important, which
     would also outrank the swipe gesture's inline styles.) */
  @media (max-width: 760px) {
    html .pc, html .bx-modal, html .team-drawer, html .profile-panel {
      transition: transform .42s cubic-bezier(.32, .72, 0, 1), opacity .22s ease;
    }
    html .pc:not(.open), html .bx-modal:not(.open) { transform: translateY(100%); }
  }

  /* A panel whose content just changed (a new week or tab) eases in. */
  @keyframes pcPanelIn { from { opacity: .35; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .panel-in { animation: pcPanelIn .24s cubic-bezier(.2, .8, .2, 1); }

  /* Reduce motion, if the phone or computer asks for it. */
  @media (prefers-reduced-motion: reduce) {
    .pc, .pc-backdrop, .bx-modal, .bx-backdrop, .team-drawer, .drawer-backdrop, .profile-panel, .profile-backdrop,
    .pc-hero, .pc-photo, .pc-tags, .drawer-hero, .profile-hero, .panel-in {
      transition-duration: .01ms !important; animation-duration: .01ms !important;
    }
  }
  .bx-name[data-player], .roster-name[data-player] strong, .starters-name[data-player] strong {
    text-decoration-line: underline;
    text-decoration-style: dotted;
    text-decoration-thickness: 1.5px;
    text-decoration-color: rgba(23, 105, 224, .55);
    text-underline-offset: 3px;
    transition: color .12s ease, text-decoration-color .12s ease;
  }
  @media (hover: hover) {
    .bx-name[data-player]:hover, .roster-name[data-player]:hover strong, .starters-name[data-player]:hover strong {
      color: #1769e0; text-decoration-style: solid; text-decoration-color: #1769e0;
    }
  }
  .bx-name[data-player]:active, .roster-name[data-player]:active strong, .starters-name[data-player]:active strong {
    color: #1769e0; text-decoration-style: solid; text-decoration-color: #1769e0;
  }
  .bx-name[data-player]:focus-visible, .roster-name[data-player]:focus-visible, .starters-name[data-player]:focus-visible {
    outline: 2px solid #1769e0; outline-offset: 2px; border-radius: 3px;
  }

  /* Phones: a bottom sheet, sized to match the rest of the site's compact
     mobile type rather than the desktop card scaled down. */
  @media (max-width: 760px) {
    .pc {
      left: 0; top: auto; bottom: 0; width: 100%; max-height: 92dvh;
      border-radius: 24px 24px 0 0; transform: translateY(24px); font-size: 11px;
    }
    /* the grabber the swipe-down has always answered to */
    .pc::before {
      content: ""; position: absolute; z-index: 8; top: 6px; left: 50%; width: 36px; height: 5px; margin-left: -18px;
      border-radius: 3px; background: rgba(255, 255, 255, .55); pointer-events: none;
    }
    .pc.open { transform: none; }
    .pc-hero { padding: 18px 50px 14px 12px; gap: 12px; }
    .pc-photo { width: 56px; height: 56px; box-shadow: 0 0 0 3px rgba(255,255,255,.25); }
    .pc-photo .pc-club { width: 24px; height: 24px; right: -4px; padding: 1.5px; }
    .pc-photo .pc-club .pc-chip { font-size: 6.5px; }
    .pc-id h2 { font-size: 18px; }
    .pc-tags { margin-top: 6px; gap: 4px; }
    .pc-tag { font-size: 9px; padding: 2px 7px; }
    .pc-champ { font-size: 9px; margin-bottom: 4px; }
    .pc-id h2.pc-gold { padding: 1px 8px 2px; border-radius: 8px; }
    .pc-close { top: 10px; right: 10px; width: 30px; height: 30px; font-size: 18px; border-radius: 50%; }
    .pc.pc-small .pc-photo { width: 34px; height: 34px; }
    .pc.pc-small .pc-id h2 { font-size: 16px; }
    .pc.pc-small .pc-close { top: calc(50% - 15px); }
    .pc-body { padding: 8px; gap: 8px; }
    .pc-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
    .pc-tile { padding: 8px 10px; border-radius: 14px; }
    .pc-tile small { font-size: 7.5px; }
    .pc-tile strong { font-size: 17px; margin-top: 2px; }
    .pc-tile span { font-size: 9px; }
    .pc-card { border-radius: 16px; }
    .pc-card-head { padding: 8px 10px; }
    .pc-card-head h3 { font-size: 12px; }
    .pc-card-head > span { font-size: 9px; }
    .pc-cols { grid-template-columns: 1fr; gap: 8px; }
    .pc-tl-row { grid-template-columns: 30px minmax(0, 1fr) 52px; gap: 6px; padding: 6px 10px; }
    .pc-tl-year { font-size: 10.5px; }
    .pc-wk-label { font-size: 6.5px; letter-spacing: -.03em; }
    .pc-tl-who { gap: 2px; }
    .pc-tl-who .pc-mark { width: 16px; height: 16px; border-radius: 4px; }
    .pc-more { min-width: 16px; height: 16px; border-radius: 4px; font-size: 8px; }
    .pc-wk { height: 13px; border-radius: 2px; }
    .pc-tl-strip { gap: 1px; }
    .pc-tl-strip { grid-template-columns: repeat(var(--reg), minmax(0, 1fr)) 1px repeat(var(--po), minmax(0, 1fr)); }
    .pc-tl-key { padding: 7px 10px; font-size: 9px; gap: 3px 10px; }
    .pc-mgr { grid-template-columns: 24px minmax(0, 1fr) auto; gap: 8px; padding: 7px 10px; }
    .pc-mark { width: 24px; height: 24px; border-radius: 6px; }
    .pc-mgr-name strong { font-size: 11.5px; }
    .pc-mgr-name span { font-size: 9px; }
    .pc-mgr-nums {
      gap: 6px; font-size: 12px;
      grid-template-columns: max(22px, calc(var(--gs, 2) * 1ch + 2px)) max(40px, calc(var(--pts, 5) * 1ch + 2px)) max(34px, calc(var(--rec, 4) * 1ch + 2px));
    }
    .pc-mgr-nums small { font-size: 7.5px; }
    .pc-top { padding: 8px; gap: 6px; }
    .pc-medal { grid-template-columns: 28px minmax(0, 1fr) auto; gap: 8px; padding: 8px 10px; border-radius: 10px; }
    .pc-medal-rank { width: 28px; height: 28px; font-size: 13px; }
    .pc-medal-info strong { font-size: 10.5px; }
    .pc-medal-info span { font-size: 9px; }
    .pc-medal b { font-size: 18px; }
    .pc-tabs { display: none; }
    .pc-year { display: block; }
    .pc-help { padding: 8px 10px; font-size: 10px; }
    .pc-log-row { grid-template-columns: 34px minmax(0, 1fr) auto; gap: 7px; padding: 4px 10px; font-size: 10.5px; }
    .pc-log.all .pc-log-row { grid-template-columns: 52px minmax(0, 1fr) auto; }
    .pc-log-row.head { font-size: 7.5px; padding-top: 5px; padding-bottom: 5px; }
    .pc-team { gap: 6px; }
    .pc-team .pc-mark { width: 18px; height: 18px; border-radius: 5px; }
    .pc-pts { min-width: 50px; font-size: 10.5px; padding: 2px 7px; }
  }`;

  // Added at load, not on first open: the link styling on player names has to
  // be there before anyone has opened a card, or nothing looks clickable.
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  // Open the connection to the photo server early (Sleeper's, or ESPN's for
  // an ESPN league), so the first photo is not also paying for the handshake.
  const pre = document.createElement("link");
  pre.rel = "preconnect";
  pre.href = window.League && window.League.sourceName && window.League.sourceName() === "ESPN" ? "https://a.espncdn.com" : "https://sleepercdn.com";
  document.head.appendChild(pre);

  /* Once the page is idle, get ready for the first tap: the player data
     behind every card and the search, and on a season page the team
     drawers' starters. Sleeper's player list is 2.6 MB the first time (then
     kept for a day), so a phone asking to save data waits for a tap. */
  const whenIdle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  const saveData = navigator.connection && navigator.connection.saveData;
  whenIdle(() => {
    if (saveData || !window.League || !window.League.leagueId) return;
    // Only once the page has its league, so the prefetch never competes with it.
    window.League.load(window.League.leagueId).then(() => {
      load();
      if (typeof window.loadRoster === "function") window.loadRoster();
    }).catch(() => {});
  }, { timeout: 5000 });

  let data = null;
  let loading = null;
  let els = null;
  let lastFocus = null;

  const fmt = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt1 = (n) => Number(n).toFixed(1);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // Every player who has been on a roster in this league, by Sleeper id.
  function load() {
    if (!loading) {
      const L = window.League;
      loading = (L && L.leagueId ? L.load(L.leagueId).then((model) => model.playerIndex()) : Promise.resolve(null))
        .then((json) => {
          if (json) json.byId = new Map(json.players.map((p) => [p.id, p]));
          data = json;
          return json;
        })
        .catch(() => null);
    }
    return loading;
  }

  // An NFL club: its abbreviation on its colour, free agents in grey.
  const clubStyle = (abbr) => (window.League ? window.League.clubStyle(abbr) : "");
  function nfl(abbr) {
    return `<span class="pc-chip" style="${clubStyle(abbr)}" title="${abbr || "FA"}">${abbr || "FA"}</span>`;
  }
  // A defence has no photo, so its club fills the circle instead.
  function bigClub(abbr) {
    return abbr && abbr !== "FA" ? `<span class="pc-club-big" style="${clubStyle(abbr)}">${abbr}</span>` : "";
  }

  // A fantasy team's mark: the manager's Sleeper avatar where there is one,
  // otherwise the team's colour with its initial.
  function mark(team) {
    const src = window.TEAM_LOGOS && window.TEAM_LOGOS[team.ownerId];
    return `<span class="pc-mark" style="--c:${team.color}" title="${esc(team.name)} · ${esc(team.owner)}">${
      src ? `<img src="${src}" alt="">` : esc(team.name.trim().charAt(0))}</span>`;
  }

  function teamOf(season, id) {
    const t = data.teams[season] && data.teams[season][id];
    return t ? { id, name: t[0], ownerId: t[1], owner: t[2], color: t[3] } : { id, name: id, ownerId: id, owner: "", color: "#8693a1" };
  }

  function ensureShell() {
    if (els) return els;
    const backdrop = document.createElement("div");
    backdrop.className = "pc-backdrop";
    const card = document.createElement("div");
    card.className = "pc";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-hidden", "true");
    card.setAttribute("aria-labelledby", "pcName");
    document.body.append(backdrop, card);
    backdrop.addEventListener("click", close);
    els = { backdrop, card };
    swipeToClose(card, { scroller: () => card.querySelector(".pc-scroll"), backdrop, close });
    return els;
  }

  function close() {
    if (!els || !els.card.classList.contains("open")) return;
    els.card.classList.remove("open");
    els.backdrop.classList.remove("open");
    els.card.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("pc-lock");
    undock();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* Docking (desktop only). Opened from inside a team panel, the card slides
     out from behind the panel and settles on the right; opened from a box
     score, the box score narrows and moves left and the card opens beside
     it. Anywhere else (the search, say) it opens in the middle as before.
     The window it docks beside gives up width to make room, and gets it
     back when the card closes. */
  const DOCK_MIN = 1024;
  let docked = null;   // { host, kind }

  function dockFor(from) {
    if (!from || !from.closest || window.innerWidth < DOCK_MIN) return null;
    const box = from.closest("#bxModal");
    if (box) return { host: box, kind: "box" };
    const panel = from.closest("#teamDrawer, #profilePanel");
    if (panel) return { host: panel, kind: "panel" };
    return null;
  }

  function dock(target) {
    const { card, backdrop } = els;
    const vw = window.innerWidth;
    const cardW = Math.min(780, Math.round(vw * 0.5));
    if (target.kind === "box") {
      const boxW = Math.min(880, vw - cardW - 48);
      target.host.style.setProperty("--bx-dw", `${boxW}px`);
      target.host.classList.add("bx-docked");
      // Just above the box score, wherever it sits (over a team drawer it is raised).
      card.style.zIndex = String((parseInt(getComputedStyle(target.host).zIndex, 10) || 61) + 1);
      card.classList.remove("from-panel");
    } else {
      if (!target.host.dataset.pcWidth) target.host.dataset.pcWidth = target.host.getBoundingClientRect().width;
      // the panel floats 12px in from the left; keep 16px between it and the card
      const panelW = Math.min(Number(target.host.dataset.pcWidth), vw - cardW - 44);
      target.host.style.width = `${panelW}px`;
      // Just under the panel, just over its backdrop, so it slides out from
      // behind the panel's edge.
      card.style.zIndex = String((parseInt(getComputedStyle(target.host).zIndex, 10) || 80) - 1);
      card.style.setProperty("--pc-slide", `${cardW}px`);
      card.classList.add("from-panel");
    }
    card.style.width = `${cardW}px`;
    card.classList.add("docked");
    backdrop.classList.add("docked");
    docked = target;
  }

  function undock() {
    const { card, backdrop } = els;
    if (docked) {
      if (docked.kind === "box") docked.host.classList.remove("bx-docked");
      else { docked.host.style.width = ""; delete docked.host.dataset.pcWidth; }
    }
    docked = null;
    // Leave the docked classes until the card has faded, so it leaves the way
    // it came in rather than jumping to the middle first.
    setTimeout(() => {
      if (card.classList.contains("open")) return;
      card.classList.remove("docked", "from-panel");
      card.style.width = card.style.zIndex = "";
      backdrop.classList.remove("docked");
    }, 320);
  }

  function build(p) {
    const rows = p.r.map(([season, week, teamId, slot, pts, proj, club]) => {
      const game = ((data.games[season] || {})[week] || {})[teamId];
      const started = slot !== "BE" && slot !== "IR";
      let result = null;
      if (game) result = game[1] > game[2] ? "W" : game[1] < game[2] ? "L" : "T";
      return { season, week, team: teamOf(season, teamId), slot, pts, proj, club, started, game, result,
        playoff: week > (data.regularWeeks[season] || 14) };
    });
    const starts = rows.filter((r) => r.started);
    const total = starts.reduce((t, r) => t + r.pts, 0);
    const best = starts.slice().sort((a, b) => b.pts - a.pts);
    const wins = starts.filter((r) => r.result === "W").length;
    // A title counts only if he was in the winning team's starting lineup
    // for the championship game itself.
    const titles = starts.filter((r) => r.result === "W" && r.game && r.game[3] === "Championship");
    const losses = starts.filter((r) => r.result === "L").length;

    // Managers, most starts first; a manager keeps his history through renames.
    const mgrs = new Map();
    for (const r of rows) {
      const m = mgrs.get(r.team.ownerId) || { ...r.team, names: new Set(), seasons: new Set(), starts: 0, pts: 0, w: 0, l: 0, weeks: 0 };
      m.names.add(r.team.name);
      m.seasons.add(r.season);
      m.weeks++;
      if (r.started) { m.starts++; m.pts += r.pts; if (r.result === "W") m.w++; if (r.result === "L") m.l++; }
      m.color = r.team.color;
      mgrs.set(r.team.ownerId, m);
    }
    const managers = [...mgrs.values()].sort((a, b) => b.starts - a.starts || b.weeks - a.weeks);
    const seasons = [...new Set(rows.map((r) => r.season))];
    const lastClub = rows[rows.length - 1].club;
    return { rows, starts, total, best, wins, losses, titles, managers, seasons, lastClub };
  }

  function render(id) {
    const { card } = ensureShell();
    const p = data && data.byId.get(id);
    if (!p) {
      card.style.setProperty("--pc-color", "#304f91");
      card.innerHTML = `<button class="pc-close" aria-label="Close">&times;</button><div class="pc-empty">${data ? "No league history for this player." : "Player history could not be loaded."}</div>`;
      card.querySelector(".pc-close").addEventListener("click", close);
      return;
    }

    const s = build(p);
    const lead = s.managers[0];
    const isDst = p.p === "DST";
    const photo = !isDst && p.h
      ? `<img class="pc-face" src="${String(window.League && window.League.headshot ? window.League.headshot(p.h) : `https://sleepercdn.com/content/nfl/players/thumb/${p.h}.jpg`).replace(/"/g, "&quot;")}" alt="">`
      : bigClub(s.lastClub);
    const perStart = s.starts.length ? s.total / s.starts.length : 0;
    const top = s.best[0];
    const bestPts = Math.max(1, ...s.starts.map((r) => r.pts));

    // Timeline: every week of every season he was on a roster. Every row
    // shares one grid, a full league season wide whichever seasons he played,
    // so a two-week season reads as two weeks of seventeen rather than two
    // cells stretched across the card; weeks not yet played show as
    // placeholders.
    const lastOf = (season) => Math.max(...Object.keys(data.games[season] || {}).map(Number));
    const columns = Math.max(...data.seasons.map(lastOf));
    const current = data.seasons[data.seasons.length - 1];
    // Week numbers over the strips, on the same grid (playoff gap included).
    const labelReg = data.regularWeeks[current] || 14;
    const weekLabels = `<div class="pc-tl-row pc-tl-head"><span></span>
      <span class="pc-tl-strip" style="--reg:${labelReg};--po:${columns - labelReg}">${Array.from({ length: columns }, (_, i) =>
        `${i + 1 === labelReg + 1 ? `<span class="pc-gap"></span>` : ""}<span class="pc-wk-label">${i + 1}</span>`).join("")}</span>
      <span></span></div>`;
    const timeline = s.seasons.slice().reverse().map((season) => {   // newest on top
      const inSeason = s.rows.filter((r) => r.season === season);
      const played = Math.max(lastOf(season), ...inSeason.map((r) => r.week));
      const lastWeek = season === current ? columns : played;
      const reg = data.regularWeeks[season] || 14;
      const byWeek = new Map(inSeason.map((r) => [r.week, r]));
      const cells = Array.from({ length: lastWeek }, (_, i) => {
        const w = i + 1;
        const r = byWeek.get(w);
        const po = w === reg + 1 ? `<span class="pc-gap"></span>` : "";
        if (w > played) return `${po}<span class="pc-wk future" title="${season} week ${w}: not played yet"></span>`;
        if (!r) {
          // A week his last team had no game (a playoff bye, or knocked out)
          // is blank rather than "not on a roster".
          const before = inSeason.filter((x) => x.week < w).pop();
          const idle = before && !((data.games[season] || {})[w] || {})[before.team.id];
          return idle
            ? `${po}<span class="pc-wk none" title="${season} week ${w}: ${esc(before.team.name)} had no game"></span>`
            : `${po}<span class="pc-wk" title="${season} week ${w}: not on a roster"></span>`;
        }
        const cls = r.started ? "start" : "bench";
        return `${po}<span class="pc-wk ${cls}" style="--c:${r.team.color}" title="${season} week ${w}: ${esc(r.team.name)} · ${r.started ? r.slot : r.slot === "IR" ? "IR" : "bench"} · ${fmt(r.pts)}"></span>`;
      }).join("");
      // At most two logos, then a count, so a season he changed hands twice
      // cannot squeeze the strip on a phone.
      const owners = [...new Map(inSeason.map((r) => [r.team.ownerId, r.team])).values()];
      const who = owners.length > 3
        ? owners.slice(0, 2).map(mark).join("") + `<span class="pc-more" title="${owners.slice(2).map((t) => esc(t.owner)).join(", ")}">+${owners.length - 2}</span>`
        : owners.map(mark).join("");
      return `<div class="pc-tl-row"><span class="pc-tl-year">${season}</span>
        <span class="pc-tl-strip" style="--reg:${reg};--po:${columns - reg}">${cells}</span>
        <span class="pc-tl-who">${who}</span></div>`;
    }).join("");

    const mostStarts = Math.max(1, ...s.managers.map((m) => m.starts));
    const managers = s.managers.map((m) => `
      <div class="pc-mgr" style="--c:${m.color}">
        ${mark(m)}
        <span class="pc-mgr-name" title="${[...m.names].map(esc).join(" · ")}"><strong>${esc(m.owner)}</strong><span>${[...m.seasons].join(", ")}</span></span>
        <span class="pc-mgr-nums">
          <span><b>${m.starts}</b><small>GS</small></span>
          <span><b>${fmt1(m.pts)}</b><small>Pts</small></span>
          <span><b>${m.w}–${m.l}</b><small>Rec</small></span>
        </span>
        <span class="pc-bar"><i style="width:${(100 * m.starts / mostStarts).toFixed(1)}%"></i></span>
      </div>`).join("");

    const widest = (f) => Math.max(0, ...s.managers.map((m) => String(f(m)).length));
    const numWidths = `--gs:${widest((m) => m.starts)};--pts:${widest((m) => fmt1(m.pts))};--rec:${widest((m) => `${m.w}–${m.l}`)}`;

    const medals = ["gold", "silver", "bronze"];
    const topGames = s.best.slice(0, 3).map((r, i) => {
      const opp = r.game ? teamOf(r.season, r.game[0]) : null;
      const round = r.playoff && r.game && r.game[3] ? ` · ${esc(r.game[3])}` : "";
      return `<div class="pc-medal ${medals[i]}">
        <span class="pc-medal-rank">${i + 1}</span>
        <span class="pc-medal-info">
          <strong>${esc(r.team.name)}${opp ? ` vs ${esc(opp.name)}` : ""}</strong>
          <span>${r.season} · Week ${r.week}${round}${r.result ? ` · ${r.result === "W" ? "Won" : r.result === "L" ? "Lost" : "Tied"}` : ""}</span>
        </span>
        <b>${fmt(r.pts)}</b>
      </div>`;
    }).join("");

    const latest = s.seasons[s.seasons.length - 1];
    // The header wears his current NFL club's colour; a free agent keeps the
    // site's navy.
    card.style.setProperty("--pc-color", NFL_COLORS[s.lastClub] || "#304f91");
    card.innerHTML = `
      <div class="pc-scroll">
        <header class="pc-hero">
          <div class="pc-hero-shade" aria-hidden="true"></div>
          <div class="pc-hero-bg" aria-hidden="true"><div class="pc-hero-glass"></div></div>
          <div class="pc-photo" data-fold>${photo}${!isDst ? `<span class="pc-club">${nfl(s.lastClub)}</span>` : ""}</div>
          <div class="pc-id">
            ${s.titles.length ? `<div class="pc-champ" data-fold title="Championship games won in the starting lineup">🏆 ${[...new Set(s.titles.map((r) => r.season))].join(" · ")}</div>` : ""}
            <h2 id="pcName" data-fold${s.titles.length ? ` class="pc-gold"` : ""}>${esc(p.n)}</h2>
            <div class="pc-tags" data-fold>
              <span class="pc-tag">${esc(p.p)}</span>
              <span class="pc-tag">${s.managers.length} manager${s.managers.length === 1 ? "" : "s"}</span>
            </div>
          </div>
          <button type="button" class="pc-close" data-fold aria-label="Close player card">&times;</button>
        </header>
        <div class="pc-body">
          <section class="pc-tiles">
            <div class="pc-tile"><small>Starts</small><strong>${s.starts.length}</strong></div>
            <div class="pc-tile"><small>Points per start</small><strong>${fmt(perStart)}</strong></div>
            <div class="pc-tile"><small>Best game</small><strong>${top ? fmt(top.pts) : "—"}</strong><span>${top ? `${top.season} wk ${top.week} · ${esc(top.team.name)}` : "Never started"}</span></div>
            <div class="pc-tile"><small>Record when started</small><strong>${s.wins}–${s.losses}</strong></div>
          </section>

          <section class="pc-card">
            <div class="pc-card-head"><h3>Ownership timeline</h3><span>One cell per week</span></div>
            ${weekLabels}${timeline}
            <div class="pc-tl-key">
              <span><i style="background:${lead ? lead.color : "#304f91"}"></i>Started, in that team's colour</span>
              <span><i style="box-shadow: inset 0 0 0 1.5px ${lead ? lead.color : "#304f91"}"></i>Bench</span>
              <span><i style="background:#f1f4f7"></i>Not on a roster</span>
              <span><i style="box-shadow: inset 0 0 0 1px #d3dae2"></i>Not played yet</span>
            </div>
          </section>

          <div class="pc-cols">
            <section class="pc-card">
              <div class="pc-card-head"><h3>By manager</h3></div>
              <div style="${numWidths}">
              ${managers}
              </div>
            </section>
            <section class="pc-card">
              <div class="pc-card-head"><h3>Top performances</h3><span>As a starter</span></div>
              ${topGames ? `<div class="pc-top">${topGames}</div>` : `<div class="pc-empty">Never started.</div>`}
            </section>
          </div>

          <section class="pc-card">
            <div class="pc-card-head">
              <h3>Game log <button type="button" class="pc-info" aria-expanded="false" aria-label="What the points shading means">i</button></h3>
              <div class="pc-log-tools">
                <div class="pc-tabs" role="tablist">${s.seasons.map((y) =>
                  `<button type="button" role="tab" data-season="${y}">${y}</button>`).join("")}<button type="button" role="tab" data-season="all">All</button></div>
                <select class="pc-year" aria-label="Season">${s.seasons.slice().reverse().map((y) =>
                  `<option value="${y}">${y}</option>`).join("")}<option value="all">All seasons</option></select>
              </div>
            </div>
            <div class="pc-help" hidden style="--c:${lead ? lead.color : "#304f91"}">
              <ul>
                <li><span class="pc-pts start" style="--fill:.85;--pi:#fff">24.00</span>Started: filled in his team's colour, darker for a bigger score.</li>
                <li><span class="pc-pts start" style="--fill:.3;--pi:#0b1726">6.00</span>A lighter fill is a quieter game.</li>
                <li><span class="pc-pts bench">12.00</span>Outlined: on the bench or IR, so the points did not count.</li>
                <li><span class="pc-pts off">—</span>Not on a roster that week, or his team had no game (a bye or knocked out).</li>
                <li><span class="pc-pts" style="min-width:0;padding:0;color:#b8733f;font-size:10px">15<sup>P</sup></span>A P marks a playoff week.</li>
              </ul>
            </div>
            <div class="pc-log-wrap"></div>
          </section>
        </div>
      </div>`;

    // A photo the image server no longer has falls back to his club's logo.
    const face = card.querySelector(".pc-face");
    if (face) {
      // Fade the photo in when it arrives instead of letting it pop.
      const shown = () => face.classList.add("loaded");
      if (face.complete && face.naturalWidth) shown(); else face.addEventListener("load", shown);
    }
    if (face) face.addEventListener("error", () => {
      face.outerHTML = bigClub(s.lastClub);
    });

    // The shading is on the player's own scale: his best start is the darkest.
    const inkOn = (hex, fill) => {
      const n = parseInt(hex.slice(1), 16);
      const mix = (c) => fill * c + (1 - fill) * 255;
      const lum = (0.299 * mix((n >> 16) & 255) + 0.587 * mix((n >> 8) & 255) + 0.114 * mix(n & 255)) / 255;
      return lum < 0.6 ? "#fff" : "#0b1726";
    };
    const logWrap = card.querySelector(".pc-log-wrap");
    const select = card.querySelector(".pc-year");
    const showLog = (season) => {
      const all = season === "all";
      // Every week of each season shown, not just the weeks he was rostered:
      // a gap is a week off every roster, or a week his team had no game.
      const list = [];
      for (const yr of s.seasons) {
        if (!all && yr !== Number(season)) continue;
        const inSeason = s.rows.filter((r) => r.season === yr);
        const byWeek = new Map(inSeason.map((r) => [r.week, r]));
        const last = Math.max(lastOf(yr), ...inSeason.map((r) => r.week));
        for (let w = 1; w <= last; w++) {
          if (byWeek.has(w)) { list.push(byWeek.get(w)); continue; }
          const before = inSeason.filter((x) => x.week < w).pop();
          const idle = before && !((data.games[yr] || {})[w] || {})[before.team.id];
          list.push({ gap: true, season: yr, week: w, playoff: w > (data.regularWeeks[yr] || 14), idle: idle ? before.team : null });
        }
      }
      list.reverse();
      logWrap.innerHTML = `<div class="pc-log${all ? " all" : ""}"><div class="pc-log-row head"><span>Wk</span><span>Team</span><span class="num">Pts</span></div>
        ${list.map((r) => {
          if (r.gap) {
            const wk = `${all ? `’${String(r.season).slice(2)} · ` : ""}${r.week}${r.playoff ? "<sup>P</sup>" : ""}`;
            return r.idle
              ? `<div class="pc-log-row gap" title="${r.season} week ${r.week}: ${esc(r.idle.name)} had no game">
                  <span class="wk">${wk}</span>
                  <span class="pc-team">${mark(r.idle)}<span>${esc(r.idle.name)} · no game</span></span>
                  <span class="num"><span class="pc-pts off">—</span></span>
                </div>`
              : `<div class="pc-log-row gap" title="${r.season} week ${r.week}: not on a roster">
                  <span class="wk">${wk}</span>
                  <span class="pc-team"><span class="pc-mark pc-mark-off"></span><span>Not on a roster</span></span>
                  <span class="num"><span class="pc-pts off">—</span></span>
                </div>`;
          }
          const fill = r.started ? .22 + .78 * Math.max(0, r.pts) / bestPts : 0;
          const tip = `${r.season} week ${r.week}${r.playoff && r.game && r.game[3] ? ` (${r.game[3]})` : ""} · ${r.started ? r.slot : r.slot === "IR" ? "IR" : "bench"}${r.proj == null ? "" : ` · projected ${fmt(r.proj)}`}${r.result && r.started ? ` · ${r.result === "W" ? "won" : r.result === "L" ? "lost" : "tied"}` : ""}`;
          return `<div class="pc-log-row" title="${esc(tip)}">
            <span class="wk">${all ? `’${String(r.season).slice(2)} · ` : ""}${r.week}${r.playoff ? "<sup>P</sup>" : ""}</span>
            <span class="pc-team">${mark(r.team)}<span>${esc(r.team.name)}</span></span>
            <span class="num"><span class="pc-pts ${r.started ? "start" : "bench"}" style="--c:${r.team.color};--fill:${fill.toFixed(2)};--pi:${inkOn(r.team.color, fill)}">${fmt(r.pts)}</span></span>
          </div>`;
        }).join("")}</div>`;
      card.querySelectorAll(".pc-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.season === String(season)));
      select.value = String(season);
    };
    showLog(latest);
    card.querySelector(".pc-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-season]");
      if (b) showLog(b.dataset.season);
    });
    select.addEventListener("change", () => showLog(select.value));
    const info = card.querySelector(".pc-info");
    const help = card.querySelector(".pc-help");
    info.addEventListener("click", () => {
      help.hidden = !help.hidden;
      info.setAttribute("aria-expanded", String(!help.hidden));
    });
    card.querySelector(".pc-close").addEventListener("click", close);
  }

  /* The header's fold, tied to the scroll (see .pc-hero in the CSS).
     Where each part sits in the full header and in the slim bar is
     measured once per card, from layout offsets (a card still zooming in
     is scaled, so on-screen boxes would be off), and the scroll only moves
     --p between the two. */
  function offsetIn(el, root) {
    let x = 0, y = 0;
    for (let n = el; n && n !== root; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
    return { x, y, w: el.offsetWidth };
  }
  function measureFold(card) {
    const hero = card.querySelector(".pc-hero");
    if (!hero) return 0;
    const parts = [...hero.querySelectorAll("[data-fold]")];
    const full = parts.map((el) => offsetIn(el, hero)), fullH = hero.offsetHeight;
    card.classList.add("pc-small");
    const small = parts.map((el) => offsetIn(el, hero)), smallH = hero.offsetHeight;
    card.classList.remove("pc-small");
    parts.forEach((el, i) => {
      el.style.setProperty("--dx", `${small[i].x - full[i].x}px`);
      el.style.setProperty("--dy", `${small[i].y - full[i].y}px`);
      el.style.setProperty("--k", full[i].w ? (small[i].w / full[i].w).toFixed(4) : 1);
    });
    const d = Math.max(0, fullH - smallH);
    hero.style.setProperty("--hd", `${d}px`);
    return d;
  }
  // where the browser runs the fold itself, tied to the scroll (see the CSS)
  const SCROLL_DRIVEN = !!(window.CSS && CSS.supports && CSS.supports("animation-timeline: scroll()"));
  function foldHeader(card, scroller) {
    const hero = card.querySelector(".pc-hero");
    if (!hero) return;
    let d = 0, raf = 0, idle = 0, touching = false;
    const set = () => {
      raf = 0;
      if (SCROLL_DRIVEN) return;
      const p = d ? Math.min(1, Math.max(0, scroller.scrollTop / d)) : 0;
      hero.style.setProperty("--p", p.toFixed(4));
    };
    const measure = () => {
      d = measureFold(card);
      hero.classList.toggle("pc-nofold", !d);
      set();
    };
    // A scroll that comes to rest partway through the fold finishes it,
    // gliding to whichever end is nearer, so the header is never left
    // half folded. Not while a finger is still on the card.
    const settle = () => {
      clearTimeout(idle);
      if (touching || !d) return;
      const t = scroller.scrollTop;
      const end = Math.min(d, scroller.scrollHeight - scroller.clientHeight);
      if (t > 0.5 && t < end - 0.5) scroller.scrollTo({ top: t < d / 2 ? 0 : end, behavior: "smooth" });
    };
    const HAS_SCROLLEND = "onscrollend" in window;
    measure();
    scroller.addEventListener("scroll", () => {
      if (!raf && !SCROLL_DRIVEN) raf = requestAnimationFrame(set);
      clearTimeout(idle);
      if (!HAS_SCROLLEND) idle = setTimeout(settle, 160);
    }, { passive: true });
    if (HAS_SCROLLEND) scroller.addEventListener("scrollend", settle);
    scroller.addEventListener("touchstart", () => { touching = true; clearTimeout(idle); }, { passive: true });
    const lift = () => { touching = false; clearTimeout(idle); idle = setTimeout(settle, 160); };
    scroller.addEventListener("touchend", lift, { passive: true });
    scroller.addEventListener("touchcancel", lift, { passive: true });
    // a new size (rotating a phone, docking beside a panel) is a new fold
    card._refold = measure;
  }
  window.addEventListener("resize", () => {
    if (els && els.card.classList.contains("open") && els.card._refold) els.card._refold();
  });

  function open(id, from) {
    const { card, backdrop } = ensureShell();
    lastFocus = document.activeElement;
    const target = dockFor(from);
    const wasOpen = card.classList.contains("open");
    if (!wasOpen) {
      card.classList.remove("docked", "from-panel");
      card.style.width = card.style.zIndex = "";
      backdrop.classList.remove("docked");
      // Jump, untransitioned, to the docked start position (off to the left,
      // at its final height), so the slide in is a straight horizontal move
      // rather than a diagonal from where the centred card would sit.
      card.style.transition = "none";
      if (target) dock(target);
      void card.offsetWidth;
      card.style.transition = "";
    }
    // Hold the page still behind a card that covers it; a docked card sits
    // beside a window that already does.
    if (!card.classList.contains("docked")) document.documentElement.classList.add("pc-lock");
    card.setAttribute("aria-hidden", "false");

    const fill = () => {
      render(id);
      const btn = card.querySelector(".pc-close");
      if (btn) btn.focus({ preventScroll: true });
      const scroller = card.querySelector(".pc-scroll");
      if (scroller) {
        scroller.scrollTop = 0;
        foldHeader(card, scroller);
      }
    };
    const show = () => { card.classList.add("open"); backdrop.classList.add("open"); };

    if (data) {
      // The data is already here (the usual case, since it is fetched while
      // the page is idle): build the card first and start the slide on the
      // next frame, so the animation never waits on building it.
      fill();
      if (wasOpen) show(); else requestAnimationFrame(show);
    } else {
      card.innerHTML = `<div class="pc-empty">Loading…</div>`;
      show();
      load().then(fill);
    }
  }

  /* Search: names containing every word typed, in any order, accents and
     punctuation ignored; the most-started first. */
  const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[.'’]/g, "");
  function search(query, limit = 8) {
    return load().then((d) => {
      if (!d) return [];
      const words = norm(query).split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      return d.players
        .filter((p) => { const n = norm(p.n); return words.every((w) => n.includes(w)); })
        .map((p) => {
          const starts = p.r.filter((r) => r[3] !== "BE" && r[3] !== "IR");
          return { id: p.id, name: p.n, pos: p.p, club: p.r[p.r.length - 1][6], headshot: p.h,
            starts: starts.length, pts: starts.reduce((t, r) => t + r[4], 0),
            seasons: [...new Set(p.r.map((r) => r[0]))], prefix: norm(p.n).startsWith(words[0]) };
        })
        .sort((a, b) => (b.prefix - a.prefix) || b.starts - a.starts || a.name.localeCompare(b.name))
        .slice(0, limit);
    });
  }

  document.addEventListener("click", (event) => {
    const el = event.target.closest && event.target.closest("[data-player]");
    if (!el) return;
    event.preventDefault();
    event.stopPropagation();
    open(decodeURIComponent(el.dataset.player), el);
  }, true);

  // Closing the window the card is docked beside closes the card with it.
  document.addEventListener("click", (event) => {
    if (!docked || !els || !els.card.classList.contains("open")) return;
    if (event.target.closest && event.target.closest("#bxClose, #bxBackdrop, #drawerClose, #drawerBackdrop, #closeProfile, #profileBackdrop")) close();
  }, true);

  document.addEventListener("keydown", (event) => {
    if (!els || !els.card.classList.contains("open")) {
      const el = event.target.closest && event.target.closest("[data-player]");
      if (el && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        event.stopPropagation();
        open(decodeURIComponent(el.dataset.player), el);
      }
      return;
    }
    if (event.key === "Escape") {
      // Close only the card, not the box score or drawer underneath it.
      event.stopImmediatePropagation();
      event.preventDefault();
      close();
    }
  }, true);

  /* Swipe down to close, for every bottom sheet on a phone: this card, the
     box score, the team drawer and the all-time team profile.

     A drag starts anywhere on the sheet once its content is scrolled to the
     top (or the moment a scroll reaches the top mid-gesture), and the sheet
     follows the finger 1:1 while the backdrop fades with it. On release the
     velocity decides: a flick, or a drag past a third of the sheet, carries
     on down at the finger's own speed; anything less springs back with a
     little overshoot. Sideways gestures are left alone. */
  const SHEET_MAX = 760;

  function swipeToClose(sheet, { scroller, backdrop, close: dismiss }) {
    if (!sheet || sheet.dataset.swipe) return;
    sheet.dataset.swipe = "1";
    let active = false, decided = false, dragging = false;
    let startX = 0, startY = 0, baseY = 0, lastY = 0, lastT = 0, v = 0, off = 0;
    const bd = () => (typeof backdrop === "function" ? backdrop() : backdrop);

    const setOffset = (y) => {
      off = y;
      sheet.style.transform = `translate3d(0, ${y}px, 0)`;
      const b = bd();
      if (b) b.style.opacity = String(Math.max(0, 1 - y / (sheet.offsetHeight * 1.1)));
    };
    const clear = () => {
      sheet.style.transition = sheet.style.transform = "";
      const b = bd();
      if (b) b.style.transition = b.style.opacity = "";
    };

    sheet.addEventListener("touchstart", (e) => {
      // Only while it is laid out as a phone sheet: full width, on a narrow screen.
      if (window.innerWidth > SHEET_MAX || sheet.getBoundingClientRect().width < window.innerWidth - 2 ||
          !sheet.classList.contains("open") || e.touches.length > 1) { active = false; return; }
      const t = e.touches[0];
      active = true; decided = false; dragging = false;
      startX = t.clientX; startY = lastY = t.clientY; lastT = e.timeStamp; v = 0;
    }, { passive: true });

    sheet.addEventListener("touchmove", (e) => {
      if (!active) return;
      const t = e.touches[0];
      if (!decided) {
        const dx = t.clientX - startX, dy = t.clientY - startY;
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        decided = true;
        if (Math.abs(dx) > Math.abs(dy)) { active = false; return; }
      }
      const sc = scroller();
      if (!dragging && t.clientY > lastY && (!sc || sc.scrollTop <= 0)) {
        dragging = true;
        baseY = lastY;           // from the previous point, so this move already counts
        sheet.style.transition = "none";
        const b = bd(); if (b) b.style.transition = "none";
      }
      if (dragging) {
        e.preventDefault();
        const y = t.clientY - baseY;
        if (y <= 0) {            // pushed back up past the start: hand back to scrolling
          dragging = false;
          clear();
        } else {
          setOffset(y);
          const dt = e.timeStamp - lastT;
          if (dt > 0) v = 0.75 * ((t.clientY - lastY) / dt) + 0.25 * v;
        }
      }
      lastY = t.clientY; lastT = e.timeStamp;
    }, { passive: false });

    const end = () => {
      if (!active) return;
      active = false;
      if (!dragging) return;
      dragging = false;
      const h = sheet.offsetHeight;
      const b = bd();
      if (off > h * 0.33 || v > 0.5) {
        // Carry on at the finger's speed, never slower than a brisk exit.
        const dist = h + 24 - off;
        const dur = Math.round(Math.min(340, Math.max(170, dist / Math.max(v, 1.3))));
        sheet.style.transition = `transform ${dur}ms cubic-bezier(.2, .75, .35, 1)`;
        sheet.style.transform = `translate3d(0, ${h + 24}px, 0)`;
        if (b) { b.style.transition = `opacity ${dur}ms linear`; b.style.opacity = "0"; }
        setTimeout(() => {
          dismiss();
          // Put the sheet back to its own closed state without animating.
          sheet.style.transition = "none";
          sheet.style.transform = "";
          if (b) { b.style.transition = "none"; b.style.opacity = ""; }
          void sheet.offsetWidth;
          clear();
        }, dur);
      } else {
        // Spring home, overshooting a touch, as a sheet does on iOS.
        sheet.style.transition = "transform 460ms cubic-bezier(.2, 1.25, .35, 1)";
        sheet.style.transform = "translate3d(0, 0, 0)";
        if (b) { b.style.transition = "opacity 300ms ease"; b.style.opacity = ""; }
        setTimeout(() => { if (!dragging) clear(); }, 470);
      }
      v = 0;
    };
    sheet.addEventListener("touchend", end);
    sheet.addEventListener("touchcancel", end);
  }

  function wireSheets() {
    const click = (sel) => () => { const b = document.querySelector(sel); if (b) b.click(); };
    swipeToClose(document.getElementById("bxModal"), {
      scroller: () => document.getElementById("bxCols"),
      backdrop: () => document.getElementById("bxBackdrop"),
      close: click("#bxClose"),
    });
    swipeToClose(document.getElementById("teamDrawer"), {
      scroller: () => document.getElementById("drawerBody"),
      backdrop: () => document.getElementById("drawerBackdrop"),
      close: click("#drawerClose"),
    });
    swipeToClose(document.getElementById("profilePanel"), {
      scroller: () => document.getElementById("profileBody"),
      backdrop: () => document.getElementById("profileBackdrop"),
      close: click("#closeProfile"),
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireSheets);
  else wireSheets();

  window.PlayerCard = { open, close, search, nflLogo: nfl };
})();
