import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createHumanoidPlaceholder } from './humanoidPlaceholder.ts';
import { createLocomotionPoseDriver } from './locomotionPose.ts';
import type { LocomotionResult } from './locomotionState.ts';

const base: LocomotionResult = {
  state: 'walk',
  direction: 'forward',
  speed: 4.2,
  normalizedSpeed: 1,
  gaitRate: 1,
  airborne: false,
  directionAngle: 0,
};

function snapshot(root: THREE.Object3D) {
  return ['leg-left', 'leg-right', 'arm-left', 'arm-right'].map((name) => {
    const part = root.getObjectByName(name);
    if (!part) throw new Error(name);
    return { name, position: part.position.toArray(), quaternion: part.quaternion.toArray() };
  });
}

describe('grey-box locomotion pose driver (T-2.18)', () => {
  it('animates cardinal directions without moving the root', () => {
    for (const directionAngle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const root = createHumanoidPlaceholder('local');
      const driver = createLocomotionPoseDriver(root);
      const rootPosition = root.position.toArray();
      driver.update({ ...base, directionAngle }, 1 / 60);
      expect(root.getObjectByName('leg-left')!.quaternion.angleTo(
        new THREE.Quaternion(),
      )).toBeGreaterThan(0);
      expect(root.position.toArray()).toEqual(rootPosition);
    }
  });

  it('blends diagonals continuously at cardinal boundaries', () => {
    const a = createHumanoidPlaceholder('local');
    const b = createHumanoidPlaceholder('local');
    createLocomotionPoseDriver(a).update({ ...base, directionAngle: Math.PI / 4 - 0.001 }, 1 / 60);
    createLocomotionPoseDriver(b).update({ ...base, directionAngle: Math.PI / 4 + 0.001 }, 1 / 60);
    const qa = a.getObjectByName('leg-left')!.quaternion;
    const qb = b.getObjectByName('leg-left')!.quaternion;
    expect(qa.angleTo(qb)).toBeLessThan(0.002);
  });

  it('is frame-rate independent', () => {
    const a = createHumanoidPlaceholder('local');
    const b = createHumanoidPlaceholder('local');
    const da = createLocomotionPoseDriver(a);
    const db = createLocomotionPoseDriver(b);
    for (let i = 0; i < 60; i++) da.update(base, 1 / 60);
    for (let i = 0; i < 30; i++) db.update(base, 1 / 30);
    expect(da.phase).toBeCloseTo(db.phase, 10);
    expect(a.getObjectByName('leg-left')!.quaternion.angleTo(
      b.getObjectByName('leg-left')!.quaternion)).toBeLessThan(1e-9);
  });

  it('gives sprint a faster and larger gait', () => {
    const walk = createHumanoidPlaceholder('local');
    const sprint = createHumanoidPlaceholder('local');
    const wd = createLocomotionPoseDriver(walk);
    const sd = createLocomotionPoseDriver(sprint);
    wd.update(base, 0.1);
    sd.update({ ...base, state: 'sprint', speed: 6.8 }, 0.1);
    expect(sd.phase).toBeGreaterThan(wd.phase);
    const rest = createHumanoidPlaceholder('local');
    expect(sprint.getObjectByName('leg-left')!.quaternion.angleTo(rest.getObjectByName('leg-left')!.quaternion))
      .toBeGreaterThan(walk.getObjectByName('leg-left')!.quaternion.angleTo(rest.getObjectByName('leg-left')!.quaternion));
  });

  it('restores the exact standing pose when idle', () => {
    const root = createHumanoidPlaceholder('local');
    const driver = createLocomotionPoseDriver(root);
    const rest = snapshot(root);
    driver.update(base, 1 / 30);
    driver.update({ ...base, state: 'idle', speed: 0, normalizedSpeed: 0, gaitRate: 0 }, 1 / 60);
    expect(snapshot(root)).toEqual(rest);
    expect(driver.phase).toBe(0);
  });

  it('never moves the gameplay hitbox root', () => {
    const root = createHumanoidPlaceholder('local');
    const driver = createLocomotionPoseDriver(root);
    const before = { position: root.position.toArray(), quaternion: root.quaternion.toArray(), scale: root.scale.toArray() };
    driver.update({ ...base, directionAngle: Math.PI / 3 }, 1 / 60);
    expect(root.position.toArray()).toEqual(before.position);
    expect(root.quaternion.toArray()).toEqual(before.quaternion);
    expect(root.scale.toArray()).toEqual(before.scale);
  });
});
