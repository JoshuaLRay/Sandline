/**
 * U-070: the tank in the page, from the bytes a server sends to the objects the renderer makes. A real `NetClient`
 * fed real Delta messages and a real `TankModels` over a real scene, as `remoteSoldiers.test.ts` does for soldiers.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BitWriter,
  COMPONENT_IDS,
  DEFAULT_MOVE_CONFIG,
  ENEMY_IDS,
  POSITION,
  TICK_SECONDS,
  type WorldSnapshot,
  createLoopbackPair,
  encodeMessage,
  quantize,
  vitalityCode,
  writeDelta,
} from '@sandline/shared';
import { NetClient } from '../net/NetClient.ts';
import { createHumanoidSoldier } from './humanoidSoldier.ts';
import { RemoteSoldiers } from './remoteSoldiers.ts';
import { TankModels } from './tankModel.ts';

const TICK_MS = TICK_SECONDS * 1000;
const TANK = ENEMY_IDS.indexOf('tank');
const RIFLEMAN = ENEMY_IDS.indexOf('rifleman');
type Entity = WorldSnapshot['entities'][number];

function tank(netId: number, opts: { x?: number; z?: number; yaw?: number; turret?: number; aiming?: boolean; health?: number; dead?: boolean } = {}): Entity {
  const dead = opts.dead ?? false;
  return {
    netId,
    components: {
      [COMPONENT_IDS.Transform]: [quantize(opts.x ?? 0, POSITION), quantize(0, POSITION), quantize(opts.z ?? 0, POSITION), opts.yaw ?? 0, 0],
      [COMPONENT_IDS.Health]: [dead ? 0 : (opts.health ?? 1000), 1000, vitalityCode(dead ? 'dead' : 'alive'), dead ? 10 : 0, 0, 0],
      [COMPONENT_IDS.Crouch]: [0, 0],
      [COMPONENT_IDS.Enemy]: [TANK, 0, opts.turret ?? 0, opts.aiming ? 1 : 0],
    },
  };
}

function rifleman(netId: number): Entity {
  return {
    netId,
    components: {
      [COMPONENT_IDS.Transform]: [quantize(3, POSITION), quantize(0, POSITION), quantize(3, POSITION), 0, 0],
      [COMPONENT_IDS.Health]: [100, 100, 0, 0, 0, 0],
      [COMPONENT_IDS.Crouch]: [0, 0],
      [COMPONENT_IDS.Enemy]: [RIFLEMAN, 0, 0, 0],
    },
  };
}

function harness() {
  const pair = createLoopbackPair();
  const net = new NetClient(pair.b, 'tester');
  const scene = new THREE.Scene();
  const shootable: THREE.Object3D[] = [];
  const tanks = new TankModels(scene, shootable);
  const remotes = new RemoteSoldiers({ scene, shootable, create: createHumanoidSoldier, world: () => [], config: DEFAULT_MOVE_CONFIG });
  return {
    net,
    scene,
    shootable,
    tanks,
    remotes,
    frame(tick: number, entities: Entity[]): void {
      const writer = new BitWriter();
      writeDelta(writer, { tick, entities }, null);
      pair.a.send(encodeMessage({ kind: 'Delta', tick, baselineTick: null, lastProcessedInputTick: -1, payload: writer.toUint8Array() }));
      pair.settle();
      net.advanceClock(TICK_MS);
      remotes.update(net, TICK_SECONDS);
      tanks.update(net, TICK_SECONDS);
    },
  };
}

describe('the tank in the page (U-070)', () => {
  it('draws a tank from its Enemy component as a tank, not a soldier, at its place and heading', () => {
    const h = harness();
    for (let tick = 10; tick < 16; tick++) h.frame(tick, [tank(3000, { x: -22, z: 40, yaw: 256 }), rifleman(2000)]);
    expect(h.tanks.has(3000)).toBe(true);
    expect(h.remotes.has(3000)).toBe(false);
    expect(h.remotes.has(2000)).toBe(true);
    expect(h.tanks.has(2000)).toBe(false);
    const at = h.tanks.at(3000)!;
    expect(at.x).toBeCloseTo(-22, 1);
    expect(at.z).toBeCloseTo(40, 1);
    const root = h.scene.getObjectByName('tank tank') as THREE.Mesh;
    expect(root.rotation.y).toBeCloseTo(Math.PI / 2, 2);
  });

  it('turns the turret apart from the hull, following the replicated yaw', () => {
    const h = harness();
    for (let tick = 10; tick < 14; tick++) h.frame(tick, [tank(3000, { yaw: 0, turret: 0 })]);
    const turret = h.scene.getObjectByName('turret') as THREE.Group;
    expect(turret.rotation.y).toBeCloseTo(0, 6);
    for (let tick = 14; tick < 80; tick++) h.frame(tick, [tank(3000, { yaw: 0, turret: 256 })]);
    expect(turret.rotation.y).toBeCloseTo(Math.PI / 2, 2);
    // The hull turning with the turret held leaves the gun pointing the same way in the world.
    for (let tick = 80; tick < 90; tick++) h.frame(tick, [tank(3000, { yaw: 256, turret: 256 })]);
    expect(turret.rotation.y).toBeCloseTo(0, 2);
  });

  it('lights the lock lamp in the tell, flashes at the muzzle when it ends, and shows a wreck when dead', () => {
    const h = harness();
    const lamp = () => h.scene.getObjectByName('turret')!.children.filter((c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.SphereGeometry) as THREE.Mesh[];
    for (let tick = 10; tick < 13; tick++) h.frame(tick, [tank(3000)]);
    expect(lamp().map((m) => m.visible)).toEqual([false, false]);
    h.frame(13, [tank(3000, { aiming: true })]);
    expect(lamp().map((m) => m.visible)).toEqual([true, false]);
    h.frame(14, [tank(3000, { aiming: false })]);
    expect(lamp().map((m) => m.visible)).toEqual([false, true]);
    for (let tick = 15; tick < 25; tick++) h.frame(tick, [tank(3000, { aiming: false })]);
    expect(lamp().map((m) => m.visible)).toEqual([false, false]);

    const root = h.scene.getObjectByName('tank tank') as THREE.Mesh;
    const alive = (root.material as THREE.MeshLambertMaterial).color.getHex();
    h.frame(25, [tank(3000, { dead: true })]);
    expect(h.tanks.has(3000)).toBe(true);
    expect((root.material as THREE.MeshLambertMaterial).color.getHex()).not.toBe(alive);
  });

  it('puts the hull and turret on the aim list, maps them back to the tank, and removes them with it', () => {
    const h = harness();
    for (let tick = 10; tick < 14; tick++) h.frame(tick, [tank(3000)]);
    expect(h.shootable).toHaveLength(2);
    for (const mesh of h.shootable) expect(h.tanks.netIdOf(mesh)).toBe(3000);
    expect(h.tanks.netIdOf(new THREE.Object3D())).toBeNull();
    // Gone from the snapshot, then past the interpolation window: gone from the scene and the aim list.
    for (let tick = 14; tick < 60; tick++) h.frame(tick, []);
    expect(h.tanks.has(3000)).toBe(false);
    expect(h.shootable).toHaveLength(0);
    expect(h.scene.getObjectByName('tank tank')).toBeUndefined();
  });

  it('keeps the tank\'s health and maximum for the HUD marker', () => {
    const h = harness();
    for (let tick = 10; tick < 14; tick++) h.frame(tick, [tank(3000, { health: 640 })]);
    expect(h.net.remoteHealth(3000)).toEqual({ current: 640, max: 1000 });
    expect(h.net.remoteHealth(99)).toBeNull();
  });
});
