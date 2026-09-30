/* Every object in the hall is built from three.js primitives at load time —
   lathed cups, extruded stars, hexagonal marble. No model files, so the whole
   room is a few hundred lines of geometry and it streams instantly.

   Each builder returns a Group whose origin sits on the surface it stands on,
   and tags itself with the framing hints the camera needs to inspect it:
     userData.focusHeight — where the object's visual centre is
     userData.focusRadius — how far back the camera has to sit to hold it
     userData.spin        — parts that turn on their own
     userData.glints      — points that catch an additive sparkle */

import * as THREE from "three";
import {
  crestTexture, marbleTexture, mix, nameplateTexture, pennantTexture, recordFaceTexture,
  teamFlagTexture, teamPlaqueTexture, woodTexture, yearPlateTexture
} from "./textures.js";

const TAU = Math.PI * 2;

let shared = null;

export function initMaterials({ envMap, quality }) {
  const marble = new THREE.CanvasTexture(marbleTexture());
  marble.colorSpace = THREE.SRGBColorSpace;
  marble.wrapS = marble.wrapT = THREE.RepeatWrapping;

  const darkMarble = new THREE.CanvasTexture(marbleTexture({ base: "#0b1220", vein: "#22344b", glow: "#132132" }));
  darkMarble.colorSpace = THREE.SRGBColorSpace;
  darkMarble.wrapS = darkMarble.wrapT = THREE.RepeatWrapping;

  const walnut = new THREE.CanvasTexture(woodTexture());
  walnut.colorSpace = THREE.SRGBColorSpace;
  walnut.wrapS = walnut.wrapT = THREE.RepeatWrapping;

  // The lowlight boards get their own cold grain rather than the walnut tinted
  // blue: multiplying a warm brown by a cool colour only makes mud, and under
  // the hall's key light it came back looking like brass anyway.
  const slate = new THREE.CanvasTexture(woodTexture({
    base: "#242c38", grain: "#11161e", highlight: "#3b4757"
  }));
  slate.colorSpace = THREE.SRGBColorSpace;
  slate.wrapS = slate.wrapT = THREE.RepeatWrapping;

  const metal = (color, roughness, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, metalness: 1, roughness, envMap, envMapIntensity: 2.3, ...extra });

  shared = {
    envMap,
    quality,
    gold: metal(0xffc964, 0.14),
    goldWarm: metal(0xe8a53c, 0.24),
    goldDark: metal(0x8a6420, 0.38),
    brass: metal(0xd8b46a, 0.28),
    silver: metal(0xd6dde6, 0.16),
    // The league trophy's own three materials: mirror chrome for the cup and
    // its fittings, anodised blue for the columns, and the glossy black of the
    // base and shelf.
    chrome: metal(0xeef3f8, 0.05),
    columnBlue: new THREE.MeshStandardMaterial({
      color: 0x2f63e8, metalness: 0.5, roughness: 0.2,
      emissive: 0x102a72, emissiveIntensity: 0.5,
      envMap, envMapIntensity: 1.2
    }),
    trophyBlack: new THREE.MeshStandardMaterial({
      color: 0x0d1117, metalness: 0.45, roughness: 0.3, envMap, envMapIntensity: 1.1
    }),
    pewter: metal(0x7d8794, 0.34),
    bronze: metal(0x9a6a38, 0.32),
    tarnish: metal(0x6d6553, 0.55),
    porcelain: new THREE.MeshStandardMaterial({
      color: 0xf2f6f9, metalness: 0.04, roughness: 0.1, envMap, envMapIntensity: 1.2
    }),
    marble: new THREE.MeshStandardMaterial({
      map: marble, color: 0xffffff, metalness: 0.2, roughness: 0.42, envMap, envMapIntensity: 0.7
    }),
    darkMarble: new THREE.MeshStandardMaterial({
      map: darkMarble, color: 0xffffff, metalness: 0.3, roughness: 0.38, envMap, envMapIntensity: 0.8
    }),
    walnut: new THREE.MeshStandardMaterial({
      map: walnut, color: 0xd8b184, metalness: 0.12, roughness: 0.52, envMap, envMapIntensity: 0.55
    }),
    slate: new THREE.MeshStandardMaterial({
      map: slate, color: 0xb8c6d8, metalness: 0.16, roughness: 0.58, envMap, envMapIntensity: 0.5
    }),
    velvet: new THREE.MeshStandardMaterial({ color: 0x2a1421, metalness: 0, roughness: 0.95 }),
    textures: { marble, darkMarble, walnut, slate }
  };

  return shared;
}

export function materials() {
  return shared;
}

/* A team's colour in metal, cached so ten exhibits sharing a palette share a
   material. `metalness` is the dial that matters: at 0.95 the colour only tints
   reflections, which is right for a thin accent ring but turns a broad face
   into a white mirror. Large surfaces ask for painted metal instead — enough
   metalness to catch the room, enough diffuse to stay the team's colour. */
const teamMetalCache = new Map();
export function teamMetal(color, { roughness = 0.26, emissive = 0.14, metalness = 0.95, lighten = 0.1 } = {}) {
  const key = `${color}:${roughness}:${emissive}:${metalness}:${lighten}`;
  if (!teamMetalCache.has(key)) {
    teamMetalCache.set(key, new THREE.MeshStandardMaterial({
      color: new THREE.Color(mix(color, "#ffffff", lighten)),
      metalness,
      roughness,
      emissive: new THREE.Color(color),
      emissiveIntensity: emissive,
      envMap: shared.envMap,
      envMapIntensity: metalness > 0.8 ? 1.4 : 0.5
    }));
  }
  return teamMetalCache.get(key);
}

