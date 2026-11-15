// Yard 7: an original desert freight yard at dusk. Two lanes and a mid corridor run
// from the attackers' spawn in the south to Site A in the north. Every box is a
// collider for players and bots and a surface a bullet stops on. Plain geometry
// only: no models, no textures, no outside files.
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
  [13, 9, [2, 13]], // 12 east lane south
  [13, 3, [12, 14, 16]], // 13 east lane mid
  [13, -7, [14, 18, 20]], // 14 east lane north
  [-7, 5, [1, 3, 4, 10]], // 15 west connector
  [7, 5, [2, 3, 4, 13]], // 16 east connector
  [-7, -8, [5, 7, 11]], // 17 west north connector
  [7, -8, [5, 8, 14]], // 18 east north connector
  [-15, -15, [7, 11, 20]], // 19 north-west corner
  [15, -15, [8, 14, 19]], // 20 north-east corner
  [0, -17, [6, 7, 8]], // 21 defender spawn
];

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

  // Floor and the outer wall, 42 x 38 m, 5 m high, open to the dusk sky.
  box(42.6, 0.4, 38.6, 0, -0.2, 0, 'canvas');
  box(0.6, 5, 38.6, -21.3, 2.5, 0, 'surface');
  box(0.6, 5, 38.6, 21.3, 2.5, 0, 'surface');
  box(42.6, 5, 0.6, 0, 2.5, -19.3, 'surface');
  box(42.6, 5, 0.6, 0, 2.5, 19.3, 'surface');

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

  // West lane: a long container, crates, barrels.
  box(2.4, 2.6, 6, -14.5, 1.3, -2, 'muted');
  box(1.2, 1.2, 1.2, -13, 0.6, 6, 'hairline');
  box(1.2, 2.4, 1.2, -11.2, 1.2, -6, 'hairline');
  barrel(-16, -8.5);
  barrel(-15.2, -8.9);

  // East lane: mirrored cover, different rhythm.
  box(1.2, 1.2, 1.2, 13, 0.6, 5, 'hairline');
  box(2.4, 1.2, 1.2, 11.8, 0.6, -4, 'hairline');
  box(2.4, 2.6, 5, 14.8, 1.3, -8.5, 'muted');
  barrel(16, 1);
  barrel(10.8, -9.5);

  // Connector corners: a crate in each doorway so every crossing is a peek.
  box(1.2, 1.2, 1.2, -7, 0.6, 5, 'hairline');
  box(1.2, 1.2, 1.2, 7, 0.6, 5, 'hairline');

  // Spawn cover.
  box(1.2, 1.2, 1.2, -5, 0.6, 14, 'hairline');
  box(1.2, 1.2, 1.2, 5, 0.6, 14, 'hairline');

  // Site A: two containers flanking the plant zone, crates, a jumpable perch,
  // and barrels at the mouth of the site.
  box(2.4, 2.6, 4, -7.5, 1.3, -14.5, 'muted');
  box(2.4, 2.6, 4, 7.5, 1.3, -14.5, 'accent');
  box(1.2, 1.2, 1.2, -3, 0.6, -13, 'hairline');
  box(1.2, 1.2, 1.2, 3, 0.6, -16, 'hairline');
  box(4, 0.5, 3, 0, 0.25, -17.5, 'surface'); // perch, jumpable
  barrel(-8.5, -11.5);
  barrel(8.5, -11.5);

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
  strip(8, 0.35, 0, -11.2);
  strip(8, 0.35, 0, -18.2);
  strip(0.35, 7, -4, -14.7);
  strip(0.35, 7, 4, -14.7);
  const diamond = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 1.4), mark);
  diamond.position.set(0, 0.03, -14.7);
  diamond.rotation.y = Math.PI / 4;
  group.add(diamond);

  // A pole lamp over the site, ember light spilling onto the plant zone.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.4, 8), materials.hairline);
  pole.position.set(5.5, 2.2, -18.4);
  group.add(pole);
  const lamp = new THREE.PointLight(new THREE.Color(PALETTE.accent), 30, 16, 1.6);
  lamp.position.set(5.5, 4.4, -18.4);
  scene.add(lamp);

  // Light: a low western sun with long shadows, a cool fill, and a warm sky.
  // Bright enough that every lane reads at a glance in a screenshot.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.ink), new THREE.Color(PALETTE.canvas), 1.35);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffd9a0'), 2.7);
  sun.position.set(18, 20, 12);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 70;
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
    playerSpawn: { x: 0, z: 15, yaw: 0 },
    defenderSpawns: [
      { x: -14, z: -16 },
      { x: 14, z: -16 },
      { x: 0, z: -17.5 },
      { x: -6, z: -13 },
      { x: 6, z: -13 },
    ],
    site: { x: 0, z: -14.7, halfW: 4, halfD: 3.5 },
    collides,
    inSite(x, z) {
      return Math.abs(x) <= 4 && z >= -18.2 && z <= -11.2;
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
