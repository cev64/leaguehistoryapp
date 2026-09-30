/* The building. Everything here spans the whole gallery in one mesh, or is an
   InstancedMesh of a repeated element, so the room costs about a dozen draw
   calls no matter how many wings the league grows into. */

import * as THREE from "three";
import { bannerTexture, floorInlayTexture, radialTexture } from "./textures.js";
import { materials, roundedBox } from "./models.js";

export const LAYOUT = {
  spacing: 3.85,      // metres between neighbouring pedestals
  wingGap: 6.4,       // extra room at a wing boundary, where the arch stands
  itemZ: 0,           // the pedestals all stand on one line
  wallZ: -5.0,        // the wall they stand in front of
  frontZ: 9.4,        // the wall behind the viewer
  ceilingY: 6.7,
  pedestalHeight: 1.12
};

/* The same gallery, stood on its end.

   A phone held upright is a tall window onto a room that runs sideways, and
   walking it by swiping up asks the viewer to hold two directions in their head
   at once: the swipe goes one way, the hall goes the other. So on a phone the
   hall is not a corridor at all — it is a shaft, and the exhibits are stacked
   one above another down it, each on its own shelf. Swiping up moves you down
   the stack, which is the only thing a vertical swipe has ever meant.

   The rail is unchanged: same order, same stops, same distances between them.
   Only which axis those distances are spent on changes, and everything that
   places something in the room asks `railPlace` rather than assuming x. */
export const SHAFT = {
  spacing: 4.6,       // more room than the corridor: nothing is beside anything
  wingGap: 7.2,
  /* The back of the shaft. Much closer than a corridor's wall, because the
     exhibits stand on ledges out of it rather than on a floor in front of it —
     the shelf has to reach from the wall to under the pedestal, and a wall five
     metres back needs a five-metre shelf to get there. */
  wallZ: -1.35,
  shelfZ: 0.9,        // how far the shelf reaches out of the wall
  shelfDepth: 1.9,
  half: 2.3,          // how far the shaft's edges reach across
  shelfDrop: 0.2      // thickness of the shelf a pedestal stands on
};

/* Walks the rail once and fixes where every exhibit stands, plus where each
   wing begins and ends. Everything downstream — camera, arches, banners, the
   HUD's progress bar — reads these numbers rather than recomputing them.

   Positions are distances along the rail, not coordinates. `railPlace` turns a
   distance into a point, and it is the only place that knows which way the
   gallery runs. */
export function planLayout(hall, { vertical = false } = {}) {
  const spacing = vertical ? SHAFT.spacing : LAYOUT.spacing;
  const wingGap = vertical ? SHAFT.wingGap : LAYOUT.wingGap;
  let x = 0;
  const positions = [];
  hall.wings.forEach((wing, index) => {
    if (index > 0) x += wingGap;
    wing.startX = x;
    wing.archX = x - wingGap / 2;
    wing.items.forEach((item, itemIndex) => {
      positions[item.railIndex] = x + itemIndex * spacing;
    });
    x += (wing.items.length - 1) * spacing;
    wing.endX = x;
    wing.centerX = (wing.startX + wing.endX) / 2;
  });

  const minX = positions[0] - wingGap;
  const maxX = positions[positions.length - 1] + wingGap;
  return { positions, minX, maxX, length: maxX - minX, vertical, spacing, wingGap };
}

/* A distance along the rail, as a point in the room. A corridor spends it going
   right; a shaft spends it going down, so the first exhibit is at the top and
   the rail reads like a page. */
export function railPlace(layout, distance) {
  return layout.vertical
    ? { x: 0, y: -distance, z: LAYOUT.itemZ }
    : { x: distance, y: 0, z: LAYOUT.itemZ };
}

function longBox(width, height, depth, material, position) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(...position);
  return mesh;
}

function emissiveStrip(color, intensity) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });
}

export function buildRoom(scene, hall, layout) {
  return layout.vertical ? buildShaft(scene, hall, layout) : buildCorridor(scene, hall, layout);
}

/* ------------------------------------------------------------------- shaft */

