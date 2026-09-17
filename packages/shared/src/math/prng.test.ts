import { describe, expect, it } from 'vitest';
import { Sfc32, mix32, seedFrom, unitFromSeed } from './prng.ts';

describe('mix32', () => {
  it('is pure and stays in uint32 range', () => {
    for (const v of [0, 1, -1, 2 ** 31, -(2 ** 31), 123456789]) {
      const a = mix32(v);
      expect(mix32(v)).toBe(a);
      expect(Number.isInteger(a)).toBe(true);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(2 ** 32);
    }
  });

  it('avalanches: adjacent inputs give unrelated outputs', () => {
    expect(Math.abs(mix32(1) - mix32(2))).toBeGreaterThan(1000);
  });

  it('has no collisions over a large contiguous run', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 100_000; i++) seen.add(mix32(i));
    expect(seen.size).toBe(100_000);
  });
});

describe('seedFrom', () => {
  it('is order-sensitive, so (tick, entity) never aliases (entity, tick)', () => {
    expect(seedFrom(3, 7)).not.toBe(seedFrom(7, 3));
  });

  it('gives every (tick, shot) pair a distinct seed for one entity', () => {
    const seen = new Set<number>();
    for (let tick = 0; tick < 300; tick++) {
      for (let shot = 0; shot < 30; shot++) seen.add(seedFrom(tick, 42, shot));
    }
    expect(seen.size).toBe(300 * 30);
  });
});

describe('unitFromSeed', () => {
  it('stays in [0, 1)', () => {
    for (let i = 0; i < 20_000; i++) {
      const u = unitFromSeed(i);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });

  it('is roughly uniform across ten buckets', () => {
    const buckets = new Array<number>(10).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) buckets[Math.floor(unitFromSeed(i) * 10)]!++;
    for (const b of buckets) expect(Math.abs(b - n / 10)).toBeLessThan(n / 10 * 0.05);
  });
});

describe('Sfc32', () => {
  it('reproduces its stream exactly from the same seed', () => {
    const a = new Sfc32(12345);
    const b = new Sfc32(12345);
    for (let i = 0; i < 1000; i++) expect(a.nextUint32()).toBe(b.nextUint32());
  });

  it('diverges from a different seed', () => {
    const a = new Sfc32(1);
    const b = new Sfc32(2);
    let same = 0;
    for (let i = 0; i < 1000; i++) if (a.nextUint32() === b.nextUint32()) same++;
    expect(same).toBeLessThan(5);
  });

  it('stays in [0, 1) and in uint32 range', () => {
    const r = new Sfc32(99);
    for (let i = 0; i < 50_000; i++) {
      const u = r.next();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
    const q = new Sfc32(99);
    for (let i = 0; i < 1000; i++) {
      const v = q.nextUint32();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
  });

  it('does not degenerate to a short cycle', () => {
    const r = new Sfc32(7);
    const seen = new Set<number>();
    for (let i = 0; i < 50_000; i++) seen.add(r.nextUint32());
    expect(seen.size).toBeGreaterThan(49_000);
  });
});
