import { describe, expect, it } from 'vitest';
import { Clock, MAX_CATCHUP_STEPS, TICK_SECONDS } from './Clock.ts';

describe('Clock', () => {
  it('runs one step per tick interval', () => {
    const c = new Clock();
    expect(c.advance(TICK_SECONDS)).toBe(1);
    expect(c.tick).toBe(1);
  });

  it('accumulates sub-tick deltas instead of dropping them', () => {
    const c = new Clock();
    expect(c.advance(TICK_SECONDS / 2)).toBe(0);
    expect(c.advance(TICK_SECONDS / 2)).toBe(1);
    expect(c.tick).toBe(1);
  });

  // T-0.08 acceptance: identical delta sequences produce identical tick counts.
  it('is deterministic across identical delta sequences', () => {
    const deltas = [0.016, 0.017, 0.008, 0.041, 0.016, 0.033, 0.004, 0.022];
    const run = () => {
      const c = new Clock();
      const steps: number[] = [];
      for (const d of deltas) steps.push(c.advance(d));
      return { steps, tick: c.tick, alpha: c.alpha };
    };
    expect(run()).toEqual(run());
  });

  // T-0.08 acceptance: a 10 s pause must clamp, not run 300 steps.
  it('clamps a long stall instead of spiralling', () => {
    const c = new Clock();
    const steps = c.advance(10);
    expect(steps).toBe(MAX_CATCHUP_STEPS);
    expect(c.tick).toBe(MAX_CATCHUP_STEPS);
    expect(c.dropped).toBeGreaterThan(290);
  });

  it('resyncs cleanly after a stall rather than staying behind', () => {
    const c = new Clock();
    c.advance(10);
    // The next normal frame behaves normally; the backlog is gone, not queued.
    expect(c.advance(TICK_SECONDS)).toBe(1);
  });

  it('ignores negative, zero and non-finite deltas', () => {
    const c = new Clock();
    for (const bad of [-1, 0, NaN, Infinity, -Infinity]) {
      expect(c.advance(bad)).toBe(0);
    }
    expect(c.tick).toBe(0);
    expect(c.dropped).toBe(0);
  });

  it('reports alpha inside [0, 1) for render interpolation', () => {
    const c = new Clock();
    for (const d of [0.001, 0.016, 0.033, 0.1, 0.007]) {
      c.advance(d);
      expect(c.alpha).toBeGreaterThanOrEqual(0);
      expect(c.alpha).toBeLessThan(1);
    }
  });

  it('tracks total ticks over a long varied run without drift', () => {
    const c = new Clock();
    let total = 0;
    for (let i = 0; i < 1000; i++) total += c.advance(1 / 60);
    // 1000 frames at 60 Hz is ~16.67 s, which is ~500 ticks at 30 Hz.
    expect(total).toBe(500);
    expect(c.tick).toBe(500);
    expect(c.dropped).toBe(0);
  });

  it('resets to a clean state', () => {
    const c = new Clock();
    c.advance(10);
    c.reset();
    expect(c.tick).toBe(0);
    expect(c.dropped).toBe(0);
    expect(c.alpha).toBe(0);
  });
});
