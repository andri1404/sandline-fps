// The fighters: five defenders holding Site A, and four teammates fighting
// beside the player — a real 5v5. One agent system serves both sides: each
// agent has a job, a patrol, eyes and ears. Agents walk waypoint routes, hold
// angles, react to what they see and hear, shoot back in bursts, and the
// defenders converge on a planted bomb to defuse it while a teammate that
// reaches Site A plants the charge. One job per function; the sim never
// allocates in its hot loops.
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
const PLANT_SECONDS = 3;
const FALL_SECONDS = 0.45;

const ROLES = ['siteA', 'siteA', 'siteB', 'siteB', 'mid'];
const HOLD_SPOTS = [
  [-6, -13.5],
  [6, -13.5],
  [24, -13.5],
  [32, -13.5],
  [0, -6],
];
const PATROLS = [
  [[6, -14], [-6, -14], [0, -12]],
  [[-6, -14], [6, -14], [0, -16]],
  [[32, -14], [24, -14], [28, -12]],
  [[24, -14], [32, -14], [28, -16]],
  [[0, -8], [0, 2], [7, -8], [0, -8], [13, -7]],
];

const TEAM_NAMES = ['VIPER', 'JINX', 'ORYX', 'NOVA'];
const TEAM_TORSO = ['ink', 'muted', 'surface', 'hairline'];
// One push route per mate per site. VIPER and JINX default to Site A, ORYX and
// NOVA to Site B, so the squad splits and the defenders cannot stack one site.
const TEAM_PATROLS_A = [
  [[0, 15], [0, 8], [0, 0], [0, -8], [0, -14]], // VIPER: mid to A
  [[-2, 15], [-8, 14], [-13, 9], [-13, 3], [-13, -7], [-7, -8], [0, -14]], // JINX: west to A
  [[2, 15], [8, 14], [13, 9], [13, 3], [13, -7], [7, -8], [0, -14]], // ORYX: east to A
  [[1, 15], [7, 5], [0, 0], [0, -8], [0, -14]], // NOVA: mid to A
];
const TEAM_PATROLS_B = [
  [[0, 15], [0, 8], [0, 0], [0, -8], [7, -8], [13, -7], [23, -7], [28, -14]], // VIPER: mid, east wing to B
  [[-2, 15], [-8, 14], [-13, 9], [-13, 3], [-13, -7], [0, -8], [7, -8], [13, -7], [23, -7], [28, -14]], // JINX: west, across to B
  [[2, 15], [8, 14], [13, 9], [13, 3], [13, -7], [23, -7], [28, -7], [28, -14]], // ORYX: east lane to B
  [[1, 15], [7, 5], [0, 0], [0, -8], [7, -8], [13, -7], [23, -7], [28, -7], [28, -14]], // NOVA: mid, east wing to B
];
const TEAM_HOLD_A = [
  [-2, -13],
  [2, -13],
  [-2, -16],
  [2, -16],
];
const TEAM_HOLD_B = [
  [26, -13],
  [30, -13],
  [26, -16],
  [30, -16],
];
const TEAM_DEFAULT_SITE = ['A', 'A', 'B', 'B'];

function holdSpotFor(site, index) {
  return site === 'B' ? TEAM_HOLD_B[index] : TEAM_HOLD_A[index];
}

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

