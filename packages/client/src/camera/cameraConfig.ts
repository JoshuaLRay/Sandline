/**
 * Third-person camera constants, as a live config rather than module constants.
 *
 * Same reasoning as DEFAULT_MOVE_CONFIG: these are guesses, and the only way to
 * find the right ones is to move them while looking at the result. Camera feel
 * is also the thing the first QA pass had most to say about, so it gets the
 * same treatment movement did.
 */
export interface CameraConfig {
  /** Pivot height — roughly the eyes of a 1.8 m soldier. */
  eyeHeight: number;
  /** Pivot height while downed (T-2.14): the view of someone lying on the ground. */
  downedEyeHeight: number;
  /** Arm length before any shortening. */
  distance: number;
  /** Over-the-shoulder offset, hip and aimed. */
  shoulderRight: number;
  shoulderRightAds: number;
  shoulderUp: number;
  /** How much the arm shortens at full pitch, as a fraction. */
  pitchShorten: number;
  /** Arm length multiplier while aiming. */
  adsDistanceScale: number;
  /** Exponential rate for easing the shoulder swap, in reciprocal seconds. */
  shoulderSwapRate: number;
  /** Floor guard: lowest world Y the camera may occupy, and the shortest arm. */
  minCameraY: number;
  minDistance: number;
  /** Field of view, hip and aimed. Narrowing it is the aim cue. */
  baseFov: number;
  adsFov: number;
  /** Camera shake scale (T-2.09): 1 is the weapon's full jolt, 0 is none. */
  shakeScale: number;
}

export const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  eyeHeight: 1.55,
  downedEyeHeight: 0.55,
  distance: 5.5,
  shoulderRight: 0.85,
  shoulderRightAds: 0.55,
  shoulderUp: 0.3,
  pitchShorten: 0.35,
  adsDistanceScale: 0.6,
  shoulderSwapRate: 14,
  minCameraY: 0.3,
  minDistance: 1.0,
  baseFov: 60,
  adsFov: 38,
  shakeScale: 1,
};
