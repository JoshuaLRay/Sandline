/**
 * U-070: the tank in the page, from the bytes a server sends to the objects the renderer makes. A real `NetClient`
 * fed real Delta messages and a real `TankModels` over a real scene, as `remoteSoldiers.test.ts` does for soldiers.
 * U-126: the same, drawn from a stand-in for the generated model once one is provided.
 */
import { afterEach, describe, expect, it } from 'vitest';
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
import { TURRET_NODE, TankModels, provideVehicleAssets, vehicleAssetsVersion } from './tankModel.ts';
import { loadVehicleAssets } from './vehicleAssets.ts';

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

/**
 * A stand-in for the generated model, laid out as the shipped copy is after the pipeline quantizes it. The scene
 * holds the hull node (origin at the tank's feet) with its mesh hung under it. The hull's child is the turret pivot
 * on the roof, with its mesh hung under it at the scale and offset that decode quantized positions: a dome 0.82
 * high with its top on the axis, and a gun out to z = 4.3.
 */
function generatedTemplate(): THREE.Object3D {
  const material = new THREE.MeshLambertMaterial({ map: new THREE.Texture() });
  const hull = new THREE.Object3D();
  hull.name = 'vehicle-tank';
  hull.add(new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 5.8).translate(0, 0.8, 0), material));
  const dome = new THREE.SphereGeometry(0.8, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.82 / 0.8, 1).toNonIndexed();
  const gun = new THREE.CylinderGeometry(0.1, 0.1, 3.3).rotateX(Math.PI / 2).translate(0, 0.6, 2.65).toNonIndexed();
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...(dome.getAttribute('position').array as Float32Array), ...(gun.getAttribute('position').array as Float32Array)]), 3));
  // Quantized: stored about its centre at 1/2.6 scale, decoded by its node's offset and scale.
  const [offset, scale] = [new THREE.Vector3(0, 0.5, 1.7), 2.6];
  merged.translate(-offset.x, -offset.y, -offset.z).scale(1 / scale, 1 / scale, 1 / scale);
  const turretMesh = new THREE.Mesh(merged, material);
  turretMesh.name = `${TURRET_NODE}-mesh`;
  turretMesh.position.copy(offset);
  turretMesh.scale.setScalar(scale);
  const turret = new THREE.Object3D();
  turret.name = TURRET_NODE;
  turret.position.set(0, 1.6, 0);
  turret.add(turretMesh);
  hull.add(turret);
  const scene = new THREE.Group();
  scene.add(hull);
  return scene;
}

/** The first mesh under a named node. */
function meshUnder(root: THREE.Object3D, name: string): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  root.getObjectByName(name)!.traverse((o) => {
    if (!found && o instanceof THREE.Mesh) found = o;
  });
  return found!;
}

