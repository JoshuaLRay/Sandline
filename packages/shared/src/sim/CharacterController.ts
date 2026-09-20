/**
 * Kinematic character controller (T-1.12, ADR-014).
 *
 * THE most safety-critical function in the codebase for netcode purposes: the
 * client predicts the local player by running this, and the server runs the
 * same code as authority. Any disagreement shows up as rubber-banding.
 *
 * Therefore it is a PURE function of (state, input, dt):
 *   - no hidden state, no wall-clock reads, no Math.random
 *   - yaw to direction goes through the table trig, never Math.sin/cos
 *
 * That last rule is the one that bites. Math.cos here would agree perfectly
 * between a Node server and a Chrome client, because both are V8, and disagree
 * only for Safari and Firefox players — an invisible bug costing a week to find
 * (ADR-014). The lint rule blocks it; this comment explains why it is there.
 */
import { type BinAngle, wireToTable } from '../math/angles.ts';
import { sin, cos } from '../math/trig.ts';
import { DEFAULT_WORLD, type WorldBox, overlapsFootprint } from './world.ts';

export interface MoveState {
  x: number;
  y: number;
  z: number;
  /** Vertical velocity; horizontal motion is driven directly by input. */
  vy: number;
  grounded: boolean;
}

export interface MoveInput {
  /** -1..1, strafe. */
  moveX: number;
  /** -1..1, forward. */
  moveY: number;
  /** Wire angle (1/1024 turn). */
  yaw: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  /**
   * Downed (T-2.13): crawling. Not a button — the server sets it from the
   * soldier's vitality and the client predictor from the replicated one, so
   * both step the same input. Sprint and jump are ignored while it is set.
   */
  downed?: boolean;
  /**
   * The interact button (T-2.15): held to revive a downed teammate. Not a
   * movement input — the controller ignores it — but it rides the same
   * per-tick sample so the server sees it in step with the position.
   */
  interact?: boolean;
}

export interface MoveConfig {
  walkSpeed: number;
  sprintSpeed: number;
  crouchSpeed: number;
  /** Downed and crawling (T-2.13). */
  crawlSpeed: number;
  gravity: number;
  jumpSpeed: number;
  groundY: number;
  /** Terminal velocity, so a long fall cannot produce absurd numbers. */
  maxFallSpeed: number;
  /**
   * The soldier's footprint half-width and standing height, for collision
   * (T-1.12). The footprint is a square, not a circle: box-against-box is a
   * comparison, and the 5 cm of corner a circle would shave off is not worth
   * a square root per box per tick. Matches the server hitbox's radius.
   */
  radius: number;
  height: number;
  /** Ledges up to this high are stepped onto; higher ones block. */
  stepHeight: number;
}

/**
 * Defaults. Parity tests must NOT read these — they declare their own constants
 * in the fixture, so tuning here can never break a parity test (ADR-014, R10).
 */
export const DEFAULT_MOVE_CONFIG: MoveConfig = {
  walkSpeed: 4.2,
  sprintSpeed: 6.8,
  crouchSpeed: 1.9,
  crawlSpeed: 1.2,
  gravity: -19.6,
  jumpSpeed: 6.0,
  groundY: 0,
  maxFallSpeed: -55,
  radius: 0.35,
  height: 1.8,
  stepHeight: 0.45,
};

