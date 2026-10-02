/* The hall itself: builds the room, hangs the exhibits along one rail, and
   turns pointers, wheels and keys into movement through it.

   There are two states and one transition between them. In `hall` you travel
   sideways past the pedestals. In `focus` one exhibit lifts off its plinth and
   turns under your finger while its record opens beside it. The camera is never
   driven directly — every frame it eases toward a target pose, which is what
   makes a flick, a tap and a keypress all feel like the same room. */

import * as THREE from "three";
import { buildHall } from "./accolades.js";
import { environmentTexture, glintTexture, loadTeamLogos, setAnisotropy, waitForFonts } from "./textures.js";
import { buildExhibitObject, buildPedestal, initMaterials } from "./models.js";
import { LAYOUT, buildDust, buildRoom, buildTravellingLights, contactShadow, planLayout, railPlace } from "./hall.js";
import { buildLockerRoom, buildLockerWall } from "./locker.js";

const clamp = THREE.MathUtils.clamp;
const damp = THREE.MathUtils.damp;

const state = {
  mode: "intro",
  rail: 0,
  railTarget: 0,
  velocity: 0,
  dragging: false,
  pointerMoved: 0,
  focusIndex: -1,
  focusYaw: 0,
  focusPitch: 0,
  focusZoom: 1,
  lift: 0,
  intro: 1,
  lastIndex: -1,
  // The rail index the nameplate is currently showing.
  lastStop: null,
  // The team locker: which manager's wall is open, which piece of it is being
  // inspected, and where the viewer has panned and zoomed the wall itself.
  lockerId: null,
  lockerIndex: -1,
  lockerPanX: 0,
  lockerPanY: 0,
  lockerWallZoom: 1
};

const IN_LOCKER = (mode) => mode === "locker" || mode === "lockerFocus";

/* Small screens, and the subset of them that are phones held upright.

   `isNarrow` is the HUD's long-standing breakpoint: below it the record sheet
   takes the bottom of the screen rather than a column down its side, and the
   chrome is measured accordingly.

   `isUpright` is narrower still — narrow AND taller than it is wide — and it is
   what the room reshapes itself around: the drag axis in the hall, the fold of a
   locker wall, how that wall is framed. A phone on its side is a short, wide
   rectangle, which wants exactly what a desktop wants and none of what a phone
   held upright does, so it is not upright and nothing changes for it. Above the
   breakpoint, neither is ever true and nothing changes at all. */
/* The room's viewport. Not the window: an ad bar can run along the foot of
   the screen (trophy.html, #hallAd), and the room is laid out in the space
   above it rather than behind it, so an exhibit, its nameplate or the record
   sheet is never under the bar. Every measurement of the screen below reads
   these, not innerWidth / innerHeight. */
const stageEl = document.getElementById("stage");
const viewW = () => (stageEl && stageEl.clientWidth) || innerWidth;
const viewH = () => (stageEl && stageEl.clientHeight) || innerHeight;

/* How hard the render is pushed before the tone map. A shaft is read at arm's
   length through a phone, and at the corridor's exposure every glazed or gold
   surface in it clipped — a porcelain lid, the face of a cup, a brass plate —
   and took the lettering next to it with them. The locker room keeps its own
   lamps and wants the exposure it was lit for, so the two are set separately
   rather than the whole site being turned down. Both are swapped behind the
   wipe that covers a change of room, so neither is ever seen changing. */
const HALL_EXPOSURE = viewW() <= 860 && viewH() > viewW() ? 0.86 : 1.06;
const LOCKER_EXPOSURE = 1.06;

const NARROW_AT = 860;
const isNarrow = () => viewW() <= NARROW_AT;
const isUpright = () => isNarrow() && viewH() > viewW();

const dom = {};
let hall;
let layout;
let scene;
let camera;
let renderer;
let lights;
let focusFill;
let dust;
let raycaster;
let hallGroup;
let hallFog;
let lockerRoom;
let lockerWall = null;
let exhibits = [];
let quality;
const pointer = new THREE.Vector2();
const camTarget = { position: new THREE.Vector3(), look: new THREE.Vector3() };
const lookAt = new THREE.Vector3();

/* ------------------------------------------------------------------- setup */

function detectQuality() {
  const mobile = matchMedia("(pointer: coarse)").matches || viewW() < 820;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const light = mobile && (cores <= 4 || memory <= 4);
  // Someone who has asked the system for less motion should not be handed a
  // room where every object sways and dust drifts through the light.
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  return {
    mobile,
    light,
    calm,
    pixelRatio: Math.min(devicePixelRatio || 1, light ? 1.5 : mobile ? 2 : 2),
    shadows: !light,
    dust: calm ? 0 : light ? 200 : 420,
    anisotropy: light ? 2 : 8
  };
}

/* The league the hall is for, from Sleeper or ESPN (sleeper.js, espn.js). Finished seasons
   fill the hall; the season being played is read only for runs still going,
   since win and loss streaks carry across years. */
async function loadLeague() {
  const L = window.League;
  const leagueId = L && L.requireLeague();
  if (!leagueId) return null;
  document.querySelectorAll('a[href="alltime.html"]').forEach((a) => { a.href = L.url("alltime"); });
  const model = await L.load(leagueId);
  window.TEAM_LOGOS = model.logos;
  L.remember({ id: leagueId, name: model.name, avatar: model.avatar, season: model.current.year });
  document.title = `${model.name} · Trophy Room`;
  const kicker = document.querySelector("#loader .kicker");
  if (kicker) kicker.textContent = model.name;
  const data = model.leagueData();
  const live = data.seasons.find((season) => season.live && season.regularGames.length);
  const results = {};
  if (live) {
    live.regularGames.forEach((g) => (results[g.week] = results[g.week] || []).push([g.a, g.aScore, g.b, g.bScore]));
  }
  return {
    name: model.name,
    owners: data.owners,
    seasons: data.seasons.filter((season) => !season.live),
    liveSeason: live ? { year: live.year, teams: live.teams, results } : null
  };
}

