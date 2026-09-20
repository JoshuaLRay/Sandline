import { describe, expect, it } from 'vitest';
import { CORRECTION_THRESHOLD_M, Predictor, SMOOTHING_MS, distance } from './prediction.ts';
import {
  DEFAULT_MOVE_CONFIG,
  type MoveInput,
  type MoveState,
  createMoveState,
  stepCharacter,
} from '../sim/CharacterController.ts';
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

/**
 * Regressions from a smoothness pass at 80 ms / 15 ms jitter / 5% loss. Every
 * one of these failed silently: prediction appeared to work, the correction
 * counter read near zero, and the only symptom was that the game felt bad.
 */
describe('reconciliation under a poor link', () => {
  const START: MoveState = { x: 0, y: 0, z: 0, vy: 0, grounded: true, crouched: false, vaulting: false, vaultProgress: 0, vaultStartX: 0, vaultStartY: 0, vaultStartZ: 0, vaultEndX: 0, vaultEndY: 0, vaultEndZ: 0 };
  const FORWARD: MoveInput = { moveX: 0, moveY: 1, yaw: 0, jump: false, sprint: false, crouch: false };

  it('does not throw away pending inputs when the acked tick is missing', () => {
    /**
     * The acknowledged tick may simply not be in history — it ages out, or the
     * predictor started mid-stream. The old code cleared the WHOLE history in
     * that case, which is self-sustaining: acknowledgements lag by a round
     * trip, so the next one refers to a tick older than everything kept after
     * the wipe and fails to match too. Measured at 814 unmatched out of 830.
     */
    // A predictor created mid-stream: it holds ticks 7..12, and the server
    // acknowledges tick 5, from before it existed. Nothing to match.
    const p = new Predictor(START);
    for (let tick = 7; tick <= 12; tick += 1) p.predict(tick, FORWARD);

    const result = p.reconcile(5, { ...START, z: 1 });
    expect(result.matched).toBe(false);
    // All six held inputs are newer than tick 5, so all six must be replayed
    // rather than discarded.
    expect(result.replayed).toBe(6);
    expect(p.pendingInputs).toBe(6);
  });

  it('recovers on the next acknowledgement rather than staying broken', () => {
    const p = new Predictor(START);
    for (let tick = 1; tick <= 10; tick += 1) p.predict(tick, FORWARD);
    p.reconcile(5, { ...START, z: 1 });
    for (let tick = 11; tick <= 14; tick += 1) p.predict(tick, FORWARD);

    // An advancing ack for a tick we do hold must match again.
    const result = p.reconcile(12, p.simulated);
    expect(result.matched).toBe(true);
  });

  it('ignores an acknowledgement that has not advanced', () => {
    /**
     * The server re-sends the same lastProcessedInputTick whenever it had
     * nothing buffered from this client. Acting on it means comparing the
     * client's present state against a server state from a different moment,
     * which reads as a large error and yanks the player backwards. It was the
     * last remaining source of lurching once inputs were being resent.
     */
    const p = new Predictor(START);
    for (let tick = 1; tick <= 6; tick += 1) p.predict(tick, FORWARD);
    p.reconcile(3, p.simulated);

    const before = p.simulated;
    const corrections = p.corrections;
    // Same tick again, with a server state that is now far away.
    const result = p.reconcile(3, { ...START, z: before.z + 5 });

    expect(result.corrected).toBe(false);
    expect(p.simulated).toEqual(before);
    expect(p.corrections).toBe(corrections);
  });

  it('counts a correction on every path that corrects', () => {
    // The counter used to increment on one of two correcting paths, so it read
    // near zero while a third of reconciles were correcting.
    const p = new Predictor(START);
    for (let tick = 1; tick <= 4; tick += 1) p.predict(tick, FORWARD);
    const result = p.reconcile(2, { ...START, z: 99 });
    expect(result.corrected).toBe(true);
    expect(p.corrections).toBe(1);
  });
});