const crestCache = new Map();
function crestMaterial(item, label) {
  const key = `${item.ownerId || item.id}:${label || ""}`;
  if (!crestCache.has(key)) {
    crestCache.set(key, new THREE.MeshStandardMaterial({
      map: crestTexture({ icon: item.icon, color: item.color, label, ownerId: item.ownerId }),
      metalness: 0.15,
      roughness: 0.52,
      envMap: shared.envMap,
      envMapIntensity: 0.75,
      // A logo is painted bare on a transparent canvas, so the face has to let
      // the medallion's own metal through around it. Drawn after the opaque
      // body it sits in front of, so it composites without writing depth.
      transparent: true,
      depthWrite: false
    }));
  }
  return crestCache.get(key);
}

function lathe(points, segments = 64) {
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segments);
}

export function roundedBox(width, height, depth, radius, curve = 4) {
  const shape = new THREE.Shape();
  const w = width / 2 - radius;
  const h = height / 2 - radius;
  shape.moveTo(-w, -height / 2);
  shape.lineTo(w, -height / 2);
  shape.quadraticCurveTo(width / 2, -height / 2, width / 2, -h);
  shape.lineTo(width / 2, h);
  shape.quadraticCurveTo(width / 2, height / 2, w, height / 2);
  shape.lineTo(-w, height / 2);
  shape.quadraticCurveTo(-width / 2, height / 2, -width / 2, h);
  shape.lineTo(-width / 2, -h);
  shape.quadraticCurveTo(-width / 2, -height / 2, -w, -height / 2);

  const bevel = Math.min(depth * 0.3, radius * 0.8);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: depth - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: curve,
    curveSegments: 8
  });
  geometry.translate(0, 0, -(depth - bevel * 2) / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function starGeometry(outer = 0.1, inner = 0.045, thickness = 0.03) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 ? inner : outer;
    const angle = (i / 10) * TAU - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness * 0.5,
    bevelEnabled: true,
    bevelThickness: thickness * 0.35,
    bevelSize: thickness * 0.35,
    bevelSegments: 2
  });
  geometry.center();
  return geometry;
}

/* A disc carrying the team crest on its front face, gold on the rim and back.

   The crest is its own CircleGeometry rather than the cap of the cylinder
   behind it. A cylinder lays its cap UVs out around the axis — u follows the
   local z, v follows the local x — so standing one up to face the room
   delivers any texture on it rotated a quarter turn. A circle's UVs run
   straight across x and y, which is the orientation the crest was drawn in. */
export function crestDisc(item, { radius = 0.3, thickness = 0.055, label = null, metal = null } = {}) {
  const surround = metal || (item.tarnished ? shared.pewter : shared.gold);
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, thickness, 56),
    item.tarnished ? shared.tarnish : shared.goldWarm
  );
  body.rotation.x = Math.PI / 2;

  const face = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.995, 64),
    crestMaterial(item, label)
  );
  face.position.z = thickness / 2 + 0.002;

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 1.005, thickness * 0.44, 10, 60),
    surround
  );

  const group = new THREE.Group();
  group.add(body, face, rim);
  group.userData.crestFace = face;
  return group;
}

/* ---------------------------------------------------------------- pedestals */

let sheenMap = null;
function sheenTexture() {
  if (!sheenMap) {
    const element = document.createElement("canvas");
    element.width = 64;
    element.height = 256;
    const ctx = element.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, "rgba(255,255,255,.85)");
    gradient.addColorStop(0.45, "rgba(255,255,255,.3)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 256);
    // Pinch the sides so the streak tapers away from the plinth.
    const sides = ctx.createLinearGradient(0, 0, 64, 0);
    sides.addColorStop(0, "rgba(0,0,0,1)");
    sides.addColorStop(0.5, "rgba(0,0,0,0)");
    sides.addColorStop(1, "rgba(0,0,0,1)");
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = sides;
    ctx.fillRect(0, 0, 64, 256);
    sheenMap = new THREE.CanvasTexture(element);
  }
  return sheenMap;
}

/* A plinth is a base, a shaft and a capped top. Only the shaft's length varies,
   so it is cut to order and cached per height — it used to be a fixed 0.86,
   which meant any plinth shorter than 1.09 had marble poking out through its
   own cap. */
const pedestalGeometry = { shafts: new Map() };
function pedestalParts(shaftHeight) {
  if (!pedestalGeometry.plinth) {
    pedestalGeometry.plinth = roundedBox(1.00, 0.13, 1.00, 0.045);
    pedestalGeometry.cap = roundedBox(0.92, 0.09, 0.92, 0.03);
  }
  const key = shaftHeight.toFixed(3);
  if (!pedestalGeometry.shafts.has(key)) {
    pedestalGeometry.shafts.set(key, roundedBox(0.76, shaftHeight, 0.76, 0.035));
  }
  return { ...pedestalGeometry, shaft: pedestalGeometry.shafts.get(key) };
}

