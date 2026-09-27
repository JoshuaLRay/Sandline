/**
 * U-017: a dead enemy's firearm as a world pickup, end to end — a real
 * `Session`, real `NetClient`s over loopback and the page's `PickupModels`.
 *
 * - A death drops exactly one, with the enemy's weapon and the rounds left
 *   in its magazine, where it fell, under a netId in the pickup band; the
 *   same death seen again (every tick after it) drops nothing more. The LMG
 *   an MG enemy carries drops nothing (the documented policy).
 * - Every client, and one that joins later, has the same pickup at the same
 *   place; the page draws it, and stops drawing it when the host does.
 * - Bounded: each goes after `despawnSeconds`; past `max` the oldest goes; a
 *   retry clears them; and an id is never handed out twice.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { PICKUPS, TICK_SECONDS, WEAPON_IDS, createLoopbackPair, encodeMessage, getWeapon, isPickupNetId } from '@sandline/shared';
import { initNav } from '@sandline/server/nav';
import { Session } from '@sandline/server/session';
import { NetClient } from '../net/NetClient.ts';
import { PickupModels } from './pickupModels.ts';

const CARBINE = WEAPON_IDS.indexOf('carbine');

function room() {
  const session = new Session();
  let now = 0;
  const clients: { net: NetClient; pair: ReturnType<typeof createLoopbackPair> }[] = [];
  const settle = () => clients.forEach((c) => c.pair.settle());
  const join = (name: string) => {
    const pair = createLoopbackPair();
    session.addConnection(pair.a, now);
    const net = new NetClient(pair.b, name);
    clients.push({ net, pair });
    net.join();
    settle();
    return net;
  };
  const step = (ticks = 1) => {
    for (let i = 0; i < ticks; i++) {
      now += TICK_SECONDS * 1000;
      clients.forEach((c) => c.pair.b.send(encodeMessage({ kind: 'Ping', id: 1, clientTime: 0 })));
      settle();
      session.step(now);
      settle();
    }
  };
  /** An enemy killed where it stands, as a finishing shot would leave it. */
  const kill = (netId: number) => {
    const e = session.enemies.find((x) => x.netId === netId)!;
    Object.assign(e.health, { current: 0, diedAt: now / 1000 });
  };
  return { session, join, step, kill };
}

describe('a dead enemy\'s weapon on the ground (U-017)', () => {
  beforeAll(() => initNav());

  it('one pickup a death — its weapon, its rounds, where it fell — the same on every client and a late joiner, and drawn', () => {
    const r = room();
    const a = r.join('a');
    r.step(2);
    const id = r.session.spawnEnemy('rifleman', { x: 12, y: 0, z: 30 })!;
    const enemy = r.session.enemies.find((e) => e.netId === id)!;
    enemy.weaponState.ammo = 17;
    r.step(2);
    expect(r.session.pickups).toHaveLength(0);
    r.kill(id);
    r.step(1);
    expect(r.session.pickups).toHaveLength(1);
    const p = r.session.pickups[0]!;
    expect(p).toMatchObject({ weapon: CARBINE, ammo: 17, x: 12, z: 30 });
    expect(isPickupNetId(p.netId)).toBe(true);
    // The death is seen again every tick after: still one.
    r.step(30);
    expect(r.session.pickups).toHaveLength(1);
    expect(r.session.pickups[0]!.netId).toBe(p.netId);
    // Every client has it, the same; one that joins now does too.
    const late = r.join('late');
    r.step(3);
    for (const net of [a, late]) {
      expect(net.pickups()).toHaveLength(1);
      expect(net.pickups()[0]).toMatchObject({ netId: p.netId, weapon: CARBINE, ammo: 17 });
      expect(net.pickups()[0]!.x).toBeCloseTo(12, 1);
      expect(net.pickups()[0]!.z).toBeCloseTo(30, 1);
    }
    // The page draws it, and stops when the host stops sending it.
    const scene = new THREE.Scene();
    const models = new PickupModels(scene);
    models.update(a.pickups());
    expect(models.count).toBe(1);
    expect(scene.getObjectByName(`pickup carbine ${p.netId}`)?.position.z).toBeCloseTo(30, 1);
    r.step(Math.ceil(PICKUPS.despawnSeconds / TICK_SECONDS) + 2);
    expect(r.session.pickups).toHaveLength(0);
    expect(a.pickups()).toHaveLength(0);
    models.update(a.pickups());
    expect(models.count).toBe(0);
  });

  it('an MG enemy\'s LMG drops nothing; the magazine\'s rounds are the dead enemy\'s own', () => {
    const r = room();
    r.join('a');
    r.step(2);
    const mg = r.session.spawnEnemy('mg', { x: -10, y: 0, z: 30 })!;
    const rifleman = r.session.spawnEnemy('rifleman', { x: 10, y: 0, z: 30 })!;
    r.step(2);
    r.kill(mg);
    r.kill(rifleman);
    r.step(2);
    expect(r.session.pickups.map((p) => WEAPON_IDS[p.weapon])).toEqual(['carbine']);
    expect(r.session.pickups[0]!.ammo).toBe(getWeapon('carbine').magSize);
  });

  it('bounded: past the cap the oldest goes, ids are never handed out twice, and a retry clears the ground', () => {
    const r = room();
    r.join('a');
    r.step(2);
    const seen = new Set<number>();
    for (let i = 0; i < PICKUPS.max + 5; i++) {
      const id = r.session.spawnEnemy('rifleman', { x: (i % 10) * 2, y: 0, z: 20 + Math.floor(i / 10) * 2 })!;
      r.step(1);
      r.kill(id);
      r.step(1);
      for (const p of r.session.pickups) seen.add(p.netId);
    }
    expect(r.session.pickups).toHaveLength(PICKUPS.max);
    expect(seen.size).toBe(PICKUPS.max + 5);
    // The oldest five went.
    const ids = r.session.pickups.map((p) => p.netId);
    expect(Math.min(...ids)).toBe(Math.min(...seen) + 5);
    // A restart clears them; the next death takes a new id.
    r.session.restartMission();
    r.step(1);
    expect(r.session.pickups).toHaveLength(0);
    const id = r.session.spawnEnemy('rifleman', { x: 0, y: 0, z: 25 })!;
    r.step(1);
    r.kill(id);
    r.step(1);
    expect(r.session.pickups).toHaveLength(1);
    expect(seen.has(r.session.pickups[0]!.netId)).toBe(false);
  });
});
