// Yard 7: an original desert freight yard at dusk. Two bombsites — Site A in the
// north-west, Site B in the north-east wing — joined by three lanes, a mid
// corridor and the east wing's own entries. Attackers spawn in the south and
// choose a site; defenders split across both and rotate on intel. Every box is
// a collider for players and bots and a surface a bullet stops on. Plain
// geometry only: no models, no textures, no outside files.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint graph the bots walk: [x, z, links...]. Nodes sit in open ground;
// edges never cross a wall. Bots path with a tiny BFS over these links.
const WAYPOINTS = [
  [0, 15, [1, 2, 3]], // 0 attacker spawn
  [-8, 14, [0, 9, 15]], // 1 spawn west
  [8, 14, [0, 12, 16]], // 2 spawn east
  [0, 8, [0, 4, 15, 16]], // 3 mid south
  [0, 0, [3, 5, 15, 16]], // 4 mid gate
  [0, -8, [4, 6, 17, 18]], // 5 mid north
  [0, -14, [5, 7, 8, 21]], // 6 Site A
  [-6, -14, [6, 17, 19]], // 7 site west
  [6, -14, [6, 18, 20]], // 8 site east
  [-13, 9, [1, 10]], // 9 west lane south
  [-13, 3, [9, 11, 15]], // 10 west lane mid
  [-13, -7, [10, 17, 19]], // 11 west lane north
  [13, 9, [2, 13, 28]], // 12 east lane south
  [13, 3, [12, 14, 16]], // 13 east lane mid
  [13, -7, [14, 18, 20, 22]], // 14 east lane north
  [-7, 5, [1, 3, 4, 10]], // 15 west connector
  [7, 5, [2, 3, 4, 13]], // 16 east connector
  [-7, -8, [5, 7, 11]], // 17 west north connector
  [7, -8, [5, 8, 14]], // 18 east north connector
  [-15, -15, [7, 11, 20]], // 19 north-west corner
  [15, -15, [8, 14, 19, 27]], // 20 north-east corner
  [0, -17, [6, 7, 8]], // 21 defender spawn
  [23, -7, [14, 23, 24]], // 22 wing south entry
  [28, -7, [22, 24, 25, 28]], // 23 wing centre
  [23, -14, [22, 25, 27]], // 24 Site B west
  [28, -14.7, [23, 24, 26]], // 25 Site B
  [32, -14, [25, 27]], // 26 Site B east
  [23, -15.5, [20, 24, 26]], // 27 wing north entry
  [24, 9, [12, 23]], // 28 wing flank entry
];