export function buildPedestal(item, { height = 1.1 } = {}) {
  const baseTop = 0.13;
  const capBottom = height - 0.09;
  const shaftHeight = Math.max(0.12, capBottom - baseTop);
  const parts = pedestalParts(shaftHeight);
  const group = new THREE.Group();

  const plinth = new THREE.Mesh(parts.plinth, shared.darkMarble);
  plinth.position.y = 0.065;
  const shaft = new THREE.Mesh(parts.shaft, shared.marble);
  shaft.position.y = baseTop + shaftHeight / 2;
  const cap = new THREE.Mesh(parts.cap, shared.darkMarble);
  cap.position.y = height - 0.045;

  // A thin band of the team's colour where the cap meets the shaft, so a
  // pedestal is identifiable from down the hall before you can read it.
  const band = new THREE.Mesh(roundedBox(0.855, 0.02, 0.855, 0.01), teamMetal(item.color, { emissive: 0.5 }));
  band.position.y = height - 0.105;

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.64, 0.16),
    new THREE.MeshStandardMaterial({
      map: nameplateTexture({
        title: item.title, sub: item.subtitle, accent: item.accent,
        metal: item.tarnished ? "pewter" : "brass"
      }),
      metalness: 0.28,
      roughness: 0.32,
      envMap: shared.envMap,
      envMapIntensity: 1.1
    })
  );
  plate.position.set(0, baseTop + shaftHeight / 2, 0.3855);

  const sheen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 2.2),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(item.color).lerp(new THREE.Color(0xffd28a), 0.6),
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: sheenTexture()
    })
  );
  sheen.rotation.x = -Math.PI / 2;
  sheen.position.set(0, 0.014, 1.42);

  group.add(plinth, shaft, cap, band, plate, sheen);
  group.userData.topY = height;
  group.userData.band = band;
  return group;
}

/* ------------------------------------------------------------------ trophies */

/* The championship cup: lathed foot, stem and bowl, two swept handles, a domed
   lid and a football finial. The team crest is mounted on the front of the bowl. */
/* The league's own trophy, measured off a photograph of it.

   Bottom to top: a stepped hexagonal base carrying a printed plate, three blue
   columns rising from it, a hexagonal shelf across their tops, and a chrome
   loving cup with scroll handles standing on that. A plaque hangs between the
   columns on a small silver bracket.

   The two printed inserts are the league's to fill: the plaque takes the
   champion's crest, the base plate takes the year.

   Everything is built at the proportions in the photo, in units where the
   whole trophy stands a shade under two metres tall in hall scale. The parts
   that never vary — base, columns, shelf, cup — are cut once and shared by all
   six trophies; only the two inserts differ. */

const TROPHY = {
  baseRadius: 0.45,
  baseTop: 0.533,
  columnTop: 1.19,
  shelfTop: 1.242,
  columnX: 0.245,
  columnZ: -0.08
};

const trophyParts = {};
function leagueTrophyParts() {
  if (trophyParts.cup) return trophyParts;

  // The cup, lathed in one piece: a flat foot, a plain cylinder, a trumpet up
  // through a knop, then the bowl. The tail of the list walks back down the
  // inside so the cup is hollow when you look into it.
  trophyParts.cup = lathe([
    [0.000, 0.000], [0.118, 0.000], [0.121, 0.016], [0.112, 0.030],
    [0.092, 0.044], [0.087, 0.055], [0.085, 0.140], [0.082, 0.198],
    [0.090, 0.207], [0.082, 0.217], [0.062, 0.250], [0.041, 0.286],
    [0.031, 0.320], [0.030, 0.358], [0.046, 0.384], [0.055, 0.406],
    [0.044, 0.430], [0.033, 0.449], [0.049, 0.470], [0.076, 0.496],
    [0.098, 0.520], [0.104, 0.534], [0.100, 0.546], [0.110, 0.560],
    [0.120, 0.596], [0.132, 0.640], [0.143, 0.684], [0.150, 0.712],
    [0.153, 0.722], [0.150, 0.729], [0.141, 0.726], [0.134, 0.694],
    [0.118, 0.624], [0.096, 0.560], [0.072, 0.522], [0.000, 0.510]
  ], 56);

  // One handle, swept so its ends finish inside the bowl wall at both heights.
  trophyParts.handle = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3([
      [0.124, 0.700], [0.180, 0.727], [0.226, 0.712], [0.248, 0.656],
      [0.236, 0.590], [0.186, 0.546], [0.092, 0.528]
    ].map(([x, y]) => new THREE.Vector3(x, y, 0))),
    30, 0.011, 8, false
  );
  trophyParts.scroll = new THREE.TorusGeometry(0.030, 0.008, 8, 22);

  trophyParts.column = new THREE.CylinderGeometry(0.037, 0.039, TROPHY.columnTop - TROPHY.baseTop, 20);
  trophyParts.shelf = new THREE.CylinderGeometry(0.37, 0.372, TROPHY.shelfTop - TROPHY.columnTop, 6);
  trophyParts.shelfLip = new THREE.CylinderGeometry(0.378, 0.378, 0.012, 6);
  trophyParts.peg = new THREE.CylinderGeometry(0.010, 0.014, 0.032, 10);

  trophyParts.baseStepLow = new THREE.CylinderGeometry(0.500, 0.503, 0.070, 6);
  trophyParts.baseStepMid = new THREE.CylinderGeometry(0.474, 0.478, 0.058, 6);
  trophyParts.baseBlock = new THREE.CylinderGeometry(TROPHY.baseRadius, TROPHY.baseRadius, 0.405, 6);

  trophyParts.plaqueFrame = roundedBox(0.300, 0.468, 0.030, 0.012);
  trophyParts.plaqueInsert = new THREE.PlaneGeometry(0.238, 0.404);
  trophyParts.bracket = new THREE.CylinderGeometry(0.030, 0.070, 0.069, 16);
  trophyParts.bracketCollar = new THREE.TorusGeometry(0.034, 0.008, 8, 20);
  trophyParts.basePlate = new THREE.PlaneGeometry(0.405, 0.182);

  return trophyParts;
}

