/**
 * The crosshair's gap (moved out of `main.ts` for T-3.17, so it can be tested).
 *
 * The gap in pixels for a cone half-angle, at the current field of view and
 * viewport height: the on-screen radius of the cone at the centre of the view.
 * This is what makes the reticle honest — the gap is the inaccuracy, drawn at
 * the size it actually has on screen, so bloom opening the cone visibly opens
 * the arms, and so does suppression (T-3.16/T-3.17): the cone passed in is
 * the one the weapon fires with at the replicated level.
 */
export function crosshairGapPx(coneHalfDeg: number, fovDeg: number, viewportHeightPx: number): number {
  const half = viewportHeightPx / 2;
  return (Math.tan((coneHalfDeg * Math.PI) / 180) / Math.tan((fovDeg * Math.PI) / 360)) * half;
}
