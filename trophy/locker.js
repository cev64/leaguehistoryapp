/* The team locker: one manager's wall, everything they have to be proud of on
   it at once.

   The hall's wings are league-wide and argue about who holds what. A locker
   does not argue — every manager has one, every one of them has something in
   it, and nothing on the wall is a lowlight. It reads as a wall rather than an
   aisle: you see the whole thing on arrival, then zoom into any piece of it.

   Rows run down the wall in the order a trophy case fills up:

     flag        the team's colours, across the top
     pennants    one per playoff berth, hung point-down from a rail, with that
                 season's star and ribbon pinned to its two posts
     shelf       a league trophy per title, a silver bowl per title game
     plaques     personal bests, mounted in a row

   A row centres itself and wraps when it runs long, so a manager with one
   berth and a manager with five both get a composed wall. The whole thing is
   built when a locker is opened and thrown away when it closes: ten lockers of
   canvas textures resident at once is not worth the memory.

   On a phone the same wall is folded narrower — fewer to a row, a shorter shelf,
   a smaller flag. A portrait screen has width to spare in exactly the direction
   a wall does not need it, so the fold trades the empty sides for a wall the
   thumb scrolls down and pieces roughly twice the size. */

import * as THREE from "three";
import {
  buildLeagueTrophy, buildPennant, buildPlaque, buildPodiumBowl, buildScoringStar,
  buildTeamFlag, buildWinsRibbon, materials, roundedBox, teamMetal
} from "./models.js";
import { mix, radialTexture } from "./textures.js";

/* Where the room sits. Far enough from the hall that neither is ever in the
   other's frustum, so the two can simply be shown and hidden. */
const LOCKER_ORIGIN = new THREE.Vector3(0, 0, -220);

/* Rows stack from the top down rather than sitting at fixed heights, because
   most managers are missing at least one of them. A fixed layout left a hole
   where the trophy shelf would have been for anyone who has never reached a
   final; stacking closes the gap and every wall comes out composed. */
const WALL_TOP = 6.3;
const ROW_GAP = 0.34;
const CAPTION_DROP = 0.28;

const SIZE = {
  flagHalf: 0.80,
  pennant: 0.62,
  trophy: 0.90,
  bowl: 0.46,
  plaqueHalf: 0.43,
  trophyScale: 0.44,
  bowlScale: 1.1,
  plaqueScale: 0.66
};

const WALL_Z = -0.55;

/* How far the panelling reaches above the floor line in each shape, and how far
   it drops below it so the room has no seam at the skirting. Both carry a
   couple of rows of headroom over the fullest wall in the league today, because
   a manager who reaches the bracket once more gains a whole row of pennants in
   a single season and the panel is not rebuilt for it. */
const PANEL = { wide: 10.5, narrow: 14.5, below: 1 };

/* Pennant cloth. Every berth flies the same blue so a wall reads at a glance
   as "five Januaries in the bracket"; a division crown flies gold. */
const PENNANT_BLUE = "#2a5fcc";
const PENNANT_GOLD = "#7a5205";

/* The wash on each honour's year plate: gold under a star, red under a ribbon,
   so the plate belongs to the badge above it rather than to the team. */
const STAR_PLATE = "#e0aa2c";
const RIBBON_PLATE = "#c8102e";

/* How wide each row of the unfolded wall is allowed to run, and how wide its
   fittings are cut. The folded wall is not a narrower version of this — it is
   laid out in columns instead of rows, and takes its measurements from COLUMN
   below. All the two share is the pool of light on the floor in front. */
const ROWS = { pennants: 6, trophies: 5, plaques: 6, shelf: 4.6, flag: 1 };
const POOL = { wide: 7, narrow: 4.6 };

/* How wide the team flag is at full size, rod and all — the number the folded
   wall divides by to cut one down to its grid. */
const FLAG_WIDTH = 3.35;

/* One cell of the folded wall's grid, and how far each kind of piece is scaled
   down to sit inside one.

   The columns are set much further apart than a piece is wide. Every piece on
   this wall is taller than it is wide, so what a cell can hold is decided by its
   height and never by its width — spreading the columns costs nothing and is
   what stops three columns of small things reading as one narrow stripe down the
   middle of a phone. */
const COLUMN = {
  pitch: 1.32,   // across, from one column to the next
  drop: 1.16,    // down, from one cell to the next
  pennant: 1.3,  // before the cell takes it in — a berth is read before anything
  trophy: 0.9,   // on top of whatever the shelf scale already is
  plaque: 0.82
};