/* The gallery as a shaft: a panelled back wall running the whole rail, a shelf
   under every exhibit, and an alcove of the wing's colour behind each one.

   It is deliberately plainer than the corridor. A corridor is read down its
   length, so it earns its pilasters, coffers and receding sconces — they are
   what make it read as long. A shaft is read one shelf at a time through a
   window the size of a phone, and everything that is not the exhibit in front
   of you is either off the top of the screen or off the bottom of it. So the
   parts that are left are the ones that say where you are: the shelf, the
   alcove behind it, and the band you cross going into a new wing. */
function buildShaft(scene, hall, layout) {
  const mat = materials();
  const room = new THREE.Group();
  const span = layout.length;
  const midY = -(layout.minX + layout.maxX) / 2;
  const wallZ = SHAFT.wallZ;
  const half = SHAFT.half;

  // Which wing each exhibit belongs to, so a shelf can be lit in its colour.
  const accentFor = [];
  hall.wings.forEach((wing) => {
    wing.items.forEach((item) => { accentFor[item.railIndex] = wing.accent; });
  });

  /* --------------------------------------------------------------- the back */
  const panelTexture = mat.textures.darkMarble.clone();
  panelTexture.needsUpdate = true;
  panelTexture.repeat.set(2, span / 7);
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2 + 1.4, span),
    new THREE.MeshStandardMaterial({
      map: panelTexture, color: 0x8ba2bd, metalness: 0.3, roughness: 0.5,
      envMap: mat.envMap, envMapIntensity: 0.85
    })
  );
  back.position.set(0, midY, wallZ);
  room.add(back);

  // The two edges of the shaft: a walnut stile and a brass bead down each side,
  // which is what stops the back wall reading as a flat backdrop.
  const stileTexture = mat.textures.walnut.clone();
  stileTexture.needsUpdate = true;
  stileTexture.repeat.set(1, span / 4);
  const stile = new THREE.MeshStandardMaterial({
    map: stileTexture, color: 0x6d5539, metalness: 0.15, roughness: 0.66,
    envMap: mat.envMap, envMapIntensity: 0.4
  });
  for (const side of [-1, 1]) {
    room.add(longBox(0.9, span, 0.5, stile, [side * (half + 0.2), midY, wallZ + 0.24]));
    room.add(longBox(0.1, span, 0.62, mat.brass, [side * (half - 0.3), midY, wallZ + 0.5]));
    // A dim strip of light down each side, so the shaft has a length you can
    // feel even where there is no shelf in frame.
    room.add(longBox(0.05, span, 0.3, emissiveStrip(0xd9b168, 0.4), [side * (half + 0.62), midY, wallZ + 0.5]));
  }

  /* ------------------------------------------------------------ the shelves */
  const count = layout.positions.length;
  const dummy = new THREE.Object3D();

  const shelves = new THREE.InstancedMesh(
    roundedBox(half * 1.4, SHAFT.shelfDrop, SHAFT.shelfDepth, 0.05), mat.darkMarble, count
  );
  const lips = new THREE.InstancedMesh(
    roundedBox(half * 1.42, 0.03, SHAFT.shelfDepth + 0.06, 0.012), mat.brass, count
  );
  const brackets = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.05, 0.08, 0.34, 10), mat.brass, count * 2
  );
  const alcoves = new THREE.InstancedMesh(
    roundedBox(half * 1.3, 3.2, 0.16, 0.06),
    new THREE.MeshStandardMaterial({
      color: 0x101b2c, metalness: 0.35, roughness: 0.55, envMap: mat.envMap, envMapIntensity: 0.5
    }),
    count
  );

  /* The wing's colour, washed into the back of each alcove. One instanced mesh
     carrying a colour per instance: forty-one separate additive planes is forty
     one draw calls for something nobody can see more than two of at a time. */
  const washes = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(half * 1.3, 3.4),
    new THREE.MeshBasicMaterial({
      map: radialTexture(), transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false
    }),
    count
  );
  const washColour = new THREE.Color();

  layout.positions.forEach((distance, index) => {
    const y = -distance;

    dummy.rotation.set(0, 0, 0);
    dummy.position.set(0, y + 1.55, wallZ + 0.14);
    dummy.updateMatrix();
    alcoves.setMatrixAt(index, dummy.matrix);

    /* The shelf reaches out of the wall far enough to have the exhibit standing
       on the middle of it. It used to sit against the wall behind them, which
       from the front read as every pedestal in the hall hovering a metre in
       front of the ledge it was supposed to be on. */
    dummy.position.set(0, y - SHAFT.shelfDrop / 2, wallZ + SHAFT.shelfZ);
    dummy.updateMatrix();
    shelves.setMatrixAt(index, dummy.matrix);

    dummy.position.set(0, y - SHAFT.shelfDrop - 0.015, wallZ + SHAFT.shelfZ);
    dummy.updateMatrix();
    lips.setMatrixAt(index, dummy.matrix);

    [-1, 1].forEach((side, i) => {
      dummy.position.set(side * half * 0.6, y - SHAFT.shelfDrop - 0.2, wallZ + 0.5);
      dummy.updateMatrix();
      brackets.setMatrixAt(index * 2 + i, dummy.matrix);
    });

    dummy.position.set(0, y + 1.55, wallZ + 0.24);
    dummy.updateMatrix();
    washes.setMatrixAt(index, dummy.matrix);
    washes.setColorAt(index, washColour.set(accentFor[index] || "#f2c14a"));
  });

  [shelves, lips, brackets, alcoves, washes].forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; });
  if (washes.instanceColor) washes.instanceColor.needsUpdate = true;
  washes.renderOrder = 1;
  room.add(shelves, lips, brackets, alcoves, washes);

  /* ------------------------------------------------------- wing thresholds */
  hall.wings.forEach((wing, wingIndex) => {
    // The banner hangs in the gap above the wing's first shelf, so you pass it
    // on the way in the same way the corridor's arch is passed through.
    const bannerY = -(wing.startX - layout.wingGap * 0.46);
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(3.9, 1.4, 16, 1),
      new THREE.MeshStandardMaterial({
        map: bannerTexture({ name: wing.name, kicker: wing.kicker, accent: wing.accent }),
        metalness: 0.05, roughness: 0.85, side: THREE.DoubleSide
      })
    );
    banner.position.set(0, bannerY, wallZ + 0.6);
    const position = banner.geometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      position.setZ(i, Math.sin(position.getX(i) * 2.2) * 0.05);
    }
    position.needsUpdate = true;
    banner.geometry.computeVertexNormals();

    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 4.2, 12), mat.brass);
    rod.rotation.z = Math.PI / 2;
    rod.position.set(0, bannerY + 0.76, wallZ + 0.62);
    room.add(banner, rod);

    // A lintel across the shaft where one wing gives way to the next.
    if (wingIndex > 0) {
      const y = -wing.archX;
      room.add(longBox(half * 2 + 1.2, 0.34, 0.7, mat.marble, [0, y, wallZ + 0.8]));
      room.add(longBox(half * 2 + 1.3, 0.08, 0.84, mat.brass, [0, y - 0.2, wallZ + 0.86]));
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(half * 2 + 1.2, 0.06),
        emissiveStrip(new THREE.Color(wing.accent).getHex(), 1.2)
      );
      glow.position.set(0, y + 0.2, wallZ + 1.16);
      room.add(glow);
    }
  });

  /* ------------------------------------------------------------------- ends */
  for (const [y, facing] of [[-layout.minX, -1], [-layout.maxX, 1]]) {
    const cap = new THREE.Mesh(
      new THREE.PlaneGeometry(half * 2 + 1.4, LAYOUT.frontZ - wallZ),
      new THREE.MeshStandardMaterial({ color: 0x0a1220, metalness: 0.3, roughness: 0.7, envMap: mat.envMap, envMapIntensity: 0.4 })
    );
    cap.rotation.x = facing * Math.PI / 2;
    cap.position.set(0, y, (wallZ + LAYOUT.frontZ) / 2);
    room.add(cap);
  }

  /* A shaft needs a little more ambient than a corridor — you are nose to nose
     with the case rather than looking down a room, and what the key does not
     land on has nowhere else to get light from. It lives on the room rather
     than on the scene so that it goes out with the hall: a locker wall is lit
     by its own lamps and does not want this one on top of them. */
  room.add(new THREE.HemisphereLight(0xa9c4ee, 0x3a2a1a, 0.4));

  scene.add(room);
  return { room, floor: back };
}

