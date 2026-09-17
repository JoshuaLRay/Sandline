import { describe, expect, it } from 'vitest';
import { CORRECTION_THRESHOLD_M, Predictor, SMOOTHING_MS, distance } from './prediction.ts';
import { DEFAULT_MOVE_CONFIG, type MoveInput, createMoveState, stepCharacter } from '../sim/CharacterController.ts';
import { TICK_SECONDS } from '../sim/Clock.ts';

const forward = (yaw = 0): MoveInput => ({
  moveX: 0,
  moveY: 1,
  yaw,
  jump: false,
  sprint: false,
  crouch: false,
});

const idle = (): MoveInput => ({ moveX: 0, moveY: 0, yaw: 0, jump: false, sprint: false, crouch: false });

/** The authoritative server: the same stepCharacter, nothing else. */
function serverRun(ticks: number, input: MoveInput = forward()) {
  let s = createMoveState(0, 0, 0);
  for (let i = 0; i < ticks; i++) s = stepCharacter(s, input, TICK_SECONDS, DEFAULT_MOVE_CONFIG);
  return s;
}

describe('prediction (T-1.14)', () => {
  it('applies input immediately rather than waiting for the server', () => {
    const p = new Predictor(createMoveState(0, 0, 0));
    const after = p.predict(1, forward());
    expect(after.z).toBeGreaterThan(0);
  });

  // T-1.14 acceptance: at zero latency the prediction matches authority.
  it('matches the server exactly when both run the same inputs', () => {
    const p = new Predictor(createMoveState(0, 0, 0));
    for (let tick = 1; tick <= 100; tick++) p.predict(tick, forward());
    expect(distance(p.simulated, serverRun(100))).toBeLessThan(1e-9);
  });

  it('retains unacknowledged inputs for replay', () => {
    const p = new Predictor(createMoveState(0, 0, 0));
    for (let tick = 1; tick <= 10; tick++) p.predict(tick, forward());
    expect(p.pendingInputs).toBe(10);
  });

  it('bounds its history so a long session cannot grow without limit', () => {
    const p = new Predictor(createMoveState(0, 0, 0), DEFAULT_MOVE_CONFIG, 16);
    for (let tick = 1; tick <= 500; tick++) p.predict(tick, forward());
    expect(p.pendingInputs).toBe(16);
  });
});

describe('reconciliation (T-1.15)', () => {
  it('reports near-zero error when prediction was right', () => {
    const p = new Predictor(createMoveState(0, 0, 0));
    for (let tick = 1; tick <= 20; tick++) p.predict(tick, forward());
    const r = p.reconcile(20, serverRun(20));
    expect(r.matched).toBe(true);
    expect(r.error).toBeLessThan(1e-9);
    expect(r.corrected).toBe(false);
  });

  // Correcting for sub-centimetre differences would mean correcting on every
  // snapshot forever: POSITION quantizes to 1/64 m, so that error is unavoidable.
  it('ignores error inside the quantization threshold', () => {
    const p = new Predictor(createMoveState(0, 0, 0));
    for (let tick = 1; tick <= 20; tick++) p.predict(tick, forward());
    const nudged = { ...serverRun(20) };
    nudged.x += CORRECTION_THRESHOLD_M / 2;
    const r = p.reconcile(20, nudged);
    expect(r.error).toBeGreaterThan(0);
    expect(r.corrected).toBe(false);
  });

  it('corrects and replays unacknowledged inputs when the server disagrees', () => {
    const p = new Predictor(createMoveState(0, 0, 0));
    for (let tick = 1; tick <= 30; tick++) p.predict(tick, forward());

    // Server says we were pushed 2 m sideways at tick 20.
    const authoritative = { ...serverRun(20) };
    authoritative.x += 2;

    const r = p.reconcile(20, authoritative);
    expect(r.corrected).toBe(true);
    expect(r.matched).toBe(true);
    expect(r.replayed).toBe(10); // ticks 21..30 were still in flight
    // The 2 m displacement survives the replay.
    expect(p.simulated.x).toBeCloseTo(2, 5);
    // And the replayed forward motion is preserved too.
    expect(p.simulated.z).toBeCloseTo(serverRun(30).z, 5);
  });

  // The plan's T-1.15 criterion: inject divergence, converge within 5 ticks.
  it('converges within 5 ticks after a 50-tick divergence', () => {
    const p = new Predictor(createMoveState(0, 0, 0));
    for (let tick = 1; tick <= 50; tick++) p.predict(tick, forward());

    // Authority diverged badly: a different position entirely.
    const authoritative = createMoveState(10, 0, -5);
    p.reconcile(50, authoritative);

    let server = authoritative;
    let converged = -1;
    for (let tick = 51; tick <= 56; tick++) {
      p.predict(tick, forward());
      server = stepCharacter(server, forward(), TICK_SECONDS, DEFAULT_MOVE_CONFIG);
      const r = p.reconcile(tick, server);
      if (converged === -1 && r.error <= CORRECTION_THRESHOLD_M) converged = tick - 50;
    }
    expect(converged).toBeGreaterThan(0);
    expect(converged).toBeLessThanOrEqual(5);
  });

  it('trusts the server outright when the tick has aged out', () => {
    const p = new Predictor(createMoveState(0, 0, 0), DEFAULT_MOVE_CONFIG, 8);
    for (let tick = 1; tick <= 100; tick++) p.predict(tick, forward());
    const r = p.reconcile(2, createMoveState(5, 0, 5)); // long gone
    expect(r.matched).toBe(false);
    expect(p.simulated.x).toBe(5);
  });

  it('tracks peak error and correction count for the netgraph', () => {
    const p = new Predictor(createMoveState(0, 0, 0));
    for (let tick = 1; tick <= 10; tick++) p.predict(tick, forward());
    const far = { ...serverRun(10) };
    far.x += 3;
    p.reconcile(10, far);
    expect(p.peakError).toBeGreaterThan(2.9);
    expect(p.corrections).toBe(1);
  });

  it('stays stable over a long run of correct predictions', () => {
    const p = new Predictor(createMoveState(0, 0, 0));
    let server = createMoveState(0, 0, 0);
    for (let tick = 1; tick <= 600; tick++) {
      p.predict(tick, forward());
      server = stepCharacter(server, forward(), TICK_SECONDS, DEFAULT_MOVE_CONFIG);
      p.reconcile(tick, server);
    }
    expect(p.corrections).toBe(0);
    expect(p.peakError).toBeLessThan(1e-6);
  });
});