async function boot() {
  cacheDom();

  let data;
  try {
    data = await loadLeague();
  } catch (error) {
    fail(`This league couldn't be loaded: ${error.message || `${window.League.sourceName()} didn't answer.`}`);
    // A private ESPN league: the way out leads to connecting it.
    if (error.link && dom.loaderExit) { dom.loaderExit.href = error.link; dom.loaderExit.textContent = error.linkText || "Back"; }
    return;
  }
  if (!data) return;
  if (!data.seasons.length) {
    fail(`The trophy room opens once the league has finished a season on ${window.League.sourceName()}. Until then, the season page has everything so far.`);
    if (dom.loaderExit) { dom.loaderExit.href = window.League.url("season"); dom.loaderExit.textContent = "← Back to the season"; }
    return;
  }

  hall = buildHall(data);
  /* Which way the gallery runs is settled here, once, because the room is built
     around it: a corridor and a shaft are different buildings, not two views of
     one. Turning the phone afterwards refolds a locker wall but leaves the hall
     as it was built — the rail's own axis follows the room, so the swipe and
     the exhibits always agree, which is the whole point of having two. */
  layout = planLayout(hall, { vertical: isUpright() });

  const canvas = dom.canvas;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch (error) {
    fail("This device can't open WebGL, so the hall can't be rendered.");
    return;
  }
  if (!renderer.getContext()) {
    fail("This device can't open WebGL, so the hall can't be rendered.");
    return;
  }

  quality = detectQuality();
  renderer.setPixelRatio(quality.pixelRatio);
  renderer.setSize(viewW(), viewH());
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = HALL_EXPOSURE;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (quality.shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  setAnisotropy(Math.min(quality.anisotropy, renderer.capabilities.getMaxAnisotropy()));
  // Both gates for the same reason: every texture here is painted once, on a
  // canvas, synchronously. A font or a logo that arrives afterwards is too late
  // to appear in one.
  await Promise.all([waitForFonts(), loadTeamLogos()]);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070d17);
  hallFog = new THREE.Fog(0x070d17, 17, 62);
  scene.fog = hallFog;

  camera = new THREE.PerspectiveCamera(52, viewW() / viewH(), 0.1, 220);
  camera.position.set(0, 2.1, LAYOUT.itemZ + 6.4);

  const envMap = environmentTexture(renderer);
  scene.environment = envMap;
  // The reflected room is deliberately dim so gold keeps its contrast; the
  // intensity here is what makes it actually light the marble.
  scene.environmentIntensity = 2.4;
  initMaterials({ envMap, quality });

  scene.add(new THREE.HemisphereLight(0x9fbdff, 0x2a1a10, 1.5));
  scene.add(new THREE.AmbientLight(0x4a5f80, 0.75));

  hallGroup = new THREE.Group();
  scene.add(hallGroup);
  buildRoom(hallGroup, hall, layout);
  buildExhibits();
  buildRailStops();
  lockerRoom = buildLockerRoom(scene);
  lights = buildTravellingLights(scene, quality, { vertical: layout.vertical });
  focusFill = new THREE.PointLight(0xfff0d6, 0, 9, 2);
  scene.add(focusFill);
  dust = buildDust(scene, quality.dust, { vertical: layout.vertical });

  raycaster = new THREE.Raycaster();

  buildHud();
  bindInput();
  applyDeepLink();

  // The stage, not the window: it also changes size when the ad bar under it
  // comes or goes (a member going Pro), with no window resize to say so.
  if (window.ResizeObserver) new ResizeObserver(() => onResize()).observe(stageEl);
  else addEventListener("resize", onResize);
  onResize();

  /* A console handle for tuning the room and for driving it from a headless
     browser. Nothing in the page reads it. `camTarget`/`lookAt` are the poses
     the camera is easing toward — useful because at a low frame rate the
     camera can be a long way behind them. */
  window.__hall = {
    scene, camera, renderer, exhibits, state, hall, layout,
    camTarget, lookAt, goTo, focus: focusExhibit, exitFocus,
    openLocker, closeLocker, focusLockerItem, exitLockerFocus,
    lockerWall: () => lockerWall,
    lockerRoom: () => lockerRoom
  };

  dom.stage.classList.add("ready");
  renderer.setAnimationLoop(tick);

  // Nothing to press: the splash covered the build, and the camera's dolly-in
  // plays underneath it as it fades.
  enterHall();
}

function fail(message) {
  dom.loader.classList.add("failed");
  dom.loaderNote.textContent = message;
}

function cacheDom() {
  const id = (name) => document.getElementById(name);
  Object.assign(dom, {
    stage: id("stage"),
    canvas: id("scene"),
    loader: id("loader"),
    loaderNote: id("loaderNote"),
    loaderExit: id("loaderExit"),
    hud: id("hud"),
    label: id("label"),
    labelWing: id("labelWing"),
    labelTitle: id("labelTitle"),
    labelSub: id("labelSub"),
    hint: id("hint"),
    wings: id("wings"),
    progress: id("progress"),
    prev: id("prevItem"),
    next: id("nextItem"),
    sheet: id("sheet"),
    sheetWing: id("sheetWing"),
    sheetTitle: id("sheetTitle"),
    sheetSub: id("sheetSub"),
    sheetBlurb: id("sheetBlurb"),
    sheetStats: id("sheetStats"),
    sheetLinks: id("sheetLinks"),
    sheetClose: id("sheetClose"),
    counter: id("counter"),
    summary: id("summary"),
    wipe: id("wipe"),
    wipeCrest: id("wipeCrest"),
    wipeLabel: id("wipeLabel"),
    lockerBack: id("lockerBack"),
    lockerBackLabel: id("lockerBackLabel"),
    lockerHint: id("lockerHint")
  });
}

/* --------------------------------------------------------------- exhibits */

function buildExhibits() {
  const glint = glintTexture();
  const glintMaterial = new THREE.SpriteMaterial({
    map: glint,
    color: 0xfff0cf,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    opacity: 0.9
  });

  exhibits = hall.rail.map((item, index) => {
    const place = railPlace(layout, layout.positions[index]);
    const stand = new THREE.Group();
    stand.position.set(place.x, place.y, place.z);

    const pedestal = buildPedestalFor(item);
    const riser = new THREE.Group();
    riser.position.y = pedestal.userData.topY;
    const pivot = new THREE.Group();
    const spinner = new THREE.Group();

    const object = buildExhibitObject(item);
    spinner.add(object);

    /* Measure what was actually built rather than trusting a hand-set radius.
       The stars over a hall-of-fame shield and the handles on a cup both sit
       outside the figure they belong to, and framing guessed at them badly.
       Half-width is the diagonal of the footprint, not the width face-on,
       because the exhibit turns under the viewer's finger and has to stay in
       frame all the way round. */
    object.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(object);
    const size = bounds.getSize(new THREE.Vector3());
    const middle = bounds.getCenter(new THREE.Vector3());
    pivot.add(spinner);
    riser.add(pivot);

    const shadow = contactShadow(0.95, layout.vertical ? 0.42 : 0.6);
    const glints = (object.userData.glints || []).map((offset) => {
      const sprite = new THREE.Sprite(glintMaterial.clone());
      sprite.position.copy(offset);
      sprite.scale.setScalar(0.34);
      sprite.visible = false;
      spinner.add(sprite);
      return sprite;
    });

    stand.add(shadow, pedestal, riser);
    hallGroup.add(stand);

    stand.userData.exhibitIndex = index;
    return {
      item,
      index,
      stand,
      pedestal,
      riser,
      pivot,
      spinner,
      object,
      glints,
      // Where the exhibit stands, and how far along the rail that is. In a
      // corridor the two are the same number; in a shaft they are not.
      place,
      along: layout.positions[index],
      focusHeight: middle.y,
      focusHalfWidth: Math.hypot(size.x, size.z) / 2,
      focusHalfHeight: size.y / 2,
      spin: object.userData.spin || [],
      shadow,
      sway: object.userData.faceForward ? 0.07 : 0.2,
      idlePhase: Math.random() * Math.PI * 2
    };
  });
}

/* Where the rail is allowed to come to rest, and the coordinate a drag is
   actually measured in: one stop per exhibit, each one unit from the next.
   A drag is worked out in stop space and converted back to the index the
   rest of the room reads. */
let railStops = [];

function buildRailStops() {
  railStops = exhibits.map((exhibit, index) => index);
}

function railToStop(rail) {
  const last = railStops.length - 1;
  if (last < 1) return rail;
  // Outside the ends the two spaces run at the same rate, so the rubber band
  // past the last pedestal behaves the way it always did.
  if (rail <= railStops[0]) return rail - railStops[0];
  if (rail >= railStops[last]) return last + (rail - railStops[last]);
  for (let i = 0; i < last; i += 1) {
    const from = railStops[i];
    const to = railStops[i + 1];
    if (rail <= to) return i + (rail - from) / (to - from);
  }
  return last;
}

function stopToRail(stop) {
  const last = railStops.length - 1;
  if (last < 1) return stop;
  if (stop <= 0) return railStops[0] + stop;
  if (stop >= last) return railStops[last] + (stop - last);
  const low = Math.floor(stop);
  return THREE.MathUtils.lerp(railStops[low], railStops[low + 1], stop - low);
}

function snapRail(rail) {
  if (railStops.length < 2) return clamp(Math.round(rail), 0, Math.max(0, exhibits.length - 1));
  return stopToRail(clamp(Math.round(railToStop(rail)), 0, railStops.length - 1));
}

function stepRail(from, direction) {
  if (railStops.length < 2) return clamp(Math.round(from) + direction, 0, exhibits.length - 1);
  return stopToRail(clamp(Math.round(railToStop(from)) + direction, 0, railStops.length - 1));
}

// A pillar is most of a plinth already, and a plaque has to land at reading
// height; the plinth under each exhibit is cut to suit what stands on it.
const PLINTH_HEIGHT = { cup: 0.72, pillar: 0.86, plaque: 0.92, toilet: 0.74 };

function buildPedestalFor(item) {
  return buildPedestal(item, { height: PLINTH_HEIGHT[item.kind] ?? LAYOUT.pedestalHeight });
}

/* ------------------------------------------------------------------ camera */

/* How far along the rail a fractional index is. A point in the room comes from
   handing this to `railPlace`; the number itself is what the travelling lights
   ride and what the fog and the dust are measured against. */
function railToAlong(t) {
  const clamped = clamp(t, 0, exhibits.length - 1);
  const low = Math.floor(clamped);
  const high = Math.min(exhibits.length - 1, low + 1);
  const fraction = clamped - low;
  return THREE.MathUtils.lerp(layout.positions[low], layout.positions[high], fraction);
}

/* Where the camera's own position on the rail is, in the room. */
function railToPlace(t) {
  return railPlace(layout, railToAlong(t));
}

/* Framing an inspected exhibit.

   The HUD does not leave the exhibit the whole screen: the record sheet takes a
   column down the right of a desktop or the lower part of a phone, and the back
   button and wordmark sit across the top. So the framing works out the
   rectangle of screen that is actually free, pushes the camera back until the
   object fits inside that rectangle rather than inside the viewport, and aims
   so it lands in the middle of it.

   The camera stays level — it shifts rather than tilts — because tilting to
   place an object skews it, and a trophy you are turning in your hands should
   not lean as you turn it. */
function focusFraming(exhibit) {
  const narrow = isNarrow();
  const pad = narrow ? 14 : 24;

  // The top chrome, and whatever the sheet is currently covering.
  const topChrome = narrow ? 78 : 84;
  const sheetHeight = dom.sheet.offsetHeight || viewH() * 0.46;
  const sheetWidth = dom.sheet.offsetWidth || 372;

  const band = {
    left: pad,
    right: narrow ? viewW() - pad : viewW() - sheetWidth - 32 - pad,
    top: topChrome + pad,
    bottom: narrow ? viewH() - sheetHeight - pad : viewH() - pad
  };
  const bandWidth = Math.max(140, band.right - band.left);
  const bandHeight = Math.max(140, band.bottom - band.top);

  const vertical = THREE.MathUtils.degToRad(camera.fov);
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);

  /* Fit into the free rectangle, not the viewport: the object subtends only
     that fraction of the frame, in each direction independently.

     Turning the exhibit sweeps a cylinder of radius `reach`, and the near
     face of that cylinder is what the perspective makes largest — a trophy
     fitted at its centre plane still overruns the frame by the depth of its
     own handles. So each fit is measured to the near face and the reach is
     added back. */
  const reach = exhibit.focusHalfWidth;
  const fitHeight = exhibit.focusHalfHeight / (Math.tan(vertical / 2) * (bandHeight / viewH())) + reach;
  const fitWidth = reach / (Math.tan(horizontal / 2) * (bandWidth / viewW())) + reach;
  const distance = Math.max(fitHeight, fitWidth) * 1.06 * state.focusZoom;

  const visibleHeight = 2 * distance * Math.tan(vertical / 2);
  const visibleWidth = visibleHeight * camera.aspect;

  // Shift the level camera so the object projects onto the middle of the band.
  return {
    distance,
    offsetX: (0.5 - (band.left + band.right) / 2 / viewW()) * visibleWidth,
    offsetY: ((band.top + band.bottom) / 2 / viewH() - 0.5) * visibleHeight
  };
}