/* The air around a piece inside its cell. Without it two neighbours can be
   exactly the height of the gap between them and still read as touching. */
const CELL_PAD = 0.14;

/* How much bigger a berth's pennant is than it used to be on an unfolded wall,
   now that the two honour rows have folded onto its corners and left the room. */
const PENNANT_BIG = 1.45;

/* A star or a ribbon pinned to a pennant's post: how wide it is against the
   pennant, how far in from the pennant's edge the pin sits and how far down from
   its top, all as fractions of the pennant as built — so one set of numbers does
   for a pennant at full size on a desktop wall and one cut to a cell on a
   phone. */
const BADGE = { span: 0.52, post: 0.62, drop: 0.15, out: 0.12 };

/* The top of the room's wainscot rail, and the line the wall's contents stop
   at. Rows stack downward, so a manager with all five of them reaches furthest
   down — far enough that the brass rail cut through the bottom row of plaques. */
const TRIM_TOP = 0.39;
const WALL_FLOOR = TRIM_TOP + 0.24;

const ordinal = (n) => {
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n] || "th";
  return `${n}${suffix}`;
};

/* Lays out n items across a row, wrapping at `perRow`, and returns a position
   for each. Rows centre themselves, so one item sits in the middle rather than
   at the left edge. */
function spread(count, { perRow, gap, top, rowGap }) {
  const spots = [];
  const rows = Math.ceil(count / perRow);
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / perRow);
    const inRow = Math.min(perRow, count - row * perRow);
    const column = index - row * perRow;
    spots.push({
      x: (column - (inRow - 1) / 2) * gap,
      y: top - row * rowGap,
      row,
      rows
    });
  }
  return spots;
}

/* The room the wall stands in: a back wall, a floor, and enough side wall to
   stop the frame falling off into black. */
