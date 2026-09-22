import * as THREE from 'three';
import RAW_PALETTES from './soldierPalette.json' with { type: 'json' };

/**
 * The soldier's one diffuse atlas, generated (T-2.30).
 *
 * WHY A GENERATED `DataTexture` AND NOT AN IMAGE. The era this project targets
 * — early-2000s console squad shooter, the fidelity ADR-013 budgets for — put
 * a character's entire detail budget in one small hand-painted diffuse map:
 * webbing, pouches, seams, boot cuffs, a painted face, shading baked into the
 * texels. The geometry carried the silhouette and nothing else. T-2.22 built
 * the silhouette and stopped there, so the soldier reads as untextured
 * geometry, because that is exactly what it is.
 *
 * Painting that map into a `Uint8Array` with arithmetic keeps four promises at
 * once, which is why it wins over shipping a PNG:
 *
 *   - It needs no DOM. Client tests run under `environment: 'node'`, where
 *     `document.createElement('canvas')` throws and `CanvasTexture` with it,
 *     and every soldier test builds a soldier. A `DataTexture` is a typed
 *     array and a size; it touches the GPU only at draw time.
 *   - It needs no asset pipeline. There is no `TextureLoader`, no `public/`
 *     and no image anywhere in this client; an image file would be E-4.1
 *     arriving three milestones early, and standing rule 3 would want an ADR
 *     and a licence for it.
 *   - It adds nothing to the <80 MB initial download (§2.2).
 *   - A test can assert a texel. The cheap path and the testable path are the
 *     same path here, which is rare enough to say out loud.
 *
 * PS2, NOT PS1. The usual "retro 3D" kit is the wrong console and would read
 * as a bug rather than a style: no vertex jitter, no affine texture warping,
 * no 320x240. What the era actually looked like is a low-poly silhouette, ONE
 * small point-filtered diffuse doing all the detail work, and a narrow
 * palette. Hence 256x256, `NearestFilter` magnification, and every colour in
 * `soldierPalette.json` rather than in this file (standing rule 4).
 *
 * THE LAYOUT IS A 4x4 GRID OF 64px CELLS, one per body part, and `weld()` in
 * `humanoidSoldier.ts` remaps each primitive's own UVs into its cell. Texel
 * rows count from the BOTTOM: `DataTexture` defaults to `flipY = false`, so
 * row 0 is v = 0, which is the same way the primitives' UVs read.
 */

/** Atlas edge, texels. One 256² diffuse is the era's whole character budget. */
export const ATLAS_SIZE = 256;
/** Cell edge, texels: a 4x4 grid of body parts. */
export const CELL_SIZE = 64;

export type CellName =
  | 'face'
  | 'helmet'
  | 'torsoFront'
  | 'torsoBack'
  | 'vest'
  | 'belt'
  | 'sleeve'
  | 'glove'
  | 'trouser'
  | 'boot'
  | 'neck'
  | 'rifle'
  | 'pack'
  | 'pouch'
  | 'uniformPlain'
  | 'gearPlain';

/** Cell origins in texels, x from the left and y from the BOTTOM. */
export const CELLS: Record<CellName, { x: number; y: number }> = {
  face: { x: 0, y: 192 },
  helmet: { x: 64, y: 192 },
  torsoFront: { x: 128, y: 192 },
  torsoBack: { x: 192, y: 192 },
  vest: { x: 0, y: 128 },
  belt: { x: 64, y: 128 },
  sleeve: { x: 128, y: 128 },
  glove: { x: 192, y: 128 },
  trouser: { x: 0, y: 64 },
  boot: { x: 64, y: 64 },
  neck: { x: 128, y: 64 },
  rifle: { x: 192, y: 64 },
  pack: { x: 0, y: 0 },
  pouch: { x: 64, y: 0 },
  uniformPlain: { x: 128, y: 0 },
  gearPlain: { x: 192, y: 0 },
};

export type PaletteName = keyof typeof RAW_PALETTES.palettes;
export type SoldierPalette = Record<PaletteColorName, string>;

