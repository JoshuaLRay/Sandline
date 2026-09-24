/**
 * The first kit piece (T-4.04): a 4 m run of compound wall, 3 m high and
 * 0.3 m thick. Plastered, on a concrete plinth that stands 3 cm proud of
 * each face, under a concrete coping that overhangs by 4 cm. The ends are
 * flush at x = ±2 m, so runs butt together into longer walls.
 *
 * Three boxes, each a collision box, so the plinth and the coping collide
 * where they are seen. The ends and the underside are left off where a
 * neighbour or the ground hides them: the plinth's underside only, since
 * an end may be the end of a run.
 */
import type { Piece } from '../piece.ts';
import { KIT_A } from '../families.ts';

export const WALL_PLASTER_4M: Piece = {
  id: 'wall-plaster-4m',
  class: 'kit',
  family: KIT_A,
  tileM: { plaster: 2, concrete: 1 },
  build(b) {
    const half = 2;
    const plinthH = 0.3;
    const capH = 0.1;
    const top = 3;
    b.box([-half, 0, -0.18], [half, plinthH, 0.18], { all: 'concrete' }, { collide: true, omit: ['ny'] });
    b.box([-half, plinthH, -0.15], [half, top - capH, 0.15], { all: 'plaster' }, { collide: true, omit: ['py', 'ny'] });
    b.box([-half, top - capH, -0.19], [half, top, 0.19], { all: 'concrete' }, { collide: true });
  },
};
