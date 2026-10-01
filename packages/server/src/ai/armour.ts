/**
 * Bots against armour (U-079): the dodge from a tank's locked shell, and the shots and charges that hurt it.
 *
 * Only a rocket, C4 or a claymore hurts a tank (U-066: bullets and frags are a tenth), so those are what a bot
 * that carries one throws at it. All of it is searched, not solved, as the grenade is (`throw.ts`): the pitch walked
 * through `projectileArc`, the stepper the server flies, from the launch the session's throw path makes
 * (`throwLaunch`). Server-only, deterministic: no randomness.
 */
import { type ProjectileDef, type ProjectileWorld, degToAngle, projectileArc } from '@sandline/shared';
import { aimAngles } from './aim.ts';
import type { ArmourView } from './actions/combat.ts';
import RAW_ARMOUR from './armour.json' with { type: 'json' };
import { throwEye, throwLaunch } from './throw.ts';

type Vec3 = { x: number; y: number; z: number };

export interface ArmourConfig {
  dodgeMarginM: number;
  rocketMinRangeM: number;
  rocketMaxRangeM: number;
  aimSpanDeg: number;
  aimStepDeg: number;
  hitFraction: number;
  safetyMarginM: number;
  retrySeconds: number;
  chargeMaxTankSpeedMps: number;
  chargeMinRangeM: number;
  chargeMaxRangeM: number;
  chargeReachM: number;
  claymoreAheadM: number;
  detonateWithinM: number;
  detonateAfterSeconds: number;
  approachM: number;
}

class ArmourDataError extends Error {}

export function parseArmourConfig(raw: unknown): ArmourConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ArmourDataError('armour: expected an object');
  const row = raw as Record<string, unknown>;
  const ranges: Record<keyof ArmourConfig, [number, number]> = {
    dodgeMarginM: [0, 20],
    rocketMinRangeM: [0, 200],
    rocketMaxRangeM: [1, 200],
    aimSpanDeg: [0, 45],
    aimStepDeg: [0.25, 10],
    hitFraction: [0.1, 1],
    safetyMarginM: [0, 20],
    retrySeconds: [0, 30],
    chargeMaxTankSpeedMps: [0, 5],
    chargeMinRangeM: [0, 200],
    chargeMaxRangeM: [1, 200],
    chargeReachM: [0, 10],
    claymoreAheadM: [0, 10],
    detonateWithinM: [0, 20],
    detonateAfterSeconds: [0, 60],
    approachM: [0, 50],
  };
  for (const k of Object.keys(row)) if (k !== '$comment' && !(k in ranges)) throw new ArmourDataError(`armour: unknown key "${k}"`);
  const out = {} as ArmourConfig;
  for (const [key, [min, max]] of Object.entries(ranges) as [keyof ArmourConfig, [number, number]][]) {
    const v = row[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new ArmourDataError(`armour.${key} must be a finite number, got ${String(v)}`);
    if (v < min || v > max) throw new ArmourDataError(`armour.${key} must be in [${min}, ${max}], got ${v}`);
    out[key] = v;
  }
  if (out.rocketMaxRangeM <= out.rocketMinRangeM) throw new ArmourDataError('armour: rocketMaxRangeM is not above rocketMinRangeM');
  if (out.chargeMaxRangeM <= out.chargeMinRangeM) throw new ArmourDataError('armour: chargeMaxRangeM is not above chargeMinRangeM');
  return out;
}

export const ARMOUR: ArmourConfig = parseArmourConfig(RAW_ARMOUR);

function flat(a: Vec3, b: Vec3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}

/**
 * Where to run to leave a shell's lock: straight away from the point it will land on (away from the tank itself when
 * standing on it), far enough to be outside its blast radius and the margin.
 */
export function dodgePoint(me: Vec3, view: ArmourView, config: ArmourConfig = ARMOUR): Vec3 | null {
  const lock = view.tell?.point;
  if (!lock) return null;
  const reach = view.shellBlastM + config.dodgeMarginM;
  const d = flat(me, lock);
  if (d >= reach) return null;
  let dx = me.x - lock.x;
  let dz = me.z - lock.z;
  let length = Math.sqrt(dx * dx + dz * dz);
  if (length < 0.5) {
    dx = me.x - view.x;
    dz = me.z - view.z;
    length = Math.sqrt(dx * dx + dz * dz);
    if (length < 0.5) {
      dx = -view.headingZ;
      dz = view.headingX;
      length = 1;
    }
  }
  return { x: lock.x + (dx / length) * (reach + 1), y: me.y, z: lock.z + (dz / length) * (reach + 1) };
}