/** Clamp a stick axis. Guards against a hostile client sending moveX = 1e9. */
function axis(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/**
 * One tick of movement, with collision against `world` (T-1.12).
 *
 * The order is horizontal then vertical, and each horizontal axis separately:
 *
 *   1. X, then Z, each pushed out of any box that blocks at standing height.
 *      Resolving the axes one at a time is what makes walking into a wall at
 *      an angle SLIDE along it instead of stopping dead — the blocked axis
 *      loses its motion and the other keeps its own. A box you could step
 *      onto, or one entirely above your head, does not block.
 *   2. Y against the highest surface under the footprint: the ground, or the
 *      top of any box no higher than a step above the feet. Landing on it
 *      grounds you; being above it does not. So walking off a crate falls,
 *      walking onto a step rises, and a jump that comes down on cover stands
 *      on it. A box overhead within standing height stops an upward move.
 *
 * Nothing here tunnels at the speeds this game has: the footprint is 0.7 m
 * wide and sprint moves 0.23 m per tick, so a box thinner than a post still
 * overlaps the footprint at every tick along the way.
 *
 * Still pure, still only arithmetic and comparison. `world` defaults to the
 * shared static world so that every caller — server session, client
 * predictor, headless bot — collides with the same scenery without being
 * told; tests pass their own, per the fixture rule.
 */
export function stepCharacter(
  state: Readonly<MoveState>,
  input: Readonly<MoveInput>,
  dt: number,
  config: MoveConfig = DEFAULT_MOVE_CONFIG,
  world: readonly WorldBox[] = DEFAULT_WORLD,
): MoveState {
  const mx = axis(input.moveX);
  const my = axis(input.moveY);

  // Normalise diagonal input so moving on both axes is not faster.
  const lenSq = mx * mx + my * my;
  const scale = lenSq > 1 ? 1 / Math.sqrt(lenSq) : 1; // sqrt IS IEEE-exact
  const downed = input.downed === true;
  const speed = downed
    ? config.crawlSpeed
    : input.crouch
      ? config.crouchSpeed
      : input.sprint
        ? config.sprintSpeed
        : config.walkSpeed;

  // Table trig, not Math.cos. See the header.
  const a: BinAngle = wireToTable(input.yaw);
  const s = sin(a);
  const c = cos(a);

  // Forward is +Z rotated by yaw. Right is cross(forward, up), NOT
  // cross(up, forward) - in a right-handed Y-up system, a viewer looking along
  // +Z has +X on their LEFT, so the other cross product sends D leftward and
  // A rightward. That was shipped once and reported immediately.
  const worldX = (my * s - mx * c) * speed * scale;
  const worldZ = (my * c + mx * s) * speed * scale;

  const half = config.radius;
  const feet = state.y;
  /** Blocks horizontal movement: too tall to step onto, and not above the head. */
  const blocks = (box: WorldBox): boolean =>
    box.maxY > feet + config.stepHeight && box.minY < feet + config.height;

  // 1. Horizontal, one axis at a time.
  let x = state.x + worldX * dt;
  if (worldX !== 0) {
    for (const box of world) {
      if (!blocks(box) || !overlapsFootprint(x, state.z, half, box)) continue;
      x = worldX > 0 ? box.minX - half : box.maxX + half;
    }
  }
  let z = state.z + worldZ * dt;
  if (worldZ !== 0) {
    for (const box of world) {
      if (!blocks(box) || !overlapsFootprint(x, z, half, box)) continue;
      z = worldZ > 0 ? box.minZ - half : box.maxZ + half;
    }
  }

  // 2. Vertical.
  let vy = state.vy;
  let grounded = state.grounded;

  if (grounded && input.jump && !downed) {
    vy = config.jumpSpeed;
    grounded = false;
  } else if (!grounded) {
    vy += config.gravity * dt;
    if (vy < config.maxFallSpeed) vy = config.maxFallSpeed;
  } else {
    vy = 0;
  }

  let y = state.y + vy * dt;

  // The highest surface under the footprint that the feet can reach: the
  // ground, or a box top no more than a step above where the feet were. A box
  // top far below the feet is also a candidate — that is what a fall lands on.
  let support = config.groundY;
  for (const box of world) {
    if (box.maxY <= feet + config.stepHeight && box.maxY > support && overlapsFootprint(x, z, half, box)) {
      support = box.maxY;
    }
  }
  if (y <= support) {
    y = support;
    vy = 0;
    grounded = true;
  } else {
    grounded = false;
  }

  // Head room: a box overhead within standing height stops an upward move.
  for (const box of world) {
    if (box.minY >= y + config.stepHeight && box.minY < y + config.height && overlapsFootprint(x, z, half, box)) {
      y = box.minY - config.height;
      if (vy > 0) vy = 0;
    }
  }

  return { x, y, z, vy, grounded };
}

export function createMoveState(x = 0, y = 0, z = 0): MoveState {
  return { x, y, z, vy: 0, grounded: y <= 0 };
}