/* Framing the locker wall. Same near-face reasoning as an inspected exhibit,
   but the thing being fitted is the whole wall, and there is no record sheet
   covering the screen — only the top bar and the strip of HUD along the
   bottom. Whatever will not fit is reachable by dragging. */
function wallFraming() {
  if (!lockerWall) return { distance: 12, offsetX: 0, offsetY: 0 };
  const narrow = isNarrow();
  const pad = narrow ? 12 : 24;
  const band = {
    width: Math.max(160, viewW() - pad * 2),
    height: Math.max(160, viewH() - (narrow ? LOCKER_CHROME.narrow : LOCKER_CHROME.wide))
  };
  const centreY = (narrow ? 84 : 92) + band.height / 2;

  const vertical = THREE.MathUtils.degToRad(camera.fov);
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
  // A wall does not turn, so the only depth in front of its centre is its own
  // thickness — using the width here pushed the camera into the next room.
  const reach = lockerWall.size.z / 2;
  const fitHeight = lockerWall.size.y / 2 / (Math.tan(vertical / 2) * (band.height / viewH())) + reach;
  const fitWidth = lockerWall.size.x / 2 / (Math.tan(horizontal / 2) * (band.width / viewW())) + reach;
  // Both shapes are framed whole. The folded wall is folded precisely so that it
  // can be: a case you have to scroll is a case you cannot take in.
  const distance = Math.max(fitHeight, fitWidth) * 1.05 / state.lockerWallZoom;

  const visibleHeight = 2 * distance * Math.tan(vertical / 2);
  return {
    distance,
    offsetX: 0,
    offsetY: (centreY / viewH() - 0.5) * visibleHeight
  };
}

