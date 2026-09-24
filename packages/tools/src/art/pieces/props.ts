/**
 * The kit's props (T-4.10), family `prop-a`: sandbags, crates, a drum and a
 * fence. A crate's tile is its own side, so each face maps one whole crate
 * side from the atlas, frame and all.
 */
import type { Piece } from '../piece.ts';
import { PROP_A } from '../families.ts';

/** A 2 m run of sandbags, 0.9 m high and 0.6 m deep, stacked in six courses a tile. */
export const SANDBAGS_2M: Piece = {
  id: 'sandbags-2m',
  class: 'prop',
  family: PROP_A,
  tileM: { sandbag: 0.9 },
  build(b) {
    b.box([-1, 0, -0.3], [1, 0.9, 0.3], { all: 'sandbag' }, { collide: true, omit: ['ny'] });
  },
};

/** An L of sandbags round a corner: 1.5 m each way, for an MG nest or a fighting position. */
export const SANDBAGS_CORNER: Piece = {
  id: 'sandbags-corner',
  class: 'prop',
  family: PROP_A,
  tileM: { sandbag: 0.9 },
  build(b) {
    b.box([-0.75, 0, 0.15], [0.75, 0.9, 0.75], { all: 'sandbag' }, { collide: true, omit: ['ny'] });
    b.box([0.15, 0, -0.75], [0.75, 0.9, 0.15], { all: 'sandbag' }, { collide: true, omit: ['ny', 'pz'] });
  },
};

function crateBox(id: string, size: number): Piece {
  return {
    id,
    class: 'prop',
    family: PROP_A,
    tileM: { crate: size },
    build(b) {
      b.box([-size / 2, 0, -size / 2], [size / 2, size, size / 2], { all: 'crate' }, { collide: true, omit: ['ny'] });
    },
  };
}

export const CRATE_SMALL = crateBox('crate-small', 0.8);
export const CRATE_LARGE = crateBox('crate-large', 1.2);

/** A large crate with a small one set on it, off-centre: 2 m of high cover in two boxes. */
export const CRATE_STACK: Piece = {
  id: 'crate-stack',
  class: 'prop',
  family: PROP_A,
  tileM: { crate: 1.2 },
  build(b) {
    b.box([-0.6, 0, -0.6], [0.6, 1.2, 0.6], { all: 'crate' }, { collide: true, omit: ['ny'] });
    b.box([-0.5, 1.2, -0.45], [0.3, 2.0, 0.35], { all: 'crate' }, { collide: true, omit: ['ny'] });
  },
};

/** A 200-litre drum: twelve sides, 0.3 m radius, 0.9 m high, collided as the square round it. */
export const DRUM: Piece = {
  id: 'drum',
  class: 'prop',
  family: PROP_A,
  tileM: { drum: Math.PI * 0.3 },
  build(b) {
    b.prism(0, 0, 0.3, 0, 0.9, 12, { side: 'drum', cap: 'drum' }, { collide: true });
  },
};

/**
 * A 2 m run of plank fence, 1.2 m high: two posts, two rails, and the
 * boarding, which is one thin box (the texture draws the boards). It
 * collides as one thin box, the posts' depth, because rounds and soldiers
 * are stopped by a fence, not threaded through its gaps.
 */
export const FENCE_WOOD_2M: Piece = {
  id: 'fence-wood-2m',
  class: 'prop',
  family: PROP_A,
  tileM: { planks: 1.2 },
  build(b) {
    for (const x of [-1, 0.9]) b.box([x, 0, -0.05], [x + 0.1, 1.2, 0.05], { all: 'planks' }, { omit: ['ny'] });
    for (const y of [0.25, 0.95]) b.box([-0.9, y, -0.05], [0.9, y + 0.08, -0.02], { all: 'planks' });
    b.box([-0.9, 0.05, -0.02], [0.9, 1.15, 0.02], { all: 'planks' }, { omit: ['ny'] });
    b.collider([-1, 0, -0.05], [1, 1.2, 0.05]);
  },
};
