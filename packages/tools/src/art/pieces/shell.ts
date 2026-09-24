/**
 * The building shell set and the ground (T-4.10), family `kit-a`.
 *
 * A one-storey house is four wall pieces round a 4 m square, pillars at its
 * corners, a roof slab on top (placed at y = 3), a parapet round the roof
 * (placed at y = 3.25), and a stair up the outside. Ground tiles are decals:
 * drawn 1 cm over the ground and colliding with nothing, because the ground
 * is not a box (world.ts) and a step of a centimetre would only snag feet.
 */
import type { Piece } from '../piece.ts';
import { KIT_A } from '../families.ts';

const TILES = { plaster: 2, concrete: 1, roofing: 2, dirt: 4, road: 4, paving: 2, rubble: 1, brick: 1 };

/** A 4.6 m square slab 0.25 m deep: roof on top, concrete edges and underside. Stands on a 4 m square of walls with their pillars. */
export const ROOF_SLAB_4M: Piece = {
  id: 'roof-slab-4m',
  class: 'kit',
  family: KIT_A,
  tileM: TILES,
  build(b) {
    b.box([-2.3, 0, -2.3], [2.3, 0.25, 2.3], { all: 'concrete', py: 'roofing' }, { collide: true });
  },
};

/** A parapet for a roof edge: 4.6 m of 0.6 m wall, 0.2 m thick, capped, set along the slab's edge. */
export const PARAPET_4M: Piece = {
  id: 'parapet-4m',
  class: 'kit',
  family: KIT_A,
  tileM: TILES,
  build(b) {
    b.box([-2.3, 0, -0.1], [2.3, 0.55, 0.1], { all: 'plaster' }, { collide: true, omit: ['ny', 'py'] });
    b.box([-2.3, 0.55, -0.13], [2.3, 0.6, 0.13], { all: 'concrete' }, { collide: true });
  },
};

/**
 * An outside stair to a 3.25 m roof: 13 concrete steps of 0.25 m, each
 * 0.3 m deep and 1.1 m wide, climbing toward +Z. Each step is a box from the
 * ground up, so the stair is solid underneath and every step is under the
 * controller's 0.45 m step height (CharacterController).
 */
export const STAIRS_3M: Piece = {
  id: 'stairs-3m',
  class: 'kit',
  family: KIT_A,
  tileM: TILES,
  build(b) {
    const steps = 13;
    for (let i = 0; i < steps; i++) {
      const z0 = -1.95 + i * 0.3;
      // Each step's back face is hidden by the taller step behind it, all but the last's.
      b.box([-0.55, 0, z0], [0.55, (i + 1) * 0.25, z0 + 0.3], { all: 'concrete' }, { collide: true, omit: ['ny', ...(i < steps - 1 ? (['pz'] as const) : [])] });
    }
  },
};

/** A 4 m ground tile, drawn 1 cm up, colliding with nothing. */
function groundTile(id: string, surface: string): Piece {
  return {
    id,
    class: 'kit',
    family: KIT_A,
    tileM: TILES,
    decal: true,
    build(b) {
      b.box([-2, 0, -2], [2, 0.01, 2], { all: surface }, { omit: ['px', 'nx', 'pz', 'nz', 'ny'] });
    },
  };
}

export const GROUND_DIRT_4M = groundTile('ground-dirt-4m', 'dirt');
export const GROUND_ROAD_4M = groundTile('ground-road-4m', 'road');
export const GROUND_PAVING_4M = groundTile('ground-paving-4m', 'paving');

/**
 * Rubble: fallen masonry, a few chunks at fixed offsets. It collides as ONE
 * low box round the pile, not a box a chunk, so a soldier steps up onto it
 * rather than snagging on chunk edges; every chunk is inside that box.
 */
function rubblePile(id: string, chunks: readonly (readonly [number, number, number, number, number])[]): Piece {
  return {
    id,
    class: 'kit',
    family: KIT_A,
    tileM: TILES,
    build(b) {
      let lo = [Infinity, 0, Infinity];
      let hi = [-Infinity, 0, -Infinity];
      for (const [x, z, w, h, d] of chunks) {
        const min: [number, number, number] = [x - w / 2, 0, z - d / 2];
        const max: [number, number, number] = [x + w / 2, h, z + d / 2];
        b.box(min, max, { all: 'rubble' }, { omit: ['ny'] });
        lo = [Math.min(lo[0]!, min[0]), 0, Math.min(lo[2]!, min[2])];
        hi = [Math.max(hi[0]!, max[0]), Math.max(hi[1]!, h), Math.max(hi[2]!, max[2])];
      }
      b.collider(lo as [number, number, number], hi as [number, number, number]);
    },
  };
}

export const RUBBLE_SMALL = rubblePile('rubble-small', [
  [0, 0, 1.0, 0.3, 0.8],
  [0.35, 0.2, 0.5, 0.42, 0.4],
  [-0.3, -0.15, 0.4, 0.2, 0.5],
]);
export const RUBBLE_LARGE = rubblePile('rubble-large', [
  [0, 0, 2.2, 0.4, 1.6],
  [0.4, 0.2, 1.0, 0.8, 0.9],
  [-0.5, -0.3, 0.9, 0.6, 0.7],
  [0.1, 0.1, 0.6, 1.0, 0.5],
]);

/** A 2 m concrete road barrier: a wide foot under a narrower 0.9 m face, low cover that stops rounds. */
export const CONCRETE_BARRIER_2M: Piece = {
  id: 'concrete-barrier-2m',
  class: 'kit',
  family: KIT_A,
  tileM: TILES,
  build(b) {
    b.box([-1, 0, -0.3], [1, 0.25, 0.3], { all: 'concrete' }, { collide: true, omit: ['ny'] });
    b.box([-1, 0.25, -0.15], [1, 0.9, 0.15], { all: 'concrete' }, { collide: true, omit: ['ny'] });
  },
};