/* ---------------------------------------------------------------- corridor */

function buildCorridor(scene, hall, layout) {
  const mat = materials();
  const room = new THREE.Group();
  const centerX = (layout.minX + layout.maxX) / 2;
  const span = layout.length;
  const depth = LAYOUT.frontZ - LAYOUT.wallZ;

  /* ------------------------------------------------------------------ floor */
  const floorTexture = mat.textures.darkMarble.clone();
  floorTexture.needsUpdate = true;
  floorTexture.repeat.set(span / 6, depth / 6);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(span, depth),
    new THREE.MeshStandardMaterial({
      map: floorTexture,
      color: 0x8ea4bd,
      metalness: 0.78,
      roughness: 0.15,
      envMap: mat.envMap,
      envMapIntensity: 2.1
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(centerX, 0, (LAYOUT.wallZ + LAYOUT.frontZ) / 2);
  floor.receiveShadow = true;
  room.add(floor);

  // A runner of darker stone down the middle of the hall, so the eye has a
  // path to follow and the pedestals sit on something.
  const runner = new THREE.Mesh(
    new THREE.PlaneGeometry(span, 3.6),
    new THREE.MeshStandardMaterial({
      color: 0x0b1524, metalness: 0.5, roughness: 0.34, envMap: mat.envMap, envMapIntensity: 0.8
    })
  );
  runner.rotation.x = -Math.PI / 2;
  runner.position.set(centerX, 0.004, LAYOUT.itemZ + 0.4);
  room.add(runner);

  for (const side of [-1, 1]) {
    const edge = new THREE.Mesh(
      new THREE.PlaneGeometry(span, 0.06),
      emissiveStrip(0xd9b168, 0.55)
    );
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(centerX, 0.008, LAYOUT.itemZ + 0.4 + side * 1.82);
    room.add(edge);
  }

  /* ------------------------------------------------------------------ walls */
  const wainscotTexture = mat.textures.walnut.clone();
  wainscotTexture.needsUpdate = true;
  wainscotTexture.repeat.set(span / 3, 1);
  const wainscot = new THREE.MeshStandardMaterial({
    map: wainscotTexture, color: 0x6d5539, metalness: 0.15, roughness: 0.66, envMap: mat.envMap, envMapIntensity: 0.4
  });

  const upperTexture = mat.textures.darkMarble.clone();
  upperTexture.needsUpdate = true;
  upperTexture.repeat.set(span / 8, 1);
  const upper = new THREE.MeshStandardMaterial({
    map: upperTexture, color: 0x97aec9, metalness: 0.3, roughness: 0.52, envMap: mat.envMap, envMapIntensity: 0.9
  });

  for (const [z, facing] of [[LAYOUT.wallZ, 1], [LAYOUT.frontZ, -1]]) {
    room.add(longBox(span, 1.45, 0.5, wainscot, [centerX, 0.72, z - facing * 0.25]));
    room.add(longBox(span, 0.09, 0.62, mat.brass, [centerX, 1.5, z - facing * 0.31]));
    room.add(longBox(span, 3.9, 0.4, upper, [centerX, 3.5, z - facing * 0.2]));
    room.add(longBox(span, 0.3, 0.66, mat.darkMarble, [centerX, 5.6, z - facing * 0.33]));

    // The cove that lights the wall from above; it is the bright band the gold
    // picks up when a trophy turns.
    const cove = longBox(span, 0.06, 0.3, emissiveStrip(0xffd9a0, 0.85), [centerX, 5.4, z - facing * 0.55]);
    room.add(cove);
  }

  /* --------------------------------------------------------------- pilasters */
  const pilasterGeometry = roundedBox(0.46, 4.1, 0.34, 0.03);
  const capitalGeometry = roundedBox(0.58, 0.16, 0.44, 0.03);
  const bays = Math.max(2, Math.round(span / 4.3));
  const pilasters = new THREE.InstancedMesh(pilasterGeometry, mat.marble, bays * 2);
  const capitals = new THREE.InstancedMesh(capitalGeometry, mat.brass, bays * 2);
  const dummy = new THREE.Object3D();
  let index = 0;
  for (let i = 0; i < bays; i += 1) {
    const x = layout.minX + (i + 0.5) * (span / bays);
    for (const [z, facing] of [[LAYOUT.wallZ, 1], [LAYOUT.frontZ, -1]]) {
      dummy.position.set(x, 3.5, z - facing * 0.02);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      pilasters.setMatrixAt(index, dummy.matrix);
      dummy.position.set(x, 5.62, z - facing * 0.06);
      dummy.updateMatrix();
      capitals.setMatrixAt(index, dummy.matrix);
      index += 1;
    }
  }
  pilasters.instanceMatrix.needsUpdate = true;
  capitals.instanceMatrix.needsUpdate = true;
  room.add(pilasters, capitals);

  // Sconces on the back wall between the pilasters. They light nothing — the
  // travelling spots do that — but they give the hall a receding row of warm
  // points, which is most of what makes a long room read as long.
  const sconceGlass = new THREE.MeshBasicMaterial({ color: 0xffd9a4 });
  const sconces = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 12, 10), sconceGlass, bays);
  const sconceArms = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.02, 0.03, 0.2, 8), mat.brass, bays);
  const halos = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1.1, 1.1),
    new THREE.MeshBasicMaterial({
      map: radialTexture(), color: 0xffbe72, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false
    }),
    bays
  );
  for (let i = 0; i < bays; i += 1) {
    const x = layout.minX + (i + 1) * (span / bays);
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(x, 2.62, LAYOUT.wallZ + 0.28);
    dummy.updateMatrix();
    sconces.setMatrixAt(i, dummy.matrix);
    halos.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, 2.48, LAYOUT.wallZ + 0.18);
    dummy.updateMatrix();
    sconceArms.setMatrixAt(i, dummy.matrix);
  }
  [sconces, sconceArms, halos].forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; });
  halos.renderOrder = 2;
  room.add(sconces, sconceArms, halos);

  /* ---------------------------------------------------------------- ceiling */
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(span, depth),
    new THREE.MeshStandardMaterial({ color: 0x080e18, metalness: 0.2, roughness: 0.9 })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(centerX, LAYOUT.ceilingY, (LAYOUT.wallZ + LAYOUT.frontZ) / 2);
  room.add(ceiling);

  const coffers = new THREE.InstancedMesh(
    roundedBox(3.0, 0.16, 3.0, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x14202f, metalness: 0.4, roughness: 0.6, envMap: mat.envMap, envMapIntensity: 0.4 }),
    bays
  );
  const lamps = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(2.2, 0.42),
    emissiveStrip(0xffd39a, 0.8),
    bays
  );
  for (let i = 0; i < bays; i += 1) {
    const x = layout.minX + (i + 0.5) * (span / bays);
    dummy.position.set(x, LAYOUT.ceilingY - 0.12, LAYOUT.itemZ + 1.2);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    coffers.setMatrixAt(i, dummy.matrix);

    dummy.position.set(x, LAYOUT.ceilingY - 0.21, LAYOUT.itemZ + 1.2);
    dummy.rotation.set(Math.PI / 2, 0, 0);
    dummy.updateMatrix();
    lamps.setMatrixAt(i, dummy.matrix);
  }
  coffers.instanceMatrix.needsUpdate = true;
  lamps.instanceMatrix.needsUpdate = true;
  room.add(coffers, lamps);

  /* ------------------------------------------------------- wing furnishings */
  const soft = radialTexture();
  hall.wings.forEach((wing, wingIndex) => {
    // Banner on the wall above the wing.
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 1.15, 16, 1),
      new THREE.MeshStandardMaterial({
        map: bannerTexture({ name: wing.name, kicker: wing.kicker, accent: wing.accent }),
        metalness: 0.05,
        roughness: 0.85,
        side: THREE.DoubleSide
      })
    );
    banner.position.set(wing.centerX, 4.35, LAYOUT.wallZ + 0.42);
    // A gentle wave baked into the cloth so it does not read as a poster.
    const position = banner.geometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      position.setZ(i, Math.sin(position.getX(i) * 2.2) * 0.05);
    }
    position.needsUpdate = true;
    banner.geometry.computeVertexNormals();

    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 3.5, 12), mat.brass);
    rod.rotation.z = Math.PI / 2;
    rod.position.set(wing.centerX, 4.99, LAYOUT.wallZ + 0.44);
    room.add(banner, rod);

    // Brass lettering set into the floor where the wing begins.
    const inlay = new THREE.Mesh(
      new THREE.PlaneGeometry(3.0, 3.0),
      new THREE.MeshBasicMaterial({
        map: floorInlayTexture({ name: wing.name, accent: wing.accent }),
        transparent: true,
        opacity: 0.55,
        depthWrite: false
      })
    );
    inlay.rotation.x = -Math.PI / 2;
    inlay.position.set(wing.centerX, 0.012, LAYOUT.itemZ + 2.0);
    room.add(inlay);

    // An arch marking the threshold into every wing after the first.
    if (wingIndex > 0) {
      room.add(buildArch(wing.archX, wing.accent, mat));
    }

    // The wing's colour washed onto the wall behind it.
    const wash = new THREE.Mesh(
      new THREE.PlaneGeometry(wing.endX - wing.startX + 5, 5.4),
      new THREE.MeshBasicMaterial({
        map: soft, color: new THREE.Color(wing.accent), transparent: true,
        opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    wash.position.set(wing.centerX, 2.6, LAYOUT.wallZ + 0.5);
    room.add(wash);
  });

  /* ------------------------------------------------------------------- ends */
  for (const [x, facing] of [[layout.minX, 1], [layout.maxX, -1]]) {
    const end = new THREE.Mesh(
      new THREE.PlaneGeometry(depth, 6.7),
      new THREE.MeshStandardMaterial({ color: 0x0a1220, metalness: 0.3, roughness: 0.7, envMap: mat.envMap, envMapIntensity: 0.4 })
    );
    end.rotation.y = facing * Math.PI / 2;
    end.position.set(x, 3.35, (LAYOUT.wallZ + LAYOUT.frontZ) / 2);
    room.add(end);
  }

  scene.add(room);
  return { room, floor };
}

