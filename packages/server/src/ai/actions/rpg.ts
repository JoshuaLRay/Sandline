/**
 * The RPG gunner's leaves (U-157): what `data/trees/rpg.json` names beyond the
 * rifleman's, tuned by the archetype's `launcher` block (`enemies.json`).
 *
 * In its hands is the launcher or the rifle (`rifle` on the blackboard, which
 * the session replicates): the rifle inside the near edge of its band or with
 * no rockets left (`useRifle`), the launcher otherwise. A rocket goes at its
 * target (`rocketTarget`) only when it is loaded, the target is known, down to
 * none, in the band and has been still a while; the shot itself (`fireRocket`)
 * is searched, not solved: a few aim points on the target, each lifted for the
 * drop over its flight, flown through `projectileArc` from the launch the
 * session will make (`throwLaunch`), so where the brain sees it burst is where
 * the server will. A shot is taken only when the burst lands within reach of
 * the target, the target is behind cover or the burst would catch a group, and
 * neither the burst nor the flight comes near a friend or itself. Then it
 * stands on that aim for its wind-up (`rocketTell`, replicated as `aiming`),
 * checks its friends again, and asks the session for the launch (`throwAt`):
 * the squad that moves in the wind-up is missed, which is the counterplay, as
 * for the tank's shell (U-068). After a shot it moves to other cover
 * (`relocate`); the session reloads the launcher slowly (`reloadSeconds`).
 *
 * Server-only (§7.9 rule 2). Deterministic: no randomness; the arc is the
 * shared stepper's.
 */
import {
  type EnemyLauncher,
  PROJECTILE_IDS,
  type ProjectileDef,
  type ProjectileWorld,
  type WorldBox,
  projectileArc,
  rayWorld,
  stanceEye,
} from '@sandline/shared';
import { BRAIN_TICKS_PER_SECOND, type BrainBody, type BrainMemory, type BrainRegistry } from '../Brain.ts';
import { firingPosition, standsClear } from '../cover.ts';
import { aimAngles } from '../aim.ts';
import { knownFeet, stillFor, throwEye, throwLaunch } from '../throw.ts';
import type { BtFrame } from '@sandline/shared';
import { type CombatBody, type Vec3, across, isCombatBody, threatEye } from './combat.ts';

type Frame = BtFrame<BrainBody, BrainMemory>;

/** How near a point counts as there: the fighting leaves' own (`rifleman.ts`). */
const THERE_M = 0.4;
/** A step out of high cover to fire that has not got there in this long fires from where it is, or gives up. */
const STEP_SECONDS = 1.2;
/** A soldier, for what a rocket meets in flight: a standing body's height and a capsule's radius with a little over. */
const BODY_HEIGHT_M = 1.8;
const BODY_RADIUS_M = 0.4;
/** How far up a target its reach is measured to: the middle of a crouched body, as the grenade's is (`throw.ts`). */
const TARGET_MIDDLE_M = 0.6;
/** How far up a target the in-cover test looks: a crouched soldier's lower body, behind whatever it is behind. */
const COVER_PROBE_M = 0.5;
/** The heights on a target a rocket is aimed at, in the order tried: the middle, low (a cover's lip), the chest. */
const AIM_HEIGHTS_M = [0.9, 0.5, 1.3] as const;
/** The arc's step: the session's tick. */
const ARC_DT = 1 / 30;

/** The launcher a body carries: an enemy archetype's, or null. */
export function launcherOf(body: CombatBody): EnemyLauncher | null {
  return body.def?.launcher ?? null;
}

/** The launcher's projectile as a PROJECTILE_IDS index. */
function rocketIndex(launcher: EnemyLauncher): number {
  return (PROJECTILE_IDS as readonly string[]).indexOf(launcher.projectile);
}

/** Rockets left in its pouch. */
export function rocketsLeft(body: CombatBody, launcher: EnemyLauncher): number {
  return body.pouch[rocketIndex(launcher)] ?? 0;
}

