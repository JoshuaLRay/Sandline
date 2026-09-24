/**
 * The kit's walls (T-4.10): full, low and broken runs, doorway and window
 * walls, and the pillar that closes a corner. All are family `kit-a` and
 * 0.3 m thick. Plaster sits on a concrete plinth 3 cm proud of each face; a
 * full wall wears a concrete coping 4 cm proud. The ends are flush at
 * ±length/2, so runs butt together along x, and a pillar covers the notch
 * where two runs meet at a corner.
 *
 * Every box that is drawn also collides, so what is seen is what stops a
 * shot and a soldier (§7.11 rule 1). A doorway is the gap between two
 * wall boxes under a lintel, and a window the same over a sill, so both
 * are gaps in the collision too: a soldier walks through a door, and a
 * shot goes through a window.
 */
import type { MeshBuilder } from '../mesh.ts';
import type { Piece } from '../piece.ts';
import { KIT_A } from '../families.ts';

const T = 0.15; // half the plaster's thickness
const PLINTH = { h: 0.3, half: 0.18 };
const COPING = { h: 0.1, half: 0.19 };
const TILES = { plaster: 2, concrete: 1, brick: 1 };

/** A plinth, a plastered run to `top`, and (if `coping`) a coping to `top + COPING.h`: x0..x1 along the run. */
function run(b: MeshBuilder, x0: number, x1: number, top: number, coping: boolean): void {
  b.box([x0, 0, -PLINTH.half], [x1, PLINTH.h, PLINTH.half], { all: 'concrete' }, { collide: true, omit: ['ny'] });
  b.box([x0, PLINTH.h, -T], [x1, top, T], { all: 'plaster' }, { collide: true, omit: coping ? ['py', 'ny'] : ['ny'] });
  if (coping) b.box([x0, top, -COPING.half], [x1, top + COPING.h, COPING.half], { all: 'concrete' }, { collide: true });
}

function wall(id: string, length: number, height: number): Piece {
  const coping = height > 2;
  return {
    id,
    class: 'kit',
    family: KIT_A,
    tileM: TILES,
    build(b) {
      run(b, -length / 2, length / 2, coping ? height - COPING.h : height, coping);
    },
  };
}

export const WALL_PLASTER_4M = wall('wall-plaster-4m', 4, 3);
export const WALL_PLASTER_2M = wall('wall-plaster-2m', 2, 3);
/** Low walls: 1.1 m, cover to a crouching soldier, a rest to a standing one. */
export const WALL_LOW_4M = wall('wall-low-4m', 4, 1.1);
export const WALL_LOW_2M = wall('wall-low-2m', 2, 1.1);

/**
 * A broken wall: the run steps down in ragged sections where the top has
 * fallen, the mud brick showing on every broken face. Section heights are
 * fixed numbers, not noise, so the collision is the same every build and
 * reads the same as the silhouette.
 */
function broken(id: string, sections: readonly (readonly [number, number])[]): Piece {
  const length = sections.reduce((sum, [w]) => sum + w, 0);
  return {
    id,
    class: 'kit',
    family: KIT_A,
    tileM: TILES,
    build(b) {
      let x = -length / 2;
      for (const [w, h] of sections) {
        b.box([x, 0, -PLINTH.half], [x + w, PLINTH.h, PLINTH.half], { all: 'concrete' }, { collide: true, omit: ['ny'] });
        // Plaster on the faces, brick on the broken top and where a step exposes the side.
        b.box([x, PLINTH.h, -T], [x + w, h, T], { all: 'brick', pz: 'plaster', nz: 'plaster' }, { collide: true, omit: ['ny'] });
        x += w;
      }
    },
  };
}

export const WALL_BROKEN_4M = broken('wall-broken-4m', [
  [0.9, 2.6],
  [0.7, 1.9],
  [0.8, 1.2],
  [0.6, 0.8],
  [1.0, 1.6],
]);
export const WALL_BROKEN_2M = broken('wall-broken-2m', [
  [0.6, 1.4],
  [0.8, 0.7],
  [0.6, 1.9],
]);

/** A 4 m full wall with a doorway 1.2 m wide and 2.2 m high in its middle. */
export const WALL_DOOR_4M: Piece = {
  id: 'wall-door-4m',
  class: 'kit',
  family: KIT_A,
  tileM: TILES,
  build(b) {
    const top = 3 - COPING.h;
    run(b, -2, -0.6, top, true);
    run(b, 0.6, 2, top, true);
    // The lintel: plaster over the opening, under the coping, concrete beneath.
    b.box([-0.6, 2.2, -T], [0.6, top, T], { all: 'plaster', ny: 'concrete' }, { collide: true, omit: ['py'] });
    b.box([-0.6, top, -COPING.half], [0.6, 3, COPING.half], { all: 'concrete' }, { collide: true });
  },
};

/** A 4 m full wall with a window 1.2 m wide, its sill at 1.0 m and its head at 2.1 m. */
export const WALL_WINDOW_4M: Piece = {
  id: 'wall-window-4m',
  class: 'kit',
  family: KIT_A,
  tileM: TILES,
  build(b) {
    const top = 3 - COPING.h;
    run(b, -2, -0.6, top, true);
    run(b, 0.6, 2, top, true);
    b.box([-0.6, 0, -PLINTH.half], [0.6, PLINTH.h, PLINTH.half], { all: 'concrete' }, { collide: true, omit: ['ny'] });
    b.box([-0.6, PLINTH.h, -T], [0.6, 0.95, T], { all: 'plaster' }, { collide: true, omit: ['ny', 'py'] });
    // The sill, a concrete slab a little proud, and the head over the opening.
    b.box([-0.6, 0.95, -0.2], [0.6, 1.0, 0.2], { all: 'concrete' }, { collide: true });
    b.box([-0.6, 2.1, -T], [0.6, top, T], { all: 'plaster', ny: 'concrete' }, { collide: true, omit: ['py'] });
    b.box([-0.6, top, -COPING.half], [0.6, 3, COPING.half], { all: 'concrete' }, { collide: true });
  },
};

/** A 0.5 m square pillar, 3 m high like a full wall: it stands at a corner where two runs meet, and hides the joint. */
export const PILLAR: Piece = {
  id: 'pillar',
  class: 'kit',
  family: KIT_A,
  tileM: TILES,
  build(b) {
    b.box([-0.25, 0, -0.25], [0.25, 0.3, 0.25], { all: 'concrete' }, { collide: true, omit: ['ny'] });
    b.box([-0.22, 0.3, -0.22], [0.22, 2.9, 0.22], { all: 'plaster' }, { collide: true, omit: ['ny', 'py'] });
    b.box([-0.25, 2.9, -0.25], [0.25, 3.0, 0.25], { all: 'concrete' }, { collide: true });
  },
};
