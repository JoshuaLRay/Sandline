/**
 * Path following as input (T-3.05).
 *
 * A bot walks a navmesh path the way a person does: by producing a
 * `MoveInput` every tick and letting `stepCharacter` move it (§7.9 rule 1).
 * There is no second movement model here. The follower decides which way to
 * face, how far to push the stick, and when to crouch, sprint or jump; the
 * controller does the rest, so a bot collides, slides, steps and vaults
 * exactly as a person does, and a human taking over its slot (ADR-001)
 * changes who produces the input and nothing else.
 *
 * TWO LAYERS. `followPath` is a pure function of (the path and how far along
 * it the follower is, the soldier's `MoveState`, the intent) to an input and
 * the follower's next state: stepped at 30 Hz (ADR-012), no clock, no
 * randomness, no Detour. `PathFollower` owns the navmesh and asks it for a
 * path only on a new goal and when `followPath` reports no progress — never
 * per tick, which is the cost ADR-006's addendum priced in.
 *
 * VAULTS. A vault leg (T-3.04) is walked into facing along its link, stick
 * full forward, and jump is pressed only on a tick where the controller
 * itself would start the vault — found by stepping it once with jump held
 * and looking. `tryStartVault` alone is not enough: it answers the geometry,
 * while the controller also refuses a crouched soldier (including on the
 * tick crouch is released) and a firing one, and in both cases a held jump
 * is an ordinary hop in front of the wall. Asking the controller, as T-3.04
 * did to find the links, cannot drift from it.
 *
 * A vault lands 1.5 m along the facing from wherever it began, not on the
 * link's far end, so its leg is left on the tick the vault finishes, never by
 * distance to that end: a bot that began the vault a little to one side would
 * otherwise never arrive at the end and walk on into whatever is beyond it.
 *
 * Server-only and never predicted (§7.9 rule 2), so `Math.atan2` is allowed
 * here (the ban is `packages/shared`'s, ADR-014); the yaw it gives is rounded
 * once to the wire's 1/1024 turn, the same integer a person's client sends.
 */
import {
  DEFAULT_MOVE_CONFIG,
  type MoveConfig,
  type MoveInput,
  type MoveState,
  TICK_SECONDS,
  WIRE_ANGLE_UNITS,
  type WorldBox,
  stepCharacter,
} from '@sandline/shared';
import type { NavMesh, NavPath, NavPoint } from '../nav/NavMesh.ts';
import RAW_FOLLOW from './follow.json' with { type: 'json' };

/** How ordinary legs are walked. Vault legs are always walked standing. */
export type LocomotionPace = 'walk' | 'sprint' | 'crouch';

/** What a brain asks of locomotion: where to go, and how. */
export interface LocomotionIntent {
  goal: NavPoint;
  pace: LocomotionPace;
}

/** Path following tuning (`follow.json`). */
export interface FollowConfig {
  /** How close to the path's last point, across the ground, counts as arrived. */
  arrivalRadiusM: number;
  /** How close to a corner before steering for the next: the corner smoothing. */
  cornerRadiusM: number;
  /** Ticks without progress along the path before the follower is stuck. */
  stuckTicks: number;
  /** Progress is the distance left along the path falling by at least this. */
  progressEpsilonM: number;
  /** How far across a goal (or a start) off the mesh is looked for. */
  goalSearchMaxM: number;
  /** How far an intent's goal must move before it is planned again. */
  repathGoalMoveM: number;
}

/** Where a follower is along its path. Plain data, threaded tick to tick. */
export interface FollowState {
  readonly path: NavPath;
  /** Distance across the ground from each point to the path's end, along it. */
  readonly tail: readonly number[];
  /** Index of the point being walked toward. */
  leg: number;
  /**
   * The vault leg (by the index of its end) already crossed, or -1. Once a
   * vault lands, its leg's end is walked to as an ordinary corner.
   */
  crossed: number;
  /** Least distance left along the path so far, for the stuck detector. */
  bestRemaining: number;
  /** Ticks since `bestRemaining` last fell by `progressEpsilonM`. */
  sinceProgress: number;
  /** A vault was in progress last tick: the tick it is not is the landing. */
  wasVaulting: boolean;
  /** The facing last produced, kept when there is nowhere to turn. */
  yaw: number;
}

