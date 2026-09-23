/**
 * Interest management (T-3.12), as a pure filter and over the real wire.
 *
 * The session tests decode what a client would decode, acknowledging as they
 * go (or, for the bookkeeping test, only now and then), because the claim is
 * about the wire: an entity leaving a client's radius is a despawn in THAT
 * client's deltas, coming back is a spawn with its current state, and the
 * client's baselines — the views it was sent — never go out of step with
 * what the host diffs against.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPONENT_IDS,
  type Message,
  POSITION,
  PROTOCOL_VERSION,
  SnapshotStore,
  type WorldSnapshot,
  createLoopbackPair,
  decodeMessage,
  dequantize,
  encodeMessage,
  quantize,
} from '@sandline/shared';
import { Session } from './Session.ts';
import { RELEVANCE_HYSTERESIS_M, RELEVANCE_RADIUS_M, relevantView } from './relevance.ts';

const TICK_MS = 1000 / 30;
const T = COMPONENT_IDS.Transform;

/* -- The filter on its own ------------------------------------------------ */

function entity(netId: number, x: number, z: number, slot: boolean): WorldSnapshot['entities'][number] {
  return {
    netId,
    components: {
      [T]: [quantize(x, POSITION), quantize(0, POSITION), quantize(z, POSITION), 0, 0],
      ...(slot ? { [COMPONENT_IDS.PlayerSlot]: [netId - 1, 0] } : {}),
    },
  };
}

const ids = (s: WorldSnapshot): number[] => s.entities.map((e) => e.netId);

describe('relevantView', () => {
  const world: WorldSnapshot = {
    tick: 7,
    entities: [
      entity(1, 0, 0, true),
      entity(2, 0, 200, true), // a squadmate 200 m away
      entity(2000, 0, RELEVANCE_RADIUS_M - 1, false),
      entity(2001, 0, RELEVANCE_RADIUS_M + 1, false),
      entity(2002, 0, RELEVANCE_RADIUS_M + RELEVANCE_HYSTERESIS_M - 1, false),
      entity(2003, 0, RELEVANCE_RADIUS_M + RELEVANCE_HYSTERESIS_M + 1, false),
      entity(2004, 0, -50, false), // behind slot 1, 250 m from slot 2
    ],
  };

  it('keeps every slot at any distance, and non-slots inside the radius only', () => {
    const view = relevantView(world, 1);
    expect(view.tick).toBe(7);
    expect(ids(view)).toEqual([1, 2, 2000, 2004]);
  });

  it('keeps an entity already in view until it is the hysteresis past the radius', () => {
    const view = relevantView(world, 1, new Set([2001, 2002, 2003]));
    expect(ids(view)).toEqual([1, 2, 2000, 2001, 2002, 2004]);
  });

  it('measures from the viewer, not the origin', () => {
    expect(ids(relevantView(world, 2))).toEqual([1, 2, 2000, 2001, 2002, 2003]);
  });

  it('gives a viewer without a slot only the slots', () => {
    expect(ids(relevantView(world, null))).toEqual([1, 2]);
    expect(ids(relevantView(world, 999))).toEqual([1, 2]);
  });

  it('copies nothing and changes nothing', () => {
    const before = structuredClone(world);
    const view = relevantView(world, 1);
    expect(view.entities[0]).toBe(world.entities[0]);
    expect(world).toEqual(before);
  });
});

/* -- On the wire ---------------------------------------------------------- */

/**
 * A client over a loopback: handshakes, decodes every delta and acknowledges
 * one in `ackEvery` of them. Every decode failure is kept, so a test can
 * assert there were none.
 */
function connect(session: Session, ackEvery = 1) {
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  const store = new SnapshotStore();
  const failures: string[] = [];
  const baselines: (number | null)[] = [];
  let netId = 0;
  let deltas = 0;
  pair.b.onMessage((bytes) => {
    const msg: Message = decodeMessage(bytes);
    if (msg.kind === 'JoinAck') netId = msg.netId;
    if (msg.kind !== 'Delta') return;
    baselines.push(msg.baselineTick);
    const result = store.applyDelta(msg.tick, msg.baselineTick, msg.payload);
    if (!result.ok) failures.push(result.reason ?? 'failed');
    else if (deltas++ % ackEvery === 0) pair.b.send(encodeMessage({ kind: 'Ack', tick: msg.tick }));
  });
  pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'viewer', room: '' }));
  pair.settle();
  return {
    store,
    failures,
    baselines,
    get netId() {
      return netId;
    },
    /** What this client currently holds of `id`, or null. */
    sees(id: number) {
      const e = store.current?.entities.find((x) => x.netId === id);
      const t = e?.components[T];
      if (!e || !t) return null;
      return {
        x: dequantize(t[0] as number, POSITION),
        z: dequantize(t[2] as number, POSITION),
        health: e.components[COMPONENT_IDS.Health]?.[0],
        enemy: e.components[COMPONENT_IDS.Enemy],
      };
    },
    settle: () => pair.settle(),
  };
}