export function buildLockerRoom(scene) {
  const mat = materials();
  const room = new THREE.Group();
  room.position.copy(LOCKER_ORIGIN);
  room.visible = false;

  const panelling = mat.textures.darkMarble.clone();
  panelling.needsUpdate = true;

  // Tall enough for the fullest wall in the league. The composition stacks
  // downward and is then lifted clear of the wainscot, so every row a manager
  // has pushes their flag higher — and a nine-metre panel left the flag of a
  // manager with all five rows hanging in the black above the panelling. A
  // folded wall is taller again, so the panel is cut to whichever shape the
  // room is currently showing.
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(13, 1),
    new THREE.MeshStandardMaterial({
      map: panelling, color: 0x6a7d96, metalness: 0.3, roughness: 0.55,
      envMap: mat.envMap, envMapIntensity: 0.7
    })
  );
  back.userData.part = "panel";
  room.add(back);

  // A wainscot and a rail, so the wall has a floor line to sit on.
  const wainscotTexture = mat.textures.walnut.clone();
  wainscotTexture.needsUpdate = true;
  wainscotTexture.repeat.set(6, 1);
  const wainscot = new THREE.Mesh(
    new THREE.BoxGeometry(13, 0.34, 0.22),
    new THREE.MeshStandardMaterial({
      map: wainscotTexture, color: 0x6d5539, metalness: 0.15, roughness: 0.64,
      envMap: mat.envMap, envMapIntensity: 0.4
    })
  );
  wainscot.position.set(0, 0.17, WALL_Z + 0.06);
  wainscot.userData.part = "wainscot";
  const rail = new THREE.Mesh(new THREE.BoxGeometry(13, 0.06, 0.3), mat.brass);
  rail.position.set(0, 0.36, WALL_Z + 0.1);
  rail.userData.part = "rail";
  room.add(wainscot, rail);

  const floorTexture = mat.textures.darkMarble.clone();
  floorTexture.needsUpdate = true;
  floorTexture.repeat.set(5, 3);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(13, 8),
    new THREE.MeshStandardMaterial({
      map: floorTexture, color: 0x8ea4bd, metalness: 0.75, roughness: 0.18,
      envMap: mat.envMap, envMapIntensity: 2.0
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, WALL_Z + 3.9);
  room.add(floor);

  // A ceiling cove and two wall washes: broad even light, because a wall is
  // read all at once rather than one plinth at a time.
  // Kept well above the top of anything on the wall: at head height it showed
  // through the frame as a bright bar behind the header text.
  const cove = new THREE.Mesh(
    new THREE.PlaneGeometry(11, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0 })
  );
  room.add(cove);

  const washes = [];
  for (const x of [-3.4, 3.4]) {
    const wash = new THREE.SpotLight(0xfff0d4, 58, 26, 1.0, 0.85, 1.2);
    wash.position.set(x, 6.2, WALL_Z + 4.6);
    wash.target.position.set(x * 0.5, 2.6, WALL_Z);
    room.add(wash, wash.target);
    washes.push(wash);
  }
  const front = new THREE.PointLight(0xffe9c8, 26, 22, 1.5);
  front.position.set(0, 3.0, WALL_Z + 5.4);
  room.add(front);
  const ambient = new THREE.HemisphereLight(0xbcd4ff, 0x2a1a10, 0.95);
  room.add(ambient);

  /* Cuts the room to the shape of wall about to stand against it. A folded wall
     runs half as tall again as an unfolded one, and the panelling, the cove and
     the two washes all have to reach that far. Called before a wall is built
     rather than every frame — the shapes only swap when the viewport crosses
     the breakpoint. */
  const setNarrow = (narrow) => {
    const height = narrow ? PANEL.narrow : PANEL.wide;
    back.geometry.dispose();
    back.geometry = new THREE.PlaneGeometry(13, height + PANEL.below);
    back.position.set(0, (height - PANEL.below) / 2, WALL_Z - 0.1);
    panelling.repeat.set(4, (height + PANEL.below) * 0.27);
    // The cove is a bright bar, not a light. It only has to stay above
    // everything on the wall, or it reads as a strip light behind the flag.
    cove.position.set(0, height + 0.6, WALL_Z + 0.6);

    /* A folded wall is read a screenful at a time on the way down it, so the
       light has to cover all of it evenly. Two spots aimed at the middle of a
       thirteen-metre wall only burn a hole in it: the hot spot blew a gold star
       out to white while the flag four metres above it sat in the dark. Wide
       open, further back, much weaker, and most of the work handed to the
       ambient instead. */
    washes.forEach((wash, index) => {
      const x = index === 0 ? -3.4 : 3.4;
      wash.position.set(narrow ? x * 0.7 : x, narrow ? 7.0 : 6.2, WALL_Z + (narrow ? 7.5 : 4.6));
      wash.target.position.set(x * (narrow ? 0.25 : 0.5), narrow ? 6.5 : 2.6, WALL_Z);
      wash.target.updateMatrixWorld();
      wash.angle = narrow ? 1.35 : 1.0;
      wash.penumbra = narrow ? 1 : 0.85;
      wash.distance = narrow ? 48 : 26;
      wash.intensity = narrow ? 30 : 58;
    });
    front.position.set(0, narrow ? 6.5 : 3.0, WALL_Z + (narrow ? 8 : 5.4));
    front.distance = narrow ? 48 : 22;
    front.intensity = narrow ? 22 : 26;
    ambient.intensity = narrow ? 2.1 : 0.95;
  };
  setNarrow(false);

  scene.add(room);
  return { room, lights: [...washes, front, ambient], setNarrow };
}

/* Builds one manager's wall into `room`, and hands back the pieces the camera
   and the pointer need: what can be clicked, and how big the wall came out. */