type PaletteColorName =
  | 'skin'
  | 'skinShade'
  | 'uniform'
  | 'uniformLight'
  | 'uniformShade'
  | 'webbing'
  | 'webbingShade'
  | 'gear'
  | 'gearShade'
  | 'boot'
  | 'bootShade'
  | 'metal'
  | 'metalShade'
  | 'accent';

export const PALETTES: Record<PaletteName, SoldierPalette> = RAW_PALETTES.palettes;

/** Every palette name in the data, for a caller that wants to walk them. */
export function paletteNames(): PaletteName[] {
  return Object.keys(PALETTES) as PaletteName[];
}

type RGB = [number, number, number];

function rgbOf(hex: string): RGB {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * A deterministic value in [0, 1) for a texel. The grain the era painted by
 * hand, reproduced the one way a test can assert a pixel: a spatial hash, not
 * a sequence, so a texel's noise never depends on the order cells are painted.
 */
function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Cell-local painting, so a part's art reads in its own 0..63 coordinates. */
class Cell {
  constructor(
    private readonly data: Uint8Array,
    private readonly originX: number,
    private readonly originY: number,
  ) {}

  /** One texel, cell-local, y from the bottom. Out-of-cell writes are dropped. */
  px(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= CELL_SIZE || y >= CELL_SIZE) return;
    const i = ((this.originY + y) * ATLAS_SIZE + this.originX + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = 255;
  }

  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let j = y; j < y + h; j += 1) for (let i = x; i < x + w; i += 1) this.px(i, j, c);
  }

  fill(c: RGB): void {
    this.rect(0, 0, CELL_SIZE, CELL_SIZE, c);
  }

  /** A one-texel outline, the era's cheapest way to separate two shapes. */
  outline(x: number, y: number, w: number, h: number, c: RGB): void {
    this.rect(x, y, w, 1, c);
    this.rect(x, y + h - 1, w, 1, c);
    this.rect(x, y, 1, h, c);
    this.rect(x + w - 1, y, 1, h, c);
  }

  /**
   * Per-texel grain, as a signed nudge of each channel. Keeps a flat fill from
   * reading as a flat fill without costing a second material or a second map.
   */
  grain(x: number, y: number, w: number, h: number, amount: number): void {
    for (let j = y; j < y + h; j += 1) {
      for (let i = x; i < x + w; i += 1) {
        if (i < 0 || j < 0 || i >= CELL_SIZE || j >= CELL_SIZE) continue;
        const k = ((this.originY + j) * ATLAS_SIZE + this.originX + i) * 4;
        const n = (hash2(this.originX + i, this.originY + j) - 0.5) * 2 * amount;
        for (let ch = 0; ch < 3; ch += 1) {
          const v = this.data[k + ch]! + n;
          this.data[k + ch] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
        }
      }
    }
  }

  /** A horizontal band with a darker edge under it: a seam, a cuff, a strap. */
  band(y: number, h: number, c: RGB, edge: RGB): void {
    this.rect(0, y, CELL_SIZE, h, c);
    this.rect(0, y - 1, CELL_SIZE, 1, edge);
    this.rect(0, y + h, CELL_SIZE, 1, edge);
  }
}

/**
 * Paint every cell. Pure arithmetic over a `Uint8Array`: the same palette in
 * gives the same bytes out, on any engine, in Node and in the browser alike.
 *
 * The art is authored against each primitive's own UV convention, which is
 * what makes a 64px square land on the right part of a limb:
 *   - Box faces each map the whole cell, in the order +X, -X, +Y, -Y, +Z, -Z.
 *   - Capsules and cylinders run `v` along the length, 0 at the lower end, so
 *     a cuff is a band at the bottom of the cell.
 *   - Spheres put the soldier's front at `u = 0.25` and the top at `v = 1`,
 *     which is why the face's eyes sit a quarter of the way across.
 */
