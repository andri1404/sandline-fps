// Grenades: a flashbang that blinds and a smoke that blocks sight. Both are
// thrown on an arc, bounce once, and do their work where they land. Smoke is
// five grey spheres; sight tests ask this module whether a line crosses one.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const GRAVITY = 12;
const THROW_SPEED = 14;
const FLASH_POP_SECONDS = 0.9;
const FLASH_RANGE = 18;
const BLIND_SECONDS = 3;
const SMOKE_SECONDS = 12;
const SMOKE_RADIUS = 3.2;

const SMOKE_OFFSETS = [
  [0, 0.9, 0],
  [1.4, 0.7, 0.6],
  [-1.3, 0.7, 0.8],
  [0.6, 0.8, -1.4],
  [-0.7, 0.7, -1.2],
];

export function createGrenades(scene, world) {
  const thrown = [];
  const smokes = [];
  const popLight = new THREE.PointLight(new THREE.Color('#ffffff'), 0, 20, 1.5);
  scene.add(popLight);

  const shellMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.4, metalness: 0.5 });
  const shellGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const smokeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.muted), transparent: true, opacity: 0.5, depthWrite: false });
  const smokeGeo = new THREE.SphereGeometry(1, 12, 10);

  const eye = new THREE.Vector3();
  const toPop = new THREE.Vector3();

  function spawnShell(position) {
    const mesh = new THREE.Mesh(shellGeo, shellMat);
    mesh.position.copy(position);
    scene.add(mesh);
    return mesh;
  }

  function popFlash(item, ctx, now) {
    const pos = item.mesh.position;
    popLight.position.copy(pos);
    popLight.intensity = 60;
    setTimeout(() => {
      popLight.intensity = 0;
    }, 120);
    if (ctx.audio) ctx.audio.flashPop();
    for (const bot of ctx.bots) {
      if (!bot.alive) continue;
      const dx = pos.x - bot.position.x;
      const dy = 1.2 - 1.55;
      const dz = pos.z - bot.position.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > FLASH_RANGE) continue;
      eye.set(bot.position.x, 1.55, bot.position.z);
      if (world.blocked(eye.x, eye.y, eye.z, pos.x, pos.y, pos.z)) continue;
      const facing = (-Math.sin(bot.yaw) * dx + -Math.cos(bot.yaw) * dz) / Math.max(dist, 0.01);
      if (facing < -0.2) continue;
      const strength = 1 - dist / FLASH_RANGE;
      bot.blindUntil = now + BLIND_SECONDS * (0.5 + strength);
    }
    // The player: blinded when looking toward the pop and close enough.
    if (ctx.playerAlive) {
      const px = ctx.playerPos.x;
      const py = ctx.playerPos.y + ctx.playerEye;
      const pz = ctx.playerPos.z;
      toPop.set(pos.x - px, pos.y - py, pos.z - pz);
      const dist = toPop.length();
      if (dist < 16) {
        toPop.normalize();
        const fx = -Math.sin(ctx.playerYaw);
        const fz = -Math.cos(ctx.playerYaw);
        const facing = toPop.x * fx + toPop.z * fz;
        if (facing > 0.1 && !world.blocked(px, py, pz, pos.x, pos.y, pos.z)) {
          ctx.onPlayerFlashed(Math.max(0.25, 1 - dist / 16));
        }
      }
    }
  }

  function deploySmoke(position) {
    const group = new THREE.Group();
    const spheres = [];
    for (const offset of SMOKE_OFFSETS) {
      const mesh = new THREE.Mesh(smokeGeo, smokeMat.clone());
      mesh.position.set(position.x + offset[0], offset[1], position.z + offset[2]);
      mesh.scale.setScalar(0.2);
      group.add(mesh);
      spheres.push(mesh);
    }
    scene.add(group);
    smokes.push({ group, spheres, age: 0 });
  }

  function segmentHitsSphere(ax, ay, az, bx, by, bz, cx, cy, cz, radius) {
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;
    const lengthSq = abx * abx + aby * aby + abz * abz;
    if (lengthSq < 1e-9) return false;
    let t = (acx * abx + acy * aby + acz * abz) / lengthSq;
    t = Math.max(0, Math.min(1, t));
    const dx = ax + abx * t - cx;
    const dy = ay + aby * t - cy;
    const dz = az + abz * t - cz;
    return dx * dx + dy * dy + dz * dz < radius * radius;
  }

  return {
    thrown,
    smokes,
    throwGrenade(kind, fromPos, direction) {
      const mesh = spawnShell(fromPos);
      const velocity = new THREE.Vector3(direction.x * THROW_SPEED, direction.y * THROW_SPEED + 3.5, direction.z * THROW_SPEED);
      thrown.push({ kind, mesh, velocity, age: 0, bounced: false });
    },
    blocksLOS(ax, ay, az, bx, by, bz) {
      for (const smoke of smokes) {
        for (const sphere of smoke.spheres) {
          const worldPos = sphere.getWorldPosition(eye);
          const radius = SMOKE_RADIUS * sphere.scale.x;
          if (radius < 0.5) continue;
          if (segmentHitsSphere(ax, ay, az, bx, by, bz, worldPos.x, worldPos.y, worldPos.z, radius)) return true;
        }
      }
      return false;
    },
    step(dt, now, ctx) {
      for (let i = thrown.length - 1; i >= 0; i -= 1) {
        const item = thrown[i];
        item.age += dt;
        item.velocity.y -= GRAVITY * dt;
        const mesh = item.mesh;
        mesh.position.x += item.velocity.x * dt;
        mesh.position.y += item.velocity.y * dt;
        mesh.position.z += item.velocity.z * dt;
        if (mesh.position.y <= 0.1 && item.velocity.y < 0) {
          mesh.position.y = 0.1;
          if (item.kind === 'smoke') {
            deploySmoke(mesh.position);
            scene.remove(mesh);
            thrown.splice(i, 1);
            continue;
          }
          if (!item.bounced) {
            item.bounced = true;
            item.velocity.multiplyScalar(0.35);
            item.velocity.y = Math.abs(item.velocity.y) * 0.4 + 1.5;
          } else {
            item.velocity.set(0, 0, 0);
          }
        }
        if (item.kind === 'flash' && item.age >= FLASH_POP_SECONDS) {
          popFlash(item, ctx, now);
          scene.remove(mesh);
          thrown.splice(i, 1);
        }
      }
      for (let i = smokes.length - 1; i >= 0; i -= 1) {
        const smoke = smokes[i];
        smoke.age += dt;
        const grow = Math.min(1, smoke.age / 0.8);
        const fade = smoke.age > SMOKE_SECONDS - 2 ? Math.max(0, (SMOKE_SECONDS - smoke.age) / 2) : 1;
        for (const sphere of smoke.spheres) {
          sphere.scale.setScalar(0.2 + grow * (SMOKE_RADIUS - 0.2));
          sphere.material.opacity = 0.5 * fade;
        }
        if (smoke.age >= SMOKE_SECONDS) {
          scene.remove(smoke.group);
          smokes.splice(i, 1);
        }
      }
    },
    reset() {
      for (const item of thrown) scene.remove(item.mesh);
      thrown.length = 0;
      for (const smoke of smokes) scene.remove(smoke.group);
      smokes.length = 0;
    },
  };
}
