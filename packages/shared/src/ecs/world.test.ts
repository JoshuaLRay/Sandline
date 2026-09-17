import { describe, expect, it } from 'vitest';
import { defineQuery } from 'bitecs';
import { NetId, Replicated, Transform } from './components.ts';
import { createSimWorld, despawn, spawnReplicated } from './world.ts';

const replicatedQuery = defineQuery([Replicated, Transform, NetId]);

describe('SimWorld (T-0.09)', () => {
  it('spawns entities carrying the replicated archetype', () => {
    const w = createSimWorld();
    const eid = spawnReplicated(w, { x: 1, y: 2, z: 3 });
    expect(Transform.x[eid]).toBe(1);
    expect(Transform.y[eid]).toBe(2);
    expect(Transform.z[eid]).toBe(3);
    expect(replicatedQuery(w.ecs)).toContain(eid);
  });

  // T-0.09 acceptance: 1000 entities, query by archetype, destroy half,
  // confirm no NetId reuse collisions.
  it('never reuses a NetId even when entity ids are recycled', () => {
    const w = createSimWorld();
    const seen = new Set<number>();

    const first: number[] = [];
    for (let i = 0; i < 1000; i++) first.push(spawnReplicated(w));
    expect(replicatedQuery(w.ecs).length).toBe(1000);
    for (const eid of first) seen.add(NetId.id[eid] as number);
    expect(seen.size).toBe(1000);

    // Destroy half, freeing entity ids for bitECS to recycle.
    for (let i = 0; i < 1000; i += 2) despawn(w, first[i] as number);
    expect(replicatedQuery(w.ecs).length).toBe(500);

    // Respawn: bitECS will hand back recycled entity ids, but NetIds must be new.
    for (let i = 0; i < 500; i++) {
      const eid = spawnReplicated(w);
      const nid = NetId.id[eid] as number;
      expect(seen.has(nid)).toBe(false);
      seen.add(nid);
    }
    expect(seen.size).toBe(1500);
  });

  it('allocates NetIds monotonically', () => {
    const w = createSimWorld();
    let prev = 0;
    for (let i = 0; i < 100; i++) {
      const nid = NetId.id[spawnReplicated(w)] as number;
      expect(nid).toBeGreaterThan(prev);
      prev = nid;
    }
  });

  it('keeps worlds isolated from each other', () => {
    const a = createSimWorld();
    const b = createSimWorld();
    spawnReplicated(a);
    spawnReplicated(a);
    spawnReplicated(b);
    expect(replicatedQuery(a.ecs).length).toBe(2);
    expect(replicatedQuery(b.ecs).length).toBe(1);
  });
});
