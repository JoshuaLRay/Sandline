/**
 * Remote entity interpolation (T-1.16, ADR-012).
 *
 * Remote players and AI are NOT predicted — they are rendered ~100 ms behind
 * server time, between snapshots we have actually received. That delay is what
 * makes other players move smoothly instead of teleporting 30 times a second,
 * and it is invisible in play.
 *
 * The buffer must tolerate loss and reordering, because snapshots travel on the
 * unreliable channel (ADR-008). When it starves it extrapolates briefly, then
 * FREEZES rather than flying off: a frozen player reads as lag, an extrapolated
 * one that keeps accelerating reads as a bug.
 */
import { ANGLE_MASK, WIRE_ANGLE_UNITS } from '../math/angles.ts';

export interface InterpSample {
  /** Server tick this state belongs to. */
  tick: number;
  /** Server time in ms when this state was current. */
  serverTimeMs: number;
  x: number;
  y: number;
  z: number;
  /** Wire angle, 1/1024 turn. */
  yaw: number;
  /**
   * Aim pitch, wire angle, unsigned like yaw (T-2.25). Optional so a sample
   * that carries no pitch reads as level.
   */
  pitch?: number;
  /** Authoritative stance; discrete, not spatially interpolated. */
  crouched: boolean;
  /**
   * Seconds into an authoritative vault, or null when not vaulting (T-2.23).
   * Optional so a sample that has no idea about vaults reads as not vaulting.
   */
  vaultElapsed?: number | null;
}

export interface InterpResult {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Aim pitch, wire angle, interpolated the short way like yaw. */
  pitch: number;
  crouched: boolean;
  /**
   * Seconds into the vault at the render time, or null. Interpolated between
   * two vaulting samples so a remote's vault pose advances as smoothly as
   * its position does; across the edge of a vault it switches at the
   * authoritative sample boundary, like the stance.
   */
  vaultElapsed: number | null;
  /** True when past the newest sample — the buffer is starving. */
  extrapolated: boolean;
  /** True when extrapolation hit its cap and the entity is held still. */
  frozen: boolean;
}

/** ADR-012: render this far behind server time. */
export const INTERPOLATION_DELAY_MS = 100;

/** Extrapolate no further than this past the newest sample. */
export const MAX_EXTRAPOLATION_MS = 250;

const DEFAULT_CAPACITY = 32;

/** Shortest-arc interpolation between two wire angles. */
export function lerpAngle(a: number, b: number, t: number): number {
  // Going the long way round makes a player spin the wrong direction.
  const diff = (((b - a) & ANGLE_MASK) + WIRE_ANGLE_UNITS) % WIRE_ANGLE_UNITS;
  const shortest = diff > WIRE_ANGLE_UNITS / 2 ? diff - WIRE_ANGLE_UNITS : diff;
  return (((Math.round(a + shortest * t) % WIRE_ANGLE_UNITS) + WIRE_ANGLE_UNITS) % WIRE_ANGLE_UNITS);
}

/**
 * Catmull-Rom through four points.
 *
 * Plain linear interpolation between snapshots produces a visible direction
 * change at every sample — a running player looks like they are on rails made
 * of straight segments. Catmull-Rom uses the neighbouring samples as tangents
 * so the path curves through them.
 */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/**
 * The vault between two samples: linear while both are vaulting, otherwise
 * whichever sample is current at the render time (the boundary rule the
 * stance uses).
 */
function vaultBetween(p1: InterpSample, p2: InterpSample, t: number, past: boolean): number | null {
  const a = p1.vaultElapsed ?? null;
  const b = p2.vaultElapsed ?? null;
  if (a !== null && b !== null) return a + (b - a) * t;
  return past ? b : a;
}

export class InterpolationBuffer {
  private samples: InterpSample[] = [];

  constructor(private readonly capacity = DEFAULT_CAPACITY) {}

  get size(): number {
    return this.samples.length;
  }

  get newestTick(): number {
    return this.samples.length ? (this.samples[this.samples.length - 1] as InterpSample).tick : -1;
  }

  /**
   * Insert a sample, keeping the buffer ordered by tick.
   *
   * Reordering is normal on an unreliable channel, so a late sample is inserted
   * in place rather than appended; a duplicate is ignored.
   */
  push(sample: InterpSample): void {
    const existing = this.samples.findIndex((s) => s.tick === sample.tick);
    if (existing !== -1) return;

    let i = this.samples.length;
    while (i > 0 && (this.samples[i - 1] as InterpSample).tick > sample.tick) i--;
    this.samples.splice(i, 0, sample);

    while (this.samples.length > this.capacity) this.samples.shift();
  }