export function buildLeagueTrophy(item) {
  const parts = leagueTrophyParts();
  const group = new THREE.Group();
  // A hexagon from a six-sided cylinder puts a corner toward the viewer;
  // a sixth of a turn puts a flat face there instead, as the real base has.
  const flatFront = Math.PI / 6;

  /* ------------------------------------------------------------------ base */
  const stepLow = new THREE.Mesh(parts.baseStepLow, shared.trophyBlack);
  stepLow.position.y = 0.035;
  const stepMid = new THREE.Mesh(parts.baseStepMid, shared.trophyBlack);
  stepMid.position.y = 0.099;
  const block = new THREE.Mesh(parts.baseBlock, shared.trophyBlack);
  block.position.y = 0.330;
  block.castShadow = true;
  [stepLow, stepMid, block].forEach((mesh) => { mesh.rotation.y = flatFront; });

  // The base plate, on the flat face the viewer is standing in front of.
  const basePlate = new THREE.Mesh(parts.basePlate, new THREE.MeshStandardMaterial({
    map: yearPlateTexture({ year: item.year, color: item.color }),
    metalness: 0.3,
    roughness: 0.34,
    envMap: shared.envMap,
    envMapIntensity: 0.9
  }));
  basePlate.position.set(0, 0.290, TROPHY.baseRadius * Math.cos(Math.PI / 6) + 0.004);

  /* --------------------------------------------------------------- columns */
  const columns = new THREE.Group();
  for (const x of [-TROPHY.columnX, 0, TROPHY.columnX]) {
    const column = new THREE.Mesh(parts.column, shared.columnBlue);
    column.position.set(x, (TROPHY.baseTop + TROPHY.columnTop) / 2, TROPHY.columnZ);
    column.castShadow = true;
    columns.add(column);
  }

  /* ----------------------------------------------------------------- shelf */
  const shelf = new THREE.Mesh(parts.shelf, shared.trophyBlack);
  shelf.position.y = (TROPHY.columnTop + TROPHY.shelfTop) / 2;
  shelf.rotation.y = flatFront;
  shelf.castShadow = true;
  const shelfLip = new THREE.Mesh(parts.shelfLip, shared.trophyBlack);
  shelfLip.position.y = TROPHY.columnTop + 0.008;
  shelfLip.rotation.y = flatFront;

  const pegs = new THREE.Group();
  for (const x of [-0.235, 0.235]) {
    const peg = new THREE.Mesh(parts.peg, shared.chrome);
    peg.position.set(x, TROPHY.shelfTop + 0.016, 0.155);
    pegs.add(peg);
  }

  /* ------------------------------------------------------- the cup on top */
  const cup = new THREE.Group();
  cup.position.y = TROPHY.shelfTop;
  const bowl = new THREE.Mesh(parts.cup, shared.chrome);
  bowl.castShadow = true;
  cup.add(bowl);

  for (const side of [1, -1]) {
    const handle = new THREE.Mesh(parts.handle, shared.chrome);
    handle.scale.x = side;
    handle.castShadow = true;
    // The curl where the handle meets the rim, which is most of what makes
    // these read as the ornate handles on the real cup rather than wire.
    const scroll = new THREE.Mesh(parts.scroll, shared.chrome);
    scroll.position.set(side * 0.222, 0.714, 0);
    scroll.rotation.set(0, 0, side * 0.5);
    scroll.scale.set(1, 0.72, 0.5);
    cup.add(handle, scroll);
  }

  /* ------------------------------------------- the plaque between columns */
  const plaque = new THREE.Group();
  const frame = new THREE.Mesh(parts.plaqueFrame, shared.trophyBlack);
  frame.castShadow = true;
  const insert = new THREE.Mesh(parts.plaqueInsert, new THREE.MeshStandardMaterial({
    map: teamPlaqueTexture({ icon: item.icon, color: item.color, label: item.subtitle, ownerId: item.ownerId }),
    metalness: 0.25,
    roughness: 0.38,
    envMap: shared.envMap,
    envMapIntensity: 0.85
  }));
  insert.position.z = 0.017;
  plaque.add(frame, insert);
  plaque.position.set(0, 0.828, 0.115);

  const bracket = new THREE.Mesh(parts.bracket, shared.chrome);
  bracket.position.set(0, 0.5675, 0.115);
  const bracketCollar = new THREE.Mesh(parts.bracketCollar, shared.chrome);
  bracketCollar.rotation.x = Math.PI / 2;
  bracketCollar.position.set(0, 0.598, 0.115);

  group.add(
    stepLow, stepMid, block, basePlate,
    columns, shelf, shelfLip, pegs,
    bracket, bracketCollar, plaque, cup
  );

  // The 2020 trophy is a ghost: the title is on the record, the season is not.
  if (item.lost) {
    group.traverse((child) => {
      if (!child.isMesh) return;
      child.material = Array.isArray(child.material)
        ? child.material.map((material) => ghost(material))
        : ghost(child.material);
    });
  }

  // It has a front — a plate and a plaque both meant to be read — so it holds
  // still in the hall the way the record plaques do.
  group.userData.faceForward = true;
  group.userData.spin = [];
  group.userData.glints = [
    new THREE.Vector3(0.13, 1.90, 0.10),
    new THREE.Vector3(-0.08, 1.65, 0.09),
    new THREE.Vector3(0.245, 0.90, -0.04)
  ];
  return group;
}

