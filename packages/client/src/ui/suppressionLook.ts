/**
 * What being suppressed looks like (T-3.17).
 *
 * A dark vignette closing in from the edges and the colour draining out of the
 * picture, both scaled by the level the server replicates (T-3.16). Stateless
 * per frame like every other effect: the look is a function of the level and
 * nothing else — no easing, no memory of the last frame — so 30 and 120 fps
 * draw the same picture at the same level, and the picture fades exactly as
 * fast as the server's level decays. The camera jolt a near miss adds is
 * `suppressionJolt` in `camera/cameraShake.ts`; the crosshair's widened gap is
 * `crosshairGapPx` in `crosshair.ts`.
 */

/** Vignette opacity at full suppression. The edges darken; the centre, where you aim, never does. */
export const SUPPRESSION_VIGNETTE_MAX = 0.75;
/** How much colour is taken out at full suppression (CSS `saturate(1 - this)`). */
export const SUPPRESSION_DESATURATION_MAX = 0.6;
/**
 * How far in the vignette's clear centre reaches at zero and at full, as a
 * percentage of the radial gradient: it closes from 70% to 40% of the way out.
 */
export const SUPPRESSION_CLEAR_FROM = 70;
export const SUPPRESSION_CLEAR_TO = 40;

export interface SuppressionLook {
  /** 0..1: opacity of the vignette layer. */
  vignette: number;
  /** 0..100: where the vignette's clear centre ends, percent of the way out. */
  clearPercent: number;
  /** 1 is full colour; lower is greyer. What CSS `saturate()` takes. */
  saturation: number;
}

/**
 * The look at `level` (0..1, clamped). Eased in on a square root so the first
 * near miss already reads — a level of 0.2 is ~45% of the way — and full is
 * full; monotonic throughout, and exactly nothing at zero.
 */
export function suppressionLook(level: number): SuppressionLook {
  const l = level > 0 ? (level < 1 ? level : 1) : 0;
  const e = Math.sqrt(l);
  return {
    vignette: SUPPRESSION_VIGNETTE_MAX * e,
    clearPercent: SUPPRESSION_CLEAR_FROM + (SUPPRESSION_CLEAR_TO - SUPPRESSION_CLEAR_FROM) * e,
    saturation: 1 - SUPPRESSION_DESATURATION_MAX * e,
  };
}

/** Whether a look draws anything at all: at zero, nothing is written and no filter runs. */
export function isQuiet(look: SuppressionLook): boolean {
  return look.vignette === 0 && look.saturation === 1;
}

/** The CSS for the vignette layer's background at a look. */
export function vignetteBackground(look: SuppressionLook): string {
  return `radial-gradient(ellipse at center, rgba(0,0,0,0) ${look.clearPercent.toFixed(1)}%, rgba(0,0,0,1) 100%)`;
}

/**
 * The backdrop filter for the desaturation layer at a look; `none` when quiet,
 * so the compositor does no work. A backdrop filter on a layer of our own
 * rather than a `filter` on the canvas: a filter gives the canvas its own
 * stacking context, which paints it over the vignette laid on top of it.
 */
export function desaturationFilter(look: SuppressionLook): string {
  return look.saturation >= 1 ? 'none' : `saturate(${look.saturation.toFixed(3)})`;
}

/**
 * Writes a look to the page: a fixed full-screen layer holding a
 * desaturating backdrop and the vignette above it. Only on change, as the
 * crosshair is, so a quiet frame touches no style at all.
 */
export class SuppressionOverlay {
  private readonly layer: HTMLDivElement;
  private readonly grey: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  private written = '';

  constructor(parent: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.id = 'suppression';
    this.layer.setAttribute('aria-hidden', 'true');
    this.grey = document.createElement('div');
    this.grey.className = 'suppression-grey';
    this.vignette = document.createElement('div');
    this.vignette.className = 'suppression-vignette';
    this.layer.append(this.grey, this.vignette);
    // First in the page: the canvas is not positioned, so it paints beneath
    // every positioned layer, and among those this one comes first — over the
    // picture, under the reticle, the banners and the panels.
    parent.insertBefore(this.layer, parent.firstChild);
  }

  render(level: number): void {
    const look = suppressionLook(level);
    const quiet = isQuiet(look);
    const key = quiet ? 'quiet' : `${look.vignette.toFixed(3)}|${look.clearPercent.toFixed(1)}|${look.saturation.toFixed(3)}`;
    if (key === this.written) return;
    this.written = key;
    this.layer.style.display = quiet ? 'none' : 'block';
    const filter = desaturationFilter(look);
    this.grey.style.backdropFilter = filter;
    this.grey.style.setProperty('-webkit-backdrop-filter', filter);
    this.vignette.style.opacity = look.vignette.toFixed(3);
    this.vignette.style.background = quiet ? 'none' : vignetteBackground(look);
  }
}