export type FollowStatus = 'following' | 'arrived' | 'stuck';

export interface FollowStep {
  input: MoveInput;
  follow: FollowState;
  status: FollowStatus;
}

// ---------------------------------------------------------------------------
// Tuning data
// ---------------------------------------------------------------------------

/**
 * Hand-written rather than zod, for the reason `weapons.ts` gives: a schema
 * library is a runtime dependency, which needs an ADR line first (§0.3 rule
 * 3). Unknown keys are refused, so a misspelt one fails at import instead of
 * silently leaving its default in charge.
 */
class FollowDataError extends Error {}

const FOLLOW_KEYS: readonly (keyof FollowConfig)[] = [
  'arrivalRadiusM',
  'cornerRadiusM',
  'stuckTicks',
  'progressEpsilonM',
  'goalSearchMaxM',
  'repathGoalMoveM',
];

function num(row: Record<string, unknown>, key: keyof FollowConfig, min: number, max: number, integer = false): number {
  const v = row[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new FollowDataError(`follow tuning: ${key} must be a finite number, got ${String(v)}`);
  }
  if (v < min || v > max) throw new FollowDataError(`follow tuning: ${key} must be in [${min}, ${max}], got ${v}`);
  if (integer && !Number.isInteger(v)) throw new FollowDataError(`follow tuning: ${key} must be an integer, got ${v}`);
  return v;
}

/** Validate path following tuning. Throws naming the offending key. */
export function parseFollowConfig(raw: unknown): FollowConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new FollowDataError('follow tuning: expected an object');
  }
  const row = raw as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (key !== '$comment' && !(FOLLOW_KEYS as readonly string[]).includes(key)) {
      throw new FollowDataError(`follow tuning: unknown key "${key}"`);
    }
  }
  return {
    arrivalRadiusM: num(row, 'arrivalRadiusM', 0.01, 5),
    cornerRadiusM: num(row, 'cornerRadiusM', 0, 5),
    stuckTicks: num(row, 'stuckTicks', 1, 300, true),
    progressEpsilonM: num(row, 'progressEpsilonM', 0, 1),
    goalSearchMaxM: num(row, 'goalSearchMaxM', 0.5, 1000),
    repathGoalMoveM: num(row, 'repathGoalMoveM', 0, 50),
  };
}

export const DEFAULT_FOLLOW_CONFIG: Readonly<FollowConfig> = Object.freeze(parseFollowConfig(RAW_FOLLOW));

// ---------------------------------------------------------------------------
// The pure step
// ---------------------------------------------------------------------------

