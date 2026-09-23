/**
 * Enemies in the page (T-3.11), from the bytes a server sends to the objects
 * the renderer makes.
 *
 * Driven through a real `NetClient` fed real Delta messages, and a real
 * `RemoteSoldiers` over a real scene, because every property asserted here is
 * a hand-off between the two: the client decides what an entity IS from its
 * components, and the renderer decides what it LOOKS like from that. Either
 * half tested alone could agree with itself and still paint a squadmate red.
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
  getEnemy,
  quantize,
  vitalityCode,
  writeDelta,
} from '@sandline/shared';
import { NetClient } from '../net/NetClient.ts';
import { requireRig } from './humanoidRig.ts';
import { createHumanoidSoldier, soldierSkin } from './humanoidSoldier.ts';
import { RemoteSoldiers, remoteSoldierState } from './remoteSoldiers.ts';
import { SLOT_PALETTES, soldierAtlas } from './soldierTexture.ts';

const TICK_MS = TICK_SECONDS * 1000;
const T = COMPONENT_IDS.Transform;
const H = COMPONENT_IDS.Health;
const RIFLEMAN = ENEMY_IDS.indexOf('rifleman');

type Entity = WorldSnapshot['entities'][number];

function transform(x: number, z: number): number[] {
  return [quantize(x, POSITION), quantize(0, POSITION), quantize(z, POSITION), 512, 0];
}

/** A squad slot as the session sends it: PlayerSlot, Health, Crouch, Weapon. */
function slotEntity(netId: number, slot: number, x = 1): Entity {
  return {
    netId,
    components: {
      [T]: transform(x, 2),
      [H]: [100, 100, 0, 0, 0, 0],
      [COMPONENT_IDS.PlayerSlot]: [slot, 1],
      [COMPONENT_IDS.Crouch]: [0, 0],
      [COMPONENT_IDS.Weapon]: [0, 0, 0],
    },
  };
}

/** An enemy as T-3.10's session sends it: Transform, Health, Crouch, Enemy — no PlayerSlot, no Weapon. */
function enemyEntity(netId: number, x: number, z: number, vitality: 'alive' | 'dead' = 'alive'): Entity {
  const dead = vitality === 'dead';
  return {
    netId,
    components: {
      [T]: transform(x, z),
      [H]: [dead ? 0 : 100, 100, vitalityCode(vitality), dead ? 10 : 0, 0, 0],
      [COMPONENT_IDS.Crouch]: [0, 0],
      [COMPONENT_IDS.Enemy]: [RIFLEMAN, 0],
    },
  };
}

/** A client fed raw snapshots and a renderer drawing from it into a scene of its own. */
function harness() {
  const pair = createLoopbackPair();
  const net = new NetClient(pair.b, 'tester');
  const scene = new THREE.Scene();
  const shootable: THREE.Object3D[] = [];
  const remotes = new RemoteSoldiers({
    scene,
    shootable,
    create: createHumanoidSoldier,
    world: () => [],
    config: DEFAULT_MOVE_CONFIG,
  });
  return {
    net,
    scene,
    shootable,
    remotes,
    /** One tick: a full snapshot arrives, the clock moves a tick, a frame is drawn. */
    frame(tick: number, entities: Entity[]): void {
      const writer = new BitWriter();
      writeDelta(writer, { tick, entities }, null);
      pair.a.send(
        encodeMessage({ kind: 'Delta', tick, baselineTick: null, lastProcessedInputTick: -1, payload: writer.toUint8Array() }),
      );
      pair.settle();
      net.advanceClock(TICK_MS);
      remotes.update(net, TICK_SECONDS);
    },
  };
}

function atlasOf(mesh: THREE.Object3D): THREE.Texture | null {
  return (soldierSkin(mesh).material as THREE.MeshLambertMaterial).map;
}