export interface ShotChoice {
  yaw: number;
  pitch: number;
  /** Where the rocket would meet the hull. */
  hit: Vec3;
  /** Seconds in the air. */
  seconds: number;
}

/** Where the hull's middle will be `seconds` from now if it keeps its heading and pace. */
function hullAt(view: ArmourView, seconds: number): Vec3 {
  const d = view.speedMps * seconds;
  return { x: view.centre.x + view.headingX * d, y: view.centre.y, z: view.centre.z + view.headingZ * d };
}

/**
 * The rocket from `body` (feet) that meets the tank's hull, or null. The yaw is at the hull led by the time of flight to
 * it; the pitch is searched either side of the line, keeping the arc that comes nearest the hull, which has to be within
 * `hitFraction` of its radius, and whose meeting is clear of `body` and of every friend by the blast and the margin.
 */
export function chooseRocket(
  def: ProjectileDef,
  body: Vec3 & { crouched?: boolean; prone?: boolean },
  view: ArmourView,
  friends: readonly Vec3[],
  world: ProjectileWorld,
  config: ArmourConfig = ARMOUR,
): ShotChoice | null {
  const eye = throwEye(body);
  const range = flat(body, view);
  if (range < config.rocketMinRangeM || range > config.rocketMaxRangeM) return null;
  const clear = def.blastRadiusM + config.safetyMarginM;
  const step = degToAngle(config.aimStepDeg) || 1;
  const span = Math.round(degToAngle(config.aimSpanDeg) / step);
  // Lead by the straight-line flight time, once: a tank crawls, so a second pass would move the aim by centimetres.
  const lead = Math.sqrt((view.centre.x - eye.x) ** 2 + (view.centre.z - eye.z) ** 2) / def.speedMPerSec;
  const aim = hullAt(view, lead);
  const { yaw, pitch: base } = aimAngles(eye, aim);
  let best: ShotChoice | null = null;
  let bestMiss = Infinity;
  for (let k = -span; k <= span; k++) {
    const pitch = (base + k * step) & 0xfff;
    const { origin, velocity } = throwLaunch(def, eye, yaw, pitch, world);
    const arc = projectileArc(def, origin, velocity, { dt: 1 / 30, maxSeconds: Math.min(def.maxLifeSeconds, (range / def.speedMPerSec) * 2 + 0.5), world });
    for (let i = 0; i < arc.points.length; i++) {
      const p = arc.points[i]!;
      const h = hullAt(view, i / 30);
      const miss = Math.sqrt((p.x - h.x) ** 2 + (p.y - h.y) ** 2 + (p.z - h.z) ** 2);
      if (miss < bestMiss) {
        bestMiss = miss;
        best = { yaw, pitch, hit: p, seconds: i / 30 };
      }
    }
  }
  if (best === null || bestMiss > view.radiusM * config.hitFraction) return null;
  if (flat(best.hit, body) <= clear) return null;
  if (friends.some((f) => flat(best!.hit, f) <= clear)) return null;
  return best;
}

export interface PlacementChoice {
  yaw: number;
  pitch: number;
  landing: Vec3;
  missM: number;
}

/**
 * The throw of a placed charge from `body` that comes to rest within `reachM` of `spot`, clear of `body` and every
 * friend by `def`'s blast and the margin, or null. The yaw is straight at the spot.
 */
export function choosePlacement(
  def: ProjectileDef,
  body: Vec3 & { crouched?: boolean; prone?: boolean },
  spot: Vec3,
  reachM: number,
  friends: readonly Vec3[],
  world: ProjectileWorld,
  config: ArmourConfig = ARMOUR,
): PlacementChoice | null {
  const eye = throwEye(body);
  const { yaw } = aimAngles(eye, spot);
  const clear = def.blastRadiusM + config.safetyMarginM;
  let best: PlacementChoice | null = null;
  for (let deg = -10; deg <= 80; deg += 2) {
    const pitch = degToAngle(deg) & 0xfff;
    const { origin, velocity } = throwLaunch(def, eye, yaw, pitch, world);
    const arc = projectileArc(def, origin, velocity, { dt: 1 / 30, maxSeconds: 3, world });
    const landing = arc.points[arc.points.length - 1]!;
    const missM = flat(landing, spot);
    if (missM > reachM || (best !== null && missM >= best.missM)) continue;
    if (flat(landing, body) <= clear) continue;
    if (friends.some((f) => flat(landing, f) <= clear)) continue;
    best = { yaw, pitch, landing, missM };
  }
  return best;
}
