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
