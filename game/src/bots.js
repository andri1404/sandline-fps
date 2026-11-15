// The defenders: five bots that hold Site A and the lanes. Each one has a job,
// a patrol, eyes and ears. They walk waypoint routes, hold angles, react to what
// they see and hear, shoot back in bursts, and converge on the bomb to defuse it.
// One job per function; the sim never allocates in its hot loops.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const HEALTH = 100;
const BOT_HEIGHT = 1.72;
const BOT_RADIUS = 0.34;
const PATROL_SPEED = 3.2;
const HUNT_SPEED = 4.4;
const AIM_SPEED = 1.6;
const EYE_HEIGHT = 1.55;
const SIGHT_RANGE = 42;
const SIGHT_HALF_ANGLE = 1.05; // ~60 degrees
const BURST_MIN = 3;
const BURST_MAX = 5;
const SHOT_GAP = 0.13;
const DAMAGE = 20;
const HEAD_MULT = 2.5;
const DEFUSE_SECONDS = 5;
const FALL_SECONDS = 0.45;

const ROLES = ['site', 'site', 'mid', 'west', 'east'];
const HOLD_SPOTS = [
  [-6, -13.5],
  [6, -13.5],
  [0, -6],
  [-13, 0],
  [13, 0],
];
const PATROLS = [
  [[6, -14], [-6, -14], [0, -12]],
  [[-6, -14], [6, -14], [0, -16]],
  [[0, -8], [0, 2], [0, -8], [0, 4]],
  [[-13, 8], [-13, -7], [-13, 3]],
  [[13, 8], [13, -7], [13, 3]],
];

