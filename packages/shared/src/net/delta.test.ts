import { describe, expect, it } from 'vitest';
import { BitReader, BitWriter } from './BitStream.ts';
import { COMPONENT_IDS } from '../ecs/components.ts';
import { SnapshotHistory, readDelta, writeDelta } from './delta.ts';
import { type WorldSnapshot, readSnapshot, writeSnapshot } from './snapshot.ts';
import { Sfc32 } from '../math/prng.ts';

const T = COMPONENT_IDS.Transform;
const H = COMPONENT_IDS.Health;

/** A world of `n` entities with deterministic starting levels. */
function makeWorld(tick: number, n: number): WorldSnapshot {
  const rng = new Sfc32(4242);
  const entities = [];
  for (let i = 0; i < n; i++) {
    entities.push({
      netId: i + 1,
      components: {
        [T]: [rng.nextUint32() % 65536, rng.nextUint32() % 65536, rng.nextUint32() % 65536, rng.nextUint32() % 1024, 0],
        [H]: [100, 100, 0, 0, 0, 0],
      },
    });
  }
  return { tick, entities };
}

const encodeFull = (s: WorldSnapshot): Uint8Array => {
  const w = new BitWriter();
  writeSnapshot(w, s);
  return w.toUint8Array();
};

const encodeDelta = (cur: WorldSnapshot, base: WorldSnapshot | null): Uint8Array => {
  const w = new BitWriter();
  writeDelta(w, cur, base);
  return w.toUint8Array();
};

const decodeDelta = (bytes: Uint8Array, base: WorldSnapshot | null): WorldSnapshot =>
  readDelta(new BitReader(bytes), base);

/** Compare ignoring entity order, which the wire does not preserve. */
function expectSameWorld(a: WorldSnapshot, b: WorldSnapshot): void {
  expect(a.tick).toBe(b.tick);
  const key = (w: WorldSnapshot) =>
    [...w.entities].sort((x, y) => x.netId - y.netId).map((e) => ({ netId: e.netId, components: e.components }));
  expect(key(a)).toEqual(key(b));
}

describe('full snapshot (T-1.03)', () => {
  it('round-trips a 50-entity world exactly', () => {
    const world = makeWorld(10, 50);
    expectSameWorld(readSnapshot(new BitReader(encodeFull(world))), world);
  });

  it('round-trips an empty world', () => {
    const world: WorldSnapshot = { tick: 3, entities: [] };
    expectSameWorld(readSnapshot(new BitReader(encodeFull(world))), world);
  });

  it('preserves partial component sets', () => {
    const world: WorldSnapshot = {
      tick: 1,
      entities: [
        { netId: 1, components: { [T]: [1, 2, 3, 4, 5] } },
        { netId: 2, components: { [H]: [50, 100, 0, 0, 0, 0] } },
      ],
    };
    expectSameWorld(readSnapshot(new BitReader(encodeFull(world))), world);
  });

  it('rejects a component given the wrong field count', () => {
    const w = new BitWriter();
    expect(() => writeSnapshot(w, { tick: 1, entities: [{ netId: 1, components: { [T]: [1, 2] } }] })).toThrow(
      /expects 5 fields/,
    );
  });

  it('stays near the per-entity budget', () => {
    // ADR-012 budgets ~12 bytes per entity; Transform + Health is the common case.
    const bytes = encodeFull(makeWorld(1, 50)).length;
    expect(bytes / 50).toBeLessThan(16);
  });
});

