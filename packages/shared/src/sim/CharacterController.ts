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
}

export interface MoveConfig {
  walkSpeed: number;
  sprintSpeed: number;
  crouchSpeed: number;
  gravity: number;
  jumpSpeed: number;
  groundY: number;
  /** Terminal velocity, so a long fall cannot produce absurd numbers. */
  maxFallSpeed: number;
}

/**
 * Defaults. Parity tests must NOT read these — they declare their own constants
 * in the fixture, so tuning here can never break a parity test (ADR-014, R10).
 */
export const DEFAULT_MOVE_CONFIG: MoveConfig = {
  walkSpeed: 4.2,
  sprintSpeed: 6.8,
  crouchSpeed: 1.9,
  gravity: -19.6,
  jumpSpeed: 6.0,
  groundY: 0,
  maxFallSpeed: -55,
};

/** Clamp a stick axis. Guards against a hostile client sending moveX = 1e9. */
function axis(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

export function stepCharacter(
  state: Readonly<MoveState>,
  input: Readonly<MoveInput>,
  dt: number,
  config: MoveConfig = DEFAULT_MOVE_CONFIG,
): MoveState {
  const mx = axis(input.moveX);
  const my = axis(input.moveY);

  // Normalise diagonal input so moving on both axes is not faster.
  const lenSq = mx * mx + my * my;
  const scale = lenSq > 1 ? 1 / Math.sqrt(lenSq) : 1; // sqrt IS IEEE-exact
  const speed = input.crouch ? config.crouchSpeed : input.sprint ? config.sprintSpeed : config.walkSpeed;

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

  let vy = state.vy;
  let grounded = state.grounded;

  if (grounded && input.jump) {
    vy = config.jumpSpeed;
    grounded = false;
  } else if (!grounded) {
    vy += config.gravity * dt;
    if (vy < config.maxFallSpeed) vy = config.maxFallSpeed;
  } else {
    vy = 0;
  }

  let y = state.y + vy * dt;
  if (y <= config.groundY) {
    y = config.groundY;
    vy = 0;
    grounded = true;
  }

  return {
    x: state.x + worldX * dt,
    y,
    z: state.z + worldZ * dt,
    vy,
    grounded,
  };
}

export function createMoveState(x = 0, y = 0, z = 0): MoveState {
  return { x, y, z, vy: 0, grounded: y <= 0 };
}