/** Where it believes its target's feet are, while it has one it knows of and it is not down. */
function targetFeet(body: CombatBody): Vec3 | null {
  if (body.target === null) return null;
  const entry = body.memory.entries.get(body.target);
  return entry && !entry.downed ? knownFeet(entry, body.state.y) : null;
}

/** The squad soldiers besides its target it knows of now: learnt within `knownSeconds` and not down, at their feet. */
function knownSquad(body: CombatBody, launcher: EnemyLauncher, now: number): Vec3[] {
  const out: Vec3[] = [];
  for (const entry of body.memory.entries.values()) {
    if (entry.netId === body.target || entry.downed || now - entry.updatedAt > launcher.knownSeconds) continue;
    out.push(knownFeet(entry, body.state.y));
  }
  return out;
}

/**
 * Whether the soldier at `feet` is behind cover from `eye`: the line to its
 * lower body stops on something within `nearM` of it. A wall far out in front
 * of it is not its cover, only something in the way.
 */
export function inCoverFrom(eye: Vec3, feet: Vec3, boxes: readonly WorldBox[], nearM: number): boolean {
  const low = { x: feet.x, y: feet.y + COVER_PROBE_M, z: feet.z };
  const dx = low.x - eye.x;
  const dy = low.y - eye.y;
  const dz = low.z - eye.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance <= 1e-6) return false;
  const hit = rayWorld({ origin: eye, direction: { x: dx / distance, y: dy / distance, z: dz / distance }, maxDistance: distance - 1e-3 }, boxes);
  return hit !== null && distance - hit.distance <= nearM;
}

/**
 * Where the segment `a`→`b` meets a standing body at `feet` (a vertical
 * cylinder), or null: the point of the segment nearest the body's axis, when
 * that is inside its radius and between its feet and its head.
 */
export function meetsBody(a: Vec3, b: Vec3, feet: Vec3, radius = BODY_RADIUS_M, height = BODY_HEIGHT_M): Vec3 | null {
  const sx = b.x - a.x;
  const sz = b.z - a.z;
  const len2 = sx * sx + sz * sz;
  const t = len2 <= 1e-12 ? 0 : Math.max(0, Math.min(1, ((feet.x - a.x) * sx + (feet.z - a.z) * sz) / len2));
  const p = { x: a.x + sx * t, y: a.y + (b.y - a.y) * t, z: a.z + sz * t };
  if ((p.x - feet.x) ** 2 + (p.z - feet.z) ** 2 > radius * radius) return null;
  return p.y >= feet.y && p.y <= feet.y + height ? p : null;
}

/** A rocket shot: the aim (table units, as a Throw carries it), what it was aimed at and where it goes off. */
export interface RocketShot {
  yaw: number;
  pitch: number;
  aim: Vec3;
  burst: Vec3;
  /** Metres from the burst to the middle of the target's crouched body. */
  missM: number;
  /** Squad soldiers it knows of within `groupFraction` of the blast radius of the burst, the target among them. */
  group: number;
}

/**
 * What a rocket launched at (`yaw`, `pitch`) from `eye` meets, as the session
 * flies it: the scenery stops it (the arc ends there), and so does the first
 * body in its way. `burst` is where it goes off (null: within its life,
 * nowhere); `friend` says the first body was one of `friends`.
 */
export function flyRocket(
  def: ProjectileDef,
  eye: Vec3,
  yaw: number,
  pitch: number,
  bodies: { squad: readonly Vec3[]; friends: readonly Vec3[] },
  world: ProjectileWorld,
): { burst: Vec3 | null; friend: boolean } {
  const { origin, velocity } = throwLaunch(def, eye, yaw, pitch, world);
  const arc = projectileArc(def, origin, velocity, { dt: ARC_DT, maxSeconds: def.maxLifeSeconds, world });
  for (let i = 1; i < arc.points.length; i++) {
    const a = arc.points[i - 1]!;
    const b = arc.points[i]!;
    for (const f of bodies.friends) {
      const met = meetsBody(a, b, f);
      if (met) return { burst: met, friend: true };
    }
    for (const s of bodies.squad) {
      const met = meetsBody(a, b, s);
      if (met) return { burst: met, friend: false };
    }
  }
  return { burst: arc.detonation, friend: false };
}