/* Polished metal under a spotlight blows out the moment you make it
   translucent, so a ghost trades most of its metalness for roughness and comes
   back as pale glass instead of a white blob. */
function ghost(material) {
  const clone = material.clone();
  clone.transparent = true;
  clone.opacity = 0.26;
  clone.metalness = 0.35;
  clone.roughness = 0.62;
  clone.envMapIntensity = 0.45;
  clone.color = clone.color.clone().lerp(new THREE.Color(0x9ec2ff), 0.55);
  clone.depthWrite = false;
  return clone;
}

/* The hall-of-fame exhibit. A plain marble column said nothing about whose
   career it was, so the manager's crest is the object: a heraldic shield struck
   in their own colour, standing on a brass post, with one gold star turning
   overhead for every title. It is as close to a team logo in three dimensions
   as a league of emoji and hex codes can get. */
function shieldShape(width = 0.46, shoulder = 0.56, point = 0.64) {
  const shape = new THREE.Shape();
  shape.moveTo(-width, shoulder);
  shape.lineTo(width, shoulder);
  shape.lineTo(width, 0.06);
  shape.bezierCurveTo(width, -0.3, width * 0.62, -point * 0.75, 0, -point);
  shape.bezierCurveTo(-width * 0.62, -point * 0.75, -width, -0.3, -width, 0.06);
  shape.closePath();
  return shape;
}

function extrudedShield(scale, depth, material) {
  const geometry = new THREE.ExtrudeGeometry(
    shieldShape(0.46 * scale, 0.56 * scale, 0.64 * scale),
    { depth, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.022, bevelSegments: 3, curveSegments: 18 }
  );
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

export function buildShield(item) {
  const group = new THREE.Group();

  const rim = extrudedShield(1.06, 0.1, shared.gold);
  rim.position.set(0, 1.02, -0.02);
  rim.castShadow = true;

  // A shield is a broad flat face pointed straight at both the key light and
  // the viewer's fill, which is the worst case for a bright material: it was
  // clipping to cream. It takes the manager's colour raw, with no lightening,
  // no emissive lift, and only a trace of the room in it.
  const face = extrudedShield(1.0, 0.12, teamMetal(item.color, {
    roughness: 0.46, emissive: 0, metalness: 0.3, lighten: 0
  }));
  face.position.set(0, 1.02, 0.03);

  const crest = crestDisc(item, { radius: 0.29, thickness: 0.05 });
  crest.position.set(0, 1.09, 0.11);

  // A chevron across the foot of the shield, so it is not a flat field of colour.
  const chevron = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.045, 0.02), shared.gold);
  chevron.position.set(0, 0.64, 0.1);

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.062, 0.46, 16), shared.brass);
  post.position.y = 0.23;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.23, 0.07, 24), shared.darkMarble);
  foot.position.y = 0.035;
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.018, 8, 26), shared.gold);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.45;

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.2, 0.014, 8, 34),
    teamMetal(item.color, { emissive: 0.9, roughness: 0.16 })
  );
  halo.position.set(0, 0.44, 0);
  halo.rotation.x = Math.PI / 2;

  const stars = new THREE.Group();
  stars.position.y = 1.86;
  const geometry = starGeometry(0.085, 0.038, 0.028);
  for (let i = 0; i < (item.rings || 0); i += 1) {
    const star = new THREE.Mesh(geometry, shared.gold);
    const angle = (i / Math.max(1, item.rings)) * TAU;
    star.position.set(Math.cos(angle) * 0.34, Math.sin(angle * 2) * 0.05, Math.sin(angle) * 0.34);
    stars.add(star);
  }

  group.add(foot, post, collar, halo, rim, face, chevron, crest, stars);
  group.userData.spin = item.rings ? [{ node: stars, speed: -0.3 }] : [];
  group.userData.glints = [
    new THREE.Vector3(0.42, 1.4, 0.1),
    new THREE.Vector3(-0.4, 0.7, 0.1),
    new THREE.Vector3(0, 1.09, 0.16)
  ];
  return group;
}

/* A record plaque: walnut board, brass face, studs at the corners, tilted back
   on a stand the way a real one leans in a case. */
