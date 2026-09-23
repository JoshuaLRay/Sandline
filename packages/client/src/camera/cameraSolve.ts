/**
 * The third-person camera solve (T-2.01, E-2.1).
 *
 * Extracted from the render loop, where it had grown into forty lines of
 * arithmetic that no test could reach — and which four separate QA rounds had
 * already found bugs in: a camera that hovered instead of pitching, one that
 * went through the floor looking up, a crosshair sitting on the character, and
 * shots leaving from the wrong place relative to it.
 *
 * WHY PLAIN NUMBERS. No `three` types cross this boundary. The renderer is a
 * view onto replicated state (ADR-004) and must not own it, and a solve stated
 * in numbers runs headless in a test. `main.ts` keeps what is genuinely
 * Three.js bookkeeping: the Euler, the field-of-view ease, and assignment.
 *
 * WHY A CALLER-OWNED TARGET. This runs every frame. Returning fresh objects
 * would allocate four per frame for no reason; the caller keeps one and passes
 * it in. Tests pass a fresh one and read it.
 *
 * ANGLES. Yaw arrives unsigned and already wrapped; pitch arrives SIGNED,
 * because its limits are asymmetric (89 degrees up, 80 down) and a signed
 * accumulator is what makes that expressible. Both are in wire units but NOT
 * rounded to them: the camera is the player's own eye, and it must follow the
 * mouse at the mouse's own resolution. Snapping it to 1/1024 turn (0.35
 * degrees, roughly two pixels of mouse at the default sensitivity) made
 * turning visibly step while movement, interpolated every frame, stayed
 * smooth. Wire precision is for what goes on the wire and for drawing OTHER
 * characters; aim precision is its own path again (note 17).
 */
import { ANGLE_UNITS, WIRE_ANGLE_UNITS, sin } from '@sandline/shared';
import type { CameraConfig } from './cameraConfig.ts';
import { solveCollisionArmLength, type CameraCollider } from './cameraColliders.ts';
import { solveArmLength } from './followCamera.ts';
import { springArmLength } from './springArm.ts';

export interface CameraView {
  /** The character's render position. FEET, as the renderer receives it. */
  x: number;
  y: number;
  z: number;
  /** Yaw in wire-angle units, unsigned, wrapped and fractional (`LocalInput.viewYaw`). */
  yawWire: number;
  /** Pitch in wire-angle units, SIGNED and fractional (`LocalInput.pitch`). */
  pitchWire: number;
  /** Pitch as -1..1 across its current limit. Shapes the arm, not the view. */
  pitchFraction: number;
  ads: boolean;
  firstPerson: boolean;
  /** +1 is right shoulder, -1 is left shoulder. */
  shoulderSide: 1 | -1;
  /** Lying on the ground (T-2.14): the pivot eases down to `downedEyeHeight`. */
  downed?: boolean;
  /** Prone (T-2.41): the pivot eases down to `proneEyeHeight`, on the same curve. */
  prone?: boolean;
  /** Crouched: the pivot eases down to `crouchEyeHeight`. Prone wins if both are set. */
  crouched?: boolean;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraSolve {
  /** Where the camera goes. */
  position: Vec3;
  /** The point the arm orbits: the pivot after the shoulder offset. */
  focus: Vec3;
  /** Unit view direction, +Z forward. What the aim ray is cast along. */
  direction: Vec3;
  /** Yaw-only forward, for turning the character mesh. */
  forward: { x: number; z: number };
  /** Table-angle yaw and pitch, fractional, for the Euler the renderer sets. */
  yawAngle: number;
  pitchAngle: number;
  /** Arm length after shortening. Zero in first person. */
  distance: number;
  /** Smoothed shoulder side: +1 right, -1 left. */
  shoulderBlend: number;
  /** Normalized 0..1 ADS transition shared by distance, shoulder and FOV. */
  adsBlend: number;
  /** Normalized 0..1: how far the pivot has dropped toward the downed height. */
  downedBlend: number;
  /** Normalized 0..1: how far the pivot has dropped toward the prone height. */
  proneBlend: number;
  /** Normalized 0..1: how far the pivot has dropped toward the crouch height. */
  crouchBlend: number;
  /** FOV derived from the same ADS transition. */
  fov: number;
  /**
   * Camera shake (T-2.09): a world-space offset the renderer ADDS to
   * `position` when placing the camera, and a roll for the Euler. Kept apart
   * from `position` so the aim ray, which reads `position` and `direction`,
   * never sees it. Written by `applyShake`; zero otherwise.
   */
  shake: { x: number; y: number; z: number; roll: number };
}

export function createCameraSolve(): CameraSolve {
  return {
    position: { x: 0, y: 0, z: 0 },
    focus: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 0, z: 1 },
    forward: { x: 0, z: 1 },
    yawAngle: 0,
    pitchAngle: 0,
    distance: 0,
    shoulderBlend: 1,
    adsBlend: 0,
    downedBlend: 0,
    proneBlend: 0,
    crouchBlend: 0,
    fov: 60,
    shake: { x: 0, y: 0, z: 0, roll: 0 },
  };
}

