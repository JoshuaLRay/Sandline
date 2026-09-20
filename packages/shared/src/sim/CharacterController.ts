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
  /** Authoritative crouch stance; remains crouched until standing clearance exists. */
  crouched: boolean;
  vaulting: boolean;
  vaultProgress: number;
  vaultStartX: number;
  vaultStartY: number;
  vaultStartZ: number;
  vaultEndX: number;
  vaultEndY: number;
  vaultEndZ: number;
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
  /** T-2.15: hold the interact button to revive a nearby downed teammate. */
  interact?: boolean;
  /**
   * Downed (T-2.13): crawling. Not a button — the server sets it from the
   * soldier's vitality and the client predictor from the replicated one, so
   * both step the same input. Sprint and jump are ignored while it is set.
   */
  downed?: boolean;
  /** T-2.21: jump is the vault request; the authoritative controller decides. */
  vault?: boolean;
  /** Held trigger state, used to reject vault while firing. */
  firing?: boolean;
}

export interface MoveConfig {
  walkSpeed: number;
  sprintSpeed: number;
  crouchSpeed: number;
  /** Downed and crawling (T-2.13). */
  crawlSpeed: number;
  vaultHeight: number;
  vaultDistance: number;
  vaultDuration: number;
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
  /** Full standing height used for collision and headroom. */
  crouchHeight: number;
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
  vaultHeight: 1.35,
  vaultDistance: 1.4,
  vaultDuration: 0.45,
  gravity: -19.6,
  jumpSpeed: 6.0,
  groundY: 0,
  maxFallSpeed: -55,
  radius: 0.35,
  height: 1.8,
  crouchHeight: 1.2,
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
  // Crouch is an authoritative stance, not merely a button state. Releasing
  // crouch while under a ceiling keeps the character crouched until the
  // resulting position has enough headroom for the full standing height.
  let crouched = !downed && (input.crouch || state.crouched);
  const effectiveHeight = crouched ? config.crouchHeight : config.height;
  const speed = downed
    ? config.crawlSpeed
    : crouched
      ? config.crouchSpeed
      : input.sprint
        ? config.sprintSpeed
        : config.walkSpeed;

  // Table trig, not Math.cos. See the header.
  const half = config.radius;
  const a: BinAngle = wireToTable(input.yaw);
  const s = sin(a);
  const c = cos(a);

  // Vault traversal is an explicit state. Jump is only a request; this same
  // detector runs on both client and server, while the server's replicated
  // Vault component is the authoritative remote presentation state.
  if (state.vaulting) {
    const p = Math.min(1, state.vaultProgress + dt / config.vaultDuration);
    const arc = 4 * p * (1 - p) * 0.35;
    const x = state.vaultStartX + (state.vaultEndX - state.vaultStartX) * p;
    const z = state.vaultStartZ + (state.vaultEndZ - state.vaultStartZ) * p;
    const y = state.vaultStartY + (state.vaultEndY - state.vaultStartY) * p + arc;
    if (p >= 1) return { x, y: state.vaultEndY, z, vy: 0, grounded: true, crouched: false, vaulting: false, vaultProgress: 0, vaultStartX: x, vaultStartY: state.vaultEndY, vaultStartZ: z, vaultEndX: x, vaultEndY: state.vaultEndY, vaultEndZ: z };
    return { ...state, x, y, z, vy: 0, grounded: false, vaulting: true, vaultProgress: p };
  }

  if (!downed && !state.crouched && state.grounded && input.vault && !input.firing && my > 0.25) {
    const len = Math.sqrt(mx * mx + my * my);
    const dx = (my * s - mx * c) / len;
    const dz = (my * c + mx * s) / len;
    let best: { d: number; x: number; z: number; y: number } | null = null;
    for (const box of world) {
      if (box.maxY <= state.y + config.stepHeight || box.maxY > state.y + config.vaultHeight) continue;
      let near = 0, far = config.vaultDistance, miss = false;
      for (const axis of [{ o: state.x, d: dx, lo: box.minX - half, hi: box.maxX + half }, { o: state.z, d: dz, lo: box.minZ - half, hi: box.maxZ + half }]) {
        if (axis.d === 0) { if (axis.o < axis.lo || axis.o > axis.hi) miss = true; continue; }
        let a0 = (axis.lo - axis.o) / axis.d, a1 = (axis.hi - axis.o) / axis.d;
        if (a0 > a1) [a0, a1] = [a1, a0];
        near = Math.max(near, a0); far = Math.min(far, a1);
        if (near > far) { miss = true; break; }
      }
      const d = far + 0.05;
      if (miss || d <= 0 || d > config.vaultDistance + 1e-9) continue;
      const ex = state.x + dx * d, ez = state.z + dz * d;
      const blocked = world.some((other) => other !== box && other.maxY > box.maxY - 0.05 && overlapsFootprint(ex, ez, half, other));
      if (!blocked && (!best || d < best.d)) best = { d, x: ex, z: ez, y: box.maxY };
    }
    if (best) return { x: state.x, y: state.y, z: state.z, vy: 0, grounded: false, crouched: false, vaulting: true, vaultProgress: 0, vaultStartX: state.x, vaultStartY: state.y, vaultStartZ: state.z, vaultEndX: best.x, vaultEndY: best.y, vaultEndZ: best.z };
  }

  // Forward is +Z rotated by yaw. Right is cross(forward, up), NOT
  // cross(up, forward) - in a right-handed Y-up system, a viewer looking along
  // +Z has +X on their LEFT, so the other cross product sends D leftward and
  // A rightward. That was shipped once and reported immediately.
  const worldX = (my * s - mx * c) * speed * scale;
  const worldZ = (my * c + mx * s) * speed * scale;

  const feet = state.y;
  /** Blocks horizontal movement: too tall to step onto, and not above the head. */
  const blocks = (box: WorldBox): boolean =>
    box.maxY > feet + config.stepHeight && box.minY < feet + effectiveHeight;

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

  // A released crouch is only allowed to transition to standing when the
  // character's current feet position has full-height clearance. Keep the
  // crouched stance while moving through a low ceiling; after horizontal
  // movement, re-check at the resulting position so walking out from under
  // cover permits the same tick's stand transition.
  if (crouched && !input.crouch && !downed) {
    const canStand = !world.some((box) =>
      box.minY >= feet + config.stepHeight &&
      box.minY < feet + config.height &&
      overlapsFootprint(x, z, half, box),
    );
    if (canStand) crouched = false;
  }
  const resolvedHeight = crouched ? config.crouchHeight : config.height;

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
    if (box.minY >= y + config.stepHeight && box.minY < y + resolvedHeight && overlapsFootprint(x, z, half, box)) {
      y = Math.max(support, box.minY - effectiveHeight);
      if (vy > 0) vy = 0;
    }
  }

  return { x, y, z, vy, grounded, crouched, vaulting: false, vaultProgress: 0, vaultStartX: x, vaultStartY: y, vaultStartZ: z, vaultEndX: x, vaultEndY: y, vaultEndZ: z };
}

export function createMoveState(x = 0, y = 0, z = 0): MoveState {
  return { x, y, z, vy: 0, grounded: y <= 0, crouched: false, vaulting: false, vaultProgress: 0, vaultStartX: x, vaultStartY: y, vaultStartZ: z, vaultEndX: x, vaultEndY: y, vaultEndZ: z };
}