const BOUNDS = { minX: -21.3, maxX: 38.3, minZ: -19.3, maxZ: 19.3 };
const SITES = {
  A: { x: 0, z: -14.7, halfW: 4, halfD: 3.5 },
  B: { x: 28, z: -14.7, halfW: 4, halfD: 3.5 },
};

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }

  const colliders = [];
  const shootables = [];
  const tmpBox = new THREE.Box3();

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  function barrel(x, z) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.45, 1.05, 14),
      materials.muted,
    );
    mesh.position.set(x, 0.525, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    tmpBox.setFromObject(mesh);
    colliders.push(tmpBox.clone());
    shootables.push(mesh);
    return mesh;
  }

  // Floor and the outer wall, 59.6 x 38.6 m, 5 m high, open to the dusk sky.
  // The yard runs from the old west wall (x -21.3) to the new east wall (x 38.3).
  box(59.9, 0.4, 38.6, 8.5, -0.2, 0, 'canvas');
  box(0.6, 5, 38.6, -21.3, 2.5, 0, 'surface');
  box(0.6, 5, 38.6, 38.3, 2.5, 0, 'surface');
  box(59.9, 5, 0.6, 8.5, 2.5, -19.3, 'surface');
  box(59.9, 5, 0.6, 8.5, 2.5, 19.3, 'surface');

  // The old east wall (x = 21.3) now divides the yard from the east wing, with
  // three doorways: the north entry (z -17..-13), the south entry (z -9..-5)
  // and the flank entry (z 7..11). Lintels keep each doorway 3.4 m high.
  box(0.6, 5, 2.3, 21.3, 2.5, -18.15, 'surface');
  box(0.6, 5, 4, 21.3, 2.5, -11, 'surface');
  box(0.6, 5, 12, 21.3, 2.5, 1, 'surface');
  box(0.6, 5, 8.3, 21.3, 2.5, 15.15, 'surface');
  box(0.6, 1.6, 4, 21.3, 4.2, -15, 'surface');
  box(0.6, 1.6, 4, 21.3, 4.2, -7, 'surface');
  box(0.6, 1.6, 4, 21.3, 4.2, 9, 'surface');

  // Lane dividers at x = -7 and x = +7, z from 12 down to -10, with two door gaps
  // each: the mid connector (z 3..7) and the north connector (z -10..-6).
  for (const side of [-7, 7]) {
    box(0.5, 3.4, 5, side, 1.7, 9.5, 'surface'); // z 7..12
    box(0.5, 3.4, 9, side, 1.7, -1.5, 'surface'); // z -6..3
  }

  // Mid gate at z = 0: a wall across mid with one 2.6 m doorway in the middle.
  box(5.7, 3.4, 0.5, -4.15, 1.7, 0, 'surface');
  box(5.7, 3.4, 0.5, 4.15, 1.7, 0, 'surface');
  box(2.6, 0.9, 0.5, 0, 3.85, 0, 'surface'); // lintel over the doorway

  // Mid cover: crates and a low wall to peek over.
  box(1.2, 1.2, 1.2, -2, 0.6, 6, 'hairline');
  box(1.2, 1.2, 1.2, 2.2, 0.6, 2, 'hairline');
  box(2.4, 1.0, 0.6, 0.6, 0.5, -4, 'hairline');
  box(1.2, 1.2, 1.2, -1.5, 0.6, -4.5, 'hairline');
  barrel(2.6, -6.5);
  barrel(3.1, -6.1);

  // West lane: a long container, crates, barrels. The container sits clear of
  // the west lane's patrol line (x -13): a face on the line pins bots against
  // it forever, and the stuck-avoidance only makes them oscillate.
  box(2.4, 2.6, 6, -15.2, 1.3, -2, 'muted');
  box(1.2, 1.2, 1.2, -13, 0.6, 6, 'hairline');
  box(1.2, 2.4, 1.2, -11.2, 1.2, -6, 'hairline');
  barrel(-16, -8.5);
  barrel(-15.2, -8.9);

  // East lane: mirrored cover, different rhythm. Same clearance rule as the
  // west container: the lane's patrol line (x 13) and the diagonal to the
  // north-east corner must both pass clear of its faces.
  box(1.2, 1.2, 1.2, 13, 0.6, 5, 'hairline');
  box(2.4, 1.2, 1.2, 11.8, 0.6, -4, 'hairline');
  box(2.4, 2.6, 5, 16, 1.3, -8.5, 'muted');
  barrel(16, 1);
  barrel(10.8, -9.5);

  // Connector corners: a crate in each doorway so every crossing is a peek.
  // They sit just south of the connector nodes — a crate on the node itself
  // makes the waypoint unreachable, and the bots orbit it forever.
  box(1.2, 1.2, 1.2, -7, 0.6, 3, 'hairline');
  box(1.2, 1.2, 1.2, 7, 0.6, 3, 'hairline');

  // Spawn cover.
  box(1.2, 1.2, 1.2, -5, 0.6, 14, 'hairline');
  box(1.2, 1.2, 1.2, 5, 0.6, 14, 'hairline');

  // Corner stacks and wall-side cover: height and depth at the map's edges,
  // clear of every waypoint line so no patrol ever stalls on them.
  function stack(x, z) {
    box(1.2, 1.2, 1.2, x, 0.6, z, 'hairline');
    box(1.2, 1.2, 1.2, x, 1.8, z, 'muted');
  }
  stack(-19, 17);
  stack(19, 17);
  stack(-19, -17);
  stack(19, -17);
  stack(-11.5, -17);
  stack(11.5, -17);
  box(1.2, 1.2, 1.2, -19, 0.6, 0, 'hairline');
  box(1.2, 1.2, 1.2, 19, 0.6, 0, 'hairline');
  box(2.4, 2.6, 5, -17, 1.3, -2, 'muted');
  box(2.4, 2.6, 5, 17, 1.3, -2, 'muted');
  box(1.2, 1.2, 1.2, -4, 0.6, 10, 'hairline');
  box(1.2, 1.2, 1.2, 4, 0.6, 12, 'hairline');
  barrel(-16, 14);
  barrel(16, 14);
  barrel(-1.5, 18.3);
  barrel(1.5, 18.3);

  // East wing south yard: cover on the flank route to Site B, clear of the
  // waypoint edges (23)-(28) and (12)-(28).
  box(2.4, 2.6, 5, 32, 1.3, 2, 'muted');
  box(1.2, 1.2, 1.2, 26, 0.6, 4, 'hairline');
  box(1.2, 1.2, 1.2, 32, 0.6, 12, 'hairline');
  stack(36, 17);
  barrel(24, 16);
  barrel(36, 14);

  // Site A: two containers flanking the plant zone, crates, a jumpable perch,
  // and barrels at the mouth of the site.
  box(2.4, 2.6, 4, -7.5, 1.3, -14.5, 'muted');
  box(2.4, 2.6, 4, 7.5, 1.3, -14.5, 'accent');
  box(1.2, 1.2, 1.2, -3, 0.6, -13, 'hairline');
  box(1.2, 1.2, 1.2, 3, 0.6, -16, 'hairline');
  box(4, 0.5, 3, 0, 0.25, -17.5, 'surface'); // perch, jumpable
  barrel(-8.5, -11.5);
  barrel(8.5, -11.5);

  // Site B: the same grammar as Site A, mirrored into the east wing — the
  // east container hugs the outer wall, the west one guards the wing entries.
  box(2.4, 2.6, 4, 20.5, 1.3, -14.5, 'muted');
  box(2.4, 2.6, 4, 35.5, 1.3, -14.5, 'accent');
  box(1.2, 1.2, 1.2, 25, 0.6, -13, 'hairline');
  box(1.2, 1.2, 1.2, 31, 0.6, -16, 'hairline');
  box(4, 0.5, 3, 28, 0.25, -17.5, 'surface'); // perch, jumpable
  barrel(19.5, -11.5);
  barrel(36.5, -11.5);

  // Site markings: an ember outline on the floor and a diamond at its heart.
  const mark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.6, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.35 });
  function strip(w, d, x, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), mark);
    mesh.position.set(x, 0.03, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    shootables.push(mesh);
    return mesh;
  }

  // Site lettering, drawn once on canvas textures: a big ember letter on the
  // floor of the plant zone and a sign on the north wall, so the objective
  // reads from across the yard. A warm light shaft and a pole lamp make the
  // site glow at dusk.
  function textTexture(draw, w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d');
    draw(c, w, h);
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    return tex;
  }

  function siteMarkings(letter, cx, cz) {
    strip(8, 0.35, cx, cz + 3.5);
    strip(8, 0.35, cx, cz - 3.5);
    strip(0.35, 7, cx - 4, cz);
    strip(0.35, 7, cx + 4, cz);
    const letterTex = textTexture((c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.fillStyle = '#ff7a1a';
      c.font = 'bold 190px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.globalAlpha = 0.85;
      c.fillText(letter, w / 2, h / 2 + 8);
    }, 256, 256);
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 4.5), new THREE.MeshBasicMaterial({ map: letterTex, transparent: true, depthWrite: false }));
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(cx, 0.05, cz);
    group.add(decal);
    const signTex = textTexture((c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.fillStyle = '#f5ead6';
      c.font = 'bold 84px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(`SITE  ${letter}`, w / 2, h / 2);
      c.fillStyle = '#ff7a1a';
      c.fillRect(0, h - 10, w, 10);
    }, 512, 128);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshBasicMaterial({ map: signTex, transparent: true }));
    sign.position.set(cx, 3.4, -18.9);
    group.add(sign);
    const shaftMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (const rot of [0, Math.PI / 2]) {
      const shaft = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 7), shaftMat);
      shaft.position.set(cx, 3.5, cz);
      shaft.rotation.y = rot;
      group.add(shaft);
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.4, 8), materials.hairline);
    pole.position.set(cx + 5.5, 2.2, -18.4);
    group.add(pole);
    const lamp = new THREE.PointLight(new THREE.Color(PALETTE.accent), 30, 16, 1.6);
    lamp.position.set(cx + 5.5, 4.4, -18.4);
    scene.add(lamp);
  }
  siteMarkings('A', 0, -14.7);
  siteMarkings('B', 28, -14.7);

  // Dusk sky: a gradient dome with a low sun disc, so the horizon burns ember
  // behind the yard instead of a flat colour. One canvas texture, no files.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4;
  skyCanvas.height = 512;
  const skyCtx = skyCanvas.getContext('2d');
  const skyGrad = skyCtx.createLinearGradient(0, 0, 0, 512);
  skyGrad.addColorStop(0, '#0e0b16');
  skyGrad.addColorStop(0.42, '#33202c');
  skyGrad.addColorStop(0.58, '#8a4522');
  skyGrad.addColorStop(0.64, '#ff7a1a');
  skyGrad.addColorStop(0.69, '#3a2416');
  skyGrad.addColorStop(0.74, '#191410');
  skyGrad.addColorStop(1, '#191410');
  skyCtx.fillStyle = skyGrad;
  skyCtx.fillRect(0, 0, 4, 512);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(120, 24, 12),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  skyDome.frustumCulled = false;
  scene.add(skyDome);
  const sunDir = new THREE.Vector3(26, 11, 9).normalize();
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(7, 24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb35c'), transparent: true, opacity: 0.95, fog: false, depthWrite: false }),
  );
  sunDisc.position.copy(sunDir).multiplyScalar(110);
  sunDisc.lookAt(0, 0, 0);
  sunDisc.frustumCulled = false;
  scene.add(sunDisc);
  const sunGlow = new THREE.Mesh(
    new THREE.CircleGeometry(15, 24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a1a'), transparent: true, opacity: 0.22, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  sunGlow.position.copy(sunDir).multiplyScalar(109);
  sunGlow.lookAt(0, 0, 0);
  sunGlow.frustumCulled = false;
  scene.add(sunGlow);

  // Ambient dust: one pre-allocated Points cloud drifting east on the wind.
  // Positions live in a fixed buffer; nothing allocates while it moves.
  const DUST_COUNT = 120;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(DUST_COUNT * 3);
  const dustPhase = new Float32Array(DUST_COUNT);
  for (let i = 0; i < DUST_COUNT; i += 1) {
    dustPos[i * 3] = -21 + Math.random() * 59;
    dustPos[i * 3 + 1] = 0.3 + Math.random() * 4.2;
    dustPos[i * 3 + 2] = -19 + Math.random() * 38;
    dustPhase[i] = Math.random() * Math.PI * 2;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xd8b98a, size: 0.06, transparent: true, opacity: 0.35, depthWrite: false }));
  dust.frustumCulled = false;
  scene.add(dust);
  let dustTime = 0;
  function updateDust(dt) {
    dustTime += dt;
    for (let i = 0; i < DUST_COUNT; i += 1) {
      dustPos[i * 3] += 0.35 * dt;
      dustPos[i * 3 + 1] += Math.sin(dustTime * 0.7 + dustPhase[i]) * 0.05 * dt;
      if (dustPos[i * 3] > 38.3) dustPos[i * 3] = -21.3;
    }
    dustGeo.attributes.position.needsUpdate = true;
  }

  // Light: a low western sun with long shadows, a cool fill, and a warm sky.
  // Bright enough that every lane reads at a glance in a screenshot.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.ink), new THREE.Color(PALETTE.canvas), 1.35);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffbe78'), 3.5);
  sun.position.set(26, 11, 9);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -34;
  sun.shadow.camera.right = 34;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.85);
  fill.position.set(-12, 10, -10);
  scene.add(fill);

  const probe = new THREE.Box3();

  // Shared collision test: does a standing box at (x, y, z) with this height and
  // radius touch any collider? lift keeps feet and crown out of horizontal tests.
  function collides(x, y, z, height, radius, lift) {
    probe.min.set(x - radius, y + lift, z - radius);
    probe.max.set(x + radius, y + height - lift, z + radius);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  const raycaster = new THREE.Raycaster();
  const rayOrigin = new THREE.Vector3();
  const rayDirection = new THREE.Vector3();

  return {
    colliders,
    shootables,
    group,
    waypoints: WAYPOINTS,
    bounds: BOUNDS,
    sites: SITES,
    playerSpawn: { x: 0, z: 15, yaw: 0 },
    attackerSpawns: [
      { x: -1.5, z: 15 },
      { x: 1.5, z: 15 },
      { x: -3, z: 14 },
      { x: 3, z: 14 },
    ],
    defenderSpawns: [
      { x: -6, z: -13 },
      { x: 6, z: -13 },
      { x: 24, z: -16 },
      { x: 32, z: -16 },
      { x: 0, z: -8 },
    ],
    collides,
    updateDust,
    // Which site, if any, holds this point: 'A', 'B', or null.
    siteAt(x, z) {
      for (const key of ['A', 'B']) {
        const s = SITES[key];
        if (Math.abs(x - s.x) <= s.halfW && z >= s.z - s.halfD && z <= s.z + s.halfD) return key;
      }
      return null;
    },
    // True when a straight line between two points is blocked by the map.
    blocked(ax, ay, az, bx, by, bz) {
      rayOrigin.set(ax, ay, az);
      rayDirection.set(bx - ax, by - ay, bz - az);
      const distance = rayDirection.length();
      if (distance < 0.001) return false;
      rayDirection.normalize();
      raycaster.set(rayOrigin, rayDirection);
      raycaster.far = distance;
      return raycaster.intersectObjects(shootables, false).length > 0;
    },
  };
}
