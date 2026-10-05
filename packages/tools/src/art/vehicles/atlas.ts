/**
 * U-126: the vehicle atlas (ADR-018, ADR-020). One 1024² diffuse for a tank.
 *
 * Most of it is THREE PAINT SHEETS. The armour is mapped by projection, not
 * unwrapped. A face looking mostly sideways takes the SIDE sheet at its
 * (z, y), one looking up or down takes the TOP sheet at (z, x), and one
 * looking forward or back takes the FRONT sheet at (x, y). Every texel of a
 * sheet is a known place on the vehicle, so the painter can work by place:
 *   - dust thickest low on the hull, where the tracks throw it;
 *   - mud on the fenders;
 *   - rain streaks running down;
 *   - a cast roughness on the turret's band of the side sheet;
 *   - a dark ring round the turret on the roof.
 * The cast dome is painted as one piece from the top sheet, where its footprint is (`TurretFootprint`), so no seam
 * between sheets crosses its curve.
 * Both sides share the side sheet, and the turret takes its texels at its
 * forward-facing rest pose, so it reads the same wherever it is turned.
 *
 * The rest is SIXTEEN CELLS of 128 × 88. They hold what is not armour plate,
 * mapped per part (`mesh.ts`): track links, a road wheel's face and tyre,
 * the sprocket, bare steel, the engine-deck louvres, canvas, a lens, the
 * unditching log, rubber, the gun's paint, the bore and tow cable.
 *
 * The paint is faded, dusty ex-Soviet green. The tank is old stock in the
 * enemy's hands (ADR-020), not a US desert scheme, and it carries no marking.
 */
import { PNG } from 'pngjs';
import { rng, tiledFbm, tiledNoise } from '../noise.ts';

export const VEHICLE_ATLAS_SIZE = 1024;

/** The paint sheets' extents, metres in the vehicle's frame (origin at its feet, +Z forward, +X its left). */
export const SHEET_Z: readonly [number, number] = [-3.0, 3.0];
export const SHEET_X = 1.35;
export const SHEET_Y = 3.0;

export type Sheet = 'side' | 'top' | 'front';

export const CELLS = ['track', 'trackInner', 'wheel', 'tyre', 'sprocket', 'steel', 'grille', 'tarp', 'canvas', 'lens', 'wood', 'rubber', 'barrel', 'bore', 'cable', 'olive'] as const;
export type VehicleCell = (typeof CELLS)[number];

