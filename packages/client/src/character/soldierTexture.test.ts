/**
 * T-2.30. The atlas is the soldier's whole detail budget, so these assert the
 * things that make it one: that it builds with no DOM (this file runs under
 * `environment: 'node'`, where a canvas throws), that it is point-magnified,
 * that a texel a cell claims is the colour that cell painted, and that no
 * cell can bleed into its neighbour.
 *
 * Palette VALUES are read from the data deliberately — recolouring a soldier
 * is tuning and must never break a test — but the PROPERTIES asserted here
 * are structural, so they hold for any palette the data grows later.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  ATLAS_SIZE,
  CELLS,
  CELL_SIZE,
  type CellName,
  PALETTES,
  cellUv,
  paintSoldierAtlas,
  paletteNames,
  remapGeometryUv,
  soldierAtlas,
} from './soldierTexture.ts';

const ALL_CELLS = Object.keys(CELLS) as CellName[];

/** The texel `cellUv` sends (u, v) to, the way nearest filtering will read it. */
function texelAt(data: Uint8Array, u: number, v: number): [number, number, number] {
  const x = Math.min(ATLAS_SIZE - 1, Math.floor(u * ATLAS_SIZE));
  const y = Math.min(ATLAS_SIZE - 1, Math.floor(v * ATLAS_SIZE));
  const i = (y * ATLAS_SIZE + x) * 4;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}