export function paintSoldierAtlas(palette: SoldierPalette): Uint8Array {
  const data = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  const skin = rgbOf(palette.skin);
  const skinShade = rgbOf(palette.skinShade);
  const uniform = rgbOf(palette.uniform);
  const uniformLight = rgbOf(palette.uniformLight);
  const uniformShade = rgbOf(palette.uniformShade);
  const webbing = rgbOf(palette.webbing);
  const webbingShade = rgbOf(palette.webbingShade);
  const gear = rgbOf(palette.gear);
  const gearShade = rgbOf(palette.gearShade);
  const boot = rgbOf(palette.boot);
  const bootShade = rgbOf(palette.bootShade);
  const metal = rgbOf(palette.metal);
  const metalShade = rgbOf(palette.metalShade);
  const accent = rgbOf(palette.accent);
  const cell = (name: CellName): Cell => new Cell(data, CELLS[name].x, CELLS[name].y);

  // -- Face. The sphere puts the soldier's front at u = 0.25, so 16 texels
  // across is the middle of the face; the helmet's rim crosses the head at
  // about v = 0.45, so everything that reads has to sit BELOW y = 27. The
  // front of the head spans roughly sixty degrees of the wrap — eleven of
  // these texels — which is the whole budget the eyes, nose and mouth share. --
  const face = cell('face');
  face.fill(skin);
  face.grain(0, 0, CELL_SIZE, CELL_SIZE, 10);
  face.rect(0, 27, CELL_SIZE, CELL_SIZE - 27, skinShade); // scalp, under the helmet
  face.rect(0, 24, CELL_SIZE, 3, skinShade); // the brim's shadow across the brow
  face.rect(13, 21, 2, 2, metalShade); // right eye
  face.rect(18, 21, 2, 2, metalShade); // left eye
  face.rect(16, 16, 1, 4, skinShade); // nose
  face.rect(14, 12, 5, 1, skinShade); // mouth
  face.rect(0, 0, CELL_SIZE, 8, skinShade); // jaw and throat in shadow

  // -- Helmet. A dome: v = 1 at the crown, the rim at v = 0. --
  const helmet = cell('helmet');
  helmet.fill(gear);
  helmet.grain(0, 0, CELL_SIZE, CELL_SIZE, 12);
  helmet.band(4, 6, webbingShade, gearShade); // the band around the shell
  helmet.rect(0, 0, CELL_SIZE, 4, gearShade); // the rim, in its own shadow
  helmet.rect(12, 5, 8, 4, accent); // a squad mark, front and centre
  for (let x = 2; x < CELL_SIZE; x += 11) helmet.rect(x, 12, 2, 2, gearShade); // rivets

  // -- Torso front: collar, placket, chest pockets. --
  const torsoFront = cell('torsoFront');
  torsoFront.fill(uniform);
  torsoFront.grain(0, 0, CELL_SIZE, CELL_SIZE, 12);
  torsoFront.rect(0, 56, CELL_SIZE, 8, uniformShade); // collar
  torsoFront.rect(30, 0, 3, 56, uniformShade); // placket
  for (const x of [10, 38]) {
    torsoFront.rect(x, 26, 16, 18, uniformLight);
    torsoFront.outline(x, 26, 16, 18, uniformShade);
    torsoFront.rect(x, 40, 16, 3, uniformShade); // pocket flap
  }

  // -- Torso back: a yoke seam and nothing else; nobody looks. --
  const torsoBack = cell('torsoBack');
  torsoBack.fill(uniform);
  torsoBack.grain(0, 0, CELL_SIZE, CELL_SIZE, 12);
  torsoBack.rect(0, 56, CELL_SIZE, 8, uniformShade);
  torsoBack.rect(0, 44, CELL_SIZE, 2, uniformShade);

  // -- Vest: the load-bearing gear, two pouches and the straps over them. --
  const vest = cell('vest');
  vest.fill(gear);
  vest.grain(0, 0, CELL_SIZE, CELL_SIZE, 14);
  for (const x of [6, 26, 46]) {
    vest.rect(x, 14, 14, 20, webbingShade);
    vest.outline(x, 14, 14, 20, gearShade);
    vest.rect(x, 30, 14, 4, webbing); // flap
  }
  vest.rect(0, 40, CELL_SIZE, 5, webbing); // the strap across the chest
  vest.rect(0, 39, CELL_SIZE, 1, gearShade);
  vest.rect(28, 44, 8, 6, accent); // squad mark on the plate

  // -- Belt: buckle at the front, pouches either side. --
  const belt = cell('belt');
  belt.fill(uniform);
  belt.grain(0, 0, CELL_SIZE, CELL_SIZE, 10);
  belt.band(26, 12, webbing, webbingShade);
  belt.rect(28, 28, 9, 8, gearShade); // buckle
  for (const x of [8, 46]) {
    belt.rect(x, 20, 12, 16, webbingShade);
    belt.outline(x, 20, 12, 16, gearShade);
  }

  // -- Sleeve: `v` runs along the arm, 0 at the cuff. One cell serves the
  // upper and lower arm both, so the cuff band reads as an elbow seam too. --
  const sleeve = cell('sleeve');
  sleeve.fill(uniform);
  sleeve.grain(0, 0, CELL_SIZE, CELL_SIZE, 12);
  sleeve.band(3, 6, uniformShade, uniformShade); // cuff
  sleeve.rect(0, 30, CELL_SIZE, 2, uniformShade); // seam up the arm
  sleeve.rect(4, 40, 12, 10, uniformLight); // shoulder patch
  sleeve.outline(4, 40, 12, 10, uniformShade);

  // -- Glove. --
  const glove = cell('glove');
  glove.fill(bootShade);
  glove.grain(0, 0, CELL_SIZE, CELL_SIZE, 14);
  for (let x = 6; x < 58; x += 13) glove.rect(x, 34, 9, 3, boot); // knuckles
  glove.rect(0, 0, CELL_SIZE, 6, boot); // the cuff of the glove

  // -- Trouser: `v` 0 at the ankle. Blouse the bottom into the boot. --
  const trouser = cell('trouser');
  trouser.fill(uniform);
  trouser.grain(0, 0, CELL_SIZE, CELL_SIZE, 12);
  trouser.band(6, 5, uniformShade, uniformShade); // the blouse above the boot
  trouser.rect(0, 0, CELL_SIZE, 6, uniformShade);
  trouser.rect(6, 22, 16, 16, uniformLight); // cargo pocket
  trouser.outline(6, 22, 16, 16, uniformShade);
  trouser.rect(6, 34, 16, 3, uniformShade);
  trouser.rect(0, 44, CELL_SIZE, 2, uniformShade); // knee seam

  // -- Boot: `v` 0 at the sole on every side face. --
  const bootCell = cell('boot');
  bootCell.fill(boot);
  bootCell.grain(0, 0, CELL_SIZE, CELL_SIZE, 12);
  bootCell.rect(0, 0, CELL_SIZE, 9, metalShade); // sole
  bootCell.rect(0, 9, CELL_SIZE, 2, bootShade); // welt
  for (let y = 18; y < 52; y += 8) bootCell.rect(22, y, 20, 2, bootShade); // laces

  // -- Neck. --
  const neck = cell('neck');
  neck.fill(skinShade);
  neck.grain(0, 0, CELL_SIZE, CELL_SIZE, 8);
  neck.rect(0, 0, CELL_SIZE, 10, uniformShade); // the collar it sits in

  // -- Rifle: on the long faces `u` runs from the stock to the muzzle. --
  const rifle = cell('rifle');
  rifle.fill(metal);
  rifle.grain(0, 0, CELL_SIZE, CELL_SIZE, 10);
  rifle.rect(0, 0, 16, CELL_SIZE, metalShade); // stock
  rifle.rect(30, 0, 20, CELL_SIZE, bootShade); // handguard
  rifle.rect(50, 24, 14, 16, metalShade); // barrel, thinner than the body
  rifle.rect(20, 10, 8, 20, metalShade); // magazine

  // -- Pack, and the two plain cells anything undetailed can point at. --
  const pack = cell('pack');
  pack.fill(gear);
  pack.grain(0, 0, CELL_SIZE, CELL_SIZE, 14);
  pack.outline(6, 6, 52, 52, gearShade);
  pack.rect(6, 36, 52, 5, webbing); // the strap over the top
  pack.rect(20, 6, 24, 20, webbingShade); // the pouch on the back of it

  const pouch = cell('pouch');
  pouch.fill(webbingShade);
  pouch.grain(0, 0, CELL_SIZE, CELL_SIZE, 12);
  pouch.rect(0, 40, CELL_SIZE, 6, webbing);

  const uniformPlain = cell('uniformPlain');
  uniformPlain.fill(uniform);
  uniformPlain.grain(0, 0, CELL_SIZE, CELL_SIZE, 10);

  const gearPlain = cell('gearPlain');
  gearPlain.fill(gearShade);
  gearPlain.grain(0, 0, CELL_SIZE, CELL_SIZE, 10);

  return data;
}

