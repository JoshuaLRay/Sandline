/**
 * Server-authoritative projectiles: T-2.30's flight wired into the session
 * (T-2.31), driven over the real wire.
 *
 * Over the wire, and through the real delta path, for the reason `fire.test.ts`
 * gives and then one more. The Throw message is new, the Detonation is new, the
 * `Projectile` component is new and the component mask got a bit wider — a
 * field written and read at different widths passes every unit test and
 * corrupts every snapshot. And projectiles are the first entities in this game
 * that spawn and despawn, which is delta-format machinery that has existed
 * since T-1.04 and never once run: these tests decode what the client would
 * decode, acknowledging as it goes, so a spawn or a despawn that does not
 * survive the encoding fails here rather than in a browser.
 *
 * What is NOT here: the shape of an arc, the bounce off a crate, the blast
 * falloff and what cover does to it. Those are `ballistics.test.ts`'s, over
 * fixture geometry it owns (§2.3, R10). This file is about whether the session
 * spawns the thing, flies it, hurts the right people with it and takes it away
 * again.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPONENT_IDS,
  FIRST_PROJECTILE_NET_ID,
  type Message,
  PROTOCOL_VERSION,
  POSITION,
  SnapshotStore,
  dequantize,
  createLoopbackPair,
  decodeMessage,
  encodeMessage,
  getProjectile,
  isRangeTarget,
  vitality,
} from '@sandline/shared';
import { MAX_PROJECTILES, Session } from './Session.ts';

const TICK_MS = 1000 / 30;

/** Table angle units (1/4096 turn), which is what a Throw carries. */
const STRAIGHT_DOWN = (-1024 >>> 0) & 0xfff;
const QUARTER_TURN = 1024;

const FRAG = 0;
const ROCKET = 1;

/** A client that handshakes, throws things, and decodes what comes back. */
function connect(session: Session, now = 0) {
  const pair = createLoopbackPair();
  session.addConnection(pair.a, now);
  const store = new SnapshotStore();
  const detonations: Extract<Message, { kind: 'Detonation' }>[] = [];
  let netId = 0;

  pair.b.onMessage((bytes) => {
    let msg: Message;
    try {
      msg = decodeMessage(bytes);
    } catch {
      return;
    }
    if (msg.kind === 'JoinAck') netId = msg.netId;
    if (msg.kind === 'Detonation') detonations.push(msg);
    if (msg.kind === 'Delta') {
      const result = store.applyDelta(msg.tick, msg.baselineTick, msg.payload);
      // Acknowledge, so the NEXT delta is encoded against this baseline and
      // the spawns and despawns below are real deltas rather than full
      // snapshots that happen to differ.
      if (result.ok) pair.b.send(encodeMessage({ kind: 'Ack', tick: msg.tick }));
    }
  });
  pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'thrower', room: '' }));
  pair.settle();

  return {
    detonations,
    store,
    get netId() {
      return netId;
    },
    send(msg: Message): void {
      pair.b.send(encodeMessage(msg));
      pair.settle();
    },
    throwOne(overrides: Partial<Extract<Message, { kind: 'Throw' }>> = {}): void {
      pair.b.send(
        encodeMessage({ kind: 'Throw', tick: 0, yaw: 0, pitch: 0, projectile: FRAG, ...overrides }),
      );
      pair.settle();
    },
    /** Advance the session `count` ticks, settling the link on both sides. */
    run(count: number): void {
      for (let i = 0; i < count; i += 1) {
        pair.settle();
        session.step((session.tick + 1) * TICK_MS);
        pair.settle();
      }
    },
  };
}

/** Every projectile in the client's decoded view of the world. */
function projectilesIn(store: SnapshotStore): { netId: number; x: number; y: number; z: number; kind: number; ownerSlot: number }[] {
  const snapshot = store.current;
  if (!snapshot) return [];
  const out = [];
  for (const entity of snapshot.entities) {
    const projectile = entity.components[COMPONENT_IDS.Projectile];
    const transform = entity.components[COMPONENT_IDS.Transform];
    if (!projectile || !transform) continue;
    out.push({
      netId: entity.netId,
      x: dequantize(transform[0] as number, POSITION),
      y: dequantize(transform[1] as number, POSITION),
      z: dequantize(transform[2] as number, POSITION),
      kind: projectile[0] as number,
      ownerSlot: projectile[1] as number,
    });
  }
  return out;
}

