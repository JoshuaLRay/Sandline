/**
 * Mobile is a property of the device, never of the window: a phone turned to
 * landscape is wider than any width breakpoint but is still a phone (U-037).
 * `?mobile` forces it for emulation; otherwise the primary pointer is coarse.
 */
export function detectMobile(search: string, coarsePointer: boolean): boolean {
  return new URLSearchParams(search).has('mobile') || coarsePointer;
}

/** Mirror the decision onto `<html class="mobile">` so CSS keys off it, not off width. */
export function applyMobileClass(root: HTMLElement, mobile: boolean): void {
  root.classList.toggle('mobile', mobile);
}

export const MOBILE_CAMERA_MIN = 3;

/** Farthest the mobile camera may pull back: 6x the minimum in portrait, 3x in landscape (U-038). */
export function mobileCameraMax(portrait: boolean): number {
  return MOBILE_CAMERA_MIN * (portrait ? 6 : 3);
}

export function clampMobileCameraDistance(distance: number, portrait: boolean): number {
  return Math.max(MOBILE_CAMERA_MIN, Math.min(mobileCameraMax(portrait), distance));
}
