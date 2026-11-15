// The arsenal: four weapons, one job each. The numbers live here; main.js owns the
// ray and the damage. A primary (rifle, SMG or sniper, slot 1) and a sidearm
// (slot 2). The sniper zooms on right mouse. Every weapon has its own view model
// built from boxes, its own magazine, and spread that punishes moving fire.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  rifle: { id: 'rifle', name: 'VK-47', slot: 1, price: 0, auto: true, magSize: 30, reserveMax: 90, gap: 0.096, reload: 1.9, damage: 34, headMult: 4, spreadStill: 0.0022, spreadMove: 0.028, kick: 0.009, zoom: 1 },
  pistol: { id: 'pistol', name: 'P9', slot: 2, price: 0, auto: false, magSize: 12, reserveMax: 36, gap: 0.22, reload: 1.4, damage: 26, headMult: 4, spreadStill: 0.004, spreadMove: 0.02, kick: 0.007, zoom: 1 },
  smg: { id: 'smg', name: 'KESTREL', slot: 1, price: 1500, auto: true, magSize: 32, reserveMax: 96, gap: 0.07, reload: 1.6, damage: 24, headMult: 4, spreadStill: 0.008, spreadMove: 0.04, kick: 0.006, zoom: 1 },
  sniper: { id: 'sniper', name: 'LONGSHOT', slot: 1, price: 4750, auto: false, magSize: 5, reserveMax: 15, gap: 1.1, reload: 2.8, damage: 110, headMult: 4, spreadStill: 0.0005, spreadMove: 0.06, kick: 0.03, zoom: 2.6 },
};

export const SHOP = [
  { id: 'smg', name: 'KESTREL SMG', desc: 'Fast hose: 32 rounds, close range.', price: 1500 },
  { id: 'sniper', name: 'LONGSHOT .50', desc: 'One shot, one kill. Right mouse to scope.', price: 4750 },
  { id: 'armor', name: 'KEVLAR VEST', desc: 'Halves all damage taken this round.', price: 650 },
  { id: 'flash', name: 'FLASHBANG', desc: 'Blinds bots that see it pop.', price: 200 },
  { id: 'smoke', name: 'SMOKE', desc: 'A 12 s wall of grey that blocks sight.', price: 300 },
];

const GRIP = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
const BODY = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
const DARK = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.6, metalness: 0.3 });
const EMBER = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.45, metalness: 0.2 });

function part(geometry, material, x, y, z) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  return mesh;
}

function buildModel(id) {
  const model = new THREE.Group();
  if (id === 'rifle') {
    model.add(
      part(new THREE.BoxGeometry(0.09, 0.1, 0.42), BODY, 0, 0, 0),
      part(new THREE.BoxGeometry(0.045, 0.045, 0.4), GRIP, 0, 0.025, -0.38),
      part(new THREE.BoxGeometry(0.075, 0.08, 0.22), GRIP, 0, -0.02, 0.3),
      part(new THREE.BoxGeometry(0.03, 0.06, 0.12), DARK, 0, -0.07, 0.05),
    );
    model.position.set(0.25, -0.23, -0.46);
  } else if (id === 'pistol') {
    model.add(
      part(new THREE.BoxGeometry(0.05, 0.09, 0.22), BODY, 0, 0, 0),
      part(new THREE.BoxGeometry(0.045, 0.12, 0.06), GRIP, 0, -0.09, 0.07),
      part(new THREE.BoxGeometry(0.04, 0.02, 0.06), EMBER, 0, 0.055, -0.08),
    );
    model.position.set(0.23, -0.24, -0.38);
  } else if (id === 'smg') {
    model.add(
      part(new THREE.BoxGeometry(0.08, 0.09, 0.34), BODY, 0, 0, 0),
      part(new THREE.BoxGeometry(0.04, 0.04, 0.34), GRIP, 0, 0.02, -0.32),
      part(new THREE.BoxGeometry(0.05, 0.14, 0.05), GRIP, 0, -0.1, -0.02),
      part(new THREE.BoxGeometry(0.06, 0.07, 0.16), GRIP, 0, -0.015, 0.24),
    );
    model.position.set(0.25, -0.24, -0.44);
  } else {
    model.add(
      part(new THREE.BoxGeometry(0.08, 0.09, 0.5), DARK, 0, 0, 0),
      part(new THREE.BoxGeometry(0.04, 0.04, 0.5), GRIP, 0, 0.03, -0.46),
      part(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 10), EMBER, 0, 0.07, -0.05),
      part(new THREE.BoxGeometry(0.07, 0.07, 0.2), GRIP, 0, -0.02, 0.32),
    );
    model.children[2].rotation.x = Math.PI / 2;
    model.position.set(0.25, -0.22, -0.54);
  }
  model.scale.setScalar(0.62);
  return model;
}