/* The shape of the space a locker wall has to fit into: how much taller the
   band is than it is wide. The folded wall is composed to this, so a squarer
   phone and a longer one get differently shaped cases and both fill the screen.

   Measured from the same numbers `wallFraming` uses, but callable before there
   is a wall to frame, because it is what decides how the wall is built. */
/* What the locker's own chrome takes off the screen: the top bar, and the hint
   pill along the bottom. Nothing else is on it since the team bar came off, and
   every pixel counted back here is a bigger pennant. */
const LOCKER_CHROME = { narrow: 152, wide: 168 };

function bandAspect() {
  const narrow = isNarrow();
  const pad = narrow ? 12 : 24;
  const width = Math.max(160, viewW() - pad * 2);
  const height = Math.max(160, viewH() - (narrow ? LOCKER_CHROME.narrow : LOCKER_CHROME.wide));
  return height / width;
}

/* How far the wall may be dragged from that resting frame. Both shapes are
   framed whole, so there is never anything off screen to reach for and the drag
   is only ever a nudge around the room. */
const WALL_PAN = { x: 3.2, y: 2.6 };

function wallPanLimits() {
  return lockerWall ? WALL_PAN : { x: 0, y: 0 };
}

function updateCameraTarget(dt) {
  if (state.mode === "lockerFocus" && lockerWall && lockerWall.items[state.lockerIndex]) {
    const holder = lockerWall.items[state.lockerIndex];
    const frame = holder.userData.frame;
    const present = holder.userData.present;
    const framing = focusFraming({
      focusHalfWidth: frame.halfWidth,
      focusHalfHeight: frame.halfHeight
    });
    // A pennant is a small thing. Fitting it to the frame the way a trophy is
    // fitted blows it up until its neighbours crowd in around it, so nothing
    // comes closer than arm's length.
    const distance = Math.max(framing.distance, 2.4 * state.focusZoom);
    const { offsetX, offsetY } = framing;
    const shownY = frame.centre.y + present.lift;
    const shownZ = frame.centre.z + present.push;
    camTarget.position.set(frame.centre.x + offsetX, shownY + offsetY, shownZ + distance);
    camTarget.look.set(frame.centre.x + offsetX, shownY + offsetY, shownZ);
  } else if (state.mode === "locker" && lockerWall) {
    // The wall's centre is measured in world space, origin included, so it is
    // used as it comes.
    const { distance, offsetX, offsetY } = wallFraming();
    const x = lockerWall.centre.x + state.lockerPanX + offsetX;
    const y = lockerWall.centre.y + state.lockerPanY + offsetY;
    camTarget.position.set(x, y, lockerWall.centre.z + distance);
    camTarget.look.set(x, y, lockerWall.centre.z);
  } else if (state.mode === "focus" && exhibits[state.focusIndex]) {
    const exhibit = exhibits[state.focusIndex];
    // An exhibit's own base, wherever the rail put it, plus everything that
    // stands on top of it.
    const centerY = exhibit.place.y + exhibit.pedestal.userData.topY + state.lift + exhibit.focusHeight;
    const { distance, offsetX, offsetY } = focusFraming(exhibit);
    const axisY = centerY + offsetY;
    camTarget.position.set(exhibit.place.x + offsetX, axisY, LAYOUT.itemZ + distance);
    camTarget.look.set(exhibit.place.x + offsetX, axisY, LAYOUT.itemZ);
  } else {
    const spot = railToPlace(state.rail);
    // The camera leans into a flick, which reads as momentum without moving
    // the exhibits themselves — down the corridor, or down the shaft.
    const lean = clamp(state.velocity * 0.14, -0.7, 0.7);
    const ease = state.intro * state.intro;
    /* The same eye height over whatever the exhibit is standing on, either way.
       The shaft aims lower than the corridor for the same reason a phone's
       record sheet takes the bottom of the screen and a desktop's takes the
       side: on a phone the free part of the frame is its top two thirds, and
       aiming below an exhibit is what lifts it into them. */
    const eye = spot.y + 2.52 + ease * 2.2;
    const aim = spot.y + (layout.vertical ? 1.42 : 1.80) + ease * 0.25;
    if (layout.vertical) {
      camTarget.position.set(spot.x, eye - lean * 0.55, LAYOUT.itemZ + 6.7 + ease * 6.6);
      camTarget.look.set(spot.x, aim - lean * 1.6, LAYOUT.itemZ);
    } else {
      camTarget.position.set(spot.x + lean * 0.55, eye, LAYOUT.itemZ + 6.7 + ease * 6.6);
      camTarget.look.set(spot.x + lean * 1.6, aim, LAYOUT.itemZ);
    }
  }

  const speed = state.mode === "focus" ? 5.4 : 4.2;
  camera.position.x = damp(camera.position.x, camTarget.position.x, speed, dt);
  camera.position.y = damp(camera.position.y, camTarget.position.y, speed, dt);
  camera.position.z = damp(camera.position.z, camTarget.position.z, speed, dt);
  lookAt.x = damp(lookAt.x, camTarget.look.x, speed, dt);
  lookAt.y = damp(lookAt.y, camTarget.look.y, speed, dt);
  lookAt.z = damp(lookAt.z, camTarget.look.z, speed, dt);
  camera.lookAt(lookAt);
}

/* -------------------------------------------------------------------- loop */

let previous = performance.now();

function tick(now) {
  const dt = Math.min(0.05, (now - previous) / 1000);
  previous = now;
  const time = now / 1000;

  if (state.mode !== "intro") {
    state.intro = damp(state.intro, 0, 2.4, dt);
  }

  if (state.mode === "hall") {
    if (!state.dragging) {
      state.rail = damp(state.rail, state.railTarget, 6.5, dt);
      state.velocity = damp(state.velocity, 0, 6, dt);
    }
  }

  if (IN_LOCKER(state.mode)) {
    updateLocker(dt, time);
    updateCameraTarget(dt);
    focusFill.intensity = damp(focusFill.intensity, state.mode === "lockerFocus" ? 10 : 0, 4, dt);
    focusFill.position.set(camera.position.x - 0.6, camera.position.y + 0.4, camera.position.z - 0.3);
    dust.update(dt, layout.vertical ? camera.position.y : camera.position.x);
    renderer.render(scene, camera);
    return;
  }

  state.lift = damp(state.lift, state.mode === "focus" ? 0.42 : 0, 5, dt);

  updateExhibits(dt, time);
  updateCameraTarget(dt);

  const current = nearestIndex();
  state.lastIndex = current;
  if (current !== state.lastStop) {
    state.lastStop = current;
    onCurrentChanged(current);
  }

  const active = exhibits[state.mode === "focus" ? state.focusIndex : current];
  if (active) {
    lights.update(layout.vertical ? -active.along : active.along, active.item.accent);
  }

  // The fill rides just off the camera's shoulder, so it lights whatever face
  // the viewer has turned toward themselves. Gold can take a lot of it; the
  // painted shields and engraved plates clip long before it does, so this is
  // set by what the diffuse surfaces will take.
  focusFill.intensity = damp(focusFill.intensity, state.mode === "focus" ? 20 : 0, 4, dt);
  // The fill takes the wing's colour too, so a cold wall is not lit warm.
  if (active) focusFill.color.lerp(new THREE.Color(0xfff0d6).lerp(new THREE.Color(active.item.accent), 0.35), 0.08);
  focusFill.position.set(
    camera.position.x - 0.9,
    camera.position.y + 0.5,
    camera.position.z - 0.4
  );
  dust.update(dt, layout.vertical ? camera.position.y : camera.position.x);

  renderer.render(scene, camera);
}