describe('throwing (T-2.31)', () => {
  it('spawns an entity that flies, and takes it away when it goes off', () => {
    const session = new Session();
    const client = connect(session);
    // Level, down-range: it lands well clear of the spawn line.
    client.throwOne({ pitch: 0, yaw: 0 });
    client.run(3);

    const [projectile] = projectilesIn(client.store);
    expect(projectile).toBeDefined();
    expect(projectile?.kind).toBe(FRAG);
    expect(projectile?.ownerSlot).toBe(0);
    // Its own numbering: not a slot's, and not a range target's either — the
    // predicate that decides that became a bounded test for exactly this.
    expect(projectile?.netId).toBeGreaterThanOrEqual(FIRST_PROJECTILE_NET_ID);
    expect(session.slots.some((s) => s.netId === projectile?.netId)).toBe(false);
    expect(isRangeTarget(projectile?.netId ?? 0)).toBe(false);

    const startZ = projectile?.z ?? 0;
    client.run(5);
    expect((projectilesIn(client.store)[0]?.z ?? 0)).toBeGreaterThan(startZ);

    // Through the fuse, and it is gone from the world the client decodes.
    client.run(Math.ceil(getProjectile('frag').fuseSeconds / (TICK_MS / 1000)) + 2);
    expect(client.detonations.length).toBe(1);
    expect(client.detonations[0]?.netId).toBe(projectile?.netId);
    expect(projectilesIn(client.store)).toHaveLength(0);
  });

  it('names the tick it went off on, and the world of that tick no longer holds it', () => {
    const session = new Session();
    const client = connect(session);
    client.throwOne({ pitch: 0 });
    client.run(85);
    const detonation = client.detonations[0];
    expect(detonation).toBeDefined();
    // The snapshot that carries the despawn is the tick the blast is stamped
    // with: a client rendering that tick can draw both consistently.
    const atTick = client.store.get(detonation?.tick ?? -1);
    expect(atTick).not.toBeNull();
    expect(atTick?.entities.some((e) => e.netId === detonation?.netId)).toBe(false);
  });

  it('hurts the thrower who drops one at their own feet, and the squad beside them', () => {
    const session = new Session();
    const client = connect(session);
    const before = session.slots.map((s) => s.health.current);
    client.throwOne({ pitch: STRAIGHT_DOWN });
    client.run(85);

    const detonation = client.detonations[0];
    expect(detonation).toBeDefined();
    expect(detonation?.targets.some((t) => t.netId === client.netId)).toBe(true);
    // Slot 0 threw it; slot 0 is downed or badly hurt by it.
    expect(session.slots[0]?.health.current).toBeLessThan(before[0] as number);
    // The far end of the spawn line is 7.5 m away, outside the 6.5 m radius.
    expect(session.slots[5]?.health.current).toBe(before[5]);
  });

  it('hurts nobody when it lands down-range', () => {
    const session = new Session();
    const client = connect(session);
    const before = session.slots.map((s) => s.health.current);
    client.throwOne({ pitch: 0, yaw: 0 });
    client.run(85);
    expect(client.detonations.length).toBe(1);
    expect(client.detonations[0]?.targets).toHaveLength(0);
    expect(session.slots.map((s) => s.health.current)).toEqual(before);
  });

  it('downs a soldier it goes off on top of, by the same rules a bullet uses', () => {
    const session = new Session();
    const client = connect(session);
    client.throwOne({ pitch: STRAIGHT_DOWN });
    client.run(85);
    expect(vitality(session.slots[0]?.health as never)).toBe('downed');
  });
});