/** Whether a burst at `burst` spares every friend (feet; itself among them): all farther than the blast radius and the margin. */
export function sparesFriends(def: ProjectileDef, launcher: EnemyLauncher, burst: Vec3, friends: readonly Vec3[]): boolean {
  const clear = def.blastRadiusM + launcher.safetyMarginM;
  // Measured flat, which is never nearer than the real distance.
  return friends.every((f) => (burst.x - f.x) ** 2 + (burst.z - f.z) ** 2 > clear * clear);
}

/**
 * The rocket from the standing eye `eye` that bursts within reach of `target`
 * (feet), catches a group or a target behind cover, and spares every friend,
 * or null. `self` is where it stands: a friend for the blast, not a body the
 * rocket can meet (it leaves ahead of its own capsule). Of the aim heights that
 * do, the one that catches most of the squad wins, then the nearest burst.
 */
export function chooseRocket(
  def: ProjectileDef,
  launcher: EnemyLauncher,
  eye: Vec3,
  self: Vec3,
  target: Vec3,
  squad: readonly Vec3[],
  others: readonly Vec3[],
  world: ProjectileWorld,
): RocketShot | null {
  const reach = def.blastRadiusM * launcher.reachFraction;
  const groupM = def.blastRadiusM * launcher.groupFraction;
  const covered = inCoverFrom(eye, target, world.boxes, launcher.coverNearM);
  const friends = [self, ...others];
  const soldiers = [target, ...squad];
  const bodies = { squad: soldiers, friends: others };
  let best: RocketShot | null = null;
  for (const height of AIM_HEIGHTS_M) {
    const aim = { x: target.x, y: target.y + height, z: target.z };
    // Aimed high by the drop over the flight, as the tank lays its gun (U-068).
    const seconds = across(eye, aim) / def.speedMPerSec;
    const angles = aimAngles(eye, { x: aim.x, y: aim.y + 0.5 * def.gravity * seconds * seconds, z: aim.z });
    const yaw = angles.yaw & 0xfff;
    const pitch = angles.pitch & 0xfff;
    const { burst, friend } = flyRocket(def, eye, yaw, pitch, bodies, world);
    if (burst === null || friend) continue;
    const missM = Math.sqrt((burst.x - target.x) ** 2 + (burst.y - target.y - TARGET_MIDDLE_M) ** 2 + (burst.z - target.z) ** 2);
    if (missM > reach) continue;
    if (!sparesFriends(def, launcher, burst, friends)) continue;
    const group = soldiers.filter((s) => across(s, burst) <= groupM).length;
    if (!covered && group < launcher.groupMin) continue;
    if (best === null || group > best.group || (group === best.group && missM < best.missM)) best = { yaw, pitch, aim, burst, missM, group };
  }
  return best;
}

/** Whether a point is in its band from the threat: past the near edge and its hysteresis, inside the far edge. */
function inBand(p: Vec3, threat: Vec3, launcher: EnemyLauncher): boolean {
  const d = across(p, threat);
  return d >= launcher.minRangeM + launcher.rifleHysteresisM && d <= launcher.maxRangeM;
}

/**
 * Cover for the launcher: the point it holds while `keep` says it will still
 * do, else the best the query offers in the band that `also` accepts,
 * reserved; null when there is none (or no cover on this world).
 */
function bandCover(body: CombatBody, launcher: EnemyLauncher, threat: Vec3, keep: (p: Vec3) => boolean, also: (p: Vec3) => boolean): Vec3 | null {
  const cover = body.combat.cover;
  if (!cover) return null;
  const held = cover.heldPoint(body.netId);
  if (held && keep(held) && (body.canReach?.(held) ?? true)) return held;
  const accept = (p: Vec3) => inBand(p, threat, launcher) && also(p) && (body.canReach?.(p) ?? true);
  return cover.choose(body.netId, { from: body.state, threats: [threat], friends: othersOf(body), accept, ...(body.movementCost ? { pathCost: body.movementCost } : {}) })?.point ?? null;
}