/** Wire units, fractional and possibly signed, to table units in [0, ANGLE_UNITS). Never rounded. */
export function fineTableAngle(wire: number): number {
  const t = (wire * (ANGLE_UNITS / WIRE_ANGLE_UNITS)) % ANGLE_UNITS;
  return t < 0 ? t + ANGLE_UNITS : t;
}

/**
 * sin of a fractional table angle: the shared table, interpolated between its
 * neighbouring entries. Exactly the table's value at a whole angle, and
 * continuous between them, so a sub-unit turn moves the view by a sub-unit
 * amount instead of nothing and then a whole step. Linear interpolation over a
 * 4096-entry circle is within ~3e-7 of the true sine.
 */
export function fineSin(a: number): number {
  const i = Math.floor(a);
  const f = a - i;
  const s0 = sin(i);
  return f === 0 ? s0 : s0 + (sin(i + 1) - s0) * f;
}

/**
 * Solve the camera for one frame, writing into `out` and returning it.
 *
 * Structured as pivot -> shoulder -> arm, and in that order for a reason: the
 * arm orbits the SHOULDER point, not the character's centre line. Orbiting the
 * centre and adding the shoulder afterwards moves the aim origin relative to
 * the reticle, which is the shape of the down-and-left bug.
 */
export function solveCamera(
  view: CameraView,
  cfg: CameraConfig,
  out: CameraSolve,
  dtSeconds = 1 / 60,
  collider?: CameraCollider,
): CameraSolve {
  // Pitch is signed; `fineTableAngle` wraps it, or a downward pitch would
  // index the trig table negatively.
  const yawAngle = fineTableAngle(view.yawWire);
  const pitchAngle = fineTableAngle(view.pitchWire);

  const fwdX = fineSin(yawAngle);
  const fwdZ = fineSin(yawAngle + ANGLE_UNITS / 4);
  const cosP = fineSin(pitchAngle + ANGLE_UNITS / 4);

  out.yawAngle = yawAngle;
  out.pitchAngle = pitchAngle;
  out.forward.x = fwdX;
  out.forward.z = fwdZ;

  // The shoulder is a continuous render state, not a binary camera mode.
  // Exponential easing makes the swap frame-rate independent just like the
  // spring arm: 30 and 120 fps traverse the same continuous-time curve.
  const targetShoulder = view.shoulderSide;
  if (dtSeconds > 0) {
    const alpha = 1 - Math.exp(-cfg.shoulderSwapRate * dtSeconds);
    out.shoulderBlend += (targetShoulder - out.shoulderBlend) * alpha;
  } else {
    out.shoulderBlend = targetShoulder;
  }

  // ADS is one normalized transition state. Distance, shoulder offset and FOV
  // all derive from it, so there is no frame where the weapon is "half aimed"
  // but the camera has already snapped one of the other two cues. The same
  // exponential curve is used at every frame rate.
  const targetAds = view.ads ? 1 : 0;
  if (dtSeconds > 0) {
    const alpha = 1 - Math.exp(-12 * dtSeconds);
    out.adsBlend += (targetAds - out.adsBlend) * alpha;
  } else {
    out.adsBlend = targetAds;
  }
  out.fov = cfg.baseFov + (cfg.adsFov - cfg.baseFov) * out.adsBlend;

  // Going down drops the pivot on the same curve; getting up lifts it back.
  // Eased for the same reason as the others: a cut reads as a teleport.
  const targetDowned = view.downed ? 1 : 0;
  if (dtSeconds > 0) {
    const alpha = 1 - Math.exp(-8 * dtSeconds);
    out.downedBlend += (targetDowned - out.downedBlend) * alpha;
  } else {
    out.downedBlend = targetDowned;
  }

  // Going prone drops the pivot the same way: same curve, same rate, its own height.
  const targetProne = view.prone ? 1 : 0;
  if (dtSeconds > 0) {
    const alpha = 1 - Math.exp(-8 * dtSeconds);
    out.proneBlend += (targetProne - out.proneBlend) * alpha;
  } else {
    out.proneBlend = targetProne;
  }

  // Crouching drops it too. Prone beats crouch, as it does in the controller,
  // so the two drops never stack.
  const targetCrouch = view.crouched && !view.prone ? 1 : 0;
  if (dtSeconds > 0) {
    const alpha = 1 - Math.exp(-8 * dtSeconds);
    out.crouchBlend += (targetCrouch - out.crouchBlend) * alpha;
  } else {
    out.crouchBlend = targetCrouch;
  }

  // View direction: the horizontal component shrinks as the pitch steepens.
  const dx = fwdX * cosP;
  const dy = fineSin(pitchAngle);
  const dz = fwdZ * cosP;
  out.direction.x = dx;
  out.direction.y = dy;
  out.direction.z = dz;

  const pivotY =
    view.y +
    cfg.eyeHeight +
    (cfg.downedEyeHeight - cfg.eyeHeight) * out.downedBlend +
    (cfg.proneEyeHeight - cfg.eyeHeight) * out.proneBlend +
    (cfg.crouchEyeHeight - cfg.eyeHeight) * out.crouchBlend;

  if (view.firstPerson) {
    // The eye IS the camera here, so focus and position coincide and there is
    // no arm to shorten. Keeping focus meaningful matters: the aim convergence
    // reads the direction from here in both views.
    out.focus.x = view.x;
    out.focus.y = pivotY;
    out.focus.z = view.z;
    out.position.x = view.x;
    out.position.y = pivotY;
    out.position.z = view.z;
    out.distance = 0;
    return out;
  }

  /**
   * Right is cross(forward, up), which for a Y-up right-handed system and a
   * yaw-only forward reduces to (-fwdZ, 0, fwdX). The same handedness the
   * strafe fix established — getting it backwards puts the camera over the
   * wrong shoulder AND mirrors the aim offset, so it reads as two bugs.
   */
  const shoulder =
    (cfg.shoulderRight + (cfg.shoulderRightAds - cfg.shoulderRight) * out.adsBlend) * out.shoulderBlend;
  out.focus.x = view.x - fwdZ * shoulder;
  out.focus.y = pivotY + cfg.shoulderUp;
  out.focus.z = view.z + fwdX * shoulder;

  const desired =
    cfg.distance *
    (1 + (cfg.adsDistanceScale - 1) * out.adsBlend) *
    (1 - cfg.pitchShorten * Math.abs(view.pitchFraction));

  // Floor clamp: shorten the arm to land the camera ON the floor rather than
  // clamping its position and leaving the view buried. See solveArmLength.
  // The ray points from the shoulder pivot toward the desired camera position.
  // Only static camera scenery belongs in this query; it intentionally differs
  // from the server-authoritative shootable list used for aim convergence.
  const sceneryLimit = solveCollisionArmLength(
    desired,
    out.focus,
    { x: -dx, y: -dy, z: -dz },
    collider,
  );
  const collisionLimit = solveArmLength(sceneryLimit, out.focus.y, dy, cfg);
  out.distance = springArmLength(out.distance, collisionLimit, dtSeconds);

  out.position.x = out.focus.x - dx * out.distance;
  out.position.y = out.focus.y - dy * out.distance;
  out.position.z = out.focus.z - dz * out.distance;
  return out;
}