export function createWeapons(camera) {
  const models = {};
  for (const id of Object.keys(WEAPONS)) {
    models[id] = buildModel(id);
    models[id].visible = false;
    camera.add(models[id]);
  }

  // Muzzle flash: a code-drawn starburst sprite (bright core, four spikes,
  // fading to transparent) so it reads as a flash, not a solid square.
  const flashCanvas = document.createElement('canvas');
  flashCanvas.width = 64;
  flashCanvas.height = 64;
  const fctx = flashCanvas.getContext('2d');
  const glow = fctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  glow.addColorStop(0, 'rgba(255, 240, 200, 1)');
  glow.addColorStop(0.35, 'rgba(255, 170, 60, 0.9)');
  glow.addColorStop(1, 'rgba(255, 110, 20, 0)');
  fctx.fillStyle = glow;
  fctx.fillRect(0, 0, 64, 64);
  fctx.globalCompositeOperation = 'lighter';
  fctx.fillStyle = 'rgba(255, 220, 150, 0.9)';
  fctx.beginPath();
  fctx.moveTo(32, 2); fctx.lineTo(35, 29); fctx.lineTo(62, 32); fctx.lineTo(35, 35);
  fctx.lineTo(32, 62); fctx.lineTo(29, 35); fctx.lineTo(2, 32); fctx.lineTo(29, 29);
  fctx.closePath();
  fctx.fill();
  const flashTexture = new THREE.CanvasTexture(flashCanvas);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ map: flashTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.26, -0.19, -0.82);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const ammo = {};
  for (const id of Object.keys(WEAPONS)) ammo[id] = { mag: WEAPONS[id].magSize, reserve: WEAPONS[id].reserveMax };
  const state = { primary: 'rifle', slot: 1, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, switchT: 0, scoped: false };
  let bobT = 0;
  models.rifle.visible = true;

  function def() {
    return WEAPONS[state.slot === 1 ? state.primary : 'pistol'];
  }

  function currentModel() {
    return models[def().id];
  }

  function step(dt, aiming, speed = 0) {
    const d = def();
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.switchT = Math.max(0, state.switchT - dt);
    const model = currentModel();
    const baseZ = model.userData.baseZ ?? (model.userData.baseZ = model.position.z);
    const baseX = model.userData.baseX ?? (model.userData.baseX = model.position.x);
    const baseY = model.userData.baseY ?? (model.userData.baseY = model.position.y);
    model.position.z = baseZ + state.kick;
    model.rotation.x = state.kick * 2.2 + (state.switchT > 0 ? state.switchT * 1.4 : 0);
    state.scoped = aiming && d.id === 'sniper' && state.reloadLeft === 0;
    // Scoped: the view model leaves the frame, the crosshair does the work.
    model.visible = !state.scoped;
    // Walk bob: a small sway that grows with speed and dies at a standstill.
    bobT += dt * (1.5 + speed * 1.6);
    const bob = state.scoped ? 0 : Math.min(1, speed / 5.2);
    model.position.x = baseX + Math.sin(bobT) * 0.006 * bob;
    model.position.y = baseY + Math.abs(Math.cos(bobT)) * 0.008 * bob;
    flash.visible = state.flash > 0 && !state.scoped;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 && !state.scoped ? 18 : 0;
    state.scoped = aiming && d.id === 'sniper' && state.reloadLeft === 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (d.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = d.magSize - ammo[d.id].mag;
        const take = Math.min(need, ammo[d.id].reserve);
        ammo[d.id].mag += take;
        ammo[d.id].reserve -= take;
      }
    }
  }

  return {
    state,
    WEAPONS,
    def,
    step,
    ready() {
      const d = def();
      return ammo[d.id].mag > 0 && state.cooldown === 0 && state.reloadLeft === 0 && state.switchT === 0;
    },
    pullTrigger() {
      state.cooldown = def().gap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      const d = def();
      if (ammo[d.id].mag <= 0) return false;
      ammo[d.id].mag -= 1;
      return true;
    },
    reload() {
      const d = def();
      if (state.reloadLeft > 0 || ammo[d.id].mag === d.magSize || ammo[d.id].reserve === 0) return false;
      state.reloadLeft = d.reload;
      return true;
    },
    spread(speed, onGround) {
      const d = def();
      let spread = d.spreadStill;
      if (state.scoped) spread *= 0.4;
      spread += Math.min(1, speed / 5.2) * d.spreadMove;
      if (!onGround) spread += 0.03;
      return spread;
    },
    damage() {
      return def().damage;
    },
    headDamage() {
      const d = def();
      return d.damage * d.headMult;
    },
    isAuto() {
      return def().auto;
    },
    isScoped() {
      return state.scoped;
    },
    ammoOf(id) {
      return ammo[id];
    },
    mag() {
      return ammo[def().id].mag;
    },
    reserve() {
      return ammo[def().id].reserve;
    },
    switchSlot(slot) {
      if (slot === state.slot || state.reloadLeft > 0) return false;
      models[def().id].visible = false;
      state.slot = slot;
      models[def().id].visible = true;
      state.switchT = 0.28;
      state.cooldown = Math.max(state.cooldown, 0.28);
      state.scoped = false;
      return true;
    },
    buyPrimary(id) {
      if (id === state.primary) return false;
      models[state.primary].visible = false;
      state.primary = id;
      ammo[id].mag = WEAPONS[id].magSize;
      ammo[id].reserve = WEAPONS[id].reserveMax;
      state.slot = 1;
      models[id].visible = true;
      state.reloadLeft = 0;
      state.cooldown = 0.3;
      return true;
    },
    refillAll() {
      for (const id of Object.keys(WEAPONS)) ammo[id].reserve = WEAPONS[id].reserveMax;
      state.reloadLeft = 0;
      state.cooldown = 0;
      state.flash = 0;
    },
    reset() {
      state.primary = 'rifle';
      state.slot = 1;
      for (const id of Object.keys(WEAPONS)) {
        ammo[id].mag = WEAPONS[id].magSize;
        ammo[id].reserve = WEAPONS[id].reserveMax;
        models[id].visible = id === 'rifle';
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.scoped = false;
    },
  };
}