describe('enemies in the page (T-3.11)', () => {
  it('gives an Enemy entity a soldier mesh in the enemy palette, and a slot never', () => {
    const h = harness();
    for (let tick = 10; tick < 16; tick += 1) h.frame(tick, [slotEntity(4, 1), slotEntity(5, 2, 3), enemyEntity(2000, -5, 40)]);

    const enemy = h.remotes.get(2000);
    expect(enemy).toBeDefined();
    // The same soldier a remote squadmate is: the rig contract, the skin, the
    // carbine its archetype carries.
    const rig = requireRig(enemy!);
    expect(rig.kind).toBe('skinned');
    expect(rig.held).toBe(getEnemy('rifleman').weapon);
    expect(atlasOf(enemy!)).toBe(soldierAtlas('enemy'));
    expect(enemy!.position.z).toBeCloseTo(40, 1);

    for (const netId of [4, 5]) {
      const slot = h.remotes.get(netId);
      expect(slot).toBeDefined();
      expect(atlasOf(slot!)).not.toBe(soldierAtlas('enemy'));
      expect(remoteSoldierState(h.net, netId).palette).not.toBe('enemy');
    }
    expect(atlasOf(h.remotes.get(4)!)).toBe(soldierAtlas(SLOT_PALETTES[1]!));

    // Whatever the roster says about the slots, never the enemy palette.
    for (const human of [true, false]) {
      const view = Object.create(h.net, { roster: { value: Array.from({ length: 6 }, () => ({ human, name: '' })) } });
      for (const netId of [4, 5]) expect(remoteSoldierState(view, netId).palette).not.toBe('enemy');
      expect(remoteSoldierState(view, 2000).palette).toBe('enemy');
    }
  });

  it('never hands an enemy to the squad\'s roster or HUD', () => {
    const h = harness();
    for (let tick = 10; tick < 16; tick += 1) h.frame(tick, [slotEntity(4, 1), enemyEntity(2000, -5, 40)]);

    expect(h.net.remoteEnemy(2000)).toEqual({ archetype: RIFLEMAN, faction: 0 });
    expect(h.net.remoteEnemy(4)).toBeNull();
    // No slot: every HUD line keyed by slot (the squad panel, the revive
    // banner's names) asks `remoteSlot` or `roster`, and gets nothing.
    expect(h.net.remoteSlot(2000)).toBe(-1);
    expect(h.net.roster).toEqual([]);
    // The revive prompt names the downed teammate this client is reviving.
    // Before a join the client's slot is -1, which is exactly the "no
    // reviver" code an enemy's Health carries — the enemy must still not be
    // offered as someone to revive.
    expect(h.net.reviveTargetNetId).not.toBe(2000);
  });

  it('holds a corpse in its death pose until the entity despawns', () => {
    const h = harness();
    let tick = 10;
    for (; tick < 16; tick += 1) h.frame(tick, [slotEntity(4, 1), enemyEntity(2000, -5, 40)]);
    const rig = requireRig(h.remotes.get(2000)!);
    expect(rig.pose).toBe('standing');

    // Killed: it never goes down (T-3.10), it is dead, and it lies there.
    for (const end = tick + 30; tick < end; tick += 1) {
      h.frame(tick, [slotEntity(4, 1), enemyEntity(2000, -5, 40, 'dead')]);
      if (tick > 18) expect(rig.pose).toBe('downed');
    }
    // A corpse takes no hit reaction: it is already on the ground.
    expect(rig.react({ turn: 0.3, lean: 0.2, head: 0 })).toBe(true);
    expect(rig.pose).toBe('downed');
  });

  it('removes every object it created when the entity despawns', () => {
    const h = harness();
    const before = { children: h.scene.children.length, shootable: h.shootable.length };
    let tick = 10;
    for (; tick < 16; tick += 1) h.frame(tick, [slotEntity(4, 1), enemyEntity(2000, -5, 40, 'dead')]);
    const corpse = h.remotes.get(2000)!;
    expect(h.scene.children).toContain(corpse);
    expect(h.shootable).toContain(corpse);
    expect(h.scene.children.length).toBe(before.children + 2);

    // Everything the mesh owns, so a despawn can be seen to free it.
    const owned: (THREE.BufferGeometry | THREE.Material)[] = [];
    for (const part of [corpse, corpse.getObjectByName('soldier'), corpse.getObjectByName('rifle')]) {
      if (!(part instanceof THREE.Mesh)) continue;
      owned.push(part.geometry, part.material as THREE.Material);
    }
    expect(owned).toHaveLength(6);
    const disposed = new Set<unknown>();
    for (const thing of owned) thing.addEventListener('dispose', () => disposed.add(thing));
    const atlas = soldierAtlas('enemy');
    let atlasDisposed = false;
    atlas.addEventListener('dispose', () => (atlasDisposed = true));

    // Gone from the world. For one interpolation delay it is still drawn —
    // the last place the server had it is still ahead of the render clock.
    h.frame(tick++, [slotEntity(4, 1)]);
    expect(h.remotes.has(2000)).toBe(true);

    for (const end = tick + 12; tick < end; tick += 1) h.frame(tick, [slotEntity(4, 1)]);
    expect(h.remotes.has(2000)).toBe(false);
    expect(h.scene.children).not.toContain(corpse);
    expect(h.shootable).not.toContain(corpse);
    expect(h.scene.children.length).toBe(before.children + 1);
    expect(h.shootable.length).toBe(before.shootable + 1);
    expect(disposed.size).toBe(owned.length);
    // The palette atlas is shared by every enemy: never freed with one.
    expect(atlasDisposed).toBe(false);
    // The slot is untouched.
    expect(h.remotes.has(4)).toBe(true);

    // And the client lets go of everything it held about it, a while later.
    for (const end = tick + 30; tick < end; tick += 1) h.frame(tick, [slotEntity(4, 1)]);
    expect(h.net.remotesHeld).toBe(1);
    expect(h.net.remoteEnemy(2000)).toBeNull();
  });

  it('leaves nothing behind when the session is left', () => {
    const h = harness();
    for (let tick = 10; tick < 14; tick += 1) h.frame(tick, [slotEntity(4, 1), enemyEntity(2000, -5, 40)]);
    expect(h.remotes.size).toBe(2);
    h.remotes.clear();
    expect(h.remotes.size).toBe(0);
    expect(h.scene.children).toHaveLength(0);
    expect(h.shootable).toHaveLength(0);
  });
});