describe('the generated tank in the page (U-126)', () => {
  afterEach(() => provideVehicleAssets(new Map()));

  it('draws the generated model once provided: its hull and turret on the aim list, the turret turning with the yaw', () => {
    const template = generatedTemplate();
    provideVehicleAssets(new Map([['vehicle-tank', template]]));
    const h = harness();
    for (let tick = 10; tick < 14; tick++) h.frame(tick, [tank(3000, { x: 5, z: -7, yaw: 0, turret: 0 })]);
    const root = h.scene.getObjectByName('tank tank')!;
    expect(root).toBeInstanceOf(THREE.Group);
    // A clone sharing the template's geometry: nothing of the template itself is in the scene.
    const hull = meshUnder(root, 'vehicle-tank');
    expect(hull).not.toBe(meshUnder(template, 'vehicle-tank'));
    expect(hull.geometry).toBe(meshUnder(template, 'vehicle-tank').geometry);
    // Feet on the ground: the root sits at the hull capsule's centre and the model is put back down by it.
    const feet = new THREE.Vector3();
    hull.getWorldPosition(feet);
    expect(feet.y).toBeCloseTo(0, 5);
    expect(h.shootable).toHaveLength(2);
    for (const mesh of h.shootable) expect(h.tanks.netIdOf(mesh)).toBe(3000);

    const turret = root.getObjectByName(TURRET_NODE)!;
    for (let tick = 14; tick < 80; tick++) h.frame(tick, [tank(3000, { x: 5, z: -7, yaw: 0, turret: 256 })]);
    expect(turret.rotation.y).toBeCloseTo(Math.PI / 2, 2);
    // It turns about its pivot: the pivot stays put over the hull while the gun swings to the side.
    expect(turret.position.toArray()).toEqual([0, 1.6, 0]);
    turret.updateWorldMatrix(true, false);
    const muzzle = new THREE.Vector3(0, 0.6, 4.3).applyMatrix4(turret.matrixWorld);
    expect(muzzle.x).toBeCloseTo(5 + 4.3, 1);
    expect(muzzle.z).toBeCloseTo(-7, 1);
  });

  it('lights the lamp on the dome, flashes at the drawn muzzle, and chars the wreck without touching the template', () => {
    const template = generatedTemplate();
    provideVehicleAssets(new Map([['vehicle-tank', template]]));
    const h = harness();
    const turret = () => h.scene.getObjectByName('tank tank')!.getObjectByName(TURRET_NODE)!;
    const addOns = () => turret().children.filter((c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.SphereGeometry) as THREE.Mesh[];
    for (let tick = 10; tick < 13; tick++) h.frame(tick, [tank(3000)]);
    const [lamp, flash] = addOns();
    expect(lamp!.position.y).toBeGreaterThan(0.82);
    expect(lamp!.position.y).toBeLessThan(1);
    expect(flash!.position.z).toBeGreaterThan(4.3);
    expect(flash!.position.y).toBeCloseTo(2.2 - 1.6, 5);
    h.frame(13, [tank(3000, { aiming: true })]);
    expect(addOns().map((m) => m.visible)).toEqual([true, false]);
    h.frame(14, [tank(3000, { aiming: false })]);
    expect(addOns().map((m) => m.visible)).toEqual([false, true]);

    const hull = meshUnder(h.scene.getObjectByName('tank tank')!, 'vehicle-tank');
    const live = hull.material as THREE.MeshLambertMaterial;
    h.frame(15, [tank(3000, { dead: true })]);
    const wreck = hull.material as THREE.MeshLambertMaterial;
    expect(wreck).not.toBe(live);
    expect(wreck.map).toBe(live.map);
    expect(wreck.color.getHex()).not.toBe(live.color.getHex());
    expect(meshUnder(template, 'vehicle-tank').material).toBe(live);
  });

  it('redraws a tank already in the scene when the generated model arrives, and goes back to the stand-in without it', () => {
    const h = harness();
    for (let tick = 10; tick < 13; tick++) h.frame(tick, [tank(3000)]);
    expect(h.scene.getObjectByName('tank tank')).toBeInstanceOf(THREE.Mesh);
    const version = vehicleAssetsVersion();
    provideVehicleAssets(new Map([['vehicle-tank', generatedTemplate()]]));
    expect(vehicleAssetsVersion()).toBe(version + 1);
    h.frame(13, [tank(3000)]);
    expect(h.scene.getObjectsByProperty('name', 'tank tank')).toHaveLength(1);
    expect(h.scene.getObjectByName('tank tank')).toBeInstanceOf(THREE.Group);
    expect(h.shootable).toHaveLength(2);
    provideVehicleAssets(new Map());
    h.frame(14, [tank(3000)]);
    expect(h.scene.getObjectByName('tank tank')).toBeInstanceOf(THREE.Mesh);
    expect(h.shootable).toHaveLength(2);
  });

  it('loads every vehicle asset as Lambert on one shared material, and provides nothing for one that failed', async () => {
    const template = generatedTemplate();
    const manifest = { version: 1 as const, assets: [{ id: 'vehicle-tank', class: 'vehicle' }, { id: 'crate-small', class: 'prop' }] as never };
    const asked: string[] = [];
    const loader = {
      load: async (id: string) => {
        asked.push(id);
        return { id, object: template, fallback: false, release() {} };
      },
    };
    expect(await loadVehicleAssets(loader, manifest)).toBe(1);
    expect(asked).toEqual(['vehicle-tank']);
    const hull = meshUnder(template, 'vehicle-tank');
    const turret = meshUnder(template, TURRET_NODE);
    expect(hull.material).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(turret.material).toBe(hull.material);

    let released = false;
    const failing = { load: async (id: string) => ({ id, object: new THREE.Object3D(), fallback: true, release: () => (released = true) }) };
    expect(await loadVehicleAssets(failing, manifest)).toBe(0);
    expect(released).toBe(true);
    const h = harness();
    for (let tick = 10; tick < 13; tick++) h.frame(tick, [tank(3000)]);
    expect(h.scene.getObjectByName('tank tank')).toBeInstanceOf(THREE.Mesh);
  });
});