describe('delta compression (T-1.04)', () => {
  // The headline acceptance criterion from the plan.
  it('encodes 5-of-50 moved entities in under 20% of a full snapshot', () => {
    const base = makeWorld(100, 50);
    const next: WorldSnapshot = {
      tick: 101,
      entities: base.entities.map((e, i) =>
        i < 5
          ? { netId: e.netId, components: { ...e.components, [T]: [(e.components[T] as number[])[0]! + 40, 1, 2, 3, 4] } }
          : e,
      ),
    };
    const full = encodeFull(next).length;
    const delta = encodeDelta(next, base).length;
    expect(delta).toBeLessThan(full * 0.2);
    expectSameWorld(decodeDelta(encodeDelta(next, base), base), next);
  });

  it('applying a delta to its baseline reproduces the new state exactly', () => {
    const base = makeWorld(1, 30);
    const next = makeWorld(2, 30);
    next.entities[7]!.components[H] = [42, 100, 1, 17, 0, 0];
    expectSameWorld(decodeDelta(encodeDelta(next, base), base), next);
  });

  it('costs almost nothing when nothing changed', () => {
    const base = makeWorld(5, 50);
    const still: WorldSnapshot = { tick: 6, entities: base.entities };
    const delta = encodeDelta(still, base);
    expect(delta.length).toBeLessThan(10);
    expectSameWorld(decodeDelta(delta, base), still);
  });

  it('carries spawns', () => {
    const base = makeWorld(1, 3);
    const next: WorldSnapshot = {
      tick: 2,
      entities: [...base.entities, { netId: 99, components: { [T]: [5, 6, 7, 8, 9], [H]: [10, 10, 0, 0, 0, 0] } }],
    };
    const got = decodeDelta(encodeDelta(next, base), base);
    expect(got.entities).toHaveLength(4);
    expectSameWorld(got, next);
  });

  it('carries an enemy spawn whole, archetype and faction included (T-3.10)', () => {
    const base = makeWorld(1, 3);
    const enemy = {
      netId: 2000,
      components: {
        [T]: [5, 6, 7, 8, 9],
        [COMPONENT_IDS.Velocity]: [1, 2, 3],
        [H]: [100, 100, 0, 0, 0, 0],
        [COMPONENT_IDS.Crouch]: [1, 0],
        // The widest values the fields hold: a width mismatch corrupts these.
        [COMPONENT_IDS.Enemy]: [7, 3],
      },
    };
    const next: WorldSnapshot = { tick: 2, entities: [...base.entities, enemy] };
    const got = decodeDelta(encodeDelta(next, base), base);
    expectSameWorld(got, next);
    expect(got.entities.find((e) => e.netId === 2000)?.components[COMPONENT_IDS.Enemy]).toEqual([7, 3]);
    // Identity never changes, so a tick later it costs nothing.
    const still: WorldSnapshot = { tick: 3, entities: next.entities };
    expect(encodeDelta(still, next).length).toBeLessThan(10);
  });

  it('carries despawns', () => {
    const base = makeWorld(1, 4);
    const next: WorldSnapshot = { tick: 2, entities: base.entities.filter((e) => e.netId !== 2) };
    const got = decodeDelta(encodeDelta(next, base), base);
    expect(got.entities.map((e) => e.netId).sort((a, b) => a - b)).toEqual([1, 3, 4]);
  });

  it('handles spawn, despawn and update in one delta', () => {
    const base = makeWorld(1, 5);
    const next: WorldSnapshot = {
      tick: 2,
      entities: [
        ...base.entities.filter((e) => e.netId !== 1).map((e) => (e.netId === 3 ? { ...e, components: { ...e.components, [H]: [7, 100, 0, 0, 0, 0] } } : e)),
        { netId: 50, components: { [T]: [1, 1, 1, 1, 1] } },
      ],
    };
    expectSameWorld(decodeDelta(encodeDelta(next, base), base), next);
  });

  it('sends only the fields that changed, not the whole component', () => {
    const base = makeWorld(1, 20);
    const movedOnly: WorldSnapshot = {
      tick: 2,
      entities: base.entities.map((e, i) =>
        i === 0 ? { ...e, components: { ...e.components, [T]: [(e.components[T] as number[])[0]! + 1, (e.components[T] as number[])[1]!, (e.components[T] as number[])[2]!, (e.components[T] as number[])[3]!, (e.components[T] as number[])[4]!] } } : e,
      ),
    };
    const allChanged: WorldSnapshot = {
      tick: 2,
      entities: base.entities.map((e, i) => (i === 0 ? { ...e, components: { ...e.components, [T]: [9, 9, 9, 9, 9] } } : e)),
    };
    expect(encodeDelta(movedOnly, base).length).toBeLessThan(encodeDelta(allChanged, base).length);
  });

  it('falls back to a full snapshot with no baseline', () => {
    const world = makeWorld(9, 12);
    expectSameWorld(decodeDelta(encodeDelta(world, null), null), world);
  });

  // Regression: "has a baseline" was once encoded as a sentinel tick of 0,
  // which broke the server's very first delta because tick 0 is a real tick.
  // It is an explicit bit now.
  it('treats tick 0 as a valid baseline, not as "no baseline"', () => {
    const base = makeWorld(0, 10);
    const next: WorldSnapshot = {
      tick: 1,
      entities: base.entities.map((e, i) => (i === 0 ? { ...e, components: { ...e.components, [H]: [1, 100, 0, 0, 0, 0] } } : e)),
    };
    const got = decodeDelta(encodeDelta(next, base), base);
    expect(got.entities).toHaveLength(10);
    expectSameWorld(got, next);
  });

  it('rejects a full snapshot decoded against a baseline', () => {
    const world = makeWorld(4, 3);
    expect(() => decodeDelta(encodeDelta(world, null), makeWorld(3, 3))).toThrow(/full snapshot/);
  });

  it('refuses to decode against the wrong baseline instead of corrupting state', () => {
    const base = makeWorld(1, 5);
    const wrong = makeWorld(2, 5);
    const bytes = encodeDelta(makeWorld(2, 5), base);
    expect(() => decodeDelta(bytes, wrong)).toThrow(/baseline tick/);
    expect(() => decodeDelta(bytes, null)).toThrow(/baseline tick/);
  });

  it('survives a long chain of deltas without drift', () => {
    const rng = new Sfc32(31337);
    let current = makeWorld(0, 40);
    let mirror = current;
    for (let tick = 1; tick <= 200; tick++) {
      const next: WorldSnapshot = {
        tick,
        entities: current.entities.map((e) => {
          if (rng.nextUint32() % 4 !== 0) return e;
          const t = e.components[T] as number[];
          return { netId: e.netId, components: { ...e.components, [T]: [(t[0]! + 3) % 65536, t[1]!, t[2]!, (t[3]! + 1) % 1024, t[4]!] } };
        }),
      };
      mirror = decodeDelta(encodeDelta(next, mirror), mirror);
      expectSameWorld(mirror, next);
      current = next;
    }
  });
});

describe('SnapshotHistory', () => {
  it('returns a stored snapshot by tick', () => {
    const h = new SnapshotHistory(8);
    const s = makeWorld(5, 2);
    h.store(s);
    expect(h.get(5)).toBe(s);
  });

  it('returns null for a tick that was never stored', () => {
    expect(new SnapshotHistory(8).get(3)).toBeNull();
  });

  // A client that stops acking must not grow server memory without bound; it
  // ages out and gets a full snapshot instead, which is self-healing.
  it('ages out old ticks rather than growing without bound', () => {
    const h = new SnapshotHistory(8);
    for (let t = 0; t < 20; t++) h.store(makeWorld(t, 1));
    expect(h.get(1)).toBeNull();
    expect(h.get(19)?.tick).toBe(19);
  });

  it('does not return a stale slot for an aliasing tick', () => {
    // tick 1 and tick 9 share a slot when capacity is 8.
    const h = new SnapshotHistory(8);
    h.store(makeWorld(1, 1));
    h.store(makeWorld(9, 1));
    expect(h.get(1)).toBeNull();
    expect(h.get(9)?.tick).toBe(9);
  });
});