/**
 * Remap a primitive's own `uv` into a cell, INSET BY HALF A TEXEL at each edge.
 * A primitive emits u = 1 on its last column, which under nearest filtering
 * lands on the first texel of the NEXT cell and paints a stripe of somebody
 * else's boot down the edge of a sleeve. Mapping onto texel CENTRES instead
 * makes that unrepresentable rather than merely unlikely.
 *
 * THE INPUT IS CLAMPED, because Three's spheres and capsules do not stay in
 * [0, 1]: they nudge the seam and pole columns half a segment past each edge
 * (measured: -0.0625 to 1.0625 on an eight-segment capsule) to spread the
 * distortion at a pole. Unclamped, that sliver reads a neighbouring cell —
 * which is how a sleeve ends up with a stripe of boot sole up its seam. The
 * clamp repeats the cell's own edge column there instead, which is what
 * `ClampToEdgeWrapping` would do if a cell were a whole texture.
 */
export function cellUv(cell: CellName, u: number, v: number): [number, number] {
  const origin = CELLS[cell];
  const cu = u < 0 ? 0 : u > 1 ? 1 : u;
  const cv = v < 0 ? 0 : v > 1 ? 1 : v;
  return [
    (origin.x + 0.5 + cu * (CELL_SIZE - 1)) / ATLAS_SIZE,
    (origin.y + 0.5 + cv * (CELL_SIZE - 1)) / ATLAS_SIZE,
  ];
}