describe('the pouch (T-2.31)', () => {
  it('empties, and then the client gets nothing however often it asks', () => {
    const session = new Session();
    const client = connect(session);
    const carried = getProjectile('frag').carried;
    const cooldownTicks = Math.ceil(getProjectile('frag').cooldownSeconds / (TICK_MS / 1000)) + 1;

    for (let i = 0; i < carried + 3; i += 1) {
      client.throwOne({ pitch: 0 });
      client.run(cooldownTicks);
    }
    // Everything thrown has long since gone off; count the blasts, not the air.
    client.run(85);
    expect(client.detonations.length).toBe(carried);
    expect(session.slots[0]?.pouch[FRAG]).toBe(0);
  });

  it('holds the cooldown: a client spamming Throw gets one', () => {
    const session = new Session();
    const client = connect(session);
    for (let i = 0; i < 5; i += 1) client.throwOne({ pitch: 0 });
    client.run(2);
    expect(projectilesIn(client.store)).toHaveLength(1);
    expect(session.slots[0]?.pouch[FRAG]).toBe(getProjectile('frag').carried - 1);
  });

  it('will not fill the air past the session\'s cap', () => {
    const session = new Session();
    const client = connect(session);
    // Reach in and refill: the pouch and the cooldown hold this far below the
    // cap by themselves, which is the point of the cap being a rail.
    const slot = session.slots[0];
    if (!slot) throw new Error('no slot');
    for (let i = 0; i < MAX_PROJECTILES + 4; i += 1) {
      slot.pouch[FRAG] = 9;
      slot.nextThrowAt = 0;
      client.throwOne({ pitch: 0 });
      client.run(1);
    }
    expect(session.projectilesInFlight).toBe(MAX_PROJECTILES);
    expect(projectilesIn(client.store).length).toBe(MAX_PROJECTILES);
  });

  it('refuses an index that is not a projectile', () => {
    const session = new Session();
    const client = connect(session);
    client.throwOne({ projectile: 3 });
    client.run(2);
    expect(projectilesIn(client.store)).toHaveLength(0);
    expect(session.slots[0]?.pouch).toEqual([getProjectile('frag').carried, getProjectile('rocket').carried]);
  });

  it('refuses a downed thrower and a vaulting one', () => {
    const session = new Session();
    const client = connect(session);
    const slot = session.slots[0];
    if (!slot) throw new Error('no slot');

    slot.health.downedAt = 0;
    client.throwOne({ pitch: 0 });
    client.run(2);
    expect(projectilesIn(client.store)).toHaveLength(0);

    slot.health.downedAt = null;
    slot.state = { ...slot.state, vault: { elapsed: 0.1, yaw: 0, fromX: 0, fromY: 0, fromZ: 0, topY: 1 } };
    client.throwOne({ pitch: 0 });
    client.run(2);
    expect(projectilesIn(client.store)).toHaveLength(0);

    slot.state = { ...slot.state, vault: null };
    client.throwOne({ pitch: 0 });
    client.run(2);
    expect(projectilesIn(client.store)).toHaveLength(1);
  });

  it('is refilled by a respawn, like the magazine', () => {
    const session = new Session();
    const client = connect(session);
    const slot = session.slots[0];
    if (!slot) throw new Error('no slot');
    client.throwOne({ pitch: 0 });
    client.run(2);
    expect(slot.pouch[FRAG]).toBe(getProjectile('frag').carried - 1);

    slot.health.current = 0;
    slot.health.downedAt = 0;
    slot.health.diedAt = session.tick * (TICK_MS / 1000);
    client.run(Math.ceil(6 / (TICK_MS / 1000)));
    expect(slot.pouch[FRAG]).toBe(getProjectile('frag').carried);
  });
});