function updateExhibits(dt, time) {
  const centre = state.mode === "focus" ? state.focusIndex : state.rail;

  exhibits.forEach((exhibit, index) => {
    const distance = Math.abs(index - centre);
    const near = distance < 4.5;
    // Anything more than a few pedestals away is behind the fog anyway.
    exhibit.stand.visible = distance < 9;
    if (!exhibit.stand.visible) return;

    const focused = state.mode === "focus" && index === state.focusIndex;

    if (focused) {
      exhibit.spinner.rotation.y = damp(exhibit.spinner.rotation.y, state.focusYaw, 9, dt);
      exhibit.pivot.rotation.x = damp(exhibit.pivot.rotation.x, state.focusPitch, 9, dt);
      exhibit.riser.position.y = damp(
        exhibit.riser.position.y,
        exhibit.pedestal.userData.topY + state.lift,
        5,
        dt
      );
    } else {
      // Idle: a slow quarter-turn sway, so the room is never still but nothing
      // ever spins away from you.
      const sway = quality.calm ? 0 : Math.sin(time * 0.32 + exhibit.idlePhase) * exhibit.sway;
      exhibit.spinner.rotation.y = damp(exhibit.spinner.rotation.y, sway, 2.2, dt);
      exhibit.pivot.rotation.x = damp(exhibit.pivot.rotation.x, 0, 4, dt);
      exhibit.riser.position.y = damp(exhibit.riser.position.y, exhibit.pedestal.userData.topY, 4, dt);
    }

    const lifted = focused ? state.lift : 0;
    exhibit.shadow.material.opacity = 0.6 - lifted * 0.5;
    exhibit.shadow.scale.setScalar(1 + lifted * 0.5);

    exhibit.spin.forEach(({ node, speed }) => {
      if (!quality.calm) node.rotation.y += speed * dt * (focused ? 0.35 : 1);
    });

    exhibit.glints.forEach((sprite, i) => {
      sprite.visible = near;
      if (!near) return;
      const pulse = quality.calm ? 0.7 : 0.5 + 0.5 * Math.sin(time * (1.1 + i * 0.37) + exhibit.idlePhase * 3);
      const proximity = clamp(1 - distance / 4.5, 0, 1);
      sprite.material.opacity = pulse * proximity * (focused ? 0.95 : 0.55);
      sprite.scale.setScalar(0.22 + pulse * 0.2);
    });
  });
}

/* The wall breathes a little: the piece being inspected turns under the
   finger, and everything else drifts back to square. */
function updateLocker(dt, time) {
  if (!lockerWall) return;
  lockerWall.items.forEach((holder, index) => {
    const spinner = holder.userData.spinner;
    const home = holder.userData.home;
    const present = holder.userData.present;
    if (!spinner || !home || !present) return;

    if (state.mode === "lockerFocus" && index === state.lockerIndex) {
      // Off the shelf and clear of the panelling before it turns, and no
      // further round than the room it has allows.
      spinner.rotation.y = damp(spinner.rotation.y, clamp(state.focusYaw, -present.yaw, present.yaw), 9, dt);
      spinner.rotation.x = damp(spinner.rotation.x, clamp(state.focusPitch, -present.pitch, present.pitch), 9, dt);
      holder.position.y = damp(holder.position.y, home.y + present.lift, 6, dt);
      holder.position.z = damp(holder.position.z, home.z + present.push, 6, dt);
    } else {
      const sway = quality.calm ? 0 : Math.sin(time * 0.28 + index) * 0.03;
      spinner.rotation.y = damp(spinner.rotation.y, sway, 2.4, dt);
      spinner.rotation.x = damp(spinner.rotation.x, 0, 4, dt);
      holder.position.y = damp(holder.position.y, home.y, 5, dt);
      holder.position.z = damp(holder.position.z, home.z, 5, dt);
    }
  });
}

function nearestIndex() {
  return clamp(Math.round(state.mode === "focus" ? state.focusIndex : state.rail), 0, exhibits.length - 1);
}

/* -------------------------------------------------------------------- HUD */

function buildHud() {
  dom.wings.innerHTML = hall.wings.map((wing) => `
    <button class="wing" data-wing="${wing.id}" style="--accent:${wing.accent}">
      <span class="wing-name">${wing.name}</span>
      <span class="wing-count">${wing.count}</span>
    </button>
  `).join("");

  dom.progress.innerHTML = hall.wings.map((wing) => `
    <span class="progress-wing" data-wing="${wing.id}" style="--accent:${wing.accent}; flex-grow:${wing.count}"></span>
  `).join("");

  const { summary } = hall;
  dom.summary.textContent =
    `${summary.titles} titles · ${summary.managers} managers · ${summary.seasons} seasons on record · ${summary.games} games played`;

  dom.wings.addEventListener("click", (event) => {
    const button = event.target.closest("[data-wing]");
    if (!button) return;
    const wing = hall.wings.find((entry) => entry.id === button.dataset.wing);
    if (wing) goTo(wing.start, { exitFocus: true });
  });

  dom.prev.addEventListener("click", () => step(-1));
  dom.next.addEventListener("click", () => step(1));
  dom.sheet.querySelectorAll("[data-sheet-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const direction = Number(button.dataset.sheetStep);
      if (state.mode === "lockerFocus") stepLocker(direction);
      else step(direction);
    });
  });

  dom.lockerBack.addEventListener("click", () => {
    if (state.mode === "lockerFocus") exitLockerFocus();
    else closeLocker();
  });

  const inspect = () => {
    if (state.mode !== "hall") return;
    // The nameplate is the same door the shield is.
    const item = exhibits[nearestIndex()]?.item;
    if (item && item.wing === "hall" && item.ownerId) openLocker(item.ownerId);
    else focusExhibit(nearestIndex());
  };

  dom.label.addEventListener("click", inspect);
  dom.label.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inspect(); }
  });
  dom.sheetClose.addEventListener("click", () => {
    if (state.mode === "lockerFocus") exitLockerFocus();
    else exitFocus();
  });
}