export interface Rect {
  /** Pixels: the region's left, top, width and height in the atlas. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const SHEETS: Record<Sheet, Rect> = {
  side: { x: 0, y: 0, w: 1024, h: 352 },
  top: { x: 0, y: 352, w: 1024, h: 320 },
  front: { x: 0, y: 672, w: 512, h: 352 },
};
const CELL_W = 128;
const CELL_H = 88;
const CELL_ORIGIN = { x: 512, y: 672 };
/** Texels kept clear at every region's edge, so filtering stays inside it. */
const INSET = 3;

export function sheetRect(sheet: Sheet): Rect {
  return SHEETS[sheet];
}

export function cellRect(cell: VehicleCell): Rect {
  const i = CELLS.indexOf(cell);
  return { x: CELL_ORIGIN.x + (i % 4) * CELL_W, y: CELL_ORIGIN.y + Math.floor(i / 4) * CELL_H, w: CELL_W, h: CELL_H };
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/** (fa, fb) in [0, 1] across a region to a glTF UV, with fb = 1 at the region's top. */
export function regionUv(r: Rect, fa: number, fb: number): [number, number] {
  const S = VEHICLE_ATLAS_SIZE;
  const u = (r.x + INSET + (r.w - 2 * INSET) * clamp01(fa)) / S;
  const v = (r.y + INSET + (r.h - 2 * INSET) * (1 - clamp01(fb))) / S;
  return [u, v];
}

/** The sheet a face takes its paint from, by the way it faces. */
export function sheetFor(n: readonly number[]): Sheet {
  const [ax, ay, az] = [Math.abs(n[0]!), Math.abs(n[1]!), Math.abs(n[2]!)];
  if (ay >= ax && ay >= az) return 'top';
  return ax >= az ? 'side' : 'front';
}

/** A point on the vehicle (its frame, metres) to the UV of its texel on a sheet. */
export function sheetUv(sheet: Sheet, p: readonly number[]): [number, number] {
  const fz = (p[2]! - SHEET_Z[0]) / (SHEET_Z[1] - SHEET_Z[0]);
  const fx = (p[0]! + SHEET_X) / (2 * SHEET_X);
  const fy = p[1]! / SHEET_Y;
  if (sheet === 'top') return regionUv(SHEETS.top, fz, fx);
  if (sheet === 'side') return regionUv(SHEETS.side, fz, fy);
  return regionUv(SHEETS.front, fx, fy);
}

/** Every region a UV may land in, as UV rectangles, for the tests. */
export function uvRects(): { u0: number; v0: number; u1: number; v1: number }[] {
  const S = VEHICLE_ATLAS_SIZE;
  return [...Object.values(SHEETS), ...CELLS.map(cellRect)].map((r) => ({
    u0: (r.x + INSET) / S,
    v0: (r.y + INSET) / S,
    u1: (r.x + r.w - INSET) / S,
    v1: (r.y + r.h - INSET) / S,
  }));
}

/* -- Painting ------------------------------------------------------------ */

type Rgb = [number, number, number];
const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => {
  const k = clamp01(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
};
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

const OLIVE: Rgb = [94, 99, 64];
const OLIVE_DARK: Rgb = [66, 72, 46];
const DUST: Rgb = [176, 158, 122];
const MUD: Rgb = [118, 100, 74];
const CHIP: Rgb = [56, 54, 48];
const STEEL: Rgb = [70, 70, 68];
const RUBBER: Rgb = [40, 38, 36];

/** A large period, so the projected sheets never visibly repeat. */
const P = 256;

/** Faded paint: sun-bleached in broad patches, slightly mottled. */
function paint(a: number, b: number, seed: number): Rgb {
  const fade = tiledFbm(seed, a * 0.8, b * 0.8, P, 4);
  const fine = tiledNoise(seed + 7, a * 9, b * 9, P);
  return shade(mix(OLIVE_DARK, OLIVE, 0.25 + fade * 0.9), 0.95 + fine * 0.1);
}

/** Small dark chips through the paint, and a lighter scratch now and then. */
function chips(c: Rgb, a: number, b: number, seed: number): Rgb {
  const n = tiledNoise(seed, a * 26, b * 26, P);
  if (n > 0.92) return mix(c, CHIP, 0.6);
  const s = tiledNoise(seed + 3, a * 40, b * 4, P);
  if (s > 0.95) return shade(c, 1.12);
  return c;
}

/** Rain and grime: thin streaks running down a vertical face. */
function streaks(c: Rgb, along: number, y: number, seed: number): Rgb {
  const s = tiledNoise(seed, along * 22, y * 1.4, P) * 0.7 + tiledNoise(seed + 1, along * 60, y * 2, P) * 0.3;
  const dark = smoothstep(0.58, 0.78, s);
  return shade(c, 1 - dark * 0.16);
}

function paintSide(z: number, y: number, g: number): Rgb {
  let c = paint(z, y, 11);
  c = streaks(c, z, y, 31);
  const turret = y > 1.47;
  if (turret) {
    // Cast armour: a coarser surface than the rolled plate, and dust settled where it meets the roof.
    c = shade(c, 0.93 + tiledNoise(41, z * 34, y * 34, P) * 0.12);
    c = mix(c, DUST, 0.12 + smoothstep(1.66, 1.47, y) * 0.35);
  } else {
    // Thrown up by the tracks: thick low down, thinning up the side, in uneven patches.
    const patches = tiledFbm(53, z * 1.6, y * 3, P, 3);
    const low = smoothstep(1.2, 0.45, y);
    c = mix(c, DUST, low * (0.45 + patches * 0.5) + 0.1);
    if (y < 1.05 && tiledNoise(59, z * 30, y * 30, P) > 0.8) c = mix(c, MUD, 0.5);
  }
  c = chips(c, z, y, 61);
  return shade(c, 0.97 + g * 0.06);
}

/** Where the turret stands on the roof, seen from above: its dome is painted from the top sheet as one piece. */
export interface TurretFootprint {
  x: number;
  z: number;
  /** The dome's base radius. */
  r: number;
}

function paintTop(z: number, x: number, g: number, turret: TurretFootprint): Rgb {
  const rho = Math.hypot(x - turret.x, z - turret.z);
  if (rho < turret.r) {
    // The cast dome, seen from above: its crown in the middle, its steep lower band squeezed into the ring at the
    // edge. That ring is stretched down the dome's side, so only broad variation goes there: fine noise would
    // stretch into lines.
    const edge = smoothstep(0.7, 0.92, rho / turret.r);
    const fine = 1 - edge;
    let c = paint(z * 1.1, x * 1.1, 19);
    c = shade(c, 1 + (tiledNoise(43, z * 30, x * 30, P) - 0.5) * 0.12 * fine);
    const crown = 1 - rho / turret.r;
    c = mix(c, DUST, 0.1 + crown * 0.25 + tiledFbm(47, z * 2, x * 2, P, 3) * 0.12);
    c = shade(c, 1 - smoothstep(0.8, 1, rho / turret.r) * 0.14);
    if (fine > 0.5) c = chips(c, z, x, 53);
    return shade(c, 1 + (g - 0.5) * 0.06 * fine);
  }
  let c = paint(z * 1.1, x * 1.1, 17);
  // Flat faces hold dust; it gathers in drifts.
  const drift = tiledFbm(71, z * 1.3, x * 1.3, P, 4);
  c = mix(c, DUST, 0.2 + smoothstep(0.45, 0.8, drift) * 0.4);
  // Fenders ride over the tracks and are caked.
  const fender = smoothstep(0.92, 1.0, Math.abs(x));
  if (fender > 0) {
    c = mix(c, DUST, fender * (0.25 + tiledFbm(75, z * 3, x * 3, P, 3) * 0.3));
    if (tiledNoise(73, z * 24, x * 24, P) > 0.74) c = mix(c, MUD, fender * 0.45);
  }
  // Dirt in the gap round the turret ring, on the roof.
  const ring = Math.abs(rho - turret.r * 1.07);
  c = shade(c, 1 - smoothstep(0.08, 0.0, ring) * 0.3);
  c = chips(c, z, x, 79);
  return shade(c, 0.97 + g * 0.06);
}

function paintFront(x: number, y: number, g: number): Rgb {
  let c = paint(x * 1.2 + 40, y, 23);
  c = streaks(c, x, y, 83);
  const low = smoothstep(1.15, 0.4, y);
  c = mix(c, DUST, 0.12 + low * (0.4 + tiledFbm(89, x * 2, y * 3, P, 3) * 0.4));
  if (y < 1.0 && tiledNoise(97, x * 28, y * 28, P) > 0.78) c = mix(c, MUD, 0.5);
  c = chips(c, x, y, 101);
  return shade(c, 0.97 + g * 0.06);
}

/** A disc cell: distance from the centre (0 to 1 at the cell's edge) and the angle. */
function disc(u: number, v: number): { d: number; a: number } {
  const dx = (u - 0.5) * 2;
  const dy = (v - 0.5) * 2;
  return { d: Math.sqrt(dx * dx + dy * dy), a: Math.atan2(dy, dx) };
}

const PAINT_CELL: Record<VehicleCell, (u: number, v: number, g: number) => Rgb> = {
  track(u, v, g) {
    // One link along u: the gap between links at its ends, the grouser bar across its middle, pins at the edges.
    let c: Rgb = mix([60, 56, 50], [92, 66, 46], tiledNoise(103, u * 6, v * 6, 6) * 0.5);
    if (Math.abs(u - 0.5) < 0.13) c = mix([104, 100, 92], c, Math.abs(u - 0.5) / 0.13);
    if (u < 0.07 || u > 0.93) c = [26, 25, 23];
    if (v < 0.08 || v > 0.92) c = (u > 0.3 && u < 0.7) || u < 0.07 || u > 0.93 ? [112, 106, 96] : [44, 42, 38];
    c = mix(c, DUST, 0.18 + tiledNoise(107, u * 8, v * 8, 8) * 0.25);
    return shade(c, 0.94 + g * 0.12);
  },
  trackInner(u, v, g) {
    let c: Rgb = [50, 47, 42];
    if (Math.abs(v - 0.5) < 0.09) c = [96, 92, 84];
    if (u < 0.07 || u > 0.93) c = [24, 23, 21];
    return shade(mix(c, DUST, 0.15), 0.94 + g * 0.12);
  },
  wheel(u, v, g) {
    const { d, a } = disc(u, v);
    let c: Rgb;
    if (d > 0.86) c = RUBBER;
    else if (d > 0.82) c = shade(OLIVE_DARK, 0.8);
    else if (d > 0.22) {
      // A pressed steel dish with five ribs, painted.
      const rib = Math.cos(a * 5);
      c = shade(OLIVE, rib > 0.55 ? 1.12 : rib < -0.2 ? 0.86 : 1);
      if (Math.abs(d - 0.5) < 0.02) c = shade(c, 0.85);
    } else if (d > 0.12) {
      // The hub flange and its eight bolts.
      c = shade(OLIVE_DARK, 0.9);
      for (let k = 0; k < 8; k++) {
        const ba = (k / 8) * Math.PI * 2;
        const bx = Math.cos(ba) * 0.17 - Math.cos(a) * d;
        const by = Math.sin(ba) * 0.17 - Math.sin(a) * d;
        if (bx * bx + by * by < 0.025 * 0.025) c = [110, 106, 94];
      }
    } else c = [52, 50, 44];
    c = mix(c, DUST, 0.1 + smoothstep(0.3, 1, d) * 0.2 + tiledNoise(109, u * 10, v * 10, 10) * 0.12);
    return shade(c, 0.94 + g * 0.12);
  },
  tyre(u, v, g) {
    const tread = Math.abs(((v * 6) % 1) - 0.5) < 0.08 ? 0.85 : 1;
    return shade(mix(RUBBER, DUST, 0.35 + tiledNoise(113, u * 16, v * 4, 16) * 0.3), tread * (0.94 + g * 0.12));
  },
  sprocket(u, v, g) {
    const { d, a } = disc(u, v);
    let c: Rgb;
    if (d > 0.8) c = [118, 112, 100];
    else if (d > 0.3) c = shade(OLIVE_DARK, Math.cos(a * 6) > 0.6 ? 0.8 : 1);
    else if (d > 0.18) c = [96, 92, 84];
    else c = [48, 46, 42];
    return shade(mix(c, DUST, 0.3), 0.94 + g * 0.12);
  },
  steel(u, v, g) {
    const wear = tiledFbm(127, u * 4, v * 4, 4, 3);
    return shade(mix(STEEL, [118, 116, 110], smoothstep(0.6, 0.8, wear)), 0.92 + g * 0.14);
  },
  grille(u, v, g) {
    // Louvres across the engine deck: slats along u, a frame round them, dust in the gaps.
    const frame = u < 0.05 || u > 0.95 || v < 0.07 || v > 0.93;
    if (frame) return shade(mix(OLIVE, DUST, 0.35), 0.94 + g * 0.1);
    const slat = (u * 12) % 1 < 0.6;
    const c: Rgb = slat ? mix(OLIVE, DUST, 0.3 + tiledNoise(131, u * 12, v * 6, 12) * 0.3) : [30, 29, 26];
    return shade(c, 0.94 + g * 0.1);
  },
  tarp(u, v, g) {
    const fold = 0.85 + 0.15 * Math.sin(u * Math.PI * 2 * 3 + tiledNoise(137, u * 4, v * 4, 4) * 3);
    return shade(mix([118, 110, 80], DUST, 0.2), fold * (0.95 + g * 0.08));
  },
  canvas(u, v, g) {
    // The gun's dust cover: canvas gathered into folds round the barrel.
    const fold = 0.82 + 0.18 * Math.sin(u * Math.PI * 2 * 7 + v * 2);
    return shade(mix([108, 104, 80], DUST, 0.25 + v * 0.15), fold * (0.95 + g * 0.08));
  },
  lens(u, v, g) {
    const { d } = disc(u, v);
    const glint = u < 0.42 && v > 0.58 && d < 0.6 ? 1.8 : 1;
    return d > 0.86 ? shade(STEEL, 0.8) : shade([34, 42, 48], glint * (0.9 + g * 0.1));
  },
  wood(u, v, g) {
    const grain = tiledNoise(139, u * 3, v * 24, 3) * 0.25 + tiledNoise(149, u * 24, v * 3, 24) * 0.1;
    return shade(mix([98, 74, 50], DUST, 0.2), 0.78 + grain + g * 0.06);
  },
  rubber(u, v, g) {
    return shade(mix(RUBBER, DUST, 0.25), 0.94 + g * 0.1);
  },
  barrel(u, v, g) {
    // The gun's paint along v (breech to muzzle): streaked along its length, sooted toward the muzzle.
    let c = mix(OLIVE_DARK, OLIVE, 0.5 + tiledFbm(151, u * 2, v * 8, 2, 3) * 0.6);
    c = shade(c, 1 - smoothstep(0.55, 0.75, tiledNoise(157, u * 12, v * 2, 12)) * 0.12);
    c = mix(c, DUST, 0.1 + (u > 0.6 && u < 0.9 ? 0.15 : 0));
    c = mix(c, [36, 34, 30], smoothstep(0.86, 1, v) * 0.8);
    return shade(c, 0.95 + g * 0.08);
  },
  bore(u, v) {
    const { d } = disc(u, v);
    return d > 0.8 ? [52, 50, 46] : [12, 12, 12];
  },
  cable(u, v, g) {
    const twist = ((u + v * 6) * 4) % 1 < 0.5;
    return shade(twist ? [92, 88, 80] : [52, 50, 46], 0.94 + g * 0.1);
  },
  olive(u, v, g) {
    return shade(chips(mix(paint(u * 2, v * 2, 163), DUST, 0.25), u, v, 167), 0.95 + g * 0.08);
  },
};

export function paintVehicleAtlas(turret: TurretFootprint): Uint8Array {
  const S = VEHICLE_ATLAS_SIZE;
  const out = new Uint8Array(S * S * 4);
  const put = (x: number, y: number, c: Rgb) => {
    const o = (y * S + x) * 4;
    out[o] = byte(c[0]);
    out[o + 1] = byte(c[1]);
    out[o + 2] = byte(c[2]);
    out[o + 3] = 255;
  };
  // Inside a region's inset, (fa, fb) run 0 to 1 exactly as `regionUv` maps them; the inset itself repeats the edge.
  const each = (r: Rect, salt: number, fn: (fa: number, fb: number, g: number) => Rgb) => {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const fa = clamp01((x + 0.5 - r.x - INSET) / (r.w - 2 * INSET));
        const fb = 1 - clamp01((y + 0.5 - r.y - INSET) / (r.h - 2 * INSET));
        const g = rng((x * 73856093) ^ (y * 19349663) ^ salt)();
        put(x, y, fn(fa, fb, g));
      }
    }
  };
  each(SHEETS.side, 1, (fa, fb, g) => paintSide(SHEET_Z[0] + fa * (SHEET_Z[1] - SHEET_Z[0]), fb * SHEET_Y, g));
  each(SHEETS.top, 2, (fa, fb, g) => paintTop(SHEET_Z[0] + fa * (SHEET_Z[1] - SHEET_Z[0]), -SHEET_X + fb * 2 * SHEET_X, g, turret));
  each(SHEETS.front, 3, (fa, fb, g) => paintFront(-SHEET_X + fa * 2 * SHEET_X, fb * SHEET_Y, g));
  CELLS.forEach((cell, i) => each(cellRect(cell), 100 + i, PAINT_CELL[cell]));
  return out;
}

export function vehicleAtlasPng(turret: TurretFootprint): Uint8Array {
  const png = new PNG({ width: VEHICLE_ATLAS_SIZE, height: VEHICLE_ATLAS_SIZE });
  png.data = Buffer.from(paintVehicleAtlas(turret));
  return new Uint8Array(PNG.sync.write(png));
}

const byte = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));
