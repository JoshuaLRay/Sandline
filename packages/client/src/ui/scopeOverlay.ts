/**
 * The marksman's scope, looked through.
 *
 * A rifle scope cannot be drawn as a model held in front of the eye: its
 * tube and lenses fill the view, which is what made the DMR unusable at
 * ADS. So once the rifle is shouldered the page does what every shooter
 * does: the rifle is hidden (`ViewModel`), the world's field of view
 * narrows to the scope's (`scopeFovDeg` in weapons.json), and this draws
 * the eyepiece over it — black outside the lens, a fine reticle across it,
 * its centre the screen's centre, which is where the shot goes.
 */

/** How far into the ADS blend the eye is at the eyepiece and the scope's view replaces the rifle. */
export const SCOPE_IN = 0.85;

/**
 * The world's field of view with a scope up: the camera's own ease toward
 * ADS, carried on to the scope's field instead of the iron-sight one.
 */
export function scopedFov(baseFov: number, scopeFov: number, adsBlend: number): number {
  const t = Math.max(0, Math.min(1, adsBlend));
  return baseFov + (scopeFov - baseFov) * t;
}

/** How much slower the look turns through the scope, so the reticle crosses the picture as fast as at the hip. */
export function scopedLookScale(baseFov: number, fov: number): number {
  if (!(baseFov > 0) || !(fov > 0)) return 1;
  return Math.min(1, Math.tan((fov * Math.PI) / 360) / Math.tan((baseFov * Math.PI) / 360));
}

export class ScopeOverlay {
  readonly element: HTMLDivElement;

  constructor(parent: HTMLElement = document.body) {
    this.element = document.createElement('div');
    this.element.id = 'scope';
    this.element.setAttribute('aria-hidden', 'true');
    for (const part of ['lens', 'wire h', 'wire v', 'post left', 'post right', 'post down', 'dot']) {
      const span = document.createElement('span');
      span.className = part;
      this.element.appendChild(span);
    }
    parent.appendChild(this.element);
  }

  /** Up or down, this frame. */
  set(up: boolean): void {
    if (this.element.classList.contains('up') !== up) this.element.classList.toggle('up', up);
  }

  get up(): boolean {
    return this.element.classList.contains('up');
  }
}
