import { describe, expect, it } from 'vitest';
import {
  INTERPOLATION_DELAY_MS,
  type InterpSample,
  InterpolationBuffer,
  MAX_EXTRAPOLATION_MS,
  lerpAngle,
} from './interpolate.ts';
import { WIRE_ANGLE_UNITS } from '../math/angles.ts';
import { Sfc32 } from '../math/prng.ts';

const sample = (tick: number, x: number, yaw = 0): InterpSample => ({
  tick,
  serverTimeMs: tick * 33,
  x,
  y: 0,
  z: 0,
  yaw,
});

describe('lerpAngle', () => {
  it('interpolates within a quadrant', () => {
    expect(lerpAngle(0, 100, 0.5)).toBe(50);
  });

  // Going the long way round makes a player spin the wrong direction.
  it('takes the short way across the wrap point', () => {
    const mid = lerpAngle(1000, 20, 0.5);
    expect(mid > 1000 || mid < 20).toBe(true);
  });

  it('returns the endpoints exactly', () => {
    expect(lerpAngle(300, 700, 0)).toBe(300);
    expect(lerpAngle(300, 700, 1)).toBe(700);
  });

  it('always lands inside the wire angle range', () => {
    const rng = new Sfc32(11);
    for (let i = 0; i < 5000; i++) {
      const a = rng.nextUint32() % WIRE_ANGLE_UNITS;
      const b = rng.nextUint32() % WIRE_ANGLE_UNITS;
      const v = lerpAngle(a, b, rng.next());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(WIRE_ANGLE_UNITS);
    }
  });
});

describe('InterpolationBuffer (T-1.16)', () => {
  it('returns null when empty', () => {
    expect(new InterpolationBuffer().sample(0)).toBeNull();
  });

  it('holds the only sample it has', () => {
    const b = new InterpolationBuffer();
    b.push(sample(1, 5));
    expect(b.sample(9999)?.x).toBe(5);
  });

  it('interpolates between two samples', () => {
    const b = new InterpolationBuffer();
    b.push(sample(1, 0));
    b.push(sample(2, 10));
    const mid = b.sample(1.5 * 33);
    expect(mid?.x).toBeGreaterThan(0);
    expect(mid?.x).toBeLessThan(10);
    expect(mid?.extrapolated).toBe(false);
  });

  it('passes through the sample points themselves', () => {
    const b = new InterpolationBuffer();
    for (let t = 1; t <= 5; t++) b.push(sample(t, t * 10));
    expect(b.sample(3 * 33)?.x).toBeCloseTo(30, 6);
  });

  it('produces a smooth curve, not straight segments', () => {
    // Linear interpolation makes a moving player look like they run along a
    // polyline; Catmull-Rom curves through the samples instead.
    const b = new InterpolationBuffer();
    const positions = [0, 1, 4, 9, 16, 25]; // accelerating
    positions.forEach((x, i) => b.push(sample(i + 1, x)));

    // Second differences of a curve fit should be smaller than of a polyline.
    const xs: number[] = [];
    for (let ms = 2 * 33; ms <= 5 * 33; ms += 4) xs.push(b.sample(ms)!.x);
    let maxJerk = 0;
    for (let i = 2; i < xs.length; i++) {
      maxJerk = Math.max(maxJerk, Math.abs(xs[i]! - 2 * xs[i - 1]! + xs[i - 2]!));
    }
    expect(maxJerk).toBeLessThan(0.5);
  });

  it('accepts out-of-order samples and orders them', () => {
    // Reordering is normal on the unreliable channel (ADR-008).
    const b = new InterpolationBuffer();
    b.push(sample(3, 30));
    b.push(sample(1, 10));
    b.push(sample(2, 20));
    expect(b.newestTick).toBe(3);
    expect(b.sample(2 * 33)?.x).toBeCloseTo(20, 6);
  });

  it('ignores duplicate ticks', () => {
    const b = new InterpolationBuffer();
    b.push(sample(1, 10));
    b.push(sample(1, 999));
    expect(b.size).toBe(1);
    expect(b.sample(33)?.x).toBe(10);
  });

  it('bounds its capacity', () => {
    const b = new InterpolationBuffer(8);
    for (let t = 1; t <= 100; t++) b.push(sample(t, t));
    expect(b.size).toBe(8);
    expect(b.newestTick).toBe(100);
  });

  it('extrapolates briefly past the newest sample', () => {
    const b = new InterpolationBuffer();
    b.push(sample(1, 0));
    b.push(sample(2, 10)); // 10 units per 33ms
    const ahead = b.sample(2 * 33 + 33);
    expect(ahead?.extrapolated).toBe(true);
    expect(ahead?.frozen).toBe(false);
    expect(ahead!.x).toBeGreaterThan(10);
  });

  // A frozen entity reads as lag; one that keeps accelerating reads as a bug.
  it('freezes rather than flying off when starved', () => {
    const b = new InterpolationBuffer();
    b.push(sample(1, 0));
    b.push(sample(2, 10));

    const atCap = b.sample(2 * 33 + MAX_EXTRAPOLATION_MS)!;
    const wayPast = b.sample(2 * 33 + MAX_EXTRAPOLATION_MS * 20)!;

    expect(wayPast.frozen).toBe(true);
    expect(wayPast.x).toBeCloseTo(atCap.x, 6);
  });

  it('holds the oldest sample when asked for a time before the buffer', () => {
    const b = new InterpolationBuffer();
    b.push(sample(10, 100));
    b.push(sample(11, 110));
    expect(b.sample(0)?.x).toBe(100);
  });

  // T-1.16 acceptance: 20% loss must not produce NaN or visible jumps.
  it('stays continuous and finite under 20% packet loss', () => {
    const rng = new Sfc32(4242);
    const b = new InterpolationBuffer();
    const results: number[] = [];

    for (let tick = 1; tick <= 200; tick++) {
      if (rng.next() >= 0.2) b.push(sample(tick, tick * 2)); // 2 units per tick
      const renderMs = tick * 33 - INTERPOLATION_DELAY_MS;
      const r = b.sample(renderMs);
      if (r) {
        expect(Number.isFinite(r.x)).toBe(true);
        expect(Number.isFinite(r.yaw)).toBe(true);
        results.push(r.x);
      }
    }

    expect(results.length).toBeGreaterThan(150);
    // No frame-to-frame jump larger than a few ticks' worth of motion.
    let maxJump = 0;
    for (let i = 1; i < results.length; i++) {
      maxJump = Math.max(maxJump, Math.abs(results[i]! - results[i - 1]!));
    }
    expect(maxJump).toBeLessThan(2 * 4);
  });

  it('never yields NaN even with degenerate timestamps', () => {
    const b = new InterpolationBuffer();
    b.push({ tick: 1, serverTimeMs: 100, x: 1, y: 2, z: 3, yaw: 0 });
    b.push({ tick: 2, serverTimeMs: 100, x: 5, y: 6, z: 7, yaw: 0 }); // same time
    const r = b.sample(500)!;
    expect(Number.isFinite(r.x)).toBe(true);
    expect(Number.isFinite(r.y)).toBe(true);
    expect(Number.isFinite(r.z)).toBe(true);
  });

  it('clears', () => {
    const b = new InterpolationBuffer();
    b.push(sample(1, 1));
    b.clear();
    expect(b.size).toBe(0);
    expect(b.sample(0)).toBeNull();
  });
});