function onCurrentChanged(index) {
  const exhibit = exhibits[index];
  if (!exhibit) return;
  const { item } = exhibit;

  dom.labelWing.textContent = item.wingName;
  dom.labelWing.style.color = item.accent;
  dom.labelTitle.textContent = item.kind === "plaque" ? item.title : item.title;
  dom.labelSub.textContent = item.kind === "plaque"
    ? `${item.bigValue} · ${item.subtitle}`
    : `${item.subtitle}${item.owner && item.owner !== item.subtitle ? ` · ${item.owner}` : ""}`;
  dom.counter.textContent = `${item.itemIndex + 1} / ${hall.wings[item.wingIndex].count}`;
  dom.stage.classList.toggle("is-team", item.wing === "hall" && Boolean(item.ownerId));

  dom.wings.querySelectorAll(".wing").forEach((button) => {
    const active = button.dataset.wing === item.wing;
    button.classList.toggle("active", active);
    // On a phone the pill row scrolls; walking into a wing should bring its
    // pill into view rather than leaving the highlight off-screen.
    if (active && button.dataset.wing !== dom.wings.dataset.shown) {
      dom.wings.dataset.shown = button.dataset.wing;
      button.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  });
  dom.progress.querySelectorAll(".progress-wing").forEach((bar) => {
    bar.classList.toggle("active", bar.dataset.wing === item.wing);
  });
  dom.stage.style.setProperty("--accent", item.accent);

  if (state.mode === "focus" && index === state.focusIndex) fillSheet(item);
  if (history.replaceState) history.replaceState(null, "", `${location.pathname}${location.search}#${item.id}`);
}

function fillSheet(item) {
  dom.sheetWing.textContent = item.wingName;
  dom.sheetWing.style.color = item.accent;
  dom.sheetTitle.textContent = item.kind === "plaque" ? item.bigValue : item.title;
  dom.sheetSub.innerHTML = item.kind === "plaque"
    ? `<strong>${item.title}</strong> · ${item.subtitle}`
    : `<strong>${item.subtitle}</strong>${item.owner && item.owner !== item.subtitle ? ` · ${item.owner}` : ""}`;
  dom.sheetBlurb.textContent = item.blurb || "";

  dom.sheetStats.innerHTML = (item.stats || []).map((stat) => `
    <div class="stat">
      <dt>${stat.label}</dt>
      <dd>${stat.value}</dd>
    </div>
  `).join("");

  dom.sheetLinks.innerHTML = (item.links || []).map((link) => `
    <a class="sheet-link" href="${link.href}">${link.label} <span aria-hidden="true">→</span></a>
  `).join("");
}

/* -------------------------------------------------------------- navigation */

function goTo(index, { exitFocus: leave = false } = {}) {
  if (leave && state.mode === "focus") exitFocus({ silent: true });
  state.railTarget = clamp(index, 0, exhibits.length - 1);
  state.velocity = 0;
  if (state.mode === "focus") {
    state.focusIndex = state.railTarget;
    state.rail = state.railTarget;
    resetFocusPose();
    fillSheet(exhibits[state.focusIndex].item);
  }
}

function step(direction) {
  if (state.mode === "focus") {
    const next = clamp(state.focusIndex + direction, 0, exhibits.length - 1);
    if (next === state.focusIndex) return;
    state.focusIndex = next;
    state.rail = next;
    state.railTarget = next;
    resetFocusPose();
    fillSheet(exhibits[next].item);
    return;
  }
  goTo(stepRail(state.railTarget, direction));
}

function resetFocusPose() {
  state.focusYaw = 0;
  state.focusPitch = 0;
  state.focusZoom = 1;
}

function focusExhibit(index) {
  if (state.mode === "intro") return;
  state.mode = "focus";
  state.focusIndex = clamp(index, 0, exhibits.length - 1);
  state.rail = state.focusIndex;
  state.railTarget = state.focusIndex;
  state.velocity = 0;
  resetFocusPose();
  fillSheet(exhibits[state.focusIndex].item);
  dom.stage.classList.add("focused");
  dom.sheet.setAttribute("aria-hidden", "false");
}

function exitFocus() {
  if (state.mode !== "focus") return;
  state.railTarget = state.focusIndex;
  state.rail = state.focusIndex;
  state.mode = "hall";
  state.focusIndex = -1;
  dom.stage.classList.remove("focused");
  dom.sheet.setAttribute("aria-hidden", "true");
}

function enterHall() {
  if (state.mode !== "intro") return;
  state.mode = "hall";
  dom.stage.classList.add("entered");
  dom.loader.classList.add("done", "gone");
  // The hints name the gesture, and on a phone held upright it is not the same
  // gesture. Set once on the way in: the hall is not re-entered on a rotation,
  // and a hint that rewrote itself mid-swipe would be its own distraction.
  if (isUpright()) {
    dom.hint.textContent = "Swipe up to walk the hall · tap a trophy to inspect it";
    dom.lockerHint.textContent = "Tap anything on the wall to see it up close";
  }
  setTimeout(() => dom.hint.classList.add("show"), 900);
  setTimeout(() => dom.hint.classList.remove("show"), 6500);
}

/* ------------------------------------------------------------ team lockers */

/* Opening a locker swaps rooms rather than travelling to one: the hall is
   switched off, the wall is built for this manager, and the camera is already
   there when the wipe clears. The wipe is what sells it as a door. */
function openLocker(ownerId) {
  const locker = hall.lockers[ownerId];
  if (!locker || state.lockerId === ownerId) return;

  wipe({ color: locker.color, icon: locker.icon, ownerId: locker.ownerId, label: `Opening ${locker.team}` }, () => {
    if (lockerWall) lockerWall.dispose();
    lockerRoom.setNarrow(isUpright());
    lockerWall = buildLockerWall(lockerRoom.room, locker, { narrow: isUpright(), aspect: bandAspect() });

    state.lockerId = ownerId;
    state.lockerIndex = -1;
    state.lockerPanX = 0;
    state.lockerPanY = 0;
    state.lockerWallZoom = 1;
    state.mode = "locker";

    hallGroup.visible = false;
    lockerRoom.room.visible = true;
    renderer.toneMappingExposure = LOCKER_EXPOSURE;
    // The hall's fog is tuned to a long aisle; a wall two rooms away would sit
    // in the middle of it.
    scene.fog = null;

    const framing = wallFraming();
    camera.position.set(
      lockerWall.centre.x,
      lockerWall.centre.y + framing.offsetY,
      lockerWall.centre.z + framing.distance
    );
    lookAt.copy(camera.position).setZ(lockerWall.centre.z);
    camera.lookAt(lookAt);

    dom.stage.classList.add("in-locker");
    dom.stage.classList.remove("focused");
    dom.sheet.setAttribute("aria-hidden", "true");
    dom.stage.style.setProperty("--accent", locker.color);
    dom.lockerBackLabel.textContent = "Hall of Fame";
    if (history.replaceState) history.replaceState(null, "", `#locker=${ownerId}`);
  });
}

function closeLocker() {
  if (!IN_LOCKER(state.mode)) return;
  const returning = state.lockerId;

  wipe({ color: "#f2c14a", icon: "🏆", label: "Back to the Hall" }, () => {
    if (lockerWall) lockerWall.dispose();
    lockerWall = null;
    state.lockerId = null;
    state.lockerIndex = -1;
    state.mode = "hall";

    lockerRoom.room.visible = false;
    hallGroup.visible = true;
    renderer.toneMappingExposure = HALL_EXPOSURE;
    scene.fog = hallFog;

    dom.stage.classList.remove("in-locker", "focused");
    dom.sheet.setAttribute("aria-hidden", "true");

    // Back to the shield you came in through.
    const shield = hall.rail.find((entry) => entry.wing === "hall" && entry.ownerId === returning);
    const index = shield ? shield.railIndex : state.lastIndex;
    state.rail = index;
    state.railTarget = index;
    state.lastStop = null;
    const exhibit = exhibits[index];
    if (exhibit) {
      camera.position.set(exhibit.place.x, exhibit.place.y + 2.52, LAYOUT.itemZ + 6.7);
      lookAt.set(exhibit.place.x, exhibit.place.y + 1.8, LAYOUT.itemZ);
      camera.lookAt(lookAt);
    }
  });
}

function focusLockerItem(index) {
  if (!lockerWall || !lockerWall.items[index]) return;
  state.mode = "lockerFocus";
  state.lockerIndex = index;
  state.focusYaw = 0;
  state.focusPitch = 0;
  state.focusZoom = 1;
  fillSheet(lockerWall.items[index].userData.locker);
  dom.stage.classList.add("focused");
  dom.sheet.setAttribute("aria-hidden", "false");
  dom.lockerBackLabel.textContent = "The Wall";
}

function exitLockerFocus() {
  if (state.mode !== "lockerFocus") return;
  state.mode = "locker";
  state.lockerIndex = -1;
  dom.stage.classList.remove("focused");
  dom.sheet.setAttribute("aria-hidden", "true");
  dom.lockerBackLabel.textContent = "Hall of Fame";
}

/* A short curtain over a change of room, so neither the build nor the camera
   jump is ever on screen.

   A request arriving mid-curtain is held rather than dropped: clicking through
   two managers quickly used to leave the second one's click doing nothing at
   all, with the first one's wall still on the screen. Only the most recent
   request is kept — the ones in between are rooms nobody asked to stay in. */
let wiping = false;
let pendingWipe = null;
/* Paints a team's mark into one of the HUD's crest chips. The logo is the same
   data URI the 3D textures are drawn from, so nothing extra is fetched; an
   owner without one (the two departed 2021 teams) keeps their emoji. */
function paintCrest(node, ownerId, fallback) {
  const src = ownerId && window.TEAM_LOGOS && window.TEAM_LOGOS[ownerId];
  node.textContent = "";
  if (!src) {
    node.textContent = fallback || "\u{1F3C8}";
    return;
  }
  const image = document.createElement("img");
  image.src = src;
  image.alt = "";
  node.append(image);
}

function wipe(look, midpoint) {
  if (wiping) {
    pendingWipe = { look, midpoint };
    return;
  }
  wiping = true;
  dom.wipe.style.setProperty("--wipe-team", look.color);
  paintCrest(dom.wipeCrest, look.ownerId, look.icon);
  dom.wipeLabel.textContent = look.label;
  dom.wipe.classList.add("on");
  setTimeout(() => {
    midpoint();
    dom.wipe.classList.remove("on");
    setTimeout(() => {
      wiping = false;
      if (pendingWipe) {
        const next = pendingWipe;
        pendingWipe = null;
        wipe(next.look, next.midpoint);
      }
    }, 380);
  }, 300);
}

function applyDeepLink() {
  const target = location.hash.replace("#", "");
  if (!target) return;

  const team = target.match(/^locker=(.+)$/);
  if (team) {
    const ownerId = decodeURIComponent(team[1]);
    if (hall.lockers[ownerId]) setTimeout(() => openLocker(ownerId), 60);
    return;
  }

  const wing = hall.wings.find((entry) => entry.id === target);
  const item = hall.rail.find((entry) => entry.id === target);
  const index = wing ? wing.start : item ? item.railIndex : -1;
  if (index < 0) return;
  state.rail = index;
  state.railTarget = index;
  state.lastStop = null;
}

/* ------------------------------------------------------------------ input */

function bindInput() {
  const canvas = dom.canvas;
  const active = new Map();
  let startStop = 0;
  let startX = 0;
  let startY = 0;
  let startYaw = 0;
  let startPitch = 0;
  let startPanX = 0;
  let startPanY = 0;
  let pinchStart = 0;
  let zoomStart = 1;
  let lastAlong = 0;
  let movedAlong = 0;
  let lastTime = 0;
  let pinching = false;

  /* Dragging the length of the screen walks about four stops, on a phone and on
     a desktop alike. Stops, not indices: see `railToStop`.

     Which way you drag depends on the shape of the screen. A desktop drags the
     hall sideways, because that is the direction the hall runs and there is a
     screen's width to do it in. A phone held upright has that width in the
     wrong direction and a thumb that swings up and down, so the same walk is
     driven by a vertical swipe — swipe up to go further along, exactly like
     scrolling anything else on a phone. Only the axis changes: a stop is the
     same distance, and the flick carries the same way. */
  const railAxis = () => (layout.vertical ? "y" : "x");
  const stopsPerPixel = () =>
    (railAxis() === "y" ? 4.2 / Math.max(360, viewH()) : 4.2 / Math.max(360, viewW()));

  canvas.addEventListener("pointerdown", (event) => {
    if (state.mode === "intro") return;
    canvas.setPointerCapture(event.pointerId);
    active.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (active.size === 2) {
      const [a, b] = [...active.values()];
      pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
      zoomStart = state.mode === "locker" ? state.lockerWallZoom : state.focusZoom;
      // A pinch is not a drag, and must not land as a tap when the fingers lift.
      pinching = true;
      state.dragging = false;
      return;
    }

    if (active.size === 1) pinching = false;
    state.dragging = true;
    state.pointerMoved = 0;
    movedAlong = 0;
    startStop = railToStop(state.rail);
    startX = event.clientX;
    startY = event.clientY;
    lastAlong = railAxis() === "y" ? event.clientY : event.clientX;
    startYaw = state.focusYaw;
    startPitch = state.focusPitch;
    startPanX = state.lockerPanX;
    startPanY = state.lockerPanY;
    lastTime = performance.now();
    state.velocity = 0;
    dom.hint.classList.remove("show");
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!active.has(event.pointerId)) return;
    active.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (active.size === 2) {
      const [a, b] = [...active.values()];
      const spread = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStart > 0) {
        if (state.mode === "focus" || state.mode === "lockerFocus") {
          state.focusZoom = clamp(zoomStart * (pinchStart / spread), 0.62, 2.2);
        } else if (state.mode === "locker") {
          state.lockerWallZoom = clamp(zoomStart * (spread / pinchStart), 0.85, 3.2);
        }
      }
      return;
    }
    if (!state.dragging) return;

    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    state.pointerMoved = Math.max(state.pointerMoved, Math.hypot(dx, dy));

    if (state.mode === "focus" || state.mode === "lockerFocus") {
      // Drag right and the exhibit turns to show its right side; drag down and
      // it tips to show its top. This is the direction of orbiting a camera
      // around the object rather than pushing the face nearest you, and it is
      // the one that reads as "grabbing" it.
      state.focusYaw = startYaw + dx * 0.0085;
      state.focusPitch = clamp(startPitch + dy * 0.0055, -0.55, 0.55);
      return;
    }

    if (state.mode === "locker") {
      // A wall is panned, not travelled: drag moves the view across it, and
      // the reach is bounded by how much of the wall is off-screen.
      const metresPerPixel = wallFraming().distance * 0.0016;
      const reach = wallPanLimits();
      state.lockerPanX = clamp(startPanX - dx * metresPerPixel, -reach.x, reach.x);
      state.lockerPanY = clamp(startPanY + dy * metresPerPixel, -reach.y, reach.y);
      return;
    }

    const along = railAxis() === "y" ? dy : dx;
    const at = railAxis() === "y" ? event.clientY : event.clientX;
    movedAlong = Math.max(movedAlong, Math.abs(along));
    state.rail = clamp(stopToRail(startStop - along * stopsPerPixel()), -0.4, exhibits.length - 0.6);
    const now = performance.now();
    const elapsed = Math.max(8, now - lastTime);
    // Also in stops per second, so the throw below carries the same number of
    // stops wherever on the rail it is let go.
    state.velocity = -(at - lastAlong) * stopsPerPixel() * (1000 / elapsed);
    lastAlong = at;
    lastTime = now;
  });

  const release = (event) => {
    if (!active.has(event.pointerId)) return;
    active.delete(event.pointerId);
    if (active.size > 0) return;
    if (pinching) {
      pinching = false;
      pinchStart = 0;
      return;
    }
    if (!state.dragging) return;
    state.dragging = false;

    if (state.pointerMoved < 9) {
      handleTap(event);
      return;
    }
    // A drag across the rail's axis is a drag; a drag along the other one never
    // touched the rail, and re-snapping from wherever the camera happens to
    // have glided to would answer it by walking you back a stop.
    if (state.mode === "hall" && movedAlong >= 9) {
      // Carry the flick a little way, then let the stops pull the camera in.
      const projected = railToStop(state.rail) + clamp(state.velocity * 0.28, -3.2, 3.2);
      state.railTarget = snapRail(stopToRail(projected));
    }
  };

  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  // Trackpads report continuous deltas and mice report notches; accumulating
  // into one budget and spending it a pedestal at a time makes both feel the same.
  let wheelBudget = 0;
  canvas.addEventListener("wheel", (event) => {
    if (state.mode === "intro") return;
    event.preventDefault();
    if (state.mode === "focus" || state.mode === "lockerFocus") {
      state.focusZoom = clamp(state.focusZoom + event.deltaY * 0.0016, 0.62, 2.2);
      return;
    }
    if (state.mode === "locker") {
      state.lockerWallZoom = clamp(state.lockerWallZoom - event.deltaY * 0.0018, 0.85, 3.2);
      return;
    }
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    wheelBudget += delta;
    const steps = Math.trunc(wheelBudget / 55);
    if (!steps) return;
    wheelBudget -= steps * 55;
    const direction = Math.sign(steps);
    for (let i = 0; i < Math.abs(steps); i += 1) {
      state.railTarget = stepRail(state.railTarget, direction);
    }
  }, { passive: false });

  addEventListener("keydown", (event) => {
    if (state.mode === "intro") return;
    if (IN_LOCKER(state.mode)) {
      switch (event.key) {
        case "Escape": case "Backspace":
          if (state.mode === "lockerFocus") exitLockerFocus();
          else closeLocker();
          break;
        case "ArrowRight": stepLocker(1); break;
        case "ArrowLeft": stepLocker(-1); break;
        case "Enter":
          if (state.mode === "locker") focusLockerItem(0);
          break;
        default: return;
      }
      event.preventDefault();
      return;
    }

    switch (event.key) {
      case "ArrowRight": case "d": step(1); break;
      case "ArrowLeft": case "a": step(-1); break;
      case "ArrowUp": case "Enter":
        if (state.mode !== "hall") break;
        focusExhibit(nearestIndex());
        break;
      case "ArrowDown": case "Escape":
        exitFocus();
        break;
      case "Home": goTo(0, { exitFocus: true }); break;
      case "End": goTo(exhibits.length - 1, { exitFocus: true }); break;
      default: return;
    }
    event.preventDefault();
  });

  addEventListener("hashchange", () => {
    applyDeepLink();
  });
}