export function buildPlaque(item, { mounted = false } = {}) {
  const group = new THREE.Group();
  const board = new THREE.Group();

  // A lowlight is cast in pewter on a cold dark board, so the two walls are
  // told apart from down the hall rather than only by what they say.
  const metal = item.tarnished ? "pewter" : "brass";
  const trimMetal = item.tarnished ? shared.pewter : shared.brass;
  const timber = item.tarnished ? shared.slate : shared.walnut;

  const backing = new THREE.Mesh(roundedBox(1.06, 1.30, 0.09, 0.05), timber);
  backing.castShadow = true;

  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.86, 0.645),
    new THREE.MeshStandardMaterial({
      map: recordFaceTexture({
        value: item.bigValue,
        label: item.title,
        holder: item.subtitle,
        meta: item.meta,
        accent: item.accent,
        metal
      }),
      metalness: 0.26,
      roughness: 0.3,
      envMap: shared.envMap,
      envMapIntensity: 1.15
    })
  );
  // The trim is a shallow tray the face plate sits inside; the plate has to
  // clear its front bevel or the board reads as one blank sheet of brass.
  face.position.set(0, -0.16, 0.062);

  const trim = new THREE.Mesh(roundedBox(0.9, 0.685, 0.02, 0.02), trimMetal);
  trim.position.set(0, -0.16, 0.046);

  const studs = new THREE.Group();
  for (const [x, y] of [[-0.45, 0.575], [0.45, 0.575], [-0.45, -0.575], [0.45, -0.575]]) {
    const stud = new THREE.Mesh(new THREE.SphereGeometry(0.028, 18, 14), trimMetal);
    stud.position.set(x, y, 0.055);
    stud.scale.z = 0.6;
    studs.add(stud);
  }

  // One crest, or a row of smaller ones when the mark is shared.
  const holders = item.holders || [item];
  const spacing = Math.min(0.36, 0.8 / holders.length);
  const radius = Math.min(0.165, spacing * 0.42);
  const crests = holders.map((holder, i) => {
    const crest = crestDisc({ ...item, ownerId: holder.ownerId, color: holder.color, icon: holder.icon },
      { radius, thickness: 0.05 });
    crest.position.set((i - (holders.length - 1) / 2) * spacing, 0.42, 0.062);
    return crest;
  });

  board.add(backing, trim, face, studs, ...crests);

  if (mounted) {
    // Hung on a wall rather than stood on a plinth: no foot, no lean.
    group.add(board);
  } else {
    board.position.y = 0.82;
    board.rotation.x = -0.13;

    const foot = new THREE.Mesh(roundedBox(0.66, 0.1, 0.36, 0.03), shared.darkMarble);
    foot.position.y = 0.05;
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.34, 12), trimMetal);
    strut.position.set(0, 0.24, -0.02);
    group.add(foot, strut, board);
  }
  group.userData.spin = [];
  group.userData.glints = [new THREE.Vector3(0.42, 1.32, 0.1), new THREE.Vector3(-0.42, 0.55, 0.1)];
  group.userData.faceForward = true;
  return group;
}

/* The cellar prize. A trophy would be too kind.

   Modelled facing +Z like everything else: the bowl opens toward the viewer,
   the tank sits behind it on a shelf, and the lid is propped up the way it
   always is in the photograph somebody posts in the group chat. The crest goes
   on the front of the pedestal, the only face of a toilet you can actually
   see from the aisle. */
export function buildToilet(item) {
  const group = new THREE.Group();

  const bowl = new THREE.Mesh(lathe([
    [0.000, 0.000], [0.215, 0.000], [0.222, 0.034], [0.155, 0.080],
    [0.122, 0.190], [0.142, 0.300], [0.196, 0.382], [0.252, 0.432],
    [0.274, 0.466], [0.268, 0.492], [0.228, 0.488], [0.208, 0.450],
    [0.152, 0.398], [0.122, 0.336], [0.000, 0.326]
  ], 48), shared.porcelain);
  bowl.castShadow = true;
  bowl.scale.set(1.14, 1, 1.02);

  const seat = new THREE.Mesh(new THREE.TorusGeometry(0.228, 0.034, 12, 44), shared.porcelain);
  seat.rotation.x = Math.PI / 2;
  seat.scale.set(1.16, 1, 1);
  seat.position.y = 0.512;

  // The shelf the cistern stands on, and the cistern itself.
  const shelf = new THREE.Mesh(roundedBox(0.5, 0.34, 0.34, 0.05), shared.porcelain);
  shelf.position.set(0, 0.17, -0.34);
  const tank = new THREE.Mesh(roundedBox(0.52, 0.46, 0.26, 0.045), shared.porcelain);
  tank.position.set(0, 0.57, -0.34);
  tank.castShadow = true;
  const tankLid = new THREE.Mesh(roundedBox(0.58, 0.055, 0.32, 0.025), shared.porcelain);
  tankLid.position.set(0, 0.825, -0.34);

  // Lid propped against the cistern.
  const lid = new THREE.Mesh(roundedBox(0.48, 0.045, 0.44, 0.13), shared.porcelain);
  lid.position.set(0, 0.70, -0.16);
  lid.rotation.x = 1.28;

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.085, 12), shared.tarnish);
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0.21, 0.74, -0.24);

  // Tarnished laurel and the team crest, mounted where the plaque would go on
  // a trophy nobody wanted to win.
  const wreath = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.014, 8, 36), shared.tarnish);
  wreath.position.set(0, 0.175, 0.168);
  const crest = crestDisc(item, { radius: 0.112, thickness: 0.04 });
  crest.position.set(0, 0.175, 0.178);

  group.add(bowl, seat, shelf, tank, tankLid, lid, handle, wreath, crest);
  group.scale.setScalar(1.16);
  group.userData.spin = [];
  group.userData.glints = [
    new THREE.Vector3(0.2, 0.5, 0.16),
    new THREE.Vector3(0, 0.83, -0.3)
  ];
  return group;
}

/* ------------------------------------------------- the team locker's pieces */

/* The bowl the second and third place finishers take home, struck in the metal
   of the place it marks. */