describe('correction smoothing (T-1.15)', () => {
  it('does not teleport the rendered position on correction', () => {
    const p = new Predictor(createMoveState(0, 0, 0));
    for (let tick = 1; tick <= 10; tick++) p.predict(tick, forward());
    const renderBefore = p.renderPosition(16);

    const far = { ...serverRun(10) };
    far.x += 3;
    p.reconcile(10, far);

    // Immediately after correcting, the drawn position has barely moved even
    // though the simulated position jumped 3 m.
    const renderAfter = p.renderPosition(0);
    expect(Math.abs(renderAfter.x - renderBefore.x)).toBeLessThan(0.01);
    expect(Math.abs(p.simulated.x - renderBefore.x)).toBeGreaterThan(2.9);
  });

  it('eases the residual out and settles exactly at the simulated position', () => {
    const p = new Predictor(createMoveState(0, 0, 0));
    for (let tick = 1; tick <= 10; tick++) p.predict(tick, forward());
    const far = { ...serverRun(10) };
    far.x += 3;
    p.reconcile(10, far);

    let elapsed = 0;
    while (elapsed < SMOOTHING_MS) {
      p.renderPosition(16);
      elapsed += 16;
    }
    p.renderPosition(16);
    expect(p.smoothingError).toBe(0);
    expect(p.renderPosition(16).x).toBeCloseTo(p.simulated.x, 9);
  });

  it('eases out at a steady rate rather than front-loading the correction', () => {
    // Regression: scaling the live offset each frame compounds, so ~80% of a
    // correction lands in the first few frames and the "100ms ease" is really
    // a snap. Halfway through the window, about half should remain.
    const p = new Predictor(createMoveState(0, 0, 0));
    for (let tick = 1; tick <= 10; tick++) p.predict(tick, forward());
    const far = { ...serverRun(10) };
    far.x += 3;
    p.reconcile(10, far);
    const initial = p.smoothingError;

    let elapsed = 0;
    while (elapsed < SMOOTHING_MS / 2) {
      p.renderPosition(10);
      elapsed += 10;
    }
    expect(p.smoothingError / initial).toBeGreaterThan(0.4);
    expect(p.smoothingError / initial).toBeLessThan(0.6);
  });

  it('decays monotonically rather than oscillating', () => {
    const p = new Predictor(createMoveState(0, 0, 0));
    for (let tick = 1; tick <= 10; tick++) p.predict(tick, forward());
    const far = { ...serverRun(10) };
    far.x += 3;
    p.reconcile(10, far);

    let prev = Infinity;
    for (let i = 0; i < 12; i++) {
      p.renderPosition(10);
      const err = p.smoothingError;
      expect(err).toBeLessThanOrEqual(prev + 1e-9);
      prev = err;
    }
  });

  it('leaves the render position alone when nothing needs correcting', () => {
    const p = new Predictor(createMoveState(0, 0, 0));
    p.predict(1, idle());
    const r = p.renderPosition(16);
    expect(r).toEqual({ x: p.simulated.x, y: p.simulated.y, z: p.simulated.z });
  });
});
