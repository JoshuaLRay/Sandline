/**
 * Bots against armour (U-079): the dodge from a tank's locked shell, and the shots and charges that hurt it.
 *
 * Only a rocket, C4 or a claymore hurts a tank (U-066: bullets and frags are a tenth), so those are what a bot
 * that carries one throws at it. All of it is searched, not solved, as the grenade is (`throw.ts`): the pitch walked
 * through `projectileArc`, the stepper the server flies, from the launch the session's throw path makes
 * (`throwLaunch`). Server-only, deterministic: no randomness.
 */
import { type ProjectileDef, type ProjectileWorld, type WorldBox, degToAngle, projectileArc, rayWorld } from '@sandline/shared';
import { aimAngles } from './aim.ts';
import type { ArmourView } from './actions/combat.ts';
import RAW_ARMOUR from './armour.json' with { type: 'json' };
import { throwEye, throwLaunch } from './throw.ts';

type Vec3 = { x: number; y: number; z: number };

export interface ArmourConfig {
  dodgeMarginM: number;
  dodgeCoverM: number;
  dodgeHoldSeconds: number;
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
  claymoreSpotM: number;
  claymoreReachM: number;
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
    dodgeCoverM: [0, 50],
    dodgeHoldSeconds: [0, 10],
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
    claymoreSpotM: [0, 10],
    claymoreReachM: [0, 5],
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

/** How near a rocket may pass a squadmate's middle, metres: the capsule, the rocket and a margin. */
const LANE_CLEAR_M = 1;

/** Whether the arc's first `upTo` steps pass clear of every friend (feet) — their middle taken a metre up. */
function laneClear(points: readonly Vec3[], upTo: number, friends: readonly Vec3[]): boolean {
  for (const friend of friends) {
    const cx = friend.x;
    const cy = friend.y + 1;
    const cz = friend.z;
    for (let i = 1; i <= upTo && i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const len2 = dx * dx + dy * dy + dz * dz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((cx - a.x) * dx + (cy - a.y) * dy + (cz - a.z) * dz) / len2)) : 0;
      const px = a.x + dx * t - cx;
      const py = a.y + dy * t - cy;
      const pz = a.z + dz * t - cz;
      if (px * px + py * py + pz * pz < LANE_CLEAR_M * LANE_CLEAR_M) return false;
    }
  }
  return true;
}

/** Compass points tried round a shell's lock. */
const RING_DIRECTIONS = 16;

/** How many looks a step of an arc is given. */
const SUBSTEPS = 6;

function flat(a: Vec3, b: Vec3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}

/** How near a shell's flight line a body is hit, metres: the capsule and the shell. */
const CORRIDOR_M = 1.6;
/** The farthest a shell is reckoned to fly, metres. */
const SHELL_REACH_M = 150;

function toSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0;
  return Math.sqrt((p.x - (a.x + dx * t)) ** 2 + (p.z - (a.z + dz * t)) ** 2);
}

/**
 * Where a locked shell can hurt, as a test of a position: the shell goes at the locked point and on, bursting on the
 * first body or wall it meets, so a body in its flight line is hit and everyone within the blast of where it ends (or of
 * the lock, where it may burst on a squadmate first) is caught. Null when the tank has locked nothing.
 */
export function shellDanger(view: ArmourView, boxes: readonly WorldBox[], config: ArmourConfig = ARMOUR): ((p: Vec3) => boolean) | null {
  const lock = view.tell?.point;
  if (!lock) return null;
  const dx = lock.x - view.muzzle.x;
  const dy = lock.y - view.muzzle.y;
  const dz = lock.z - view.muzzle.z;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const hit = rayWorld({ origin: view.muzzle, direction: { x: dx / length, y: dy / length, z: dz / length }, maxDistance: SHELL_REACH_M }, boxes);
  const reach = hit ? hit.distance : SHELL_REACH_M;
  const end = { x: view.muzzle.x + (dx / length) * reach, y: 0, z: view.muzzle.z + (dz / length) * reach };
  const clear = view.shellBlastM + config.dodgeMarginM;
  return (p) => toSegment(p, view.muzzle, end) < CORRIDOR_M || flat(p, end) < clear || flat(p, lock) < clear;
}

/**
 * Where to run to leave a locked shell's danger: the nearest point on rings round `me` that is out of it and that
 * `reachable` says the mesh can walk to; null when it is already out, or when nothing is.
 */
export function dodgeRing(me: Vec3, danger: (p: Vec3) => boolean, reachable: (to: Vec3) => boolean): Vec3 | null {
  if (!danger(me)) return null;
  for (const radius of [3, 5, 7.5, 10]) {
    let best: Vec3 | null = null;
    let bestD = Infinity;
    for (let k = 0; k < RING_DIRECTIONS; k++) {
      const a = (k / RING_DIRECTIONS) * Math.PI * 2;
      const p = { x: me.x + Math.sin(a) * radius, y: me.y, z: me.z + Math.cos(a) * radius };
      if (danger(p) || !reachable(p)) continue;
      const d = flat(me, p);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    if (best) return best;
  }
  return null;
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
    // A step is 1.5 m of flight at 45 m/s: look between the steps too, or a true line reads as a miss by half of one.
    let near: ShotChoice | null = null;
    let nearMiss = Infinity;
    let nearAt = 0;
    for (let i = 1; i < arc.points.length; i++) {
      const a = arc.points[i - 1]!;
      const b = arc.points[i]!;
      for (let j = 1; j <= SUBSTEPS; j++) {
        const f = j / SUBSTEPS;
        const p = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
        const t = (i - 1 + f) / 30;
        const h = hullAt(view, t);
        const miss = Math.sqrt((p.x - h.x) ** 2 + (p.y - h.y) ** 2 + (p.z - h.z) ** 2);
        if (miss < nearMiss) {
          nearMiss = miss;
          nearAt = i;
          near = { yaw, pitch, hit: p, seconds: t };
        }
      }
    }
    if (near === null || nearMiss >= bestMiss) continue;
    // A rocket goes off on the first body it meets: never down a lane with a squadmate in it.
    if (!laneClear(arc.points, nearAt, friends)) continue;
    best = near;
    bestMiss = nearMiss;
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
