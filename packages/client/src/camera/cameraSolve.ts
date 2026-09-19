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
 * accumulator is what makes that expressible. Both are wire units and the
 * camera reads them at wire precision, which is deliberate and NOT the
 * precision the aim path uses: replication precision answers how accurately a
 * character must be drawn, aim precision decides where a ray lands at 100 m
 * (note 17). Do not unify them.
 */
import { WIRE_ANGLE_UNITS, cos, sin, wireToTable } from '@sandline/shared';
import type { CameraConfig } from './cameraConfig.ts';
import { solveCollisionArmLength, type CameraCollider } from './cameraColliders.ts';
import { solveArmLength } from './followCamera.ts';
import { springArmLength } from './springArm.ts';

export interface CameraView {
  /** The character's render position. FEET, as the renderer receives it. */
  x: number;
  y: number;
  z: number;
  /** Yaw in wire-angle units, unsigned and wrapped (`LocalInput.yaw`). */
  yawWire: number;
  /** Pitch in wire-angle units, SIGNED (`LocalInput.pitch`). */
  pitchWire: number;
  /** Pitch as -1..1 across its current limit. Shapes the arm, not the view. */
  pitchFraction: number;
  ads: boolean;
  firstPerson: boolean;
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
  /** Table-angle yaw and pitch, for the Euler the renderer sets. */
  yawAngle: number;
  pitchAngle: number;
  /** Arm length after shortening. Zero in first person. */
  distance: number;
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
  };
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
  const yawAngle = wireToTable(view.yawWire);
  /**
   * Pitch is signed; a wire angle is a position on a circle and has no sign.
   * Wrap before converting, or a downward pitch indexes the trig table
   * negatively.
   */
  const pitchAngle = wireToTable(
    ((view.pitchWire % WIRE_ANGLE_UNITS) + WIRE_ANGLE_UNITS) % WIRE_ANGLE_UNITS,
  );

  const fwdX = sin(yawAngle);
  const fwdZ = cos(yawAngle);
  const cosP = cos(pitchAngle);

  out.yawAngle = yawAngle;
  out.pitchAngle = pitchAngle;
  out.forward.x = fwdX;
  out.forward.z = fwdZ;

  // View direction: the horizontal component shrinks as the pitch steepens.
  const dx = fwdX * cosP;
  const dy = sin(pitchAngle);
  const dz = fwdZ * cosP;
  out.direction.x = dx;
  out.direction.y = dy;
  out.direction.z = dz;

  const pivotY = view.y + cfg.eyeHeight;

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
  const shoulder = view.ads ? cfg.shoulderRightAds : cfg.shoulderRight;
  out.focus.x = view.x - fwdZ * shoulder;
  out.focus.y = pivotY + cfg.shoulderUp;
  out.focus.z = view.z + fwdX * shoulder;

  const desired =
    cfg.distance *
    (view.ads ? cfg.adsDistanceScale : 1) *
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