export function buildLockerWall(room, locker, { narrow = false, aspect = 1.2 } = {}) {
  const mat = materials();
  const wall = new THREE.Group();
  const items = [];
  const perishable = [];

  // Anything cut for this one manager is thrown away when they close.
  const track = (node) => {
    node.traverse((child) => {
      if (child.isMesh || child.isSprite) {
        perishable.push(child.geometry);
        (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => {
          perishable.push(material);
          if (material.map) perishable.push(material.map);
        });
      }
    });
    return node;
  };

  const accent = locker.color;

  /* Hangs one piece on the wall. The holder sits where the piece goes; the
     spinner inside it is pivoted on the piece's own centre, so inspecting a
     trophy turns it in place instead of swinging it around its foot.

     Turning a piece sweeps a sphere around that centre, and a wall has two
     surfaces close enough to be caught by it: the panelling behind, and the
     shelf underneath anything standing on one. So each piece works out how far
     it must come forward and lift to turn freely — and where coming forward
     far enough would fly it at the viewer, as it would for a banner three
     metres wide, how far it may turn instead. */
  const CLEAR = 0.06;
  const MAX_PUSH = 0.45;
  const wallFace = WALL_Z - 0.1;

  const mount = (object, x, y, z, meta, { standsOn = null } = {}) => {
    object.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(object);
    const localCentre = bounds.getCenter(new THREE.Vector3());
    const half = bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);

    const spinner = new THREE.Group();
    spinner.position.copy(localCentre);
    object.position.sub(localCentre);
    spinner.add(object);

    // A piece stands on its own underside, not on its origin. Several are
    // modelled with a bevelled base that reaches below y=0, and trusting the
    // origin sank them a couple of centimetres into the shelf.
    const seatY = standsOn === null ? y : standsOn - bounds.min.y;

    const holder = new THREE.Group();
    holder.position.set(x, seatY, z);
    holder.add(spinner);

    // Where the piece turns about, and how far its corners reach from there.
    const centreZ = z + localCentre.z;
    const centreY = seatY + localCentre.y;
    const sweep = half.length();

    const push = Math.min(MAX_PUSH, Math.max(0, sweep - (centreZ - wallFace) + CLEAR));
    const lift = standsOn === null
      ? 0
      : Math.max(0, sweep - (centreY - standsOn) + CLEAR);

    // Whatever depth is left once it has come forward decides how far it turns.
    const room = centreZ + push - wallFace - CLEAR;
    const limit = (reachAcross, reachDeep) => {
      const reach = Math.hypot(reachAcross, reachDeep);
      if (reach <= room) return Infinity;
      return Math.max(0.08, Math.asin(Math.min(1, room / reach)) - Math.atan2(reachDeep, reachAcross));
    };

    holder.userData.locker = meta;
    holder.userData.spinner = spinner;
    holder.userData.home = holder.position.clone();
    holder.userData.present = {
      push,
      lift,
      yaw: limit(half.x, half.z),
      pitch: limit(half.y, half.z)
    };
    wall.add(track(holder));
    items.push(holder);
    return holder;
  };
  // Captions take a lifted version of the team's colour: the raw one is too
  // close to the wall behind it for the darker teams.
  const captionInk = mix(accent, "#ffffff", 0.55);
  const label = (text, x, y, width = 2.0) => {
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(width, width * 0.09),
      new THREE.MeshBasicMaterial({
        map: sectionLabelTexture(text, captionInk), transparent: true, depthWrite: false
      })
    );
    plate.position.set(x, y, WALL_Z + 0.06);
    plate.userData.part = `caption:${text}`;
    wall.add(track(plate));
  };

  /* ---------------------------------------------------- what goes on the wall */

  /* Every piece the wall can carry, in the order a trophy case fills up, each
     with the words it says when it is tapped and a builder that makes it at
     whatever size the composition has room for.

     Gathering them before hanging any of them is what lets the same set go up
     two ways. A desktop wall hangs them in rows: it has width to spare and a
     viewer who reads left to right. A phone's wall hangs them in columns: it
     has height to spare instead, and a viewer who wants the whole case in one
     look rather than a wall to scroll. */
  const honourPiece = (honour, { compact = false } = {}) => ({
    kind: honour.kind,
    hangs: true,
    build: (scale) => {
      const badge = honour.kind === "star"
        ? buildScoringStar({ year: honour.year, accent: STAR_PLATE }, { compact })
        : buildWinsRibbon({ year: honour.year, accent: RIBBON_PLATE }, { compact });
      badge.scale.setScalar(scale);
      return badge;
    },
    meta: {
      id: honour.id,
      kind: honour.kind,
      title: honour.title,
      subtitle: honour.subtitle,
      blurb: honour.blurb,
      stats: honour.stats,
      links: [{ label: `${honour.year} Season`, href: window.League.url("season", { season: honour.year }) }]
    }
  });

  const pennantPiece = (berth) => ({
    kind: "pennant",
    hangs: true,
    // The star for that season on the left post, the ribbon on the right.
    badges: [
      ...(berth.star ? [{ side: -1, piece: honourPiece(berth.star, { compact: true }) }] : []),
      ...(berth.ribbon ? [{ side: 1, piece: honourPiece(berth.ribbon, { compact: true }) }] : [])
    ],
    build: (scale) => {
      const pennant = buildPennant({
        year: berth.year,
        // Pennant cloth says what the berth was, not who won it: league blue
        // for a berth, gold for a division crown. The team's own colour is
        // already everywhere else on the wall, and using it here meant a row
        // of pennants only ever told you whose locker you were standing in.
        cloth: berth.division ? PENNANT_GOLD : PENNANT_BLUE,
        crown: berth.division,
        note: berth.division ? "DIVISION CHAMPS" : "PLAYOFFS"
      });
      pennant.scale.setScalar(scale);
      return pennant;
    },
    meta: {
      id: `berth-${berth.year}`,
      kind: "pennant",
      title: berth.division ? `${berth.year} Division Champs` : `${berth.year} Playoffs`,
      subtitle: berth.team.name,
      blurb: berth.division
        ? `${locker.name} topped their division in ${berth.year} at ${berth.team.wins}–${berth.team.losses}${berth.bye ? " and sat out the first round" : ""}.`
        : `${locker.name} reached the ${berth.year} bracket with ${berth.team.name}, ${berth.team.wins}–${berth.team.losses} in the regular season.`,
      stats: [
        { label: "Record", value: `${berth.team.wins}–${berth.team.losses}` },
        { label: "Points For", value: berth.team.pf.toFixed(2) },
        { label: "Finish", value: `${berth.team.finalRank}` },
        { label: "Reached", value: berth.reached },
        ...(berth.bye ? [{ label: "First Round", value: "Bye" }] : [])
      ],
      links: [{ label: `${berth.year} Season`, href: window.League.url("season", { season: berth.year }) }]
    }
  });

  const PLACE = { 1: "Champion", 2: "Runner-up", 3: "Third place" };
  const trophyPiece = (entry) => ({
    kind: entry.place === 1 ? "title" : "bowl",
    stands: true,
    build: (scale) => {
      let object;
      if (entry.place === 1) {
        object = buildLeagueTrophy({
          year: entry.year,
          color: accent,
          // Without an ownerId the crest on the bowl falls back to the
          // manager's emoji, which is what every locker trophy was wearing.
          ownerId: locker.ownerId,
          icon: locker.icon,
          subtitle: locker.team,
          accent
        });
        object.scale.setScalar(SIZE.trophyScale * scale);
      } else {
        object = buildPodiumBowl({ year: entry.year, metal: entry.metal, accent });
        object.scale.setScalar(SIZE.bowlScale * scale);
      }
      return object;
    },
    meta: {
      id: `place-${entry.year}`,
      kind: entry.place === 1 ? "title" : "bowl",
      title: `${entry.year} ${PLACE[entry.place]}`,
      subtitle: entry.team.name,
      blurb: entry.lost
        ? `${locker.name} won the ${entry.year} league title. The season's box scores did not survive.`
        : `${locker.name} finished ${ordinal(entry.place)} of ${entry.size} in ${entry.year} at ${entry.team.wins}–${entry.team.losses}.`,
      stats: entry.lost ? [] : [
        { label: "Record", value: `${entry.team.wins}–${entry.team.losses}` },
        { label: "Points For", value: entry.team.pf.toFixed(2) },
        { label: "Points Against", value: entry.team.pa.toFixed(2) }
      ],
      links: [{ label: `${entry.year} Season`, href: window.League.url("season", { season: entry.year }) }]
    }
  });

  const plaquePiece = (entry) => ({
    kind: "plaque",
    build: (scale) => {
      const plaque = buildPlaque({
        title: entry.title,
        subtitle: entry.bigValue,
        bigValue: entry.bigValue,
        meta: entry.meta,
        accent,
        color: accent,
        icon: locker.icon,
        ownerId: locker.ownerId
      }, { mounted: true });
      plaque.scale.setScalar(SIZE.plaqueScale * scale);
      return plaque;
    },
    meta: {
      id: `plaque-${entry.id}`,
      kind: "plaque",
      title: entry.title,
      subtitle: entry.bigValue,
      meta: entry.meta,
      blurb: entry.blurb,
      stats: entry.stats,
      links: []
    }
  });

  /* The berths carry the season's honours on their own corners, so there is no
     row of stars and no row of ribbons: an honour whose season never reached the
     bracket has no pennant to sit on and joins the berths as a piece in its own
     right, which is the only way one ever appears on its own. */
  const sections = [
    {
      id: "pennants",
      caption: "PLAYOFF BERTHS",
      pieces: [...locker.berths.map(pennantPiece), ...locker.looseHonours.map((honour) => honourPiece(honour))]
    },
    { id: "trophies", caption: "TROPHIES", pieces: locker.trophies.map(trophyPiece), always: true },
    { id: "plaques", caption: "PERSONAL BESTS", pieces: locker.plaques.map(plaquePiece) }
  ];
  const sectionOf = (id) => sections.find((section) => section.id === id);

  /* A shelf, with its top surface at `topY` — which is the line whatever stands
     on it is seated on. A long one down a wall carries a case of trophies; a
     short one carries exactly one, which is what a column of them is made of. */
  const hangShelf = (centreX, width, topY, { depth = 0.62, thickness = 0.11 } = {}) => {
    const geometry = roundedBox(width, thickness, depth, Math.min(0.03, thickness / 3));
    geometry.computeBoundingBox();
    const lift = geometry.boundingBox.max.y;
    const shelf = new THREE.Mesh(geometry, mat.darkMarble);
    shelf.position.set(centreX, topY - lift, WALL_Z + 0.32);
    const long = width > 1.4;
    const edge = new THREE.Mesh(
      roundedBox(width + 0.04, long ? 0.022 : 0.012, depth + 0.04, 0.008),
      long ? teamMetal(accent, { emissive: 0.5 }) : mat.brass
    );
    edge.position.set(centreX, topY - lift - thickness * 0.56, WALL_Z + 0.32);
    shelf.userData.part = "shelf";
    edge.userData.part = "shelfEdge";
    wall.add(track(shelf), track(edge));

    /* Three brackets under a long shelf and none under a short one. A single
       bracket under a shelf the width of one trophy reads as a post holding the
       trophy up rather than as a bracket holding the shelf. */
    if (!long) return;
    for (const x of [-(width / 2 - 0.2), 0, width / 2 - 0.2]) {
      const bracket = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.2, 10), mat.brass);
      bracket.position.set(centreX + x, topY - lift - thickness * 0.5 - 0.1, WALL_Z + 0.14);
      bracket.userData.part = "bracket";
      wall.add(track(bracket));
    }
  };

  /* Hangs one piece, then pins whatever belongs to it on its own top corners.

     A star and a ribbon are won over a season, and the pennant for that season
     is already on the wall saying which season it was — so rather than taking a
     row of their own they sit on its two posts, the star on the left and the
     ribbon on the right. They are mounted separately from the pennant, not
     built into it, because each is still its own thing to tap.

     Both the pin's size and where it goes are measured off the piece as built,
     so the same line works for a pennant at full size on a desktop wall and one
     cut to a cell on a phone. */
  const measure = (object) => {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    return { centre: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()) };
  };

  const hangPiece = (piece, object, x, y, z) => {
    /* Everything is placed by where it looks like it is, not by where its
       origin happens to be. A pennant is modelled hanging off its rail and a
       plaque around its own middle, so mounting both at the same point put one
       of them half its own height below the other. Measuring first and offsetting
       by the difference lands every piece dead centre on the slot it was given,
       whatever it is. */
    const { centre, size } = measure(object);
    const holder = mount(object, x - centre.x, y - centre.y, z, piece.meta);

    (piece.badges || []).forEach(({ side, piece: badge }) => {
      const pin = badge.build(1);
      const natural = measure(pin);
      pin.scale.multiplyScalar((size.x * BADGE.span) / Math.max(0.001, natural.size.x));
      const pinned = measure(pin);
      mount(
        pin,
        x + side * size.x * BADGE.post - pinned.centre.x,
        y + size.y * (0.5 - BADGE.drop) - pinned.centre.y,
        z + BADGE.out,
        badge.meta
      );
    });
    return holder;
  };

  /* ------------------------------------------------------------------ flag */
  let cursor = WALL_TOP;

  /* The team's colours across the top, at whatever size the wall below it came
     out. On an unfolded wall that is full size; on a folded one it is cut to the
     width of the grid, because a flag wider than everything it introduces reads
     as the wall's frame rather than as the first thing on it. */
  const hangFlag = (scale) => {
    const flag = buildTeamFlag(locker);
    flag.scale.setScalar(scale);
    const half = SIZE.flagHalf * scale;
    mount(flag, 0, cursor - half - 0.12, WALL_Z + 0.14, {
      id: "flag",
      kind: "flag",
      title: locker.team,
      subtitle: locker.name,
      blurb: `${locker.name} has run ${locker.team} for ${locker.seasons.length} ${locker.seasons.length === 1 ? "season" : "seasons"}. ${locker.summary}.`,
      stats: locker.stats,
      links: [{ label: "Full Profile", href: window.League.url("alltime", {}, `owner=${encodeURIComponent(locker.ownerId)}`) }]
    });
    cursor -= half * 2 + 0.12 + (narrow ? 0.22 : ROW_GAP);
  };

  if (narrow) layoutColumns(); else layoutRows();

  /* ------------------------------------------------------------------ rows */

  /* The unfolded wall: one band per kind of thing, stacked in the order a
     trophy case fills up, each band with its own heading. */
  function layoutRows() {
    hangFlag(ROWS.flag);

    /* One band of one kind of thing. `drop` is how much height a row of them
       takes, and everything is hung by its middle inside that band — `mount`
       centres a piece on the point it is given, so hanging a pennant from the
       top of its band put half a pennant's worth of it back up through the
       heading above. */
    const hangRow = (pieces, { perRow, gap, drop, rowGap, caption, gapAfter = ROW_GAP, z = 0.2, scale = 1 }) => {
      if (!pieces.length) return;
      if (caption) label(caption, 0, cursor, 1.9);
      const top = caption ? cursor - CAPTION_DROP : cursor;
      const spots = spread(pieces.length, { perRow, gap, top, rowGap: drop + rowGap });
      pieces.forEach((piece, index) => {
        hangPiece(piece, piece.build(scale), spots[index].x, spots[index].y - drop / 2, WALL_Z + z);
      });
      const rows = Math.ceil(pieces.length / perRow);
      cursor = top - rows * drop - (rows - 1) * rowGap - gapAfter;
    };

    /* The berths run bigger than they used to. They are the row a wall is read
       by — one a January — and with the two honour rows folded onto their
       corners there is the height to give them. */
    hangRow(sectionOf("pennants").pieces, {
      perRow: ROWS.pennants, gap: 0.88, drop: SIZE.pennant * PENNANT_BIG + 0.16, rowGap: 0.24,
      caption: "PLAYOFF BERTHS", scale: PENNANT_BIG
    });

    /* The shelf is always here, stocked or bare. A manager with nothing on it
       should see the space their trophies are going to occupy — and a manager
       with more than one shelf's worth gets a second shelf rather than a second
       row of trophies standing in mid-air on top of the first. */
    {
      const trophies = sectionOf("trophies").pieces;
      label("TROPHIES", 0, cursor, 1.9);
      const hasTitle = locker.trophies.some((entry) => entry.place === 1);
      const tallest = hasTitle ? SIZE.trophy : SIZE.bowl;
      const rowGap = tallest + 0.28;
      const rows = Math.max(1, Math.ceil(trophies.length / ROWS.trophies));
      const firstY = cursor - CAPTION_DROP - tallest;

      for (let row = 0; row < rows; row += 1) hangShelf(0, ROWS.shelf, firstY - row * rowGap);

      const spots = spread(trophies.length, {
        perRow: ROWS.trophies, gap: hasTitle ? 0.92 : 0.74, top: firstY, rowGap
      });
      trophies.forEach((piece, index) => {
        mount(piece.build(1), spots[index].x, spots[index].y, WALL_Z + 0.34, piece.meta, {
          standsOn: spots[index].y
        });
      });

      cursor = firstY - (rows - 1) * rowGap - 0.16 - ROW_GAP;
    }

    hangRow(sectionOf("plaques").pieces, {
      perRow: ROWS.plaques, gap: 0.90, drop: SIZE.plaqueHalf * 2, rowGap: 0.2,
      caption: "PERSONAL BESTS", z: 0.14
    });
  }

  /* --------------------------------------------------------------- columns */

  /* The folded wall: three columns and, above them, the season's honours in
     rows.

     One column per kind of thing — berths, trophies, personal bests — reading
     down, so a glance across the wall is a glance at what sort of career this
     is. One piece to a cell and never two in one, whatever a manager has.

     The stars and the ribbons go across the top instead of down a column of
     their own, three to a row on the columns' own centre lines and a new row
     when there are more than three, because they are the one thing a manager
     collects a few of rather than one a season.

     Everything is on the screen at once. That is the point of folding it — a
     phone that has to be scrolled to find out whether a manager has a trophy is
     a phone that never gets scrolled. What it costs is size: six personal bests
     down a column is six rows deep however wide the phone is, and a piece comes
     out about a third of what it is on a desktop wall. Reading a plaque means
     tapping it, which is what tapping it has always been for. */
  function layoutColumns() {
    const lanes = [
      sectionOf("pennants").pieces,
      sectionOf("trophies").pieces,
      sectionOf("plaques").pieces
    ].filter((lane) => lane.length);

    if (!lanes.length) {
      hangFlag(0.7);
      return;
    }

    const across = Math.max(1, lanes.length);
    const laneX = (index) => (index - (across - 1) / 2) * COLUMN.pitch;

    // The flag is cut to the width of the columns under it and held to one row's
    // worth of height, so it introduces the case rather than crowding it.
    const width = across * COLUMN.pitch;
    hangFlag(Math.min(COLUMN.drop * 1.02 / (SIZE.flagHalf * 2), (width * 0.66) / FLAG_WIDTH));

    /* Nothing may grow out of its cell. The pieces are modelled at whatever size
       suited a wall with room to spread — a pennant is nearly twice a plaque's
       height — so each is measured once it is built and taken in if it does not
       fit. Trusting a scale per kind instead was what put the point of a
       one-berth manager's only pennant through the top of the plaque under it. */
    const fitCell = (object, height = COLUMN.drop) => {
      object.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
      const room = Math.min(
        (COLUMN.pitch - CELL_PAD * 2) / Math.max(0.001, size.x),
        (height - CELL_PAD) / Math.max(0.001, size.y),
        1
      );
      if (room < 1) object.scale.multiplyScalar(room);
      return object;
    };

    const hangInCell = (piece, x, cellTop) => {
      if (piece.stands) {
        // Its own shelf, because a column of trophies standing on one shelf is a
        // column of trophies standing on nothing.
        const trophy = fitCell(piece.build(COLUMN.trophy), COLUMN.drop - 0.2);
        trophy.updateMatrixWorld(true);
        const span = new THREE.Box3().setFromObject(trophy).getSize(new THREE.Vector3()).x;
        const shelfY = cellTop - COLUMN.drop + 0.14;
        // A shelf a little wider than what stands on it, rather than the width of
        // the whole column: a cup on a shelf three times its width is a cup that
        // has been left on a windowsill.
        hangShelf(x, Math.max(0.34, span * 1.5), shelfY, { depth: 0.36, thickness: 0.05 });
        mount(trophy, x, shelfY, WALL_Z + 0.34, piece.meta, { standsOn: shelfY });
        return;
      }
      // Everything else is centred in its cell: `mount` hangs a piece by its own
      // middle, so one line does for a pennant, a rosette and a plaque however
      // differently each of them is modelled.
      const scale = piece.hangs ? COLUMN.pennant : COLUMN.plaque;
      const z = piece.hangs ? WALL_Z + 0.2 : WALL_Z + 0.14;
      hangPiece(piece, fitCell(piece.build(scale)), x, cellTop - COLUMN.drop / 2, z);
    };

    /* ------------------------------------------------------------- columns */
    const top = cursor;
    let deepest = 0;
    lanes.forEach((lane, index) => {
      lane.forEach((piece, row) => hangInCell(piece, laneX(index), top - row * COLUMN.drop));
      deepest = Math.max(deepest, lane.length);
    });

    cursor = top - deepest * COLUMN.drop;
  }

  /* Nothing on the wall may come down into the wainscot. Lift the whole
     composition to the floor line rather than moving the trim, which is what
     gives the room its floor to stand on. */
  wall.updateMatrixWorld(true);
  const reach = new THREE.Box3();
  items.forEach((holder) => reach.expandByObject(holder));
  const floorLift = Math.max(0, WALL_FLOOR - reach.min.y);
  wall.position.y = floorLift;

  // A pool of the team's colour on the floor in front of the wall.
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(narrow ? POOL.narrow : POOL.wide, 3.4),
    new THREE.MeshBasicMaterial({
      map: radialTexture(), color: new THREE.Color(accent),
      transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false
    })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, 0.02 - floorLift, WALL_Z + 1.6);
  wall.add(track(pool));

  room.add(wall);
  wall.updateMatrixWorld(true);

  // Measure each piece where it ended up, so inspecting one needs no guesswork.
  items.forEach((holder) => {
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    holder.userData.frame = {
      centre: box.getCenter(new THREE.Vector3()),
      halfWidth: Math.hypot(size.x, size.z) / 2,
      halfHeight: size.y / 2
    };
  });

  // What the camera has to hold: the pieces themselves. Measuring the whole
  // wall would include the pool of light lying across the floor, which is
  // three metres deep and would push the camera back into the next room.
  const bounds = new THREE.Box3();
  items.forEach((holder) => bounds.expandByObject(holder));
  const size = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());

  return {
    wall,
    items,
    centre,
    size,
    narrow,
    dispose() {
      room.remove(wall);
      perishable.forEach((resource) => resource.dispose?.());
    }
  };
}

/* The small caption over each row. Drawn rather than modelled: it is a label,
   not an object, and it should not be clickable. */
function sectionLabelTexture(text, accent) {
  const element = document.createElement("canvas");
  element.width = 1024;
  element.height = 92;
  const ctx = element.getContext("2d");
  ctx.clearRect(0, 0, 1024, 92);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '700 46px "Barlow Condensed", Inter, system-ui, sans-serif';
  ctx.letterSpacing = "14px";
  ctx.fillStyle = "rgba(0,0,0,.6)";
  ctx.fillText(text, 512, 50);
  ctx.fillStyle = accent;
  ctx.fillText(text, 512, 46);

  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