function stepLocker(direction) {
  if (!lockerWall || state.mode !== "lockerFocus") return;
  const next = clamp(state.lockerIndex + direction, 0, lockerWall.items.length - 1);
  if (next !== state.lockerIndex) focusLockerItem(next);
}

function handleTap(event) {
  const rect = dom.canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  if (IN_LOCKER(state.mode)) {
    const hits = lockerWall ? raycaster.intersectObjects(lockerWall.items, true) : [];
    if (!hits.length) {
      // Tapping the room around the wall steps back out of a piece.
      if (state.mode === "lockerFocus") exitLockerFocus();
      return;
    }
    let node = hits[0].object;
    while (node && !node.userData.locker) node = node.parent;
    if (!node) return;
    const index = lockerWall.items.indexOf(node);
    if (state.mode === "lockerFocus" && index === state.lockerIndex) exitLockerFocus();
    else focusLockerItem(index);
    return;
  }

  const candidates = exhibits
    .filter((exhibit) => exhibit.stand.visible)
    .map((exhibit) => exhibit.stand);
  const hits = raycaster.intersectObjects(candidates, true);

  if (!hits.length) {
    if (state.mode === "focus") exitFocus();
    return;
  }

  let node = hits[0].object;
  while (node && node.userData.exhibitIndex === undefined) node = node.parent;
  if (!node) return;

  const index = node.userData.exhibitIndex;
  const item = exhibits[index].item;

  // A manager in the hall of fame is a door, not an exhibit: tapping their
  // shield opens their locker rather than turning the shield around.
  if (item.wing === "hall" && item.ownerId) {
    openLocker(item.ownerId);
    return;
  }

  if (state.mode === "focus") {
    if (index === state.focusIndex) exitFocus();
    else { state.focusIndex = index; state.rail = index; state.railTarget = index; resetFocusPose(); fillSheet(item); }
    return;
  }
  focusExhibit(index);
}

function onResize() {
  camera.aspect = viewW() / viewH();
  camera.updateProjectionMatrix();
  renderer.setSize(viewW(), viewH());
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality.pixelRatio));

  /* A wall is folded at build time, so turning a phone on its side while one is
     open has to cut it again. Only when the breakpoint is actually crossed: an
     ordinary resize, or a mobile browser's address bar sliding away, must not
     throw away a wall and drop the viewer back at the top of it. */
  const locker = lockerWall && hall.lockers[state.lockerId];
  if (locker && lockerWall.narrow !== isUpright()) {
    const focused = state.mode === "lockerFocus" ? state.lockerIndex : -1;
    lockerWall.dispose();
    lockerRoom.setNarrow(isUpright());
    lockerWall = buildLockerWall(lockerRoom.room, locker, { narrow: isUpright(), aspect: bandAspect() });
    state.lockerPanX = 0;
    state.lockerPanY = 0;
    state.lockerWallZoom = 1;
    if (focused >= 0) state.lockerIndex = Math.min(focused, lockerWall.items.length - 1);
  }
}

boot();