/**
 * Move a primitive's own UVs into its cell, in place.
 *
 * Three's primitives all arrive with a `uv` attribute mapping each face — or
 * each wrap of a capsule — onto the unit square, which is exactly the input
 * this needs; the atlas is only ever a change of coordinates over it. Pass an
 * ARRAY to give a box a different cell per face, in the order Three builds
 * them: +X, -X, +Y, -Y, +Z, -Z. That is what lets one torso box carry a
 * placket and chest pockets on the front and a plain yoke on the back, which
 * is how the era got a shirt out of six quads. Primitives never share a vertex
 * between groups, so a per-face assignment cannot fight with itself.
 */
export function remapGeometryUv(geometry: THREE.BufferGeometry, cell: CellName | CellName[]): void {
  const uv = geometry.getAttribute('uv');
  if (!uv) throw new Error('Cannot atlas a geometry with no uv attribute');
  const fallback = Array.isArray(cell) ? cell[0]! : cell;
  const perVertex: CellName[] = new Array<CellName>(uv.count).fill(fallback);
  const index = geometry.index;
  if (Array.isArray(cell) && index) {
    for (const group of geometry.groups) {
      const pick = cell[group.materialIndex ?? 0] ?? fallback;
      for (let i = group.start; i < group.start + group.count; i += 1) perVertex[index.getX(i)] = pick;
    }
  }
  for (let i = 0; i < uv.count; i += 1) {
    const [u, v] = cellUv(perVertex[i]!, uv.getX(i), uv.getY(i));
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}

const cache = new Map<PaletteName, THREE.DataTexture>();

/**
 * The atlas for a palette, built once and shared. Six soldiers of the same
 * squad are six draws of one texture, which is what keeps a variant free
 * (T-2.33): a palette costs 256 KB of texels, never a mesh or a material type.
 */
export function soldierAtlas(name: PaletteName): THREE.DataTexture {
  const cached = cache.get(name);
  if (cached) return cached;
  const texture = new THREE.DataTexture(paintSoldierAtlas(PALETTES[name]), ATLAS_SIZE, ATLAS_SIZE);
  // Point magnification is the era's whole look up close. Mipmapped
  // minification is not a compromise of it: the PS2 mipmapped too, and
  // without it a soldier at 40 m is a field of shimmer.
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.name = 'soldier atlas ' + name;
  texture.needsUpdate = true;
  cache.set(name, texture);
  return texture;
}