function rgbOf(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Channel distance, for "this texel is about that palette colour". */
function apart(a: [number, number, number], b: [number, number, number]): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

describe('the soldier atlas (T-2.30)', () => {
  it('builds a fully opaque 256² atlas from arithmetic alone, with no DOM', () => {
    // The point of the whole design: no canvas, no loader, no asset.
    expect(typeof document).toBe('undefined');
    const data = paintSoldierAtlas(PALETTES.local);
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBe(ATLAS_SIZE * ATLAS_SIZE * 4);
    // Every texel painted: a transparent one is a cell somebody forgot.
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(255);
  });

  it('is deterministic: the same palette gives the same bytes', () => {
    expect(paintSoldierAtlas(PALETTES.local)).toEqual(paintSoldierAtlas(PALETTES.local));
    expect(paintSoldierAtlas(PALETTES.remote)).not.toEqual(paintSoldierAtlas(PALETTES.local));
  });

  it('point-magnifies in sRGB, which is the era look and the reason for the file', () => {
    const texture = soldierAtlas('local');
    expect(texture).toBeInstanceOf(THREE.DataTexture);
    expect(texture.image.width).toBe(ATLAS_SIZE);
    expect(texture.image.height).toBe(ATLAS_SIZE);
    expect(texture.magFilter).toBe(THREE.NearestFilter);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    // flipY is false on a DataTexture, which is why rows count from the bottom.
    expect(texture.flipY).toBe(false);
    // Minification mipmaps: a soldier at 40 m shimmers without it.
    expect(texture.generateMipmaps).toBe(true);
  });

  it('shares one texture per palette, so a squad of six is six draws of one', () => {
    expect(soldierAtlas('local')).toBe(soldierAtlas('local'));
    expect(soldierAtlas('local')).not.toBe(soldierAtlas('remote'));
  });

  it('lays every cell inside the atlas on a clean grid, with none sharing an origin', () => {
    const seen = new Set<string>();
    for (const name of ALL_CELLS) {
      const cell = CELLS[name];
      expect(cell.x % CELL_SIZE).toBe(0);
      expect(cell.y % CELL_SIZE).toBe(0);
      expect(cell.x + CELL_SIZE).toBeLessThanOrEqual(ATLAS_SIZE);
      expect(cell.y + CELL_SIZE).toBeLessThanOrEqual(ATLAS_SIZE);
      expect(seen.has(`${cell.x},${cell.y}`)).toBe(false);
      seen.add(`${cell.x},${cell.y}`);
    }
  });

  it('keeps the full uv range inside its own cell — the half-texel inset', () => {
    // A primitive emits u = 1 on its last column. Without the inset that lands
    // on the first texel of the NEXT cell and paints somebody else's boot
    // down the edge of a sleeve.
    for (const name of ALL_CELLS) {
      const cell = CELLS[name];
      for (const [u, v] of [[0, 0], [1, 1], [0, 1], [1, 0], [0.5, 0.5]] as const) {
        const [mu, mv] = cellUv(name, u, v);
        const x = Math.floor(mu * ATLAS_SIZE);
        const y = Math.floor(mv * ATLAS_SIZE);
        expect(x).toBeGreaterThanOrEqual(cell.x);
        expect(x).toBeLessThan(cell.x + CELL_SIZE);
        expect(y).toBeGreaterThanOrEqual(cell.y);
        expect(y).toBeLessThan(cell.y + CELL_SIZE);
      }
    }
  });

  it('clamps the seam overshoot Three puts on spheres and capsules', () => {
    // Measured, not assumed: an eight-segment capsule emits u from -0.0625 to
    // 1.0625, nudging its seam half a segment past each edge. Unclamped, that
    // sliver reads the NEXT cell along.
    const capsule = new THREE.CapsuleGeometry(0.055, 0.3, 3, 8);
    const raw = capsule.getAttribute('uv');
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < raw.count; i += 1) {
      min = Math.min(min, raw.getX(i));
      max = Math.max(max, raw.getX(i));
    }
    expect(min).toBeLessThan(0);
    expect(max).toBeGreaterThan(1);
    // Clamped, the overshoot lands on the cell's own edge column, which is
    // what ClampToEdgeWrapping would do if a cell were a whole texture.
    expect(cellUv('sleeve', -0.0625, 0.5)).toEqual(cellUv('sleeve', 0, 0.5));
    expect(cellUv('sleeve', 1.0625, 0.5)).toEqual(cellUv('sleeve', 1, 0.5));
  });

  it('paints the parts the era painted: a face with eyes, a sole, a helmet band', () => {
    const data = paintSoldierAtlas(PALETTES.local);
    const p = PALETTES.local;
    // The sphere puts the soldier's front at u = 0.25, so that is where a face
    // has to be for the eyes to land on the front of the head — and below
    // y = 27, or the helmet covers it.
    const eye = texelAt(data, ...cellUv('face', 13.5 / CELL_SIZE, 21.5 / CELL_SIZE));
    const cheek = texelAt(data, ...cellUv('face', 40.5 / CELL_SIZE, 18.5 / CELL_SIZE));
    expect(apart(eye, rgbOf(p.metalShade))).toBeLessThan(16);
    expect(apart(cheek, rgbOf(p.skin))).toBeLessThan(16);
    // Both eyes, and skin between them: a single dark bar across the face is
    // the failure this catches — it reads as a visor, not a soldier.
    expect(apart(texelAt(data, ...cellUv('face', 18.5 / CELL_SIZE, 21.5 / CELL_SIZE)), rgbOf(p.metalShade))).toBeLessThan(16);
    expect(apart(texelAt(data, ...cellUv('face', 16.5 / CELL_SIZE, 21.5 / CELL_SIZE)), rgbOf(p.skin))).toBeLessThan(16);
    // The helmet's brim throws a shadow across the brow, just above the eyes.
    expect(apart(texelAt(data, ...cellUv('face', 16.5 / CELL_SIZE, 25.5 / CELL_SIZE)), rgbOf(p.skinShade))).toBeLessThan(16);
    // A boot's `v` is 0 at the sole on every side face.
    expect(apart(texelAt(data, ...cellUv('boot', 0.5, 2.5 / CELL_SIZE)), rgbOf(p.metalShade))).toBeLessThan(16);
    expect(apart(texelAt(data, ...cellUv('boot', 0.5, 40 / CELL_SIZE)), rgbOf(p.boot))).toBeLessThan(20);
    // The helmet's band sits just above its rim.
    expect(apart(texelAt(data, ...cellUv('helmet', 0.9, 6.5 / CELL_SIZE)), rgbOf(p.webbingShade))).toBeLessThan(16);
    // The trouser blouses into the boot rather than ending in mid-air.
    expect(apart(texelAt(data, ...cellUv('trouser', 0.5, 2.5 / CELL_SIZE)), rgbOf(p.uniformShade))).toBeLessThan(20);
  });

  it('gives every palette in the data the same structure', () => {
    const keys = Object.keys(PALETTES.local).sort();
    expect(paletteNames().length).toBeGreaterThanOrEqual(2);
    for (const name of paletteNames()) {
      expect(Object.keys(PALETTES[name]).sort()).toEqual(keys);
      for (const value of Object.values(PALETTES[name])) expect(value).toMatch(/^#[0-9a-f]{6}$/);
      // Every palette paints, and paints something distinguishable.
      const data = paintSoldierAtlas(PALETTES[name]);
      expect(data.length).toBe(ATLAS_SIZE * ATLAS_SIZE * 4);
    }
  });
});

describe('remapping a primitive into a cell (T-2.30)', () => {
  it('moves a whole geometry into one cell and leaves its positions alone', () => {
    const geometry = new THREE.CapsuleGeometry(0.05, 0.3, 3, 8);
    const positions = Float32Array.from(geometry.getAttribute('position').array);
    remapGeometryUv(geometry, 'sleeve');
    expect(geometry.getAttribute('position').array).toEqual(positions);
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i += 1) {
      const x = Math.floor(uv.getX(i) * ATLAS_SIZE);
      const y = Math.floor(uv.getY(i) * ATLAS_SIZE);
      expect(x).toBeGreaterThanOrEqual(CELLS.sleeve.x);
      expect(x).toBeLessThan(CELLS.sleeve.x + CELL_SIZE);
      expect(y).toBeGreaterThanOrEqual(CELLS.sleeve.y);
      expect(y).toBeLessThan(CELLS.sleeve.y + CELL_SIZE);
    }
  });

  it('gives a box a different cell per face, front and back distinct', () => {
    // This is how one torso box carries a placket on the front and a plain
    // yoke on the back — six quads doing the work of a modelled shirt.
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const faces: CellName[] = ['uniformPlain', 'uniformPlain', 'uniformPlain', 'uniformPlain', 'torsoFront', 'torsoBack'];
    remapGeometryUv(geometry, faces);
    const uv = geometry.getAttribute('uv');
    const index = geometry.index!;
    const cellOfVertex = (i: number): string => {
      const x = Math.floor(Math.floor(uv.getX(i) * ATLAS_SIZE) / CELL_SIZE) * CELL_SIZE;
      const y = Math.floor(Math.floor(uv.getY(i) * ATLAS_SIZE) / CELL_SIZE) * CELL_SIZE;
      return `${x},${y}`;
    };
    const cellOfGroup = (materialIndex: number): Set<string> => {
      const group = geometry.groups.find((g) => g.materialIndex === materialIndex)!;
      const out = new Set<string>();
      for (let i = group.start; i < group.start + group.count; i += 1) out.add(cellOfVertex(index.getX(i)));
      return out;
    };
    // Each face lands wholly in one cell — no vertex is shared between faces.
    expect(cellOfGroup(4)).toEqual(new Set([`${CELLS.torsoFront.x},${CELLS.torsoFront.y}`]));
    expect(cellOfGroup(5)).toEqual(new Set([`${CELLS.torsoBack.x},${CELLS.torsoBack.y}`]));
    expect(cellOfGroup(0)).toEqual(new Set([`${CELLS.uniformPlain.x},${CELLS.uniformPlain.y}`]));
  });

  it('refuses a geometry with no uv rather than silently painting cell zero', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    expect(() => remapGeometryUv(geometry, 'sleeve')).toThrow(/uv/);
  });
});