function buildArch(x, accent, mat) {
  const arch = new THREE.Group();
  const z = LAYOUT.wallZ + 0.62;
  const half = 1.35;

  for (const side of [-1, 1]) {
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 3.6, 18), mat.marble);
    column.position.set(x + side * half, 1.8, z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.18, 18), mat.darkMarble);
    base.position.set(x + side * half, 0.09, z);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.21, 0.18, 18), mat.brass);
    cap.position.set(x + side * half, 3.69, z);
    arch.add(column, base, cap);
  }

  const span = new THREE.Mesh(new THREE.TorusGeometry(half, 0.19, 12, 36, Math.PI), mat.marble);
  span.position.set(x, 3.78, z);
  arch.add(span);

  const keystone = new THREE.Mesh(roundedBox(0.34, 0.44, 0.34, 0.04), mat.brass);
  keystone.position.set(x, 5.18, z);
  arch.add(keystone);

  // The recess behind the opening, washed in the wing's colour so the doorway
  // announces which room you are walking into.
  const recess = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2.1, 5.1),
    new THREE.MeshStandardMaterial({ color: 0x060b13, metalness: 0.2, roughness: 0.9 })
  );
  recess.position.set(x, 2.2, LAYOUT.wallZ + 0.12);
  const wash = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2.6, 5.4),
    new THREE.MeshBasicMaterial({
      map: radialTexture(), color: new THREE.Color(accent),
      transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false
    })
  );
  wash.position.set(x, 2.0, LAYOUT.wallZ + 0.2);
  arch.add(recess, wash);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(half - 0.19, 0.022, 8, 40, Math.PI),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(1.5) })
  );
  rim.position.set(x, 3.78, z - 0.02);
  arch.add(rim);

  return arch;
}

