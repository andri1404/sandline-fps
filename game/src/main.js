// SANDLINE: boot and the one loop. A fixed 60 Hz simulation feeds a render at the
// display's rate. One game state lives here; every module owns its own numbers.
// ?shot=start|play|buy|end with &seed=N sets up a deterministic frame, renders it
// twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons, WEAPONS, SHOP } from './weapons.js';
import { createBots, createTeammates } from './bots.js';
import { createEconomy, REWARDS } from './economy.js';
import { createBomb, FUSE_SECONDS } from './bomb.js';
import { createGrenades } from './grenades.js';
import { createRounds } from './rounds.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const BASE_FOV = 74;
const BOT_NAMES = ['HAVOC', 'SABLE', 'ROOK', 'DUSK', 'FALCON'];
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 20, 52);
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const bots = createBots(scene, world, random);
const mates = createTeammates(scene, world, random);
const weapons = createWeapons(camera);
const hud = createHud();
const player = createPlayer(world.collides);
const input = createInput(renderer.domElement, onLockChange);
const audio = createAudio();
const economy = createEconomy();
const bomb = createBomb(scene, world.site);
const grenades = createGrenades(scene, world);
const rounds = createRounds();

const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const shootables = world.shootables.concat(bots.hitMeshes);
const direction = new THREE.Vector3();
const camPos = new THREE.Vector3();

// Bullet tracers: a small pool of pre-allocated lines, reused for every shot
// the player or any agent fires. Impact sparks: one Points cloud with fixed
// buffers, a handful of particles woken per hit. Nothing here allocates in
// the hot path; both fade out in frame().
const TRACER_COUNT = 12;
const tracers = [];
for (let i = 0; i < TRACER_COUNT; i += 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const line = new THREE.Line(geo, mat);
  line.visible = false;
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, geo, mat, life: 0 });
}
let tracerIdx = 0;
function spawnTracer(from, dir, length) {
  const t = tracers[tracerIdx];
  tracerIdx = (tracerIdx + 1) % TRACER_COUNT;
  const pos = t.geo.attributes.position.array;
  pos[0] = from.x;
  pos[1] = from.y;
  pos[2] = from.z;
  pos[3] = from.x + dir.x * length;
  pos[4] = from.y + dir.y * length;
  pos[5] = from.z + dir.z * length;
  t.geo.attributes.position.needsUpdate = true;
  t.life = 0.08;
  t.mat.opacity = 0.9;
  t.line.visible = true;
}
function updateTracers(dt) {
  for (const t of tracers) {
    if (t.life <= 0) continue;
    t.life -= dt;
    if (t.life <= 0) {
      t.line.visible = false;
      t.mat.opacity = 0;
    } else {
      t.mat.opacity = (t.life / 0.08) * 0.9;
    }
  }
}