/**
 * `relocateM` to one side of the line from where it fired to the threat, where
 * a soldier stands clear, in the band and reachable — its own side first by
 * its netId, so two gunners part — or null.
 */
function aside(body: CombatBody, launcher: EnemyLauncher, from: Vec3, threat: Vec3): Vec3 | null {
  const dx = threat.x - from.x;
  const dz = threat.z - from.z;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length <= 1e-6) return null;
  const first = body.netId % 2 === 0 ? 1 : -1;
  for (const side of [first, -first]) {
    const p = { x: from.x - (dz / length) * launcher.relocateM * side, y: from.y, z: from.z + (dx / length) * launcher.relocateM * side };
    if (inBand(p, threat, launcher) && standsClear(p, body.combat.boxes) && (body.canReach?.(p) ?? true)) return p;
  }
  return null;
}

/** Walk (or run) to a cover point with the launcher in hand; success once there. */
function walkToCover(frame: Frame, body: CombatBody, point: Vec3, face: Vec3 | null, pace: 'walk' | 'sprint'): 'running' | 'success' {
  shoulder(frame, null);
  frame.blackboard.set('phase', null);
  if (across(body.state, point) <= THERE_M) {
    frame.blackboard.set('intent', null);
    frame.blackboard.set('lookAt', face);
    return 'success';
  }
  frame.blackboard.set('intent', { goal: { x: point.x, y: point.y, z: point.z }, pace });
  // Facing the threat on a walk; on a run, the way it goes.
  frame.blackboard.set('lookAt', pace === 'walk' ? face : null);
  return 'running';
}

/** Its own side's other soldiers' feet. */
function othersOf(body: CombatBody): Vec3[] {
  return body.combat.friendsOf(body.netId, body.faction);
}

/** Hands on the launcher, nothing else asked of them: no rifle, no reload, no throw. */
function shoulder(frame: Frame, lookAt: Vec3 | null): void {
  const bb = frame.blackboard;
  bb.set('rifle', false);
  bb.set('fireAt', null);
  bb.set('suppressAt', null);
  bb.set('reload', false);
  bb.set('crouch', false);
  bb.set('interact', false);
  bb.set('lookAt', lookAt);
}

/** Search from a standing eye at `at` (whatever stance it is in now: it stands to fire) for its current target. */
function searchFrom(body: CombatBody, launcher: EnemyLauncher, def: ProjectileDef, at: Vec3, target: Vec3, now: number): RocketShot | null {
  const feet = { x: at.x, y: at.y, z: at.z };
  return chooseRocket(def, launcher, stanceEye(feet), feet, target, knownSquad(body, launcher, now), othersOf(body), body.combat.projectileWorld());
}

/** Begin the wind-up on `shot`: stand on it, locked, for `tellSeconds`. */
function beginTell(frame: Frame, launcher: EnemyLauncher, shot: RocketShot, now: number): void {
  frame.blackboard.set('rocketTell', { until: now + launcher.tellSeconds, point: { ...shot.aim }, yaw: shot.yaw, pitch: shot.pitch });
  frame.blackboard.set('phase', 'rocket-tell');
  frame.blackboard.set('intent', null);
  shoulder(frame, shot.aim);
}

/** Give up a shot: no wind-up, and no search again for `retrySeconds`. */
function abandon(frame: Frame, launcher: EnemyLauncher, now: number): 'failure' {
  frame.blackboard.set('rocketTell', null);
  frame.blackboard.set('phase', null);
  frame.blackboard.set('rocketNextAt', now + launcher.retrySeconds);
  return 'failure';
}