/* Motes in the light. They live in a slab that follows the camera down the
   hall, so a few hundred points cover a gallery of any length. */
/* Motes in the light. They drift across the rail rather than up it, and wrap
   around the camera so the same few hundred follow you the whole way: in a
   corridor that means drifting upward and wrapping left to right, and in a
   shaft it means drifting sideways and wrapping top to bottom. */
export function buildDust(scene, count = 420, { vertical = false } = {}) {
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  // The axis the rail runs on, which is the one the motes wrap around; and the
  // axis they drift along, which is the other one.
  const along = vertical ? 1 : 0;
  const drift = vertical ? 0 : 1;
  for (let i = 0; i < count; i += 1) {
    positions[i * 3 + along] = (Math.random() - 0.5) * 26;
    positions[i * 3 + drift] = vertical ? (Math.random() - 0.5) * 7 : Math.random() * 5.4 + 0.2;
    positions[i * 3 + 2] = LAYOUT.wallZ + Math.random() * (LAYOUT.frontZ - LAYOUT.wallZ);
    speeds[i] = 0.02 + Math.random() * 0.06;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 0.05,
    map: radialTexture(),
    color: 0xffe1b0,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true
  }));
  points.frustumCulled = false;
  scene.add(points);

  const driftFrom = vertical ? -3.5 : 0.15;
  const driftTo = vertical ? 3.5 : 5.8;

  return {
    points,
    update(delta, cameraAlong) {
      const array = geometry.attributes.position.array;
      for (let i = 0; i < count; i += 1) {
        const base = i * 3;
        array[base + drift] += speeds[i] * delta;
        array[base + along] += Math.sin(array[base + drift] * 1.4 + i) * delta * 0.06;
        if (array[base + drift] > driftTo) array[base + drift] = driftFrom;
        const offset = array[base + along] - cameraAlong;
        if (offset > 13) array[base + along] -= 26;
        else if (offset < -13) array[base + along] += 26;
      }
      geometry.attributes.position.needsUpdate = true;
    }
  };
}