const IMPACT_MAX = 60;
const impactGeo = new THREE.BufferGeometry();
const impactPos = new Float32Array(IMPACT_MAX * 3);
const impactVel = new Float32Array(IMPACT_MAX * 3);
const impactLife = new Float32Array(IMPACT_MAX);
for (let i = 0; i < IMPACT_MAX; i += 1) impactPos[i * 3 + 1] = -50;
impactGeo.setAttribute('position', new THREE.BufferAttribute(impactPos, 3));
const impactPts = new THREE.Points(impactGeo, new THREE.PointsMaterial({ color: 0xffb066, size: 0.09, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
impactPts.frustumCulled = false;
scene.add(impactPts);
let impactIdx = 0;
function spawnImpact(point, count = 6) {
  for (let n = 0; n < count; n += 1) {
    const i = impactIdx;
    impactIdx = (impactIdx + 1) % IMPACT_MAX;
    impactPos[i * 3] = point.x;
    impactPos[i * 3 + 1] = point.y;
    impactPos[i * 3 + 2] = point.z;
    const a = random() * Math.PI * 2;
    const sp = 2 + random() * 3;
    impactVel[i * 3] = Math.cos(a) * sp;
    impactVel[i * 3 + 1] = 1 + random() * 3;
    impactVel[i * 3 + 2] = Math.sin(a) * sp;
    impactLife[i] = 0.35 + random() * 0.25;
  }
  impactGeo.attributes.position.needsUpdate = true;
}
function updateImpacts(dt) {
  let any = false;
  for (let i = 0; i < IMPACT_MAX; i += 1) {
    if (impactLife[i] <= 0) continue;
    any = true;
    impactLife[i] -= dt;
    if (impactLife[i] <= 0) {
      impactPos[i * 3 + 1] = -50;
      continue;
    }
    impactVel[i * 3 + 1] -= 9 * dt;
    impactPos[i * 3] += impactVel[i * 3] * dt;
    impactPos[i * 3 + 1] += impactVel[i * 3 + 1] * dt;
    impactPos[i * 3 + 2] += impactVel[i * 3 + 2] * dt;
  }
  if (any) impactGeo.attributes.position.needsUpdate = true;
}

// The one game state: health, match, and the wires between modules.
const game = {
  health: 100,
  alive: true,
  kills: 0,
  grenade: 'flash',
  noise: [],
  elapsed: 0,
  stepAcc: 0,
  prevFiring: false,
  prevBomb: 'idle',
  menuT: 0,
};

const body = player.state;
const markerHoldMs = shot ? 4000 : 90;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let overlayMode = 'start';

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function pushNoise(x, z, radius) {
  game.noise.push({ x, z, radius, at: game.elapsed });
  if (game.noise.length > 8) game.noise.shift();
}

function botContext() {
  return {
    playerPos: body.position,
    playerEye: body.eye,
    playerHeight: body.height,
    playerSpeed: player.groundSpeed(),
    playerAlive: game.alive,
    // Every attacker a defender can shoot: the player, then the teammates.
    attackers: [
      { kind: 'player', ref: null, x: body.position.x, y: body.position.y, z: body.position.z, eye: body.eye, height: body.height, speed: player.groundSpeed(), alive: game.alive },
      ...mates.mates.map((m) => ({ kind: 'mate', ref: m, x: m.position.x, y: 0, z: m.position.z, eye: 1.55, height: 1.72, speed: 0, alive: m.alive })),
    ],
    noise: game.noise,
    smokeBlocks: (ax, ay, az, bx, by, bz) => grenades.blocksLOS(ax, ay, az, bx, by, bz),
    bombPlanted: bomb.state.status === 'planted',
    bomb: { x: world.site.x, z: world.site.z },
    onAgentShot: (agent, origin, dir) => {
      audio.shot('bot');
      spawnTracer(origin, dir, 40);
    },
    onKillFeed: (text) => hud.killfeed(text),
    onPlayerHit: (damage, isHead, bot) => damagePlayer(damage, isHead, bot),
    onDefenderDown: () => checkCombatEnd(),
    onMateDown: () => checkCombatEnd(),
    onDefused: () => {
      bomb.defuse();
      endRound(false, 'The bomb was defused.');
    },
  };
}

function mateContext() {
  return {
    defenders: bots.bots,
    noise: game.noise,
    smokeBlocks: (ax, ay, az, bx, by, bz) => grenades.blocksLOS(ax, ay, az, bx, by, bz),
    bombPlanted: bomb.state.status === 'planted',
    bombIdle: bomb.state.status === 'idle',
    bombStatus: bomb.state.status,
    // Live read: the snapshot fields above are taken when the context is
    // built, before thinkMate runs — a plant started this step still reads
    // as 'idle' through them.
    bombLive: () => bomb.state.status,
    bomb: { x: world.site.x, z: world.site.z },
    inSite: (x, z) => world.inSite(x, z),
    onAgentShot: (agent, origin, dir) => {
      audio.shot('bot');
      spawnTracer(origin, dir, 40);
    },
    onKillFeed: (text) => hud.killfeed(text),
    onDefenderDown: () => checkCombatEnd(),
    onMateStartPlant: (mate) => {
      if (bomb.state.status === 'idle') bomb.startPlant(mate);
    },
    onMateCancelPlant: (mate) => {
      if (bomb.state.status === 'planting' && bomb.state.planter === mate) bomb.cancelPlant();
    },
    onCallout: (text) => {
      hud.callout(text);
      audio.radio();
    },
  };
}

function squadList() {
  const list = [{ name: 'YOU', hp: game.health, alive: game.alive, you: true }];
  for (const m of mates.mates) list.push({ name: m.name, hp: m.health, alive: m.alive, you: false });
  return list;
}

// The round can end on any kill: all defenders down wins it, a wiped squad
// loses it. A planted bomb decides the round by itself, so it is left alone.
function checkCombatEnd() {
  const phase = rounds.state.phase;
  if (phase !== 'live' && phase !== 'aftermath') return;
  if (bots.aliveCount() === 0 && bomb.state.status !== 'planted' && phase === 'live') {
    endRound(true, 'All defenders down.');
    return;
  }
  if (!game.alive && mates.aliveCount() === 0 && bomb.state.status !== 'planted' && phase === 'live') {
    endRound(false, 'Squad wiped.');
  }
}

function mvpLine() {
  const entries = [{ name: 'YOU', kills: game.kills }];
  for (const m of mates.mates) entries.push({ name: m.name, kills: m.kills });
  entries.sort((a, b) => b.kills - a.kills);
  const top = entries[0];
  return top.kills > 0 ? `MVP: ${top.name} — ${top.kills} kill${top.kills === 1 ? '' : 's'}.` : 'No kills yet this round.';
}

function grenadeContext() {
  return {
    bots: bots.bots.concat(mates.mates),
    playerAlive: game.alive,
    playerPos: body.position,
    playerEye: body.eye,
    playerYaw: body.yaw,
    audio,
    onPlayerFlashed: (strength) => hud.flashOverlay(strength),
  };
}

function damagePlayer(damage, isHead, bot) {
  if (!game.alive) return;
  let amount = damage;
  if (economy.state.armor) amount = Math.max(1, Math.round(amount * 0.5));
  game.health -= amount;
  hud.damageFlash();
  audio.hurt();
  hud.setHealth(game.health, economy.state.armor);
  if (game.health <= 0) {
    game.health = 0;
    game.alive = false;
    hud.killfeed(`${BOT_NAMES[bot.index]} — You${isHead ? ' (headshot)' : ''}`);
    if (document.pointerLockElement) document.exitPointerLock();
    if (bomb.state.status === 'planted') {
      rounds.state.phase = 'aftermath';
      hud.banner('YOU ARE DOWN', 'The bomb is still ticking — can they defuse it in time?');
    } else if (mates.aliveCount() > 0) {
      // The round goes on without you: the squad can still take it.
      hud.banner('YOU ARE DOWN', 'Your squad is still fighting — they can still take the round.');
    } else {
      endRound(false, 'You were eliminated.');
    }
  }
}

function shoot(spread) {
  if (!weapons.takeRound()) {
    audio.dry();
    return false;
  }
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const hit = raycaster.intersectObjects(shootables, false)[0];
  const tracerLen = hit ? camera.position.distanceTo(hit.point) : 60;
  spawnTracer(camera.position, direction, tracerLen);
  if (hit && hit.object.userData.bot) {
    const isHead = hit.object.userData.part === 'head';
    const killed = bots.damage(hit.object, isHead ? weapons.headDamage() : weapons.damage());
    if (killed) {
      game.kills += 1;
      economy.add(REWARDS.kill);
      hud.killfeed(`You — ${BOT_NAMES[hit.object.userData.bot.index]}${isHead ? ' (headshot)' : ''}`);
      hud.setMoney(economy.state.money);
    }
    hud.hitMarker(killed, markerHoldMs);
    audio.hit(killed);
    checkCombatEnd();
  } else if (hit) {
    spawnImpact(hit.point, 6);
  }
  weapons.pullTrigger();
  player.recoil(weapons.def().kick * (0.9 + random() * 0.25), (random() * 2 - 1) * 0.004);
  audio.shot(weapons.def().id);
  const noiseRadius = weapons.def().id === 'sniper' ? 34 : weapons.def().id === 'pistol' ? 20 : 28;
  pushNoise(body.position.x, body.position.z, noiseRadius);
  hud.setAmmo(weapons.mag(), weapons.reserve(), weapons.def().name);
  return true;
}

function buyItem(id) {
  const item = SHOP.find((entry) => entry.id === id);
  if (!item) return;
  if (id === 'smg' || id === 'sniper') {
    if (weapons.state.primary === id) return;
    if (!economy.canAfford(item.price)) return;
    economy.add(-item.price);
    weapons.buyPrimary(id);
    audio.buy();
  } else {
    if (!economy.buy(id, item.price)) return;
    audio.buy();
  }
  hud.setMoney(economy.state.money);
  hud.updateBuy(economy.state.money, { armor: economy.state.armor, flash: economy.state.flash, smoke: economy.state.smoke, primary: weapons.state.primary });
  hud.setGrenades(economy.state.flash, economy.state.smoke, game.grenade);
  hud.setHealth(game.health, economy.state.armor);
}

function resetRound() {
  player.reset(world.playerSpawn.x, world.playerSpawn.z, world.playerSpawn.yaw);
  bots.reset(world.defenderSpawns);
  mates.reset(world.attackerSpawns);
  weapons.refillAll();
  bomb.reset();
  grenades.reset();
  game.health = 100;
  game.alive = true;
  game.kills = 0;
  game.noise = [];
  game.grenade = 'flash';
  game.prevBomb = 'idle';
  hud.setHealth(100, economy.state.armor);
  hud.setAmmo(weapons.mag(), weapons.reserve(), weapons.def().name);
  hud.setSlots(weapons.def().name, weapons.state.slot);
  hud.setGrenades(economy.state.flash, economy.state.smoke, game.grenade);
  hud.setBomb('');
  hud.setPlant(null);
  hud.hideBanner();
  hud.clearCallouts();
  hud.setSquad(squadList(), bots.aliveCount());
  syncCamera();
}

function startMatch() {
  economy.reset();
  weapons.reset();
  rounds.startMatch();
  resetRound();
  hud.setMoney(economy.state.money);
  hud.setScore(0, 0, 1);
  hud.showBuy(economy.state.money, { armor: false, flash: 0, smoke: 0, primary: 'rifle' });
  hud.hideOverlay();
}

function nextRound() {
  rounds.nextRound();
  resetRound();
  hud.setScore(rounds.state.wins, rounds.state.losses, rounds.state.round);
  hud.setMoney(economy.state.money);
  hud.showBuy(economy.state.money, { armor: economy.state.armor, flash: economy.state.flash, smoke: economy.state.smoke, primary: weapons.state.primary });
  hud.hideOverlay();
}

function endRound(won, reason) {
  if (rounds.state.phase === 'roundEnd' || rounds.state.phase === 'matchEnd') return;
  const wasMatch = rounds.state.wins + (won ? 1 : 0) >= 5 || rounds.state.losses + (won ? 0 : 1) >= 5 || rounds.state.round >= 9;
  economy.add(won ? REWARDS.win : REWARDS.loss);
  rounds.endRound(won, reason);
  if (bomb.state.status === 'planted') bomb.reset();
  hud.setMoney(economy.state.money);
  hud.setScore(rounds.state.wins, rounds.state.losses, rounds.state.round);
  hud.hideBuy();
  hud.scope(false);
  if (won) audio.win();
  else audio.lose();
  if (rounds.state.phase === 'matchEnd') {
    const matchWon = rounds.state.wins > rounds.state.losses;
    hud.banner(matchWon ? 'MATCH WON' : 'MATCH LOST', `${rounds.state.wins} — ${rounds.state.losses} · ${reason}`, 4000);
    hud.showOverlay('matchEnd', {
      title: matchWon ? 'Match won' : 'Match lost',
      copy: `Final score ${rounds.state.wins} — ${rounds.state.losses}. ${reason} ${mvpLine()}`,
      action: 'Play again',
    });
    if (document.pointerLockElement) document.exitPointerLock();
  } else {
    hud.banner(won ? 'ROUND WON' : 'ROUND LOST', reason, 3200);
    hud.showOverlay('roundEnd', {
      title: won ? 'Round won' : 'Round lost',
      copy: `${reason} Score ${rounds.state.wins} — ${rounds.state.losses}. ${mvpLine()}`,
      action: 'Next round',
    });
    if (document.pointerLockElement) document.exitPointerLock();
  }
  hud.setBomb('');
  hud.setPlant(null);
  void wasMatch;
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    hud.hideOverlay();
    overlayMode = 'playing';
  } else if (rounds.state.phase === 'live' && game.alive) {
    // A dead player watches the squad finish the round; never pause on them.
    overlayMode = 'paused';
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.ensure();
  if (overlayMode === 'start') startMatch();
  else if (rounds.state.phase === 'roundEnd') nextRound();
  else if (rounds.state.phase === 'matchEnd') startMatch();
  input.requestLock();
});

hud.onBuy((id) => {
  if (rounds.state.phase === 'buy') buyItem(id);
});

function step(dt) {
  game.elapsed += dt;
  const phase = rounds.state.phase;

  if (phase === 'buy' || phase === 'live' || phase === 'aftermath') {
    const tick = rounds.tick(dt);
    if (tick === 'live') {
      hud.hideBuy();
      hud.banner(`ROUND ${rounds.state.round}`, 'Plant the charge at Site A — or clear the defenders.', 2200);
    } else if (tick === 'timeout' && phase === 'live' && bomb.state.status !== 'planted') {
      endRound(false, 'Time expired — Site A holds.');
    }
  }

  if (phase === 'buy') {
    for (let i = 0; i < SHOP.length; i += 1) {
      if (input.consumePressed(`Digit${i + 1}`)) buyItem(SHOP[i].id);
    }
    if (input.consumePressed('KeyB')) {
      if (document.getElementById('buy').hidden) hud.showBuy(economy.state.money, { armor: economy.state.armor, flash: economy.state.flash, smoke: economy.state.smoke, primary: weapons.state.primary });
      else hud.hideBuy();
    }
  }

  if (game.alive && (phase === 'buy' || phase === 'live')) {
    player.step(dt, input.state.keys);
    if (player.groundSpeed() > 0.5 && player.state.onGround) {
      game.stepAcc += dt;
      if (game.stepAcc > 0.38) {
        game.stepAcc = 0;
        audio.step();
      }
    }
    if (phase === 'live') {
      if (input.consumePressed('KeyR') && weapons.reload()) audio.reload();
      if (input.consumePressed('Digit1')) weapons.switchSlot(1);
      if (input.consumePressed('Digit2')) weapons.switchSlot(2);
      if (input.consumePressed('KeyQ')) {
        game.grenade = game.grenade === 'flash' ? 'smoke' : 'flash';
        hud.setGrenades(economy.state.flash, economy.state.smoke, game.grenade);
      }
      if (input.consumePressed('KeyG')) {
        const kind = game.grenade;
        const ok = kind === 'flash' ? economy.useFlash() : economy.useSmoke();
        if (ok) {
          camera.getWorldDirection(direction);
          camPos.copy(camera.position);
          grenades.throwGrenade(kind, camPos, direction);
          audio.shot('pistol');
          hud.setGrenades(economy.state.flash, economy.state.smoke, game.grenade);
        }
      }
      // Plant: hold E inside Site A. Only the player's own plant is
      // cancelled here — a teammate planting must not be cut off by the
      // player simply not holding E.
      const inSite = world.inSite(body.position.x, body.position.z);
      if (input.state.keys.has('KeyE') && inSite && bomb.state.status === 'idle') bomb.startPlant();
      if (bomb.state.status === 'planting' && bomb.state.planter === 'player') {
        if (!input.state.keys.has('KeyE') || !inSite || !game.alive) bomb.cancelPlant();
      }
    }
  }

  weapons.step(dt, input.state.aiming && game.alive);
  // Bots and teammates freeze during the buy phase; they only play once the
  // round is live.
  if (phase === 'live' || phase === 'aftermath') bots.step(dt, game.elapsed, botContext());
  if (phase === 'live' || phase === 'aftermath') mates.step(dt, game.elapsed, mateContext());
  grenades.step(dt, game.elapsed, grenadeContext());
  const wasPlanting = bomb.state.status === 'planting' ? bomb.state.planter : null;
  const bombEvent = bomb.step(dt, audio);
  if (bombEvent === 'detonated') {
    audio.explosion();
    if (rounds.state.phase === 'live' || rounds.state.phase === 'aftermath') {
      endRound(true, 'The charge blew Site A.');
    }
  }
  if (bomb.state.status === 'planted' && game.prevBomb === 'planting') {
    economy.add(REWARDS.plant);
    hud.setMoney(economy.state.money);
    hud.killfeed(wasPlanting && wasPlanting !== 'player' ? `${wasPlanting.name} planted the charge` : 'You planted the charge');
  }
  game.prevBomb = bomb.state.status;

  // Bomb HUD.
  if (bomb.state.status === 'planted') {
    hud.setBomb(`BOMB PLANTED — ${Math.ceil(bomb.state.fuse)}s`);
  } else if (bomb.state.status === 'planting') {
    hud.setPlant(bomb.progress());
  } else {
    hud.setPlant(null);
  }

  // Firing.
  if (game.alive && phase === 'live' && input.state.firing && weapons.ready()) {
    if (weapons.isAuto() || !game.prevFiring) shoot(shot ? 0 : weapons.spread(player.groundSpeed(), player.state.onGround));
  }
  game.prevFiring = input.state.firing;
  input.endFrame();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (rounds.state.phase !== 'menu') player.look(look.x, look.y);
    else {
      game.menuT += dt;
      body.yaw = Math.sin(game.menuT * 0.08) * 0.35;
      body.pitch = -0.01 + Math.sin(game.menuT * 0.05) * 0.01;
    }
    const phase = rounds.state.phase;
    if (phase === 'buy' || phase === 'live' || phase === 'aftermath') {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < 5) {
        step(FIXED_STEP);
        accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (accumulator > FIXED_STEP * 5) accumulator = 0;
    }
    // Scope: lerp the field of view toward the zoomed value.
    const targetFov = weapons.isScoped() ? BASE_FOV / WEAPONS.sniper.zoom : BASE_FOV;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
      camera.updateProjectionMatrix();
    }
    hud.scope(weapons.isScoped());
    hud.crosshairGap(weapons.isScoped() ? 0 : 7 + weapons.spread(player.groundSpeed(), player.state.onGround) * 700);
    hud.setAmmo(weapons.mag(), weapons.reserve(), weapons.def().name);
    hud.setSlots(weapons.def().name, weapons.state.slot);
    hud.setSquad(squadList(), bots.aliveCount());
    hud.drawMinimap({
      px: body.position.x,
      pz: body.position.z,
      yaw: body.yaw,
      mates: mates.mates,
      foes: bots.bots,
      planted: bomb.state.status === 'planted',
    });
    updateTracers(dt);
    updateImpacts(dt);
    if (phase === 'buy') hud.setTimer(rounds.state.freeze, 'buy');
    else if (bomb.state.status === 'planted') hud.setTimer(bomb.state.fuse, 'aftermath');
    else if (phase === 'live') hud.setTimer(rounds.state.timer, 'live');
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  body.pitch = 0;
  body.yaw = 0;
  resetRound();
  if (name === 'start') {
    player.reset(world.playerSpawn.x, world.playerSpawn.z, 0.12);
    body.pitch = -0.01;
    // Two teammates flanking the spawn, facing the camera: a squad at rest.
    const viper = mates.mates[0];
    viper.position.set(-2.5, 0, 11);
    viper.yaw = Math.PI;
    viper.group.position.copy(viper.position);
    viper.group.rotation.y = viper.yaw;
    const jinx = mates.mates[1];
    jinx.position.set(2.5, 0, 11);
    jinx.yaw = Math.PI;
    jinx.group.position.copy(jinx.position);
    jinx.group.rotation.y = jinx.yaw;
    settle(30);
    syncCamera();
    hud.showOverlay('start');
    hud.setTimer(100, 'live');
    hud.setSquad(squadList(), bots.aliveCount());
    hud.drawMinimap({ px: body.position.x, pz: body.position.z, yaw: body.yaw, mates: mates.mates, foes: bots.bots, planted: false });
  } else if (name === 'play') {
    rounds.startMatch();
    rounds.state.phase = 'live';
    rounds.state.timer = 83;
    rounds.state.wins = 1;
    rounds.state.losses = 0;
    player.reset(0, 4, 0);
    const bot = bots.bots[2];
    bot.position.set(0.8, 0, -2.0);
    bot.yaw = Math.PI;
    bot.state = 'engage';
    bot.group.position.copy(bot.position);
    bot.group.rotation.y = bot.yaw;
    // Two teammates in the frame, firing through the mid doorway at the same
    // defender: a 5v5 firefight, not a duel. A short settle keeps the burst
    // to one shot each, so nobody drops before the frame is taken.
    const viper = mates.mates[0];
    viper.position.set(-1.5, 0, 0.2);
    viper.yaw = 0;
    viper.state = 'engage';
    viper.target = bots.bots[2];
    viper.reactionAt = 0;
    viper.burstLeft = 0;
    viper.group.position.copy(viper.position);
    viper.group.rotation.y = viper.yaw;
    const jinx = mates.mates[1];
    jinx.position.set(1.2, 0, 1.2);
    jinx.yaw = 0;
    jinx.state = 'engage';
    jinx.target = bots.bots[2];
    jinx.reactionAt = 0;
    jinx.burstLeft = 0;
    jinx.group.position.copy(jinx.position);
    jinx.group.rotation.y = jinx.yaw;
    economy.add(3050);
    hud.setMoney(economy.state.money);
    hud.setScore(1, 0, 2);
    hud.callout('VIPER: Contact mid!');
    settle(12);
    aimAt(bots.aimPoint(2));
    shoot(0);
    settle(2);
    // The defender shot back during the settle; restore the hero's health
    // and sync the HUD so the frame reads as a clean firefight.
    game.health = 100;
    hud.setHealth(100, false);
    hud.setTimer(83, 'live');
    hud.setAmmo(weapons.mag(), weapons.reserve(), weapons.def().name);
    hud.setSquad(squadList(), bots.aliveCount());
    hud.drawMinimap({ px: body.position.x, pz: body.position.z, yaw: body.yaw, mates: mates.mates, foes: bots.bots, planted: false });
  } else if (name === 'buy') {
    rounds.startMatch();
    economy.add(3050);
    buyItem('smg');
    buyItem('armor');
    buyItem('flash');
    hud.setMoney(economy.state.money);
    hud.setHealth(100, true);
    player.reset(0, 15, 0);
    const viper = mates.mates[0];
    viper.position.set(-3, 0, 10);
    viper.yaw = Math.PI;
    viper.group.position.copy(viper.position);
    viper.group.rotation.y = viper.yaw;
    const jinx = mates.mates[1];
    jinx.position.set(-1, 0, 11);
    jinx.yaw = Math.PI;
    jinx.group.position.copy(jinx.position);
    jinx.group.rotation.y = jinx.yaw;
    settle(20);
    hud.showBuy(economy.state.money, { armor: true, flash: 1, smoke: 0, primary: 'smg' });
    hud.setGrenades(1, 0, 'flash');
    hud.setTimer(rounds.state.freeze, 'buy');
    hud.setAmmo(weapons.mag(), weapons.reserve(), weapons.def().name);
    hud.setSlots(weapons.def().name, 1);
    hud.setScore(1, 0, 2);
    hud.setSquad(squadList(), bots.aliveCount());
    hud.drawMinimap({ px: body.position.x, pz: body.position.z, yaw: body.yaw, mates: mates.mates, foes: bots.bots, planted: false });
    syncCamera();
  } else {
    // end: round won at the site, all five defenders down.
    rounds.startMatch();
    rounds.state.wins = 2;
    rounds.state.losses = 1;
    rounds.state.round = 4;
    const fallenSpots = [[-3.4, -13.2], [2.8, -15.8], [-1.2, -11.0], [-9.5, -4.5], [9.8, -5.2]];
    bots.bots.forEach((bot, i) => {
      bot.position.set(fallenSpots[i][0], 0, fallenSpots[i][1]);
      bot.alive = false;
      bot.fall = 1;
      bot.group.rotation.x = -1.5;
      bot.group.position.copy(bot.position);
    });
    // The squad holds the site they just took: four teammates alive, and
    // VIPER takes the MVP for the round.
    const mateSpots = [[-2, -13], [2, -13], [-2, -16], [2, -16]];
    mates.mates.forEach((mate, i) => {
      mate.position.set(mateSpots[i][0], 0, mateSpots[i][1]);
      mate.yaw = Math.PI;
      mate.group.position.copy(mate.position);
      mate.group.rotation.y = mate.yaw;
    });
    mates.mates[0].kills = 2;
    mates.mates[1].kills = 1;
    game.kills = 1;
    player.reset(-1.5, -8.5, 0.1);
    body.pitch = -0.02;
    settle(20);
    syncCamera();
    hud.setScore(2, 1, 4);
    hud.setTimer(41, 'live');
    hud.setHealth(100, false);
    hud.setAmmo(weapons.mag(), weapons.reserve(), weapons.def().name);
    hud.setSlots('VK-47', 1);
    hud.setSquad(squadList(), bots.aliveCount());
    hud.drawMinimap({ px: body.position.x, pz: body.position.z, yaw: body.yaw, mates: mates.mates, foes: bots.bots, planted: false });
    hud.showOverlay('roundEnd', { title: 'Round won', copy: `All defenders down. Score 2 — 1. ${mvpLine()}`, action: 'Next round' });
  }
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

resetRound();
syncCamera();
hud.setScore(0, 0, 1);
hud.setMoney(800);
hud.showOverlay('start');
if (params.get('debug')) {
  // Headless verification hook: exposes the live sim when ?debug=1 is set.
  window.__sandline = { game, rounds, bots, mates, bomb, world, player: body, hud };
}
if (shot) runShot(shot);
else requestAnimationFrame(frame);
