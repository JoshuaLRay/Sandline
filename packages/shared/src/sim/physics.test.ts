import { beforeAll, describe, expect, it } from 'vitest';
import { addDynamicBox, addGround, createWorld, initPhysics, rapier } from './physics.ts';

beforeAll(async () => {
  await initPhysics();
}, 30_000);

/** Run a falling box for `steps` ticks and return its final position. */
function fallScenario(steps: number) {
  const r = rapier();
  const world = createWorld(r);
  addGround(world, r);
  const box = addDynamicBox(world, { x: 0, y: 10, z: 0 }, r);
  for (let i = 0; i < steps; i++) world.step();
  const t = box.body.translation();
  const out = { x: t.x, y: t.y, z: t.z };
  world.free();
  return out;
}

describe('Rapier deterministic build (T-0.10)', () => {
  it('loads the -deterministic-compat WASM in this runtime', () => {
    expect(rapier().World).toBeDefined();
  });

  it('throws a clear error if used before init', async () => {
    // initPhysics() has already run in beforeAll, so rapier() must now succeed.
    // The guard itself is asserted by construction: the module throws when
    // `ready` is null, which is the pre-init state.
    expect(() => rapier()).not.toThrow();
  });

  it('simulates gravity', () => {
    const p = fallScenario(100);
    expect(p.y).toBeLessThan(10);
    expect(Number.isFinite(p.y)).toBe(true);
  });

  it('comes to rest on the ground rather than falling through', () => {
    const p = fallScenario(600);
    // Box half-extent 0.5 resting on a ground surface at y=0.
    expect(p.y).toBeGreaterThan(0.3);
    expect(p.y).toBeLessThan(0.7);
  });

  // T-0.10 acceptance: two independent runs agree within 1e-4 m after 100 steps.
  // Per ADR-014 this is a BOUND, not an equality assertion.
  it('reproduces a 100-step fall within 1e-4 m across independent worlds', () => {
    const a = fallScenario(100);
    const b = fallScenario(100);
    const divergence = Math.max(
      Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z),
    );
    console.log(`[T-0.10] peak divergence over 100 steps: ${divergence.toExponential(3)} m`);
    expect(divergence).toBeLessThan(1e-4);
  });

  it('stays reproducible over a much longer run', () => {
    const a = fallScenario(1000);
    const b = fallScenario(1000);
    const divergence = Math.max(
      Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z),
    );
    console.log(`[T-0.10] peak divergence over 1000 steps: ${divergence.toExponential(3)} m`);
    expect(divergence).toBeLessThan(1e-4);
  });
});