// Slab test: distance along the ray to a box, or null. The caller reuses its
// two box vectors; this function allocates nothing.
const boxMaxTmp = new THREE.Vector3();
const boxMinTmp = new THREE.Vector3();
function rayHitsBox(origin, dir, min, max) {
  boxMaxTmp.copy(max);
  let tmin = 0;
  let tmax = Infinity;
  const axes = ['x', 'y', 'z'];
  for (let i = 0; i < 3; i += 1) {
    const axis = axes[i];
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

export function createBots(scene, world, random) {
  const waypoints = world.waypoints;
  const gearMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.8 });
  const torsoGeo = new THREE.BoxGeometry(0.52, 0.72, 0.3);
  const headGeo = new THREE.SphereGeometry(0.16, 14, 10);
  const legGeo = new THREE.BoxGeometry(0.2, 0.72, 0.22);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.55);
  const flashGeo = new THREE.PlaneGeometry(0.3, 0.3);

  const bots = [];
  const hitMeshes = [];
  let now = 0;
  let retakeFlashThrown = false; // one covering flash per planted bomb

  const eye = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const moveDir = new THREE.Vector3();

  // Build one agent's body. Defenders wear ember helmets; teammates wear warm
  // white ones, so the two sides read at a glance. Torso colour varies per
  // teammate; defenders all wear rust gear.
  function buildAgent(team, index, name, torsoColor) {
    const group = new THREE.Group();
    const torsoMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE[torsoColor]), roughness: 0.7, metalness: 0.05 });
    const helmMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(team === 'def' ? PALETTE.accent : PALETTE.ink),
      roughness: 0.45,
      metalness: 0.1,
    });
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
      if (mesh.isMesh) mesh.castShadow = true;
    });
    scene.add(group);
    return {
      index,
      team,
      name,
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
      holdSpot: [0, 0],
      patrol: [],
      patrolIdx: 0,
      path: [],
      pathIdx: 0,
      lastKnown: new THREE.Vector3(),
      hasKnown: false,
      target: null, // { kind: 'player' | 'mate' | 'def', ref, x, z }
      thinkAt: index * 0.05,
      reactionAt: 0,
      burstLeft: 0,
      shotAt: 0,
      pauseUntil: 0,
      strafeDir: 1,
      strafeAt: 0,
      loseSightAt: 0,
      investigateAt: 0,
      flashUntil: 0,
      blindUntil: 0,
      defuseT: 0,
      plantT: 0,
      fall: 0,
      walkPhase: random() * 6,
      speed: PATROL_SPEED,
      kills: 0,
      calloutAt: 0,
      flashLeft: 1, // one flashbang per round, lobbed at a noise or a retake
    };
  }

  for (let index = 0; index < 5; index += 1) {
    const bot = buildAgent('def', index, ['HAVOC', 'SABLE', 'ROOK', 'DUSK', 'FALCON'][index], 'hairline');
    bot.role = ROLES[index];
    bot.holdSpot = HOLD_SPOTS[index];
    bot.patrol = PATROLS[index];
    bot.state = bot.role === 'mid' ? 'patrol' : 'hold';
    bot.torso.userData.bot = bot;
    bot.head.userData.bot = bot;
    hitMeshes.push(bot.torso, bot.head);
    bots.push(bot);
  }

  function canSeePoint(agent, tx, tz, eyeY, ctx) {
    const dx = tx - agent.position.x;
    const dz = tz - agent.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > SIGHT_RANGE) return false;
    const forwardX = -Math.sin(agent.yaw);
    const forwardZ = -Math.cos(agent.yaw);
    if (dist > 0.5 && (dx * forwardX + dz * forwardZ) / dist < Math.cos(SIGHT_HALF_ANGLE)) return false;
    eye.set(agent.position.x, EYE_HEIGHT, agent.position.z);
    if (world.blocked(eye.x, eye.y, eye.z, tx, eyeY, tz)) return false;
    if (ctx.smokeBlocks && ctx.smokeBlocks(eye.x, eye.y, eye.z, tx, eyeY, tz)) return false;
    return true;
  }

  // Nearest visible attacker for a defender: the player, then the teammates.
  function pickAttacker(agent, ctx) {
    let best = null;
    let bestD = Infinity;
    for (const t of ctx.attackers) {
      if (!t.alive) continue;
      const dx = t.x - agent.position.x;
      const dz = t.z - agent.position.z;
      const d = dx * dx + dz * dz;
      if (d >= bestD) continue;
      if (!canSeePoint(agent, t.x, t.z, t.y + t.eye, ctx)) continue;
      best = t;
      bestD = d;
    }
    return best;
  }

  // Lob a grenade from an agent toward a point: the throw arcs up so it clears
  // the cover between them. Consumes one of the agent's grenades.
  function throwAt(agent, kind, tx, tz, ctx) {
    if (!ctx.throwGrenade) return;
    eye.set(agent.position.x, EYE_HEIGHT, agent.position.z);
    toTarget.set(tx - eye.x, 1.2 - eye.y, tz - eye.z).normalize();
    toTarget.y += 0.35;
    toTarget.normalize();
    ctx.throwGrenade(kind, eye, toTarget);
  }

  function setPath(agent, x, z) {
    // Rebuild only when the destination itself changes. Rebuilding every
    // step resets pathIdx to 0, which pins the agent to the nearest
    // waypoint node forever — and a path only runs node to node, so the
    // last metres to an off-node target are walked directly (see walkPath).
    if (agent.path && agent.pathTargetX === x && agent.pathTargetZ === z) return;
    const from = nearestNode(waypoints, agent.position.x, agent.position.z);
    const to = nearestNode(waypoints, x, z);
    agent.path = findPath(waypoints, from, to);
    agent.pathIdx = 0;
    agent.pathTargetX = x;
    agent.pathTargetZ = z;
  }

  function walkPath(agent, dt, speed) {
    // Aim at the next path node, or at the exact target once the nodes run
    // out (a path only runs node to node, so the last metres to an off-node
    // target are walked directly).
    const onFinalLeg = agent.pathIdx >= agent.path.length;
    let tx;
    let tz;
    if (!onFinalLeg) {
      const node = waypoints[agent.path[agent.pathIdx]];
      tx = node[0];
      tz = node[1];
    } else {
      if (agent.pathTargetX === undefined) return true;
      tx = agent.pathTargetX;
      tz = agent.pathTargetZ;
    }
    const dx = tx - agent.position.x;
    const dz = tz - agent.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6) {
      if (!onFinalLeg) {
        agent.pathIdx += 1;
        agent.stuckT = 0;
        agent.lastNodeDist = Infinity;
        return false;
      }
      return true;
    }
    // Stuck detection: if the agent is not closing on its target it is
    // pressed against a prop. Sidestep around it instead of pushing into
    // it forever — the map's crates and containers sit on several edges.
    if (dist > agent.lastNodeDist - 0.02) agent.stuckT = (agent.stuckT || 0) + dt;
    else agent.stuckT = 0;
    agent.lastNodeDist = dist;
    let mx = dx / dist;
    let mz = dz / dist;
    if (agent.stuckT > 0.6) {
      if (!agent.avoidDir) agent.avoidDir = random() < 0.5 ? -1 : 1;
      const px = -mz * agent.avoidDir;
      const pz = mx * agent.avoidDir;
      const inv = 1 / Math.SQRT2;
      mx = (mx + px) * inv;
      mz = (mz + pz) * inv;
      if (agent.stuckT > 1.6) {
        agent.stuckT = 0;
        agent.avoidDir = 0;
      }
    }
    agent.yaw = Math.atan2(-mx, -mz);
    moveAxis(agent, mx * speed * dt, 0);
    moveAxis(agent, 0, mz * speed * dt);
    agent.walkPhase += dt * speed * 2.2;
    return false;
  }

  function moveAxis(agent, dx, dz) {
    const nextX = agent.position.x + dx;
    if (!world.collides(nextX, 0, agent.position.z, BOT_HEIGHT, BOT_RADIUS, 0.04)) agent.position.x = nextX;
    const nextZ = agent.position.z + dz;
    if (!world.collides(agent.position.x, 0, nextZ, BOT_HEIGHT, BOT_RADIUS, 0.04)) agent.position.z = nextZ;
  }

  function applyDamage(agent, amount) {
    if (!agent.alive) return false;
    agent.health -= amount;
    agent.torsoMat.emissive = new THREE.Color(PALETTE.accent);
    agent.torsoMat.emissiveIntensity = 0.9;
    setTimeout(() => {
      agent.torsoMat.emissiveIntensity = 0;
    }, 90);
    if (agent.health > 0) return false;
    agent.alive = false;
    agent.fall = 0;
    agent.state = 'dead';
    agent.target = null;
    return true;
  }

  function targetPoint(agent, ctx) {
    const t = agent.target;
    if (!t) return null;
    if (t.kind === 'player') {
      if (!ctx.playerAlive) return null;
      return { x: ctx.playerPos.x, y: ctx.playerPos.y, z: ctx.playerPos.z, eye: ctx.playerEye, height: ctx.playerHeight, speed: ctx.playerSpeed, alive: true };
    }
    const ref = t.ref;
    if (!ref || !ref.alive) return null;
    return { x: ref.position.x, y: 0, z: ref.position.z, eye: EYE_HEIGHT, height: BOT_HEIGHT, speed: 0, alive: true };
  }

  // One burst of fire at the agent's current target. Works for either side:
  // the target is resolved live, the ray is tested against its body box, and
  // the hit is routed to the player or to an agent.
  function shootAt(agent, ctx) {
    const point = targetPoint(agent, ctx);
    if (!point) return;
    if (now < agent.reactionAt || now < agent.pauseUntil) return;
    if (agent.burstLeft <= 0) {
      agent.burstLeft = BURST_MIN + Math.floor(random() * (BURST_MAX - BURST_MIN + 1));
      agent.shotAt = now;
    }
    if (now - agent.shotAt < SHOT_GAP) return;
    agent.shotAt = now;
    agent.burstLeft -= 1;
    if (agent.burstLeft === 0) agent.pauseUntil = now + 0.6 + random() * 0.5;

    const px = point.x;
    const py = point.y + point.eye * 0.82;
    const pz = point.z;
    const dist = Math.hypot(px - agent.position.x, pz - agent.position.z);
    const spread = 0.028 + dist * 0.0009 + (point.speed > 3 ? 0.02 : 0);
    eye.set(agent.position.x, EYE_HEIGHT, agent.position.z);
    toTarget.set(px - eye.x, py - eye.y, pz - eye.z).normalize();
    toTarget.x += (random() * 2 - 1) * spread;
    toTarget.y += (random() * 2 - 1) * spread;
    toTarget.z += (random() * 2 - 1) * spread;
    toTarget.normalize();
    agent.flash.visible = true;
    agent.flashUntil = now + 0.05;
    ctx.onAgentShot(agent, eye, toTarget);

    // The shot is a ray against the target's body box and head sphere.
    boxMinTmp.set(px - BOT_RADIUS, point.y, pz - BOT_RADIUS);
    boxMaxTmp.set(px + BOT_RADIUS, point.y + point.height, pz + BOT_RADIUS);
    const hit = rayHitsBox(eye, toTarget, boxMinTmp, boxMaxTmp);
    if (hit === null) return;
    if (world.blocked(eye.x, eye.y, eye.z, eye.x + toTarget.x * hit, eye.y + toTarget.y * hit, eye.z + toTarget.z * hit)) return;
    if (ctx.smokeBlocks && ctx.smokeBlocks(eye.x, eye.y, eye.z, eye.x + toTarget.x * hit, eye.y + toTarget.y * hit, eye.z + toTarget.z * hit)) return;
    const hitY = eye.y + toTarget.y * hit;
    const isHead = hitY > point.y + point.eye + 0.08;
    const dmg = isHead ? DAMAGE * HEAD_MULT : DAMAGE;
    const target = agent.target;
    if (target.kind === 'player') {
      ctx.onPlayerHit(dmg, isHead, agent);
      return;
    }
    const victim = target.ref;
    const killed = applyDamage(victim, dmg);
    if (!killed) return;
    agent.kills += 1;
    ctx.onKillFeed(`${agent.name} — ${victim.name}${isHead ? ' (headshot)' : ''}`);
    if (victim.team === 'def') ctx.onDefenderDown(victim);
    else ctx.onMateDown(victim);
  }

  function thinkDefender(bot, ctx) {
    if (now < bot.thinkAt) return;
    bot.thinkAt = now + 0.12 + random() * 0.06;
    if (now < bot.blindUntil) return;
    const seen = pickAttacker(bot, ctx);
    if (seen) {
      bot.lastKnown.set(seen.x, 0, seen.z);
      bot.hasKnown = true;
      if (bot.state !== 'engage') {
        bot.state = 'engage';
        bot.reactionAt = now + 0.35 + random() * 0.3;
        bot.burstLeft = 0;
      }
      bot.target = seen;
      bot.loseSightAt = now + 1.2;
      return;
    }
    if (bot.state === 'engage' && now > bot.loseSightAt) {
      bot.state = 'investigate';
      bot.investigateAt = now;
      bot.target = null;
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
          bot.investigateAt = now;
          setPath(bot, event.x, event.z);
          // Lob a flash at the noise when it is close enough: the push in
          // is covered instead of walked blind.
          if (bot.flashLeft > 0 && Math.hypot(dx, dz) < 25 && random() < 0.5) {
            throwAt(bot, 'flash', event.x, event.z, ctx);
            bot.flashLeft -= 1;
          }
          break;
        }
      }
    }
  }

  function stepDefender(bot, dt, ctx) {
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / FALL_SECONDS);
      bot.group.rotation.x = -bot.fall * 1.5;
      bot.group.position.y = -bot.fall * 0.1;
      return;
    }
    thinkDefender(bot, ctx);
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
        // Group retake: only start the defuse when another defender is close
        // enough to cover, or when this bot is the last one standing. Walking
        // onto a held site alone to defuse is how retakes are lost.
        const others = bots.filter((b) => b.alive && b !== bot);
        const backupNear = others.length === 0 || others.some((b) => {
          const bx = ctx.bomb.x - b.position.x;
          const bz = ctx.bomb.z - b.position.z;
          return bx * bx + bz * bz < 12 * 12;
        });
        if (backupNear) {
          bot.defuseT += dt;
          if (bot.defuseT >= DEFUSE_SECONDS) ctx.onDefused(bot);
        } else {
          bot.yaw += Math.sin(now * 0.5 + bot.index * 2.1) * 0.0035;
        }
      }
      bot.group.position.copy(bot.position);
      bot.group.rotation.y = bot.yaw;
      return;
    }

    if (bot.state === 'retake') {
      // Converge on the planted site together. On arrival, hold the ground
      // taken and cover the defuser instead of piling onto the bomb.
      const dx = ctx.bomb.x - bot.position.x;
      const dz = ctx.bomb.z - bot.position.z;
      if (Math.hypot(dx, dz) > 2.5) {
        setPath(bot, ctx.bomb.x, ctx.bomb.z);
        walkPath(bot, dt, HUNT_SPEED);
      } else {
        bot.state = 'hold';
        bot.holdSpot = [bot.position.x, bot.position.z];
      }
      bot.group.position.copy(bot.position);
      bot.group.rotation.y = bot.yaw;
      return;
    }

    if (bot.state === 'engage') {
      const point = targetPoint(bot, ctx);
      if (!point) {
        bot.state = 'investigate';
        bot.investigateAt = now;
        bot.target = null;
        setPath(bot, bot.lastKnown.x, bot.lastKnown.z);
      } else {
        const dx = point.x - bot.position.x;
        const dz = point.z - bot.position.z;
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
        shootAt(bot, ctx);
      }
      bot.group.position.copy(bot.position);
      bot.group.rotation.y = bot.yaw;
      return;
    }

    if (bot.state === 'investigate') {
      // Give up after 8 s without reaching the spot: a target that cannot
      // be reached (or a last-known that keeps sliding) must not pin the
      // agent in place for the rest of the round.
      if (walkPath(bot, dt, HUNT_SPEED) || now - bot.investigateAt > 8) {
        bot.state = bot.role === 'mid' ? 'patrol' : 'hold';
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
      for (const bot of bots) stepDefender(bot, dt, ctx);
      // After the bomb is planted the defenders retake as a group: the
      // closest free defender becomes the defuser, the rest converge on the
      // site together instead of trickling in one by one. If the defuser
      // dies, the next closest free defender takes over.
      if (ctx.bombPlanted) {
        let defuser = null;
        for (const bot of bots) if (bot.alive && bot.state === 'defuse') defuser = bot;
        if (!defuser) {
          let best = null;
          let bestDist = Infinity;
          for (const bot of bots) {
            if (!bot.alive) continue;
            if (bot.state === 'engage' || bot.state === 'dead') continue;
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
            defuser = best;
          }
        }
        for (const bot of bots) {
          if (!bot.alive || bot === defuser) continue;
          if (bot.state === 'hold' || bot.state === 'patrol' || bot.state === 'investigate') {
            bot.state = 'retake';
            bot.path = null;
          }
        }
        // One flash to cover the push in: the closest retaker with a flash
        // left lobs it at the site as the group moves.
        if (!retakeFlashThrown) {
          let best = null;
          let bestDist = Infinity;
          for (const bot of bots) {
            if (!bot.alive || bot === defuser || bot.state !== 'retake' || bot.flashLeft <= 0) continue;
            const dx = ctx.bomb.x - bot.position.x;
            const dz = ctx.bomb.z - bot.position.z;
            const d = dx * dx + dz * dz;
            if (d < bestDist) {
              bestDist = d;
              best = bot;
            }
          }
          if (best && bestDist < 30 * 30 && random() < 0.7) {
            throwAt(best, 'flash', ctx.bomb.x, ctx.bomb.z, ctx);
            best.flashLeft -= 1;
          }
          retakeFlashThrown = true;
        }
      } else {
        retakeFlashThrown = false;
      }
    },
    damage(mesh, amount) {
      const bot = mesh.userData.bot;
      if (!bot || !bot.alive) return false;
      return applyDamage(bot, amount);
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
        bot.state = bot.role === 'mid' ? 'patrol' : 'hold';
        bot.target = null;
        bot.patrolIdx = 0;
        bot.path = null;
        bot.pathIdx = 0;
        bot.stuckT = 0;
        bot.lastNodeDist = Infinity;
        bot.avoidDir = 0;
        bot.investigateAt = 0;
        bot.hasKnown = false;
        bot.burstLeft = 0;
        bot.pauseUntil = 0;
        bot.defuseT = 0;
        bot.plantT = 0;
        bot.fall = 0;
        bot.blindUntil = 0;
        bot.kills = 0;
        bot.calloutAt = 0;
        bot.flashLeft = 1;
        bot.group.rotation.set(0, bot.yaw, 0);
        bot.group.position.copy(bot.position);
        bot.torsoMat.emissiveIntensity = 0;
      }
    },
  };
}