/* Three lights ride along with the viewer: a key on whatever is in front of
   them and a wash on each neighbour. Lighting the whole hall at once would
   cost thirty lights and look flat anyway. */
export function buildTravellingLights(scene, quality, { vertical = false } = {}) {
  const spacing = vertical ? SHAFT.spacing : LAYOUT.spacing;
  const wallZ = vertical ? SHAFT.wallZ : LAYOUT.wallZ;
  // Intensities are in candela: a spot falls off as intensity / distance^decay.
  // The ceiling is four metres above a plinth, so these run high — but not as
  // high as they want to be. Gold is specular and swallows a lot of light
  // before it looks lit; the painted shields and engraved plates beside it are
  // diffuse and clip long before that. The key is set by what the flat
  // surfaces will take, and the ambient below carries the rest.
  /* In a shaft the key cannot hang above the exhibit the way it does in a
     corridor — four metres up is the next shelf. It comes from in front
     instead, which is the only direction a shaft leaves open.

     It is also much softer than the corridor's. A corridor's key is a spot on
     one plinth in a long dark room and it is meant to read that way. In a shaft
     the same light, thrown from in front at four metres, burned a hole in the
     middle of whatever it hit and left the lettering on a plaque and the rim of
     a bowl in the dark on either side of it. Wide open, further back, half the
     candela, and the ambient below carrying most of the load. */
  const key = new THREE.SpotLight(
    0xffe3b8,
    vertical ? 88 : 150,
    vertical ? 30 : 22,
    vertical ? 1.05 : 0.62,
    vertical ? 0.95 : 0.45,
    vertical ? 1.0 : 1.5
  );
  key.position.set(vertical ? 1.1 : 0, vertical ? 3.1 : 5.3, LAYOUT.itemZ + (vertical ? 3.3 : 1.9));
  key.target.position.set(0, 1.3, LAYOUT.itemZ);
  if (quality.shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 14;
    key.shadow.bias = -0.0022;
    key.shadow.normalBias = 0.02;
  }
  scene.add(key, key.target);

  const wings = [-1, 1].map((side) => {
    const light = new THREE.SpotLight(
      0xbcd2ff, vertical ? 24 : 72, vertical ? 26 : 20, vertical ? 1.0 : 0.7, vertical ? 0.9 : 0.65, vertical ? 1.1 : 1.6
    );
    light.position.set(0, 5.0, LAYOUT.itemZ + 2.4);
    light.target.position.set(0, 1.1, LAYOUT.itemZ);
    scene.add(light, light.target);
    return { light, side };
  });

  // A low warm bounce off the wall behind the exhibits, so nothing is lit from
  // one side only. In a shaft the wall is a metre and a half back rather than
  // five, so the same lamp there would scorch it.
  const rim = new THREE.PointLight(0xff9d5c, vertical ? 3 : 42, vertical ? 6 : 16, 2);
  rim.position.set(0, 1.9, wallZ + (vertical ? 0.28 : 1.4));
  scene.add(rim);

  /* Where each light sits relative to the base of whatever it is lighting, as
     [along the rail, up off the base, out in front of it]. The corridor and the
     shaft need different poses for the same reason they need different rooms:
     in a corridor "up" and "along" are two different axes, so a light can hang
     over an exhibit and its neighbours can stand beside it. In a shaft they are
     the same axis — the space above an exhibit is the next exhibit — so
     everything comes at it from the front instead, and the neighbours' washes
     are the ones above and below. */
  /* A shaft's key comes down at the exhibit from above and off to one side,
     for the same reason a corridor's hangs over the plinth: a light square in
     front of a glazed white bowl or a mirrored cup puts its own reflection back
     down the lens, and the piece comes out with a hole burned in the middle of
     it however gently it is lit. Off the axis, the highlight goes past the
     viewer instead and what is left is the shape of the thing. `across` is that
     sideways offset, and it means nothing in a corridor, where sideways is the
     direction the rail already runs. */
  const POSE = vertical ? {
    key:    { across: 1.1, along: 3.1, out: 3.3 },
    keyAim: { across: 0, along: 1.2, out: 0 },
    wing:   { across: -1.5, along: 1.5, out: 3.6 },
    wingAim:{ across: 0, along: 1.2, out: 0 },
    rim:    { across: 0, along: 1.9, out: wallZ + 0.28 - LAYOUT.itemZ }
  } : {
    key:    { up: 5.3, out: 1.9 },
    keyAim: { up: 1.3, out: 0 },
    wing:   { up: 5.0, out: 2.4 },
    wingAim:{ up: 1.1, out: 0 },
    rim:    { up: 1.9, out: wallZ + 1.4 - LAYOUT.itemZ }
  };

  // `along` is where on the rail the light is riding; `step` slides it up or
  // down the rail from there, which is how a neighbour's wash finds its
  // neighbour in either room.
  const place = (node, along, pose, step = 0) => {
    if (vertical) node.position.set(pose.across, along + pose.along + step, LAYOUT.itemZ + pose.out);
    else node.position.set(along + step, pose.up, LAYOUT.itemZ + pose.out);
  };

  return {
    key,
    update(along, accent) {
      place(key, along, POSE.key);
      place(key.target, along, POSE.keyAim);
      key.color.lerp(new THREE.Color(0xffe3b8).lerp(new THREE.Color(accent), 0.4), 0.08);
      wings.forEach(({ light, side }) => {
        place(light, along, POSE.wing, side * spacing);
        place(light.target, along, POSE.wingAim, side * spacing);
      });
      place(rim, along, POSE.rim);
      rim.color.lerp(new THREE.Color(0xff9d5c).lerp(new THREE.Color(accent), 0.45), 0.06);
    }
  };
}

/* The soft dark patch a pedestal presses into the floor. Cheaper and calmer
   than asking the shadow map to resolve thirty of them. */
export function contactShadow(radius = 0.9, opacity = 0.55) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({
      map: radialTexture({ stops: [[0, "rgba(0,0,0,1)"], [0.45, "rgba(0,0,0,.55)"], [1, "rgba(0,0,0,0)"]] }),
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.NormalBlending,
      color: 0x000000
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.006;
  mesh.renderOrder = -1;
  return mesh;
}