export function buildPodiumBowl(item) {
  const group = new THREE.Group();

  const plinth = new THREE.Mesh(roundedBox(0.28, 0.075, 0.28, 0.02), shared.darkMarble);
  plinth.position.y = 0.037;

  const bowl = new THREE.Mesh(lathe([
    [0.000, 0.000], [0.098, 0.000], [0.104, 0.020], [0.084, 0.036],
    [0.052, 0.052], [0.049, 0.082], [0.088, 0.112], [0.148, 0.152],
    [0.198, 0.212], [0.224, 0.270], [0.235, 0.302], [0.238, 0.316],
    [0.233, 0.324], [0.220, 0.316], [0.204, 0.272], [0.160, 0.204],
    [0.100, 0.152], [0.000, 0.140]
  ], 48), item.metal === "bronze" ? shared.bronze : shared.silver);
  bowl.position.y = 0.075;
  bowl.castShadow = true;

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.19, 0.05),
    new THREE.MeshStandardMaterial({
      map: nameplateTexture({
        title: String(item.year), sub: null, accent: item.accent,
        metal: item.metal === "bronze" ? "brass" : "pewter"
      }),
      metalness: 0.28,
      roughness: 0.34,
      envMap: shared.envMap,
      envMapIntensity: 1.0
    })
  );
  plate.position.set(0, 0.037, 0.1415);

  group.add(plinth, bowl, plate);
  return group;
}

/* A pennant per playoff berth, hung point-down from its own short rail. */
export function buildPennant(item) {
  const group = new THREE.Group();

  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.34, 10), shared.brass);
  rail.rotation.z = Math.PI / 2;

  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(0.30, 0.675, 8, 8),
    new THREE.MeshStandardMaterial({
      map: pennantTexture({ year: item.year, color: item.cloth || item.color, note: item.note, crown: item.crown }),
      transparent: true,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      metalness: 0.05,
      roughness: 0.85
    })
  );
  cloth.position.y = -0.35;

  // A slow wave down the cloth, so a row of them does not read as cardboard.
  const position = cloth.geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    position.setZ(i, Math.sin(x * 6.5 + y * 1.2) * 0.018 * (0.4 + (0.34 - y) / 0.68));
  }
  position.needsUpdate = true;
  cloth.geometry.computeVertexNormals();

  group.add(rail, cloth);
  return group;
}

/* ---------------------------------------------------------- season honours */

/* Both honours hang by their ring from a point at their own origin, the way a
   pennant hangs from its rail, so a row of stars and ribbons lines up along its
   top edge no matter how far each one drops below it. */

/* The season each honour belongs to, on the same engraved plate the league
   trophy carries its year on. The plate's aspect ratio is the texture's. */
function yearPlate(item, width = 0.30) {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, width * 0.449),
    new THREE.MeshStandardMaterial({
      map: yearPlateTexture({ year: item.year, color: item.accent }),
      metalness: 0.3,
      roughness: 0.34,
      envMap: shared.envMap,
      envMapIntensity: 0.9
    })
  );
}

/* The gold star for leading the league in regular-season scoring. A star and
   nothing else: it is the one honour the standings hand out for putting up
   points rather than for winning with them, and it should read as a gold star
   from across the room. */
export function buildScoringStar(item, { compact = false } = {}) {
  const group = new THREE.Group();

  /* Compact is the form that gets pinned to the corner of a pennant. It loses
     the ring, the chain and the year plate — the pennant it is pinned to is
     already saying which season this was, and at that size the plate would be a
     smudge under a medal too small to read it. */
  const hanger = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 8, 20), shared.brass);
  hanger.position.y = -0.03;

  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.09, 6), shared.brass);
  chain.position.y = -0.09;

  // A dark disc behind the star, so the points do not disappear into the
  // panelling the way an unbacked star did against the lighter walls. Matte and
  // barely reflective on purpose: any of the hall's existing dark materials
  // caught enough of the warm key light to read as a silver medal with a gold
  // star sitting on it, which is a different award altogether.
  const backing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.185, 0.185, 0.03, 40),
    new THREE.MeshStandardMaterial({
      color: 0x0a1018, metalness: 0.2, roughness: 0.62,
      envMap: shared.envMap, envMapIntensity: 0.25
    })
  );
  backing.rotation.x = Math.PI / 2;
  backing.position.y = -0.30;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.186, 0.014, 10, 44), shared.brass);
  rim.position.y = -0.30;

  /* Its own gold rather than the hall's mirror finish. A polished star this size
     flares to a flat white disc the moment the camera lines up with the room's
     key, which on a folded wall it does constantly; rougher, and reflecting far
     less of the room, it stays a gold star from every angle it is seen from. */
  const star = new THREE.Mesh(starGeometry(0.145, 0.062, 0.05), new THREE.MeshStandardMaterial({
    color: 0xf0b53c, metalness: 0.92, roughness: 0.38,
    envMap: shared.envMap, envMapIntensity: 0.9
  }));
  star.position.set(0, -0.30, 0.028);
  star.castShadow = true;

  if (compact) {
    // Built around the origin rather than hanging below it, so a pin sits where
    // it is put rather than a third of a pennant lower.
    [backing, rim, star].forEach((part) => { part.position.y += 0.30; });
    group.add(backing, rim, star);
    group.userData.glints = [new THREE.Vector3(0.06, 0.14, 0.07)];
    return group;
  }

  const plate = yearPlate(item);
  plate.position.set(0, -0.63, 0.004);

  group.add(hanger, chain, backing, rim, star, plate);
  group.userData.glints = [new THREE.Vector3(0.06, -0.16, 0.07)];
  return group;
}

