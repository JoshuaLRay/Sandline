/**
 * Renderer-facing locomotion classification (T-2.17).
 *
 * This module deliberately knows nothing about Three.js, input events, or time.
 * CharacterController remains the owner of movement physics; this only turns
 * the rendered result into a visual locomotion state.
 */
export type LocomotionState = 'idle' | 'walk' | 'sprint' | 'crouch-walk' | 'crawl';

export type MovementDirection =
  | 'forward'
  | 'forward-right'
  | 'right'
  | 'back-right'
  | 'back'
  | 'back-left'
  | 'left'
  | 'forward-left';

export interface LocomotionInput {
  /** Rendered horizontal velocity in world metres/second. */
  velocityX: number;
  velocityZ: number;
  grounded: boolean;
  crouched: boolean;
  downed: boolean;
  /** Wire yaw, 1024 units per turn. */
  facingYaw: number;
}

export interface LocomotionResult {
  state: LocomotionState;
  /** Eight-way direction in the character's local frame. */
  direction: MovementDirection;
  /** Horizontal rendered speed in metres/second. */
  speed: number;
  /** Speed normalized against the selected movement mode's configured speed. */
  normalizedSpeed: number;
  /** Normalized gait rate; the pose driver can integrate this into a phase. */
  gaitRate: number;
  /** True when the rendered movement is airborne. */
  airborne: boolean;
  /** Signed local movement angle, where 0 is forward and +PI/4 is right. */
  directionAngle: number;
}

export interface LocomotionSpeeds {
  walkSpeed: number;
  sprintSpeed: number;
  crouchSpeed: number;
  crawlSpeed: number;
}

const SPEED_EPSILON = 0.05;
const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const EIGHTH_PI = Math.PI / 4;

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function wrapAngle(angle: number): number {
  const wrapped = angle % TWO_PI;
  return wrapped < -Math.PI ? wrapped + TWO_PI : wrapped > Math.PI ? wrapped - TWO_PI : wrapped;
}

/**
 * Classify one rendered sample. No state is retained between calls.
 *
 * The direction is computed from rendered velocity relative to the character's
 * facing, so a remote entity uses the same classifier as the local prediction.
 */
export function classifyLocomotion(
  input: LocomotionInput,
  speeds: LocomotionSpeeds,
): LocomotionResult {
  const vx = finite(input.velocityX);
  const vz = finite(input.velocityZ);
  const speed = Math.hypot(vx, vz);

  const yaw = (finite(input.facingYaw) / 1024) * TWO_PI;
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);

  // Forward is +Z. Right is cross(forward, up), which is (-cos(yaw), 0, sin(yaw)).
  const localForward = vz * cosYaw + vx * sinYaw;
  const localRight = -vx * cosYaw + vz * sinYaw;
  const directionAngle = speed > SPEED_EPSILON ? Math.atan2(localRight, localForward) : 0;

  const directionIndex = speed <= SPEED_EPSILON
    ? 0
    : Math.round(wrapAngle(directionAngle) / EIGHTH_PI) & 7;
  const directions: MovementDirection[] = [
    'forward',
    'forward-right',
    'right',
    'back-right',
    'back',
    'back-left',
    'left',
    'forward-left',
  ];

  let state: LocomotionState;
  let modeSpeed: number;
  if (speed <= SPEED_EPSILON) {
    state = 'idle';
    modeSpeed = input.downed ? speeds.crawlSpeed : input.crouched ? speeds.crouchSpeed : speeds.walkSpeed;
  } else if (input.downed) {
    state = 'crawl';
    modeSpeed = speeds.crawlSpeed;
  } else if (input.crouched) {
    state = 'crouch-walk';
    modeSpeed = speeds.crouchSpeed;
  } else {
    // CharacterController chooses the actual speed. We only identify the visual
    // state from that resulting speed; the midpoint prevents a tuned walk speed
    // from being mistaken for a sprint.
    const sprintThreshold = (speeds.walkSpeed + speeds.sprintSpeed) / 2;
    state = speed >= sprintThreshold ? 'sprint' : 'walk';
    modeSpeed = state === 'sprint' ? speeds.sprintSpeed : speeds.walkSpeed;
  }

  const safeModeSpeed = Number.isFinite(modeSpeed) && modeSpeed > 0 ? modeSpeed : 1;
  const normalizedSpeed = Math.min(1, speed / safeModeSpeed);

  return {
    state,
    direction: directions[directionIndex] as MovementDirection,
    speed,
    normalizedSpeed,
    // A renderer integrates this rate with its own frame dt; no clock belongs
    // in the classifier. Zero when stationary makes idle settle cleanly.
    gaitRate: state === 'idle' ? 0 : normalizedSpeed,
    airborne: !input.grounded,
    directionAngle,
  };
}

/** Exposed for tests and pose drivers that need the exact dead-zone. */
export const LOCOMOTION_SPEED_EPSILON = SPEED_EPSILON;
