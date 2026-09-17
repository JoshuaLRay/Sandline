import { beforeAll, describe, expect, it } from 'vitest';
import { addDynamicBox, addGround, createWorld, initPhysics, rapier } from '../../src/sim/physics.ts';
import { divergence, formatParity, runParity } from './parity.ts';

beforeAll(async () => { await initPhysics(); }, 30_000);

describe('divergence()', () => {
  it('is componentwise max absolute difference', () => {
    expect(divergence([1, 2, 3], [1, 2, 3])).toBe(0);
    expect(divergence([1, 2, 3], [1, 2, 3.5])).toBeCloseTo(0.5);
  });

  it('treats NaN as infinite divergence rather than silently passing', () => {
    expect(divergence([NaN], [0])).toBe(Number.POSITIVE_INFINITY);
  });

  it('refuses mismatched sample shapes', () => {
    expect(() => divergence([1], [1, 2])).toThrow(/shape mismatch/);
  });

  it('does not distinguish -0 from 0', () => {
    expect(divergence([-0], [0])).toBe(0);
  });
});

describe('parity harness (T-0.11)', () => {
  interface FallState {
    world: ReturnType<typeof createWorld>;
    box: ReturnType<typeof addDynamicBox>;
  }

  const fallScenario = {
    create: (): FallState => {
      const r = rapier();
      const world = createWorld(r);
      addGround(world, r);
      return { world, box: addDynamicBox(world, { x: 0, y: 10, z: 0 }, r) };
    },
    step: (s: FallState) => s.world.step(),
    sample: (s: FallState) => {
      const t = s.box.body.translation();
      return [t.x, t.y, t.z];
    },
    dispose: (s: FallState) => s.world.free(),
  };

  it('reports bounded divergence for a falling body', () => {
    const report = runParity(fallScenario, 1000, 1e-4);
    console.log(formatParity('falling body, 1000 ticks', report));
    expect(report.ticks).toBe(1000);
    expect(report.maxDivergence).toBeLessThan(1e-4);
    expect(report.firstBreachTick).toBe(-1);
  });

  it('detects divergence when two instances genuinely differ', () => {
    // The harness must be able to FAIL, or it proves nothing.
    let n = 0;
    const drifting = {
      create: () => ({ v: 0, id: n++ }),
      step: (s: { v: number; id: number }) => { s.v += s.id === 0 ? 1 : 1.001; },
      sample: (s: { v: number }) => [s.v],
    };
    const report = runParity(drifting, 100, 0.05);
    expect(report.maxDivergence).toBeGreaterThan(0.05);
    expect(report.firstBreachTick).toBeGreaterThanOrEqual(0);
  });

  it('takes its constants from the caller, not from game data', () => {
    // Regression guard for R10: this scenario declares its own gravity and
    // start height, so tuning data/*.json can never break parity tests.
    const report = runParity(fallScenario, 50, 1e-6);
    expect(report.maxDivergence).toBe(0);
  });

  it('frees both instances even if stepping throws', () => {
    let freed = 0;
    expect(() => runParity({
      create: () => ({}),
      step: () => { throw new Error('boom'); },
      sample: () => [0],
      dispose: () => { freed++; },
    }, 10)).toThrow('boom');
    expect(freed).toBe(2);
  });
});