/* The scalloped edge of a rosette. Drawn as one closed curve whose radius
   ripples, rather than as a ring of separate pleats: it extrudes into a single
   watertight shape and costs one mesh instead of sixteen. */
function rosetteShape(radius, lobes = 15, depth = 0.16) {
  const shape = new THREE.Shape();
  const steps = lobes * 10;
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * TAU;
    const r = radius * (1 - depth / 2 + (depth / 2) * Math.cos(angle * lobes));
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function rosetteLayer(radius, color, { lobes = 15, depth = 0.16 } = {}) {
  const geometry = new THREE.ExtrudeGeometry(rosetteShape(radius, lobes, depth), {
    depth: 0.012, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2
  });
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color, metalness: 0.04, roughness: 0.82, envMap: shared.envMap, envMapIntensity: 0.3
  }));
}

/* A prize ribbon's swallow-tailed tail. */
function ribbonTail(width, length, color) {
  const shape = new THREE.Shape();
  const half = width / 2;
  shape.moveTo(-half, 0);
  shape.lineTo(half, 0);
  shape.lineTo(half, -length);
  shape.lineTo(0, -length + width * 0.44);
  shape.lineTo(-half, -length);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.01, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 1
  });
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color, metalness: 0.04, roughness: 0.82, side: THREE.DoubleSide,
    envMap: shared.envMap, envMapIntensity: 0.3
  }));
}

/* The red, white and blue ribbon for finishing a season with the most wins.
   A rosette pleated red, white and blue from the middle out, with two tails
   under it, so it reads as a first-place ribbon at a glance rather than as one
   more team colour on a wall already full of them. */
const RIBBON = { red: 0xa80a24, white: 0xeef2f8, blue: 0x14337f };

export function buildWinsRibbon(item, { compact = false } = {}) {
  const group = new THREE.Group();

  const hanger = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 8, 20), shared.brass);
  hanger.position.y = -0.03;
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 6), shared.brass);
  chain.position.y = -0.08;

  // Tails first, so the rosette sits over the top of where they are pinned.
  const tails = new THREE.Group();
  tails.position.set(0, -0.17, -0.012);
  [[-0.10, 0.28, RIBBON.blue], [0.10, -0.28, RIBBON.red]].forEach(([x, lean, color]) => {
    const tail = ribbonTail(0.125, 0.38, color);
    tail.position.set(x, 0, 0);
    tail.rotation.z = lean;
    tails.add(tail);
  });

  const rosette = new THREE.Group();
  rosette.position.y = -0.20;
  const blue = rosetteLayer(0.17, RIBBON.blue);
  const white = rosetteLayer(0.125, RIBBON.white, { lobes: 13, depth: 0.18 });
  white.position.z = 0.016;
  white.rotation.z = Math.PI / 13;
  const red = rosetteLayer(0.082, RIBBON.red, { lobes: 11, depth: 0.2 });
  red.position.z = 0.032;

  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.026, 26), shared.gold);
  button.rotation.x = Math.PI / 2;
  button.position.z = 0.05;
  const pip = new THREE.Mesh(starGeometry(0.03, 0.013, 0.014), shared.goldWarm);
  pip.position.z = 0.066;

  rosette.add(blue, white, red, button, pip);

  if (compact) {
    [tails, rosette].forEach((part) => { part.position.y += 0.20; });
    group.add(tails, rosette);
    group.userData.glints = [new THREE.Vector3(0, 0.06, 0.09)];
    return group;
  }

  const plate = yearPlate(item, 0.28);
  plate.position.set(0, -0.665, 0.004);

  group.add(hanger, chain, tails, rosette, plate);
  group.userData.glints = [new THREE.Vector3(0, -0.14, 0.09)];
  return group;
}

/* The team's flag, across the top of their wall. */
export function buildTeamFlag(locker) {
  const group = new THREE.Group();

  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.030, 3.25, 12), shared.brass);
  rod.rotation.z = Math.PI / 2;
  rod.position.y = 0.86;
  for (const side of [-1, 1]) {
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), shared.gold);
    finial.position.set(side * 1.66, 0.86, 0);
    group.add(finial);
  }

  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(3.02, 1.60, 22, 6),
    new THREE.MeshStandardMaterial({
      map: teamFlagTexture({
        icon: locker.icon,
        color: locker.color,
        team: locker.team,
        owner: locker.name,
        ownerId: locker.ownerId,
        since: locker.seasons.length ? locker.seasons[0].year : null
      }),
      metalness: 0.06,
      roughness: 0.8,
      side: THREE.DoubleSide
    })
  );
  cloth.position.y = 0.03;
  const position = cloth.geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    position.setZ(i, Math.sin(position.getX(i) * 2.1) * 0.05);
  }
  position.needsUpdate = true;
  cloth.geometry.computeVertexNormals();

  group.add(rod, cloth);
  return group;
}

export function buildExhibitObject(item) {
  switch (item.kind) {
    case "cup": return buildLeagueTrophy(item);
    case "pillar": return buildShield(item);
    case "plaque": return buildPlaque(item);
    case "toilet": return buildToilet(item);
    default: return buildLeagueTrophy(item);
  }
}