/** Distance across the ground: path points sit a voxel above the feet. */
function across(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Wire yaw facing along (dx, dz): 1/1024 turn, 0 along +Z and a quarter turn
 * (256) along +X, which is `stepCharacter`'s forward of (sin, cos). Rounded
 * once, straight to wire units.
 */
export function yawToward(dx: number, dz: number): number {
  const wire = Math.round((Math.atan2(dx, dz) / (2 * Math.PI)) * WIRE_ANGLE_UNITS);
  return ((wire % WIRE_ANGLE_UNITS) + WIRE_ANGLE_UNITS) % WIRE_ANGLE_UNITS;
}

function inputOf(moveY: number, yaw: number, pace: LocomotionPace): MoveInput {
  return {
    moveX: 0,
    moveY,
    yaw,
    jump: false,
    sprint: pace === 'sprint',
    crouch: pace === 'crouch',
    prone: false,
    interact: false,
    firing: false,
  };
}

function paceSpeed(pace: LocomotionPace, move: MoveConfig): number {
  return pace === 'sprint' ? move.sprintSpeed : pace === 'crouch' ? move.crouchSpeed : move.walkSpeed;
}

/** The leg ending at `leg` is a vault not yet crossed. */
function onVaultLeg(f: Readonly<FollowState>, leg: number): boolean {
  return leg !== f.crossed && f.path.vaults.includes(leg - 1);
}

/** Near enough the corner, or already past it along its own leg. */
function reached(points: readonly NavPoint[], leg: number, state: Readonly<MoveState>, radius: number): boolean {
  const corner = points[leg]!;
  if (across(state, corner) <= radius) return true;
  const prev = points[leg - 1];
  if (!prev) return false;
  return (state.x - corner.x) * (corner.x - prev.x) + (state.z - corner.z) * (corner.z - prev.z) >= 0;
}

/** A follower at the start of `path`, facing `yaw` until it has somewhere to turn. */
export function startFollow(path: NavPath, yaw: number): FollowState {
  const points = path.points;
  const tail = new Array<number>(points.length).fill(0);
  for (let i = points.length - 2; i >= 0; i--) tail[i] = tail[i + 1]! + across(points[i]!, points[i + 1]!);
  return {
    path,
    tail,
    leg: Math.min(1, points.length - 1),
    crossed: -1,
    bestRemaining: Infinity,
    sinceProgress: 0,
    wasVaulting: false,
    yaw,
  };
}

/**
 * One tick of path following: the input a soldier in `state` should send to
 * walk `follow`'s path as `intent` asks, and where along the path that leaves
 * the follower. Pure; stepped at 30 Hz, and the input goes through
 * `stepCharacter` with the same `move` and `world` exactly as a person's does.
 *
 * `'stuck'` is reported, not acted on: no progress along the path for
 * `stuckTicks` ticks. Repathing is the caller's (`PathFollower`), because
 * only the caller has the navmesh.
 */
export function followPath(
  follow: Readonly<FollowState>,
  state: Readonly<MoveState>,
  intent: Readonly<LocomotionIntent>,
  world: readonly WorldBox[],
  tuning: Readonly<FollowConfig> = DEFAULT_FOLLOW_CONFIG,
  move: MoveConfig = DEFAULT_MOVE_CONFIG,
): FollowStep {
  const points = follow.path.points;
  const last = points.length - 1;
  const next: FollowState = { ...follow };

  // A vault owns the tick (T-2.21) and ignores the input. Hold the stick
  // forward along it, and neither advance nor count progress until it lands.
  if (state.vault) {
    next.wasVaulting = true;
    next.yaw = state.vault.yaw;
    return { input: inputOf(1, state.vault.yaw, 'walk'), follow: next, status: 'following' };
  }
  // The landing: this leg is crossed, wherever the vault put the feet.
  if (follow.wasVaulting) {
    next.wasVaulting = false;
    if (onVaultLeg(next, next.leg)) next.crossed = next.leg;
  }

  // On to the next corner once near enough, or once past it along its leg — a
  // sprint tick covers 0.23 m. A vault's start is a corner like any other;
  // the vault leg after it is only left by crossing it.
  while (next.leg < last && !onVaultLeg(next, next.leg) && reached(points, next.leg, state, tuning.cornerRadiusM)) {
    next.leg++;
  }

  const target = points[next.leg]!;
  const dist = across(state, target);
  const vaultLeg = onVaultLeg(next, next.leg);

  if (next.leg === last && !vaultLeg && dist <= tuning.arrivalRadiusM) {
    next.sinceProgress = 0;
    return { input: inputOf(0, next.yaw, intent.pace), follow: next, status: 'arrived' };
  }

  // Progress is the distance left along the path falling, over a window
  // rather than per tick: prone speed covers 0.037 m a tick.
  const remaining = dist + follow.tail[next.leg]!;
  if (remaining < next.bestRemaining - tuning.progressEpsilonM) {
    next.bestRemaining = remaining;
    next.sinceProgress = 0;
  } else {
    next.sinceProgress++;
  }
  const status: FollowStatus = next.sinceProgress >= tuning.stuckTicks ? 'stuck' : 'following';

  if (vaultLeg) {
    // Face along the link (axis-aligned by construction), stand, stick full
    // forward, and press jump only if the controller would vault this tick.
    const from = points[next.leg - 1]!;
    const yaw = yawToward(target.x - from.x, target.z - from.z);
    const input = inputOf(1, yaw, intent.pace === 'sprint' ? 'sprint' : 'walk');
    const trial = stepCharacter(state, { ...input, jump: true }, TICK_SECONDS, move, world);
    input.jump = trial.vault != null;
    next.yaw = yaw;
    return { input, follow: next, status };
  }

  // An ordinary leg: face the corner and go. On the last one push the stick
  // only as far as lands on the point — the controller has no acceleration,
  // so a full step would overshoot by up to a sprint tick.
  const yaw = dist > 1e-6 ? yawToward(target.x - state.x, target.z - state.z) : next.yaw;
  const push = next.leg === last ? Math.min(1, dist / (paceSpeed(intent.pace, move) * TICK_SECONDS)) : 1;
  next.yaw = yaw;
  return { input: inputOf(push, yaw, intent.pace), follow: next, status };
}

// ---------------------------------------------------------------------------
// The follower: planning around the pure step
// ---------------------------------------------------------------------------

/** What a `PathFollower` tick reports. */
export type FollowerStatus = FollowStatus | 'idle' | 'unreachable';

/**
 * Turns the latest intent into an input every tick (§7.9 rule 3): plans a
 * path when the goal changes, walks it with `followPath`, and repaths from
 * where the soldier stands when it stops making progress. One per soldier.
 *
 * It never plans mid-vault, when the soldier's feet are in the air over the
 * obstacle and could snap to either side of it; a plan wanted then waits for
 * the landing. A goal with no path is retried every `stuckTicks`, not every
 * tick.
 */
export class PathFollower {
  private follow: FollowState | null = null;
  private goal: NavPoint | null = null;
  private retryIn = 0;
  private stuckRepaths = 0;

  constructor(
    private readonly mesh: NavMesh,
    private readonly world: readonly WorldBox[],
    private readonly tuning: Readonly<FollowConfig> = DEFAULT_FOLLOW_CONFIG,
    private readonly move: MoveConfig = DEFAULT_MOVE_CONFIG,
  ) {}

  /** Paths planned again because the follower stopped making progress. */
  get repaths(): number {
    return this.stuckRepaths;
  }

  /** The path being walked, or null. */
  get path(): NavPath | null {
    return this.follow?.path ?? null;
  }

  /**
   * The input for this tick. `yaw` is the soldier's current facing, kept
   * while there is nowhere to turn; `intent` null stands the soldier still.
   */
  step(state: Readonly<MoveState>, intent: Readonly<LocomotionIntent> | null, yaw: number): { input: MoveInput; status: FollowerStatus } {
    if (!intent) {
      this.follow = null;
      this.goal = null;
      return { input: inputOf(0, yaw, 'walk'), status: 'idle' };
    }
    const g = intent.goal;
    if (!this.goal || Math.hypot(g.x - this.goal.x, g.y - this.goal.y, g.z - this.goal.z) > this.tuning.repathGoalMoveM) {
      this.goal = { x: g.x, y: g.y, z: g.z };
      this.follow = null;
      this.retryIn = 0;
    }
    if (!this.follow && !state.vault) {
      if (this.retryIn > 0) this.retryIn--;
      else this.plan(state, yaw);
    }
    if (!this.follow) {
      return { input: inputOf(0, yaw, intent.pace), status: state.vault ? 'following' : 'unreachable' };
    }

    let r = followPath(this.follow, state, intent, this.world, this.tuning, this.move);
    if (r.status === 'stuck') {
      this.stuckRepaths++;
      if (!this.plan(state, r.follow.yaw)) return { input: inputOf(0, r.follow.yaw, intent.pace), status: 'unreachable' };
      r = followPath(this.follow!, state, intent, this.world, this.tuning, this.move);
    }
    this.follow = r.follow;
    return { input: r.input, status: r.status };
  }

  private plan(state: Readonly<MoveState>, yaw: number): boolean {
    const path = this.goal ? this.mesh.path(state, this.goal, this.tuning.goalSearchMaxM) : null;
    if (!path) {
      this.follow = null;
      this.retryIn = this.tuning.stuckTicks;
      return false;
    }
    this.follow = startFollow(path, yaw);
    return true;
  }
}
