// The bomb: hold E inside Site A to plant, then a 40 second fuse. The bomb is a
// small box with a blinking ember light; its beeps quicken as the fuse runs down.
// If the planter dies, a defender can defuse it in 5 seconds flat.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const PLANT_SECONDS = 3;
export const FUSE_SECONDS = 40;

export function createBomb(scene, site) {
  const group = new THREE.Group();
  group.position.set(site.x, 0.35, site.z);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.28, 0.3),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.5, metalness: 0.4 }),
  );
  const lampMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 1 });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.1), lampMat);
  lamp.position.set(0, 0.17, 0);
  const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6, 1.8);
  light.position.set(0, 0.6, 0);
  group.add(body, lamp, light);
  group.visible = false;
  scene.add(group);

  const state = { status: 'idle', plantT: 0, fuse: FUSE_SECONDS, beepAt: 0, planter: null };
  let beepCount = 0;

  return {
    state,
    group,
    reset() {
      state.status = 'idle';
      state.plantT = 0;
      state.fuse = FUSE_SECONDS;
      state.planter = null;
      beepCount = 0;
      group.visible = false;
    },
    startPlant(planter = 'player') {
      if (state.status !== 'idle') return;
      state.status = 'planting';
      state.planter = planter;
      state.plantT = 0;
    },
    cancelPlant() {
      if (state.status === 'planting') {
        state.status = 'idle';
        state.plantT = 0;
        state.planter = null;
      }
    },
    progress() {
      return state.status === 'planting' ? state.plantT / PLANT_SECONDS : 0;
    },
    plant() {
      state.status = 'planted';
      state.planter = null;
      state.fuse = FUSE_SECONDS;
      state.beepAt = 0;
      beepCount = 0;
      group.visible = true;
    },
    defuse() {
      state.status = 'defused';
      state.planter = null;
      group.visible = false;
    },
    step(dt, audio) {
      if (state.status === 'planting') {
        state.plantT += dt;
        if (state.plantT >= PLANT_SECONDS) this.plant();
        return null;
      }
      if (state.status !== 'planted') return null;
      state.fuse -= dt;
      const interval = Math.max(0.25, state.fuse / FUSE_SECONDS);
      state.beepAt += dt;
      if (state.beepAt >= interval) {
        state.beepAt = 0;
        beepCount += 1;
        if (audio) audio.beep(state.fuse);
      }
      const blink = Math.sin(state.fuse * 14) > 0;
      lampMat.emissiveIntensity = blink ? 2.2 : 0.2;
      light.intensity = blink ? 14 : 2;
      if (state.fuse <= 0) {
        state.status = 'detonated';
        group.visible = false;
        return 'detonated';
      }
      return null;
    },
  };
}