export function registerRpgLeaves(registry: BrainRegistry): BrainRegistry {
  return (
    registry
      /**
       * Its rifle is the weapon for this fight: no launcher, no rockets left,
       * or its target inside the near edge of its band — and, once the rifle
       * is out, until the target is `rifleHysteresisM` past it.
       */
      .condition('useRifle', ({ ctx, blackboard }) => {
        if (!isCombatBody(ctx)) return false;
        const launcher = launcherOf(ctx);
        if (!launcher || rocketsLeft(ctx, launcher) <= 0) return true;
        const feet = targetFeet(ctx);
        if (!feet) return false;
        return across(ctx.state, feet) < launcher.minRangeM + (blackboard.get('rifle') ? launcher.rifleHysteresisM : 0);
      })
      .action('rifleInHand', ({ blackboard }) => {
        blackboard.set('rifle', true);
        return 'success';
      })
      .action('launcherInHand', ({ blackboard }) => {
        blackboard.set('rifle', false);
        return 'success';
      })
      /**
       * A rocket is worth searching for this think: one loaded (rockets left,
       * the reload done, the hands free), its target known within
       * `knownSeconds`, not down, in the band and still for `stillSeconds`.
       * A shot already under way (stepping out, or winding up) holds it while
       * the launcher is loaded: the wind-up is committed to its point.
       */
      .condition('rocketTarget', ({ ctx, blackboard }) => {
        if (!isCombatBody(ctx) || ctx.state.vault) return false;
        const launcher = launcherOf(ctx);
        if (!launcher || rocketsLeft(ctx, launcher) <= 0) return false;
        const now = ctx.combat.now();
        if (now < ctx.nextThrowAt || ctx.combat.projectileDef(rocketIndex(launcher)) === null) return false;
        if (ctx.target === null) return false;
        const phase = blackboard.get('phase');
        if (blackboard.get('rocketTell') !== null || phase === 'rocket-out') return true;
        if (now < blackboard.get('rocketNextAt')) return false;
        const entry = ctx.memory.entries.get(ctx.target);
        if (!entry || entry.downed || now - entry.updatedAt > launcher.knownSeconds) return false;
        const feet = knownFeet(entry, ctx.state.y);
        const range = across(ctx.state, feet);
        if (range < launcher.minRangeM || range > launcher.maxRangeM) return false;
        return stillFor(ctx.still, ctx.target, now) >= launcher.stillSeconds;
      })
      /**
       * Search, step out if it must, wind up, fire. From its feet first (over
       * low cover it stands); behind high cover, from the side step a peek
       * would take (T-3.19). Running through the step and the wind-up;
       * success once the launch is asked for; failure, not tried again for
       * `retrySeconds`, when no shot will do or a friend has come into it.
       */
      .action('fireRocket', {
        tick(frame) {
          const body = frame.ctx;
          if (!isCombatBody(body)) return 'failure';
          const launcher = launcherOf(body);
          const now = body.combat.now();
          if (!launcher) return 'failure';
          const index = rocketIndex(launcher);
          const def = body.combat.projectileDef(index);
          const target = targetFeet(body);
          if (!def || !target) return abandon(frame, launcher, now);
          const bb = frame.blackboard;
          const point = body.combat.cover?.heldPoint(body.netId) ?? null;
          const threat = threatEye(body);

          if (bb.get('rocketTell') === null && bb.get('phase') !== 'rocket-out') {
            const here = searchFrom(body, launcher, def, body.state, target, now);
            if (here) {
              beginTell(frame, launcher, here, now);
              return 'running';
            }
            // Out of high cover to the side, if a shot from there will do.
            const out = point && point.height === 'high' && threat ? firingPosition(point, threat, body.combat.boxes) : null;
            if (!out || !searchFrom(body, launcher, def, out, target, now)) return abandon(frame, launcher, now);
            bb.set('phase', 'rocket-out');
            bb.set('phaseAt', frame.tick);
          }

          if (bb.get('phase') === 'rocket-out') {
            const out = point && threat ? firingPosition(point, threat, body.combat.boxes) : null;
            const there = out === null || across(body.state, out) <= THERE_M || frame.tick - bb.get('phaseAt') >= Math.round(STEP_SECONDS * BRAIN_TICKS_PER_SECOND);
            if (!there) {
              shoulder(frame, threat);
              bb.set('intent', { goal: { x: out.x, y: out.y, z: out.z }, pace: 'walk' });
              return 'running';
            }
            const shot = searchFrom(body, launcher, def, body.state, target, now);
            if (!shot) return abandon(frame, launcher, now);
            beginTell(frame, launcher, shot, now);
            return 'running';
          }

          const tell = bb.get('rocketTell')!;
          shoulder(frame, tell.point);
          bb.set('intent', null);
          if (now < tell.until) return 'running';
          // The wind-up is over: the launch it locked, unless a friend has come into the flight or the blast since.
          const others = othersOf(body);
          const flight = flyRocket(def, throwEye(body.state), tell.yaw, tell.pitch, { squad: [target, ...knownSquad(body, launcher, now)], friends: others }, body.combat.projectileWorld());
          if (flight.friend || (flight.burst !== null && !sparesFriends(def, launcher, flight.burst, [{ x: body.state.x, y: body.state.y, z: body.state.z }, ...others]))) {
            return abandon(frame, launcher, now);
          }
          bb.set('throwAt', { projectile: index, yaw: tell.yaw, pitch: tell.pitch });
          bb.set('firedFrom', { x: body.state.x, y: body.state.y, z: body.state.z });
          bb.set('rocketTell', null);
          bb.set('phase', null);
          bb.set('rocketNextAt', now + launcher.retrySeconds);
          return 'success';
        },
        halt(frame) {
          frame.blackboard.set('rocketTell', null);
          if (frame.blackboard.get('phase')?.startsWith('rocket-')) frame.blackboard.set('phase', null);
        },
      })
      /**
       * To cover in its band, with the launcher: the point it holds while that
       * still hides it from the threat and is in the band, else the best the
       * query offers that is — never one inside the band's near edge (and its
       * hysteresis), where the rifle would come out. Running on the way,
       * success on arrival, failure when the band has none.
       */
      .action('launcherCover', (frame) => {
        const body = frame.ctx;
        if (!isCombatBody(body)) return 'failure';
        const launcher = launcherOf(body);
        const eye = threatEye(body);
        if (!launcher || !eye) return 'failure';
        const point = bandCover(body, launcher, eye, (p) => body.combat.cover!.stillProtects(body.netId, [eye]) && inBand(p, eye, launcher), () => true);
        if (!point) return 'failure';
        return walkToCover(frame, body, point, eye, 'walk');
      })
      /** It has fired and not yet moved on (`firedFrom`). */
      .condition('mustRelocate', ({ blackboard }) => blackboard.get('firedFrom') !== null)
      /**
       * Away from where it fired: to cover in its band at least `relocateM`
       * from there, at a run; with none, `relocateM` to one side of its line
       * of fire, in the open. Success on arrival; failure, the move forgotten,
       * when there is nowhere to go, or once the next rocket is loaded.
       */
      .action('relocate', (frame) => {
        const body = frame.ctx;
        const bb = frame.blackboard;
        const from = bb.get('firedFrom');
        const launcher = isCombatBody(body) ? launcherOf(body) : null;
        const eye = isCombatBody(body) ? threatEye(body) : null;
        if (!isCombatBody(body) || !from || !launcher || !eye || body.combat.now() >= body.nextThrowAt) {
          bb.set('firedFrom', null);
          return 'failure';
        }
        const away = (p: Vec3) => across(p, from) >= launcher.relocateM;
        const point = bandCover(body, launcher, eye, (p) => away(p) && inBand(p, eye, launcher), away) ?? aside(body, launcher, from, eye);
        if (!point) {
          bb.set('firedFrom', null);
          return 'failure';
        }
        const result = walkToCover(frame, body, point, null, 'sprint');
        if (result === 'success') bb.set('firedFrom', null);
        return result;
      })
  );
}