describe('the rocket (T-2.31)', () => {
  it('goes off on the first body it reaches, not on the wall behind it', () => {
    const session = new Session();
    const client = connect(session);
    const before = session.slots.map((s) => s.health.current);
    // The six slots spawn in a row along x at z = -6 (ADR-001); a quarter turn
    // of yaw points slot 0 straight down that row at slot 1, 1.5 m away.
    client.throwOne({ projectile: ROCKET, yaw: QUARTER_TURN, pitch: 0 });
    client.run(4);

    const detonation = client.detonations[0];
    expect(detonation).toBeDefined();
    expect(detonation?.projectile).toBe(ROCKET);
    // On the near side of the soldier it hit, not somewhere down-range.
    expect(detonation?.x).toBeLessThan(-2.2);
    expect(detonation?.x).toBeGreaterThan(-3.8);
    expect(session.slots[1]?.health.current).toBeLessThan(before[1] as number);
    // A rocket is not born inside its own thrower — it went off on the soldier
    // 1.5 m away, not at the muzzle — but the blast still reaches back, which
    // is what firing one at arm's length is supposed to cost.
    expect(session.slots[0]?.health.current).toBeLessThan(before[0] as number);
    // Six metres away, past the blast radius: untouched.
    expect(session.slots[5]?.health.current).toBe(before[5]);
  });

  it('flies further than a grenade in the same tick, and sags less', () => {
    const session = new Session();
    const client = connect(session);
    client.throwOne({ projectile: ROCKET, pitch: 0, yaw: 0 });
    client.run(4);
    const rocket = projectilesIn(client.store)[0];
    expect(rocket?.kind).toBe(ROCKET);
    // Slot 0 spawns at z = -6; 45 m/s covers 6 m in four ticks.
    expect(rocket?.z ?? -6).toBeGreaterThan(-6 + 5);
    // And its sag over that is centimetres, not the grenade's metres.
    expect(rocket?.y ?? 0).toBeGreaterThan(1.3);
  });
});

/** The replicated Weapon component of this client's own soldier: [gun, reload %, pouch]. */
function heldBy(store: SnapshotStore, netId: number): number[] | undefined {
  const entity = store.current?.entities.find((e) => e.netId === netId);
  return entity?.components[COMPONENT_IDS.Weapon] as number[] | undefined;
}

describe('equipping (grenade and rocket in hand)', () => {
  it('replicates a pouch item in hand, and a gun again after a gun equip', () => {
    const session = new Session();
    const client = connect(session);
    client.run(2);
    expect(heldBy(client.store, client.netId)?.[2]).toBe(0);

    // Loadout index: four guns first, then the pouch — 5 is the rocket.
    client.send({ kind: 'Equip', item: 4 + ROCKET });
    client.run(2);
    expect(session.slots[0]?.heldProjectile).toBe(ROCKET);
    expect(heldBy(client.store, client.netId)?.[2]).toBe(1 + ROCKET);

    // A gun equip swaps the weapon itself, before any shot is fired.
    client.send({ kind: 'Equip', item: 2 });
    client.run(2);
    expect(session.slots[0]?.heldProjectile).toBe(-1);
    expect(session.slots[0]?.weapon.id).toBe('breacher');
    expect(heldBy(client.store, client.netId)?.slice(0, 3)).toEqual([2, 0, 0]);
  });

  it('drops an out-of-range item without changing what is held', () => {
    const session = new Session();
    const client = connect(session);
    client.send({ kind: 'Equip', item: 4 + FRAG });
    client.send({ kind: 'Equip', item: 7 });
    client.run(1);
    expect(session.slots[0]?.heldProjectile).toBe(FRAG);
  });

  it('throws from the pouch whatever is in hand, and a Fire puts a gun back', () => {
    const session = new Session();
    const client = connect(session);
    client.send({ kind: 'Equip', item: 4 + FRAG });
    client.throwOne({ pitch: 0, yaw: 0 });
    client.run(1);
    expect(session.slots[0]?.pouch[FRAG]).toBe(getProjectile('frag').carried - 1);
    client.send({ kind: 'Fire', tick: 0, yaw: 0, pitch: 0, renderTimeMs: 0, weapon: 0, ads: false });
    expect(session.slots[0]?.heldProjectile).toBe(-1);
  });
});