  /** Sample the buffer at a server time, normally `now - INTERPOLATION_DELAY_MS`. */
  sample(renderTimeMs: number): InterpResult | null {
    if (this.samples.length === 0) return null;
    if (this.samples.length === 1) {
      const only = this.samples[0] as InterpSample;
      return { x: only.x, y: only.y, z: only.z, yaw: only.yaw, pitch: only.pitch ?? 0, crouched: only.crouched, vaultElapsed: only.vaultElapsed ?? null, extrapolated: false, frozen: false };
    }

    const oldest = this.samples[0] as InterpSample;
    const newest = this.samples[this.samples.length - 1] as InterpSample;

    // Behind everything we hold: the buffer is too shallow, so hold the oldest.
    if (renderTimeMs <= oldest.serverTimeMs) {
      return { x: oldest.x, y: oldest.y, z: oldest.z, yaw: oldest.yaw, pitch: oldest.pitch ?? 0, crouched: oldest.crouched, vaultElapsed: oldest.vaultElapsed ?? null, extrapolated: false, frozen: false };
    }

    if (renderTimeMs >= newest.serverTimeMs) {
      return this.extrapolate(renderTimeMs, newest);
    }

    // Find the bracketing pair.
    let i = 0;
    while (i < this.samples.length - 1 && (this.samples[i + 1] as InterpSample).serverTimeMs < renderTimeMs) i++;

    const p1 = this.samples[i] as InterpSample;
    const p2 = this.samples[i + 1] as InterpSample;
    const span = p2.serverTimeMs - p1.serverTimeMs;
    const t = span > 0 ? (renderTimeMs - p1.serverTimeMs) / span : 0;

    // Neighbours supply the tangents; duplicate the ends where they are missing.
    const p0 = (this.samples[i - 1] ?? p1) as InterpSample;
    const p3 = (this.samples[i + 2] ?? p2) as InterpSample;

    return {
      x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
      y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
      z: catmullRom(p0.z, p1.z, p2.z, p3.z, t),
      yaw: lerpAngle(p1.yaw, p2.yaw, t),
      pitch: lerpAngle(p1.pitch ?? 0, p2.pitch ?? 0, t),
      // Stance changes at the authoritative sample boundary, not halfway between ticks.
      crouched: renderTimeMs >= p2.serverTimeMs ? p2.crouched : p1.crouched,
      vaultElapsed: vaultBetween(p1, p2, t, renderTimeMs >= p2.serverTimeMs),
      extrapolated: false,
      frozen: false,
    };
  }

  private extrapolate(renderTimeMs: number, newest: InterpSample): InterpResult {
    const prev = this.samples[this.samples.length - 2] as InterpSample;
    const ahead = renderTimeMs - newest.serverTimeMs;
    const capped = Math.min(ahead, MAX_EXTRAPOLATION_MS);
    const frozen = ahead > MAX_EXTRAPOLATION_MS;

    const span = newest.serverTimeMs - prev.serverTimeMs;
    if (span <= 0) {
      return { x: newest.x, y: newest.y, z: newest.z, yaw: newest.yaw, pitch: newest.pitch ?? 0, crouched: newest.crouched, vaultElapsed: newest.vaultElapsed ?? null, extrapolated: true, frozen };
    }

    // Constant velocity from the last pair. Beyond the cap this holds still:
    // a frozen entity reads as lag, one that keeps accelerating reads as a bug.
    const vx = (newest.x - prev.x) / span;
    const vy = (newest.y - prev.y) / span;
    const vz = (newest.z - prev.z) / span;

    return {
      x: newest.x + vx * capped,
      y: newest.y + vy * capped,
      z: newest.z + vz * capped,
      yaw: newest.yaw,
      pitch: newest.pitch ?? 0,
      crouched: newest.crouched,
      // A vault runs on the server's clock; carrying it forward with the
      // position keeps the pose from stalling while the buffer starves.
      vaultElapsed: newest.vaultElapsed == null ? null : newest.vaultElapsed + capped / 1000,
      extrapolated: true,
      frozen,
    };
  }

  clear(): void {
    this.samples = [];
  }
}