type Client = ReturnType<typeof connect>;

function run(session: Session, clients: Client[], ticks: number, each?: () => void): void {
  for (let i = 0; i < ticks; i++) {
    session.step((session.tick + 1) * TICK_MS);
    for (const c of clients) c.settle();
    each?.();
  }
}

function slotOf(session: Session, client: Client) {
  const slot = session.slots.find((s) => s.netId === client.netId);
  if (!slot) throw new Error('client has no slot');
  return slot;
}

describe('interest management on the wire (T-3.12)', () => {
  it('despawns an enemy for the client it left, only, and respawns it with its current state', () => {
    const session = new Session(undefined, '', 'range');
    const a = connect(session);
    const b = connect(session);
    run(session, [a, b], 3);
    expect(a.netId).not.toBe(b.netId);

    const id = session.spawnEnemy('rifleman', { x: 0, y: 0, z: 14, faction: 1 }) as number;
    run(session, [a, b], 2);
    expect(a.sees(id)).not.toBeNull();
    expect(b.sees(id)).not.toBeNull();

    // A walks 200 m down range; B stays. The enemy leaves A's view only.
    const slotA = slotOf(session, a);
    const home = { x: slotA.state.x, z: slotA.state.z };
    slotA.state.z = 214;
    run(session, [a, b], 2);
    expect(a.sees(id)).toBeNull();
    expect(b.sees(id)).not.toBeNull();
    // Slots never leave: B, 200 m away, is still in A's picture, and A in B's.
    expect(a.sees(b.netId)).not.toBeNull();
    expect(b.sees(a.netId)?.z).toBeCloseTo(214, 1);

    // While A is away the enemy moves and is hurt; B keeps up, A hears nothing.
    const enemy = session.enemies.find((e) => e.netId === id);
    if (!enemy) throw new Error('enemy missing');
    enemy.state.x = 3.5;
    enemy.health.current = 70;
    run(session, [a, b], 3);
    expect(a.sees(id)).toBeNull();
    expect(b.sees(id)).toMatchObject({ x: 3.5, health: 70 });

    // A comes back: the enemy is spawned into A's view as it is now, Enemy
    // component and all — not where A last saw it.
    slotA.state.x = home.x;
    slotA.state.z = home.z;
    run(session, [a, b], 1);
    expect(a.sees(id)).toEqual({ x: 3.5, z: 14, health: 70, enemy: [0, 1] });
    expect(a.failures).toEqual([]);
    expect(b.failures).toEqual([]);
  });

  it('keeps each client’s ack and baseline bookkeeping straight through leave and re-entry', () => {
    const session = new Session(undefined, '', 'range');
    // Acknowledges one delta in five, so most deltas are against a baseline
    // several ticks old — on either side of the enemy leaving and returning.
    const lazy = connect(session, 5);
    const eager = connect(session);
    run(session, [lazy, eager], 3);

    const id = session.spawnEnemy('rifleman', { x: 0, y: 0, z: 14, faction: 0 }) as number;
    const enemy = session.enemies.find((e) => e.netId === id);
    if (!enemy) throw new Error('enemy missing');

    // The enemy paces out of range and back three times, a metre a tick.
    const presence: boolean[] = [];
    let step = 1;
    run(session, [lazy, eager], 3 * 2 * 140, () => {
      enemy.state.z += step;
      if (enemy.state.z > 150 || enemy.state.z < 14) step = -step;
      presence.push(lazy.sees(id) !== null);
      // Whenever the lazy client holds it, it holds it where the host last put it.
      const s = lazy.sees(id);
      if (s) expect(Math.abs(s.z - enemy.state.z)).toBeLessThan(1.01);
    });

    // It went and came back, more than once, for the lazy client too.
    const flips = presence.filter((p, i) => i > 0 && p !== presence[i - 1]).length;
    expect(flips).toBeGreaterThanOrEqual(5);

    // Every delta applied; after the first full one every one had a baseline
    // the client still held.
    for (const c of [lazy, eager]) {
      expect(c.failures).toEqual([]);
      expect(c.store.missedBaselines).toBe(0);
      expect(c.baselines.slice(1).every((b) => b !== null)).toBe(true);
    }

    // And both end where the host is: every slot, and the enemy when it is
    // inside the radius of that client's slot (either way in the hysteresis band).
    for (const c of [lazy, eager]) {
      const me = slotOf(session, c).state;
      for (const s of session.slots) expect(c.sees(s.netId)).not.toBeNull();
      const d = Math.hypot(enemy.state.x - me.x, enemy.state.y - me.y, enemy.state.z - me.z);
      if (d <= RELEVANCE_RADIUS_M) expect(c.sees(id)).not.toBeNull();
      if (d > RELEVANCE_RADIUS_M + RELEVANCE_HYSTERESIS_M) expect(c.sees(id)).toBeNull();
    }
  });
});
