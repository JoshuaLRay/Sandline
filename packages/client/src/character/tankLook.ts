/**
 * U-070: what a tank looks like this frame, as numbers (the picture itself is `tankModel.ts`).
 *
 * Every value here is a function of replicated state: the hull's interpolated yaw, the turret's wire yaw, whether
 * the cannon is locked (`aiming`) and the tank's vitality. The turret yaw arrives as a state, not a position
 * (a delta carries it only while it turns), so it is eased toward the newest value at the turret's own rate rather
 * than snapped; the muzzle flash is the moment the lock ends on a living tank, which is when the server fires.
 */
import type { Vitality } from '@sandline/shared';

const TURN = Math.PI * 2;

/** A wire angle (1024 to a turn) in radians. */
export function wireRadians(wire: number): number {
  return (wire / 1024) * TURN;
}

/** The shortest signed turn from `from` to `to`, radians, in (-pi, pi]. */
export function shortestTurn(from: number, to: number): number {
  let d = (to - from) % TURN;
  if (d > Math.PI) d -= TURN;
  else if (d <= -Math.PI) d += TURN;
  return d;
}

/** `current` moved toward `target` by at most `maxStep` (radians), the short way round. */
export function easeYaw(current: number, target: number, maxStep: number): number {
  const d = shortestTurn(current, target);
  return Math.abs(d) <= maxStep ? target : current + Math.sign(d) * maxStep;
}

/** How long the muzzle flash shows after the shell leaves, seconds. */
export const TANK_FLASH_SECONDS = 0.12;

export interface TankFrame {
  /** Turret yaw relative to the hull, radians: the turret group's own rotation. */
  turretRelative: number;
  /** The turret yaw itself (absolute), radians, for the next frame's easing. */
  turretYaw: number;
  /** A wreck: burnt out and still, with the turret where it stopped. */
  wreck: boolean;
  /** The cannon's lock, 0..1: how strongly the warning glows. */
  tell: number;
  /** The muzzle flash is showing. */
  flash: boolean;
}

/** One tank's frame-to-frame state: where its turret is drawn and whether it just fired. */
export class TankFx {
  private turret: number | null = null;
  private wasAiming = false;
  private flashLeft = 0;
  private clock = 0;

  /**
   * @param hullYaw the hull's interpolated yaw, radians
   * @param turretWire the replicated turret yaw, wire units
   * @param turnRadPerSec the turret's turn rate (the archetype's `turretTurnDegPerSec`, in radians)
   */
  update(input: { hullYaw: number; turretWire: number; aiming: boolean; vitality: Vitality; turnRadPerSec: number }, dt: number): TankFrame {
    const dead = input.vitality !== 'alive';
    const target = wireRadians(input.turretWire);
    // The first sight places it where it points; after that it turns at its own rate (a little faster, to catch up).
    this.turret = this.turret === null ? target : dead ? this.turret : easeYaw(this.turret, target, input.turnRadPerSec * 1.25 * dt);
    this.clock += dt;
    // The lock ending on a living tank is the shell leaving it; a tank killed in the tell never fires.
    if (this.wasAiming && !input.aiming && !dead) this.flashLeft = TANK_FLASH_SECONDS;
    else this.flashLeft = Math.max(0, this.flashLeft - dt);
    this.wasAiming = input.aiming && !dead;
    return {
      turretRelative: shortestTurn(input.hullYaw, this.turret),
      turretYaw: this.turret,
      wreck: dead,
      // A pulse, so a lock reads as a warning and not a paint job.
      tell: this.wasAiming ? 0.6 + 0.4 * Math.sin(this.clock * 16) ** 2 : 0,
      flash: this.flashLeft > 0,
    };
  }
}

// -- The HUD's readout of a tank under the crosshair -----------------------

export interface TankTargetView {
  /** "TANK  640 / 1000", or "TANK  WRECK" once it is dead. */
  label: string;
  /** Health, 0..1, for the bar. */
  fraction: number;
  /** The armour line: what hurts it. Empty for a wreck. */
  armour: string;
}

/** What the HUD says of a tank under the crosshair; null when the crosshair is on something else. */
export function tankTargetView(input: { name: string; current: number; max: number; vitality: Vitality } | null): TankTargetView | null {
  if (!input) return null;
  const name = input.name.toUpperCase();
  if (input.vitality !== 'alive') return { label: `${name}  WRECK`, fraction: 0, armour: '' };
  const fraction = input.max > 0 ? Math.max(0, Math.min(1, input.current / input.max)) : 0;
  return {
    label: `${name}  ${Math.round(input.current)} / ${Math.round(input.max)}`,
    fraction,
    armour: 'ARMOURED — rockets, C4 and claymores',
  };
}