export function createTeammates(scene, world, random) {
  const waypoints = world.waypoints;
  const gearMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.8 });
  const torsoGeo = new THREE.BoxGeometry(0.52, 0.72, 0.3);
  const headGeo = new THREE.SphereGeometry(0.16, 14, 10);
  const legGeo = new THREE.BoxGeometry(0.2, 0.72, 0.22);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.55);
  const flashGeo = new THREE.PlaneGeometry(0.3, 0.3);

  const mates = [];
  let now = 0;

  const eye = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const moveDir = new THREE.Vector3();

  function buildMate(index) {
    const group = new THREE.Group();
    const torsoMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE[TEAM_TORSO[index]]), roughness: 0.7, metalness: 0.05 });
    const helmMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.45, metalness: 0.1 });
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
      if (mesh.isMesh) mesh.castShadow = true;
    });
    scene.add(group);
    return {
      index,
      team: 'att',
      name: TEAM_NAMES[index],
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
      state: 'patrol',
      holdSpot: TEAM_HOLD_A[index],
      patrol: TEAM_PATROLS_A[index],
      patrolIdx: 0,
      path: [],
      pathIdx: 0,
      lastKnown: new THREE.Vector3(),
      hasKnown: false,
      target: null,
      thinkAt: index * 0.05,
      reactionAt: 0,
      burstLeft: 0,
      shotAt: 0,
      pauseUntil: 0,
      strafeDir: 1,
      strafeAt: 0,
      loseSightAt: 0,
      investigateAt: 0,
      flashUntil: 0,
      blindUntil: 0,
      defuseT: 0,
      plantT: 0,
      fall: 0,
      walkPhase: random() * 6,
      speed: PATROL_SPEED,
      kills: 0,
      calloutAt: 0,
      smokeLeft: 1, // one smoke per round, thrown to cover a push
      targetSite: TEAM_DEFAULT_SITE[index],
      fakeSite: null, // the site this mate pretends to push, if faking
      fakeUntil: 0, // 0 = fake not started yet this round
      plantSite: null, // the site this mate is planting at, if any
    };
  }

  for (let index = 0; index < 4; index += 1) mates.push(buildMate(index));

  function canSeePoint(agent, tx, tz, eyeY, ctx) {
    const dx = tx - agent.position.x;
    const dz = tz - agent.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > SIGHT_RANGE) return false;
    const forwardX = -Math.sin(agent.yaw);
    const forwardZ = -Math.cos(agent.yaw);
    if (dist > 0.5 && (dx * forwardX + dz * forwardZ) / dist < Math.cos(SIGHT_HALF_ANGLE)) return false;
    eye.set(agent.position.x, EYE_HEIGHT, agent.position.z);
    if (world.blocked(eye.x, eye.y, eye.z, tx, eyeY, tz)) return false;
    if (ctx.smokeBlocks && ctx.smokeBlocks(eye.x, eye.y, eye.z, tx, eyeY, tz)) return false;
    return true;
  }

  function pickDefender(agent, ctx) {
    let best = null;
    let bestD = Infinity;
    for (const def of ctx.defenders) {
      if (!def.alive) continue;
      const dx = def.position.x - agent.position.x;
      const dz = def.position.z - agent.position.z;
      const d = dx * dx + dz * dz;
      if (d >= bestD) continue;
      if (!canSeePoint(agent, def.position.x, def.position.z, EYE_HEIGHT, ctx)) continue;
      best = def;
      bestD = d;
    }
    return best;
  }

  function nearestPatrolIndex(patrol, x, z) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < patrol.length; i += 1) {
      const dx = patrol[i][0] - x;
      const dz = patrol[i][1] - z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  function nearestDefenderWithin(agent, ctx, radius) {
    for (const def of ctx.defenders) {
      if (!def.alive) continue;
      const dx = def.position.x - agent.position.x;
      const dz = def.position.z - agent.position.z;
      if (dx * dx + dz * dz < radius * radius) return true;
    }
    return false;
  }

  // Lob a grenade from a mate toward a point: the throw arcs up so it clears
  // the cover between them. Consumes one of the mate's grenades.
  function throwAt(agent, kind, tx, tz, ctx) {
    if (!ctx.throwGrenade) return;
    eye.set(agent.position.x, EYE_HEIGHT, agent.position.z);
    toTarget.set(tx - eye.x, 1.2 - eye.y, tz - eye.z).normalize();
    toTarget.y += 0.35;
    toTarget.normalize();
    ctx.throwGrenade(kind, eye, toTarget);
  }

  function setPath(agent, x, z) {
    // Rebuild only when the destination itself changes. Rebuilding every
    // step resets pathIdx to 0, which pins the agent to the nearest
    // waypoint node forever — and a path only runs node to node, so the
    // last metres to an off-node target are walked directly (see walkPath).
    if (agent.path && agent.pathTargetX === x && agent.pathTargetZ === z) return;
    const from = nearestNode(waypoints, agent.position.x, agent.position.z);
    const to = nearestNode(waypoints, x, z);
    agent.path = findPath(waypoints, from, to);
    agent.pathIdx = 0;
    agent.pathTargetX = x;
    agent.pathTargetZ = z;
  }

  function walkPath(agent, dt, speed) {
    // Aim at the next path node, or at the exact target once the nodes run
    // out (a path only runs node to node, so the last metres to an off-node
    // target are walked directly).
    const onFinalLeg = agent.pathIdx >= agent.path.length;
    let tx;
    let tz;
    if (!onFinalLeg) {
      const node = waypoints[agent.path[agent.pathIdx]];
      tx = node[0];
      tz = node[1];
    } else {
      if (agent.pathTargetX === undefined) return true;
      tx = agent.pathTargetX;
      tz = agent.pathTargetZ;
    }
    const dx = tx - agent.position.x;
    const dz = tz - agent.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6) {
      if (!onFinalLeg) {
        agent.pathIdx += 1;
        agent.stuckT = 0;
        agent.lastNodeDist = Infinity;
        return false;
      }
      return true;
    }
    // Stuck detection: if the agent is not closing on its target it is
    // pressed against a prop. Sidestep around it instead of pushing into
    // it forever — the map's crates and containers sit on several edges.
    if (dist > agent.lastNodeDist - 0.02) agent.stuckT = (agent.stuckT || 0) + dt;
    else agent.stuckT = 0;
    agent.lastNodeDist = dist;
    let mx = dx / dist;
    let mz = dz / dist;
    if (agent.stuckT > 0.6) {
      if (!agent.avoidDir) agent.avoidDir = random() < 0.5 ? -1 : 1;
      const px = -mz * agent.avoidDir;
      const pz = mx * agent.avoidDir;
      const inv = 1 / Math.SQRT2;
      mx = (mx + px) * inv;
      mz = (mz + pz) * inv;
      if (agent.stuckT > 1.6) {
        agent.stuckT = 0;
        agent.avoidDir = 0;
      }
    }
    agent.yaw = Math.atan2(-mx, -mz);
    moveAxis(agent, mx * speed * dt, 0);
    moveAxis(agent, 0, mz * speed * dt);
    agent.walkPhase += dt * speed * 2.2;
    return false;
  }

  function moveAxis(agent, dx, dz) {
    const nextX = agent.position.x + dx;
    if (!world.collides(nextX, 0, agent.position.z, BOT_HEIGHT, BOT_RADIUS, 0.04)) agent.position.x = nextX;
    const nextZ = agent.position.z + dz;
    if (!world.collides(agent.position.x, 0, nextZ, BOT_HEIGHT, BOT_RADIUS, 0.04)) agent.position.z = nextZ;
  }

  function applyDamage(agent, amount) {
    if (!agent.alive) return false;
    agent.health -= amount;
    agent.torsoMat.emissive = new THREE.Color(PALETTE.accent);
    agent.torsoMat.emissiveIntensity = 0.9;
    setTimeout(() => {
      agent.torsoMat.emissiveIntensity = 0;
    }, 90);
    if (agent.health > 0) return false;
    agent.alive = false;
    agent.fall = 0;
    agent.state = 'dead';
    agent.target = null;
    return true;
  }

  function targetPoint(agent, ctx) {
    const ref = agent.target;
    if (!ref || !ref.alive) return null;
    return { x: ref.position.x, y: 0, z: ref.position.z, eye: EYE_HEIGHT, height: BOT_HEIGHT, speed: 0, alive: true };
  }

  function shootAt(agent, ctx) {
    const point = targetPoint(agent, ctx);
    if (!point) return;
    if (now < agent.reactionAt || now < agent.pauseUntil) return;
    if (agent.burstLeft <= 0) {
      agent.burstLeft = BURST_MIN + Math.floor(random() * (BURST_MAX - BURST_MIN + 1));
      agent.shotAt = now;
    }
    if (now - agent.shotAt < SHOT_GAP) return;
    agent.shotAt = now;
    agent.burstLeft -= 1;
    if (agent.burstLeft === 0) agent.pauseUntil = now + 0.6 + random() * 0.5;

    const px = point.x;
    const py = point.y + point.eye * 0.82;
    const pz = point.z;
    const dist = Math.hypot(px - agent.position.x, pz - agent.position.z);
    const spread = 0.028 + dist * 0.0009;
    eye.set(agent.position.x, EYE_HEIGHT, agent.position.z);
    toTarget.set(px - eye.x, py - eye.y, pz - eye.z).normalize();
    toTarget.x += (random() * 2 - 1) * spread;
    toTarget.y += (random() * 2 - 1) * spread;
    toTarget.z += (random() * 2 - 1) * spread;
    toTarget.normalize();
    agent.flash.visible = true;
    agent.flashUntil = now + 0.05;
    ctx.onAgentShot(agent, eye, toTarget);

    boxMinTmp.set(px - BOT_RADIUS, point.y, pz - BOT_RADIUS);
    boxMaxTmp.set(px + BOT_RADIUS, point.y + point.height, pz + BOT_RADIUS);
    const hit = rayHitsBox(eye, toTarget, boxMinTmp, boxMaxTmp);
    if (hit === null) return;
    if (world.blocked(eye.x, eye.y, eye.z, eye.x + toTarget.x * hit, eye.y + toTarget.y * hit, eye.z + toTarget.z * hit)) return;
    if (ctx.smokeBlocks && ctx.smokeBlocks(eye.x, eye.y, eye.z, eye.x + toTarget.x * hit, eye.y + toTarget.y * hit, eye.z + toTarget.z * hit)) return;
    const hitY = eye.y + toTarget.y * hit;
    const isHead = hitY > point.y + point.eye + 0.08;
    const dmg = isHead ? DAMAGE * HEAD_MULT : DAMAGE;
    const victim = agent.target;
    const killed = applyDamage(victim, dmg);
    if (!killed) return;
    agent.kills += 1;
    ctx.onKillFeed(`${agent.name} — ${victim.name}${isHead ? ' (headshot)' : ''}`);
    ctx.onDefenderDown(victim);
  }

  function callout(mate, ctx, text) {
    if (now < mate.calloutAt) return;
    mate.calloutAt = now + 7;
    ctx.onCallout(text);
  }

  function thinkMate(mate, ctx) {
    if (now < mate.thinkAt) return;
    mate.thinkAt = now + 0.12 + random() * 0.06;
    if (now < mate.blindUntil) return;
    // Fake push: a mate assigned to fake starts on the other site's route
    // and rotates to the real target after 12 s, dragging defenders with it.
    // The patrol resumes from its nearest node, never from the spawn.
    if (mate.fakeSite) {
      if (mate.fakeUntil === 0) mate.fakeUntil = now + 12;
      else if (now >= mate.fakeUntil) {
        mate.fakeSite = null;
        mate.fakeUntil = 0;
        mate.patrol = mate.targetSite === 'B' ? TEAM_PATROLS_B[mate.index] : TEAM_PATROLS_A[mate.index];
        mate.patrolIdx = nearestPatrolIndex(mate.patrol, mate.position.x, mate.position.z);
        mate.path = null;
        mate.holdSpot = holdSpotFor(mate.targetSite, mate.index);
        callout(mate, ctx, `${mate.name}: Rotating to Site ${mate.targetSite}!`);
      }
    }
    // The bomb is down at a site: stop pushing the other one and go hold the
    // plant instead of arriving late.
    if (ctx.bombPlanted && mate.state === 'patrol') {
      mate.state = 'hold';
      mate.holdSpot = holdSpotFor(ctx.bombSite, mate.index);
      mate.path = null;
    }
    const seen = pickDefender(mate, ctx);
    if (seen) {
      mate.lastKnown.set(seen.position.x, 0, seen.position.z);
      mate.hasKnown = true;
      if (mate.state !== 'engage') {
        mate.state = 'engage';
        mate.reactionAt = now + 0.35 + random() * 0.3;
        mate.burstLeft = 0;
        callout(mate, ctx, `${mate.name}: Contact — ${seen.name} in sight!`);
        // Smoke the push when the fight is at range: cover the advance
        // instead of trading shots across open ground.
        if (mate.smokeLeft > 0) {
          const d = Math.hypot(seen.position.x - mate.position.x, seen.position.z - mate.position.z);
          if (d > 8 && d < 26 && random() < 0.4) {
            throwAt(mate, 'smoke', seen.position.x, seen.position.z, ctx);
            mate.smokeLeft -= 1;
          }
        }
      }
      mate.target = seen;
      mate.loseSightAt = now + 1.2;
      return;
    }
    if (mate.state === 'engage' && now > mate.loseSightAt) {
      mate.state = 'investigate';
      mate.investigateAt = now;
      mate.target = null;
      setPath(mate, mate.lastKnown.x, mate.lastKnown.z);
    }
    // Reach a site with the coast clear and the bomb still in hand: plant it.
    // Only from a calm state — never mid-fight.
    const site = ctx.siteAt ? ctx.siteAt(mate.position.x, mate.position.z) : null;
    if (site && (mate.state === 'patrol' || mate.state === 'hold') && ctx.bombLive() === 'idle' && !nearestDefenderWithin(mate, ctx, 14)) {
      mate.state = 'plant';
      mate.plantT = 0;
      mate.plantSite = site;
      callout(mate, ctx, `${mate.name}: Planting at Site ${site} — cover me!`);
      ctx.onMateStartPlant(mate, site);
    }
    if (mate.state !== 'engage' && ctx.noise) {
      for (const event of ctx.noise) {
        if (now - event.at > 2) continue;
        const dx = event.x - mate.position.x;
        const dz = event.z - mate.position.z;
        if (dx * dx + dz * dz < event.radius * event.radius) {
          mate.lastKnown.set(event.x, 0, event.z);
          mate.hasKnown = true;
          mate.state = 'investigate';
          mate.investigateAt = now;
          setPath(mate, event.x, event.z);
          break;
        }
      }
    }
  }

  function stepMate(mate, dt, ctx) {
    if (!mate.alive) {
      mate.fall = Math.min(1, mate.fall + dt / FALL_SECONDS);
      mate.group.rotation.x = -mate.fall * 1.5;
      mate.group.position.y = -mate.fall * 0.1;
      return;
    }
    thinkMate(mate, ctx);
    if (now < mate.blindUntil) {
      mate.group.position.copy(mate.position);
      return;
    }
    mate.flash.visible = now < mate.flashUntil;

    if (mate.state === 'plant') {
      // Stand still and hold the plant. Only a defender closing in breaks it
      // off — being watched from across the yard does not, or the plant could
      // never finish while any defender holds an angle on the site. The bomb
      // status is read live: the context snapshot is taken before thinkMate
      // runs, so it still says 'idle' in the very step the plant starts.
      const close = nearestDefenderWithin(mate, ctx, 12);
      const seen = close ? pickDefender(mate, ctx) : null;
      const live = ctx.bombLive();
      const siteNow = ctx.siteAt ? ctx.siteAt(mate.position.x, mate.position.z) : null;
      if (live === 'planted') {
        // The charge is in — hold the site.
        mate.state = 'hold';
        mate.target = null;
        mate.holdSpot = holdSpotFor(ctx.bombSite, mate.index);
      } else if (close || siteNow !== mate.plantSite || live !== 'planting') {
        if (live === 'planting') ctx.onMateCancelPlant(mate);
        mate.state = seen ? 'engage' : 'patrol';
        mate.target = seen || null;
        if (seen) {
          mate.reactionAt = now + 0.35;
          mate.burstLeft = 0;
        }
      } else {
        mate.yaw = Math.atan2(-(ctx.bomb.x - mate.position.x), -(ctx.bomb.z - mate.position.z));
      }
      mate.group.position.copy(mate.position);
      mate.group.rotation.y = mate.yaw;
      return;
    }

    if (mate.state === 'engage') {
      const point = targetPoint(mate, ctx);
      if (!point) {
        mate.state = 'investigate';
        mate.investigateAt = now;
        mate.target = null;
        setPath(mate, mate.lastKnown.x, mate.lastKnown.z);
      } else {
        const dx = point.x - mate.position.x;
        const dz = point.z - mate.position.z;
        const dist = Math.hypot(dx, dz);
        mate.yaw = Math.atan2(-dx, -dz);
        if (now > mate.strafeAt) {
          mate.strafeAt = now + 1.2 + random() * 0.8;
          mate.strafeDir = random() < 0.5 ? -1 : 1;
        }
        if (dist > 14) {
          moveDir.set(dx / dist, 0, dz / dist);
          moveAxis(mate, moveDir.x * AIM_SPEED * dt, 0);
          moveAxis(mate, 0, moveDir.z * AIM_SPEED * dt);
        } else if (dist < 5) {
          moveDir.set(-dx / dist, 0, -dz / dist);
          moveAxis(mate, moveDir.x * AIM_SPEED * dt, 0);
          moveAxis(mate, 0, moveDir.z * AIM_SPEED * dt);
        } else {
          const sx = (-dz / dist) * mate.strafeDir;
          const sz = (dx / dist) * mate.strafeDir;
          moveAxis(mate, sx * AIM_SPEED * dt, 0);
          moveAxis(mate, 0, sz * AIM_SPEED * dt);
        }
        shootAt(mate, ctx);
      }
      mate.group.position.copy(mate.position);
      mate.group.rotation.y = mate.yaw;
      return;
    }

    if (mate.state === 'investigate') {
      // Same 8 s give-up as the defenders: never pin the squad in place.
      if (walkPath(mate, dt, HUNT_SPEED) || now - mate.investigateAt > 8) {
        mate.state = ctx.bombPlanted ? 'hold' : 'patrol';
        if (ctx.bombPlanted) mate.holdSpot = holdSpotFor(ctx.bombSite, mate.index);
        mate.patrolIdx = 0;
      }
      mate.group.position.copy(mate.position);
      mate.group.rotation.y = mate.yaw;
      return;
    }

    if (mate.state === 'patrol') {
      const spot = mate.patrol[mate.patrolIdx % mate.patrol.length];
      const dx = spot[0] - mate.position.x;
      const dz = spot[1] - mate.position.z;
      if (Math.hypot(dx, dz) < 0.8) {
        mate.patrolIdx += 1;
        if (mate.patrolIdx >= mate.patrol.length) {
          // Reached the end of the push: hold the site.
          mate.state = 'hold';
        }
      } else {
        setPath(mate, spot[0], spot[1]);
        walkPath(mate, dt, PATROL_SPEED);
      }
      mate.group.position.copy(mate.position);
      mate.group.rotation.y = mate.yaw;
      return;
    }

    // hold: stand at the hold spot near the site, scan slowly.
    const hx = mate.holdSpot[0] - mate.position.x;
    const hz = mate.holdSpot[1] - mate.position.z;
    if (Math.hypot(hx, hz) > 0.5) {
      setPath(mate, mate.holdSpot[0], mate.holdSpot[1]);
      walkPath(mate, dt, PATROL_SPEED);
    } else {
      mate.yaw += Math.sin(now * 0.5 + mate.index * 2.1) * 0.0035;
    }
    mate.group.position.copy(mate.position);
    mate.group.rotation.y = mate.yaw;
  }

  return {
    mates,
    step(dt, time, ctx) {
      now = time;
      for (const mate of mates) stepMate(mate, dt, ctx);
    },
    aliveCount() {
      return mates.filter((mate) => mate.alive).length;
    },
    reset(spawns) {
      // One fake per round at most: a 30% roll picks one mate to start on the
      // other site's route and rotate to the real target after 12 s.
      const fakeIdx = random() < 0.3 ? Math.floor(random() * mates.length) : -1;
      for (let i = 0; i < mates.length; i += 1) {
        const mate = mates[i];
        const spawn = spawns[i % spawns.length];
        mate.position.set(spawn.x, 0, spawn.z);
        mate.yaw = Math.PI;
        mate.health = HEALTH;
        mate.alive = true;
        mate.state = 'patrol';
        mate.target = null;
        mate.patrolIdx = 0;
        mate.path = null;
        mate.pathIdx = 0;
        mate.stuckT = 0;
        mate.lastNodeDist = Infinity;
        mate.avoidDir = 0;
        mate.investigateAt = 0;
        mate.hasKnown = false;
        mate.burstLeft = 0;
        mate.pauseUntil = 0;
        mate.defuseT = 0;
        mate.plantT = 0;
        mate.fall = 0;
        mate.blindUntil = 0;
        mate.kills = 0;
        mate.calloutAt = 0;
        mate.smokeLeft = 1;
        mate.targetSite = TEAM_DEFAULT_SITE[i];
        mate.fakeSite = i === fakeIdx ? (mate.targetSite === 'A' ? 'B' : 'A') : null;
        mate.fakeUntil = 0;
        mate.plantSite = null;
        const routeSite = mate.fakeSite || mate.targetSite;
        mate.patrol = routeSite === 'B' ? TEAM_PATROLS_B[i] : TEAM_PATROLS_A[i];
        mate.holdSpot = holdSpotFor(mate.targetSite, i);
        mate.group.rotation.set(0, mate.yaw, 0);
        mate.group.position.copy(mate.position);
        mate.torsoMat.emissiveIntensity = 0;
      }
    },
  };
}
