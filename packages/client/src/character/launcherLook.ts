/**
 * U-158: what an RPG gunner's launcher looks like this frame, as numbers (the picture is `remoteSoldiers.ts`).
 *
 * Every value is a function of replicated state: the `launcher` bit (the launcher, not the rifle, is in its hands),
 * the `aiming` bit (the wind-up, U-157) and its vitality. The tank's lock reads as a lamp (`tankLook.ts`); a gunner's
 * wind-up reads as two things of its own: the tube coming up from a low carry onto the shoulder, and a pulsing glint
 * on the warhead that stays the same size on screen however far away it is. The launch itself is drawn where the
 * rocket appears (`RemoteSoldiers.launcherNear`, `RocketEffects.launch`), never guessed from the wind-up ending: a
 * wind-up the server calls off (a friend stepped into the way) ends without a rocket, and must not flash.
 */
import * as THREE from 'three';
import type { Vitality } from '@sandline/shared';
import { glowTexture } from '../weapons/rocketFx.ts';

/** Seconds the tube takes to come up onto the shoulder (and to go back down after the launch). */
export const LAUNCHER_RAISE_SECONDS = 0.3;
/** The glint's size on screen at full pulse: a fraction of the view's height at any range (about 25 px at 1080p). */
export const WIND_UP_CUE_SCREEN = 0.034;
/** Metres past the drawn muzzle the glint sits: on the warhead's nose, which stands proud of the tube. */
export const WIND_UP_CUE_FORWARD_M = 0.12;

export interface LauncherFrame {
  /** 0..1: how far the tube is down in the low carry (the rig's `lower`). 0 with no launcher in hand. */
  lower: number;
  /** 0..1: the wind-up's glint, pulsing; 0 when there is none. */
  tell: number;
}

/** Smooth in and out, so the raise reads as a lift rather than a hinge. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/** One gunner's frame-to-frame launcher state: how far the tube is up, and the glint's pulse. */
export class LauncherFx {
  private raised = 0;
  private clock = 0;

  update(input: { launcher: boolean; aiming: boolean; vitality: Vitality }, dt: number): LauncherFrame {
    const alive = input.vitality === 'alive';
    const carried = alive && input.launcher;
    const windUp = carried && input.aiming;
    const step = dt > 0 ? dt / LAUNCHER_RAISE_SECONDS : 0;
    // The rifle out, or a body on the ground: the next launcher starts from the low carry.
    if (!carried) this.raised = 0;
    else this.raised = windUp ? Math.min(1, this.raised + step) : Math.max(0, this.raised - step);
    this.clock += Math.max(0, dt);
    return {
      lower: carried ? 1 - ease(this.raised) : 0,
      // A pulse, so a wind-up reads as a warning and not a lamp left on.
      tell: windUp ? 0.6 + 0.4 * Math.sin(this.clock * 14) ** 2 : 0,
    };
  }
}

/**
 * The wind-up's glint: an additive sprite, the same size on screen at any range, hidden until a frame says
 * otherwise. Its material is its own (each gunner pulses on its own clock); the texture is shared.
 */
export function createWindUpCue(): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: 0xff5a2a,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: false,
  });
  const cue = new THREE.Sprite(material);
  cue.name = 'wind-up cue';
  cue.visible = false;
  return cue;
}

/** Show a frame's glint on the cue. */
export function applyWindUpCue(cue: THREE.Sprite, frame: LauncherFrame): void {
  cue.visible = frame.tell > 0;
  const size = WIND_UP_CUE_SCREEN * (0.55 + 0.45 * frame.tell);
  cue.scale.set(size, size, 1);
  (cue.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.4 + frame.tell);
}