function nearestNode(waypoints, x, z) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < waypoints.length; i += 1) {
    const dx = waypoints[i][0] - x;
    const dz = waypoints[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function findPath(waypoints, from, to) {
  if (from === to) return [to];
  const prev = new Array(waypoints.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length > 0) {
    const node = queue.shift();
    for (const next of waypoints[node][2]) {
      if (prev[next] !== -1) continue;
      prev[next] = node;
      if (next === to) {
        const path = [to];
        let at = to;
        while (at !== from) {
          at = prev[at];
          path.unshift(at);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [to];
}

export function createBots(scene, world, random) {
  const waypoints = world.waypoints;
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.05 });
  const gearMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.8 });
  const helmMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.45, metalness: 0.1 });
  const torsoGeo = new THREE.BoxGeometry(0.52, 0.72, 0.3);
  const headGeo = new THREE.SphereGeometry(0.16, 14, 10);
  const legGeo = new THREE.BoxGeometry(0.2, 0.72, 0.22);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.55);
  const flashGeo = new THREE.PlaneGeometry(0.3, 0.3);

  const bots = [];
  const hitMeshes = [];
  let now = 0;

  for (let index = 0; index < 5; index += 1) {
    const group = new THREE.Group();
    const torsoMat = bodyMat.clone();
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 1.02;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeo, helmMat);
    head.position.y = 1.56;
    head.userData.part = 'head';
    const legL = new THREE.Mesh(legGeo, gearMat);
    legL.position.set(-0.14, 0.36, 0);
    const legR = new THREE.Mesh(legGeo, gearMat);
    legR.position.set(0.14, 0.36, 0);
    const gun = new THREE.Mesh(gunGeo, gearMat);
    gun.position.set(0.24, 1.05, -0.32);
    const flashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.set(0.24, 1.05, -0.72);
    flash.visible = false;
    group.add(torso, head, legL, legR, gun, flash);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
      }
    });
    scene.add(group);

    const bot = {
      index,
      role: ROLES[index],
      group,
      torso,
      head,
      gun,
      flash,
      torsoMat,
      position: new THREE.Vector3(),
      yaw: 0,
      health: HEALTH,
      alive: true,
      state: 'hold',
      holdSpot: HOLD_SPOTS[index],
      patrol: PATROLS[index],
      patrolIdx: 0,
      path: [],
      pathIdx: 0,
      lastKnown: new THREE.Vector3(),
      hasKnown: false,
      thinkAt: index * 0.05,
      reactionAt: 0,
      burstLeft: 0,
      shotAt: 0,
      pauseUntil: 0,
      strafeDir: 1,
      strafeAt: 0,
      loseSightAt: 0,
      flashUntil: 0,
      blindUntil: 0,
      defuseT: 0,
      fall: 0,
      walkPhase: random() * 6,
      speed: PATROL_SPEED,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    hitMeshes.push(torso, head);
    bots.push(bot);
  }

  const eye = new THREE.Vector3();
  const toPlayer = new THREE.Vector3();
  const moveDir = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  function canSee(bot, ctx) {
    if (!ctx.playerAlive) return false;
    const px = ctx.playerPos.x;
    const pz = ctx.playerPos.z;
    const dx = px - bot.position.x;
    const dz = pz - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > SIGHT_RANGE) return false;
    const forwardX = -Math.sin(bot.yaw);
    const forwardZ = -Math.cos(bot.yaw);
    if (dist > 0.5 && (dx * forwardX + dz * forwardZ) / dist < Math.cos(SIGHT_HALF_ANGLE)) return false;
    eye.set(bot.position.x, EYE_HEIGHT, bot.position.z);
    const playerEye = ctx.playerPos.y + ctx.playerEye;
    if (world.blocked(eye.x, eye.y, eye.z, px, playerEye, pz)) return false;
    if (ctx.smokeBlocks && ctx.smokeBlocks(eye.x, eye.y, eye.z, px, playerEye, pz)) return false;
    return true;
  }

  function setPath(bot, x, z) {
    const from = nearestNode(waypoints, bot.position.x, bot.position.z);
    const to = nearestNode(waypoints, x, z);
    bot.path = findPath(waypoints, from, to);
    bot.pathIdx = 0;
  }

  function walkPath(bot, dt, speed) {
    if (bot.pathIdx >= bot.path.length) return true;
    const node = waypoints[bot.path[bot.pathIdx]];
    const dx = node[0] - bot.position.x;
    const dz = node[1] - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6) {
      bot.pathIdx += 1;
      return bot.pathIdx >= bot.path.length;
    }
    moveDir.set(dx / dist, 0, dz / dist);
    bot.yaw = Math.atan2(-moveDir.x, -moveDir.z);
    moveAxis(bot, moveDir.x * speed * dt, 0);
    moveAxis(bot, 0, moveDir.z * speed * dt);
    bot.walkPhase += dt * speed * 2.2;
    return false;
  }

  function moveAxis(bot, dx, dz) {
    const nextX = bot.position.x + dx;
    if (!world.collides(nextX, 0, bot.position.z, BOT_HEIGHT, BOT_RADIUS, 0.04)) bot.position.x = nextX;
    const nextZ = bot.position.z + dz;
    if (!world.collides(bot.position.x, 0, nextZ, BOT_HEIGHT, BOT_RADIUS, 0.04)) bot.position.z = nextZ;
  }

  function think(bot, ctx) {
    if (now < bot.thinkAt) return;
    bot.thinkAt = now + 0.12 + random() * 0.06;
    if (now < bot.blindUntil) return;
    const seen = canSee(bot, ctx);
    if (seen) {
      bot.lastKnown.set(ctx.playerPos.x, 0, ctx.playerPos.z);
      bot.hasKnown = true;
      if (bot.state !== 'engage') {
        bot.state = 'engage';
        bot.reactionAt = now + 0.35 + random() * 0.3;
        bot.burstLeft = 0;
      }
      bot.loseSightAt = now + 1.2;
      return;
    }
    if (bot.state === 'engage' && now > bot.loseSightAt) {
      bot.state = 'investigate';
      setPath(bot, bot.lastKnown.x, bot.lastKnown.z);
    }
    if (bot.state !== 'engage' && ctx.noise) {
      for (const event of ctx.noise) {
        if (now - event.at > 2) continue;
        const dx = event.x - bot.position.x;
        const dz = event.z - bot.position.z;
        if (dx * dx + dz * dz < event.radius * event.radius) {
          bot.lastKnown.set(event.x, 0, event.z);
          bot.hasKnown = true;
          bot.state = 'investigate';
          setPath(bot, event.x, event.z);
          break;
        }
      }
    }
  }

  function shoot(bot, ctx) {
    if (now < bot.reactionAt || now < bot.pauseUntil) return;
    if (bot.burstLeft <= 0) {
      bot.burstLeft = BURST_MIN + Math.floor(random() * (BURST_MAX - BURST_MIN + 1));
      bot.shotAt = now;
    }
    if (now - bot.shotAt < SHOT_GAP) return;
    bot.shotAt = now;
    bot.burstLeft -= 1;
    if (bot.burstLeft === 0) bot.pauseUntil = now + 0.6 + random() * 0.5;

    const px = ctx.playerPos.x;
    const py = ctx.playerPos.y + ctx.playerEye * 0.82;
    const pz = ctx.playerPos.z;
    const dist = Math.hypot(px - bot.position.x, pz - bot.position.z);
    const spread = 0.028 + dist * 0.0009 + (ctx.playerSpeed > 3 ? 0.02 : 0);
    eye.set(bot.position.x, EYE_HEIGHT, bot.position.z);
    toPlayer.set(px - eye.x, py - eye.y, pz - eye.z).normalize();
    toPlayer.x += (random() * 2 - 1) * spread;
    toPlayer.y += (random() * 2 - 1) * spread;
    toPlayer.z += (random() * 2 - 1) * spread;
    toPlayer.normalize();
    bot.flash.visible = true;
    bot.flashUntil = now + 0.05;
    ctx.onBotShot(bot, eye, toPlayer);

    // The shot is a ray against the player's body box and head sphere.
    boxMinTmp.set(px - BOT_RADIUS, ctx.playerPos.y, pz - BOT_RADIUS);
    boxMaxTmp.set(px + BOT_RADIUS, ctx.playerPos.y + ctx.playerHeight, pz + BOT_RADIUS);
    const hit = rayHitsBox(eye, toPlayer, boxMinTmp, boxMaxTmp);
    if (hit === null) return;
    if (world.blocked(eye.x, eye.y, eye.z, eye.x + toPlayer.x * hit, eye.y + toPlayer.y * hit, eye.z + toPlayer.z * hit)) return;
    if (ctx.smokeBlocks && ctx.smokeBlocks(eye.x, eye.y, eye.z, eye.x + toPlayer.x * hit, eye.y + toPlayer.y * hit, eye.z + toPlayer.z * hit)) return;
    const hitY = eye.y + toPlayer.y * hit;
    const isHead = hitY > ctx.playerPos.y + ctx.playerEye + 0.08;
    ctx.onPlayerHit(isHead ? DAMAGE * HEAD_MULT : DAMAGE, isHead, bot);
  }

  // Slab test: distance along the ray to a box, or null. The caller reuses its
  // two box vectors; this function allocates nothing.
  const boxMaxTmp = new THREE.Vector3();
  const boxMinTmp = new THREE.Vector3();
  function rayHitsBox(origin, dir, min, max) {
    boxMaxTmp.copy(max);
    let tmin = 0;
    let tmax = Infinity;
    const axes = ['x', 'y', 'z'];
    for (const axis of axes) {
      const o = origin[axis];
      const d = dir[axis];
      if (Math.abs(d) < 1e-9) {
        if (o < min[axis] || o > boxMaxTmp[axis]) return null;
      } else {
        let t1 = (min[axis] - o) / d;
        let t2 = (boxMaxTmp[axis] - o) / d;
        if (t1 > t2) {
          const swap = t1;
          t1 = t2;
          t2 = swap;
        }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    return tmin;
  }

  function stepBot(bot, dt, ctx) {
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / FALL_SECONDS);
      bot.group.rotation.x = -bot.fall * 1.5;
      bot.group.position.y = -bot.fall * 0.1;
      return;
    }
    think(bot, ctx);
    if (now < bot.blindUntil) {
      bot.group.position.copy(bot.position);
      return;
    }
    bot.flash.visible = now < bot.flashUntil;

    if (bot.state === 'defuse') {
      const bomb = ctx.bomb;
      const dx = bomb.x - bot.position.x;
      const dz = bomb.z - bot.position.z;
      if (Math.hypot(dx, dz) > 2) {
        setPath(bot, bomb.x, bomb.z);
        walkPath(bot, dt, HUNT_SPEED);
      } else {
        bot.yaw = Math.atan2(-dx, -dz);
        bot.defuseT += dt;
        if (bot.defuseT >= DEFUSE_SECONDS) ctx.onDefused(bot);
      }
      bot.group.position.copy(bot.position);
      bot.group.rotation.y = bot.yaw;
      return;
    }

    if (bot.state === 'engage') {
      const dx = ctx.playerPos.x - bot.position.x;
      const dz = ctx.playerPos.z - bot.position.z;
      const dist = Math.hypot(dx, dz);
      bot.yaw = Math.atan2(-dx, -dz);
      if (now > bot.strafeAt) {
        bot.strafeAt = now + 1.2 + random() * 0.8;
        bot.strafeDir = random() < 0.5 ? -1 : 1;
      }
      if (dist > 14) {
        moveDir.set(dx / dist, 0, dz / dist);
        moveAxis(bot, moveDir.x * AIM_SPEED * dt, 0);
        moveAxis(bot, 0, moveDir.z * AIM_SPEED * dt);
      } else if (dist < 5) {
        moveDir.set(-dx / dist, 0, -dz / dist);
        moveAxis(bot, moveDir.x * AIM_SPEED * dt, 0);
        moveAxis(bot, 0, moveDir.z * AIM_SPEED * dt);
      } else {
        const sx = (-dz / dist) * bot.strafeDir;
        const sz = (dx / dist) * bot.strafeDir;
        moveAxis(bot, sx * AIM_SPEED * dt, 0);
        moveAxis(bot, 0, sz * AIM_SPEED * dt);
      }
      if (ctx.playerAlive) shoot(bot, ctx);
      bot.group.position.copy(bot.position);
      bot.group.rotation.y = bot.yaw;
      return;
    }

    if (bot.state === 'investigate') {
      if (walkPath(bot, dt, HUNT_SPEED)) {
        bot.state = bot.role === 'site' ? 'hold' : 'patrol';
        bot.patrolIdx = 0;
      }
      bot.group.position.copy(bot.position);
      bot.group.rotation.y = bot.yaw;
      return;
    }

    if (bot.state === 'patrol') {
      const spot = bot.patrol[bot.patrolIdx % bot.patrol.length];
      const dx = spot[0] - bot.position.x;
      const dz = spot[1] - bot.position.z;
      if (Math.hypot(dx, dz) < 0.8) {
        bot.patrolIdx += 1;
      } else {
        setPath(bot, spot[0], spot[1]);
        walkPath(bot, dt, PATROL_SPEED);
      }
      bot.group.position.copy(bot.position);
      bot.group.rotation.y = bot.yaw;
      return;
    }

    // hold: stand at the hold spot, scan slowly.
    const hx = bot.holdSpot[0] - bot.position.x;
    const hz = bot.holdSpot[1] - bot.position.z;
    if (Math.hypot(hx, hz) > 0.5) {
      setPath(bot, bot.holdSpot[0], bot.holdSpot[1]);
      walkPath(bot, dt, PATROL_SPEED);
    } else {
      bot.yaw += Math.sin(now * 0.5 + bot.index * 2.1) * 0.0035;
    }
    bot.group.position.copy(bot.position);
    bot.group.rotation.y = bot.yaw;
  }

  return {
    bots,
    hitMeshes,
    step(dt, time, ctx) {
      now = time;
      for (const bot of bots) stepBot(bot, dt, ctx);
      // After the bomb is planted, the closest living bot goes to defuse it.
      if (ctx.bombPlanted && ctx.playerAlive === false) {
        let best = null;
        let bestDist = Infinity;
        for (const bot of bots) {
          if (!bot.alive || bot.state === 'defuse') continue;
          const dx = ctx.bomb.x - bot.position.x;
          const dz = ctx.bomb.z - bot.position.z;
          const d = dx * dx + dz * dz;
          if (d < bestDist) {
            bestDist = d;
            best = bot;
          }
        }
        if (best && best.state !== 'defuse') {
          best.state = 'defuse';
          best.defuseT = 0;
        }
      } else if (ctx.bombPlanted) {
        let defuser = null;
        for (const bot of bots) if (bot.alive && bot.state === 'defuse') defuser = bot;
        if (!defuser) {
          let best = null;
          let bestDist = Infinity;
          for (const bot of bots) {
            if (!bot.alive) continue;
            const dx = ctx.bomb.x - bot.position.x;
            const dz = ctx.bomb.z - bot.position.z;
            const d = dx * dx + dz * dz;
            if (d < bestDist) {
              bestDist = d;
              best = bot;
            }
          }
          if (best) {
            best.state = 'defuse';
            best.defuseT = 0;
          }
        }
      }
    },
    damage(mesh, amount) {
      const bot = mesh.userData.bot;
      if (!bot || !bot.alive) return false;
      bot.health -= amount;
      bot.torsoMat.emissive = new THREE.Color(PALETTE.accent);
      bot.torsoMat.emissiveIntensity = 0.9;
      setTimeout(() => {
        bot.torsoMat.emissiveIntensity = 0;
      }, 90);
      if (bot.health > 0) return false;
      bot.alive = false;
      bot.fall = 0;
      bot.state = 'dead';
      return true;
    },
    aliveCount() {
      return bots.filter((bot) => bot.alive).length;
    },
    aimPoint(index) {
      const bot = bots[index % bots.length];
      return new THREE.Vector3(bot.position.x, 1.1, bot.position.z);
    },
    reset(spawns) {
      for (let i = 0; i < bots.length; i += 1) {
        const bot = bots[i];
        const spawn = spawns[i % spawns.length];
        bot.position.set(spawn.x, 0, spawn.z);
        bot.yaw = Math.PI;
        bot.health = HEALTH;
        bot.alive = true;
        bot.state = bot.role === 'site' ? 'hold' : 'patrol';
        bot.patrolIdx = 0;
        bot.path = [];
        bot.pathIdx = 0;
        bot.hasKnown = false;
        bot.burstLeft = 0;
        bot.pauseUntil = 0;
        bot.defuseT = 0;
        bot.fall = 0;
        bot.blindUntil = 0;
        bot.group.rotation.set(0, bot.yaw, 0);
        bot.group.position.copy(bot.position);
        bot.torsoMat.emissiveIntensity = 0;
      }
    },
  };
}
