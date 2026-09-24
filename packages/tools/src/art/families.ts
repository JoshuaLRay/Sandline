/**
 * The family atlases (T-4.04, T-4.10; ADR-018). A family is the set of pieces
 * that share one texture and one material, so a building of twenty pieces is
 * one material and, once instanced (T-4.07), a handful of draw calls
 * (ADR-013). Two families for the slice kit:
 *
 * - `kit-a`, the architecture and the ground: the compound's plaster and
 *   concrete, the mud brick under broken plaster, roofing, earth, road,
 *   paving and rubble, in the sun-bleached palette the grey box implies;
 * - `prop-a`, the things set about it: sandbags, crates, planks and drums.
 *
 * Adding a surface changes every cell after it, so new surfaces go at the
 * END of a family, and `pnpm gen:art` rewrites every piece of the family.
 */
import { type AtlasFamily, brick, concrete, crate, dirt, drum, paving, planks, plaster, road, roofing, rubble, sandbag } from './atlas.ts';

export const KIT_A: AtlasFamily = {
  id: 'kit-a',
  size: 512,
  cell: 128,
  gutter: 4,
  seed: 0x5a4d,
  surfaces: {
    plaster: plaster([203, 184, 146], [181, 160, 124]),
    concrete: concrete([150, 146, 138]),
    brick: brick([158, 118, 82], [184, 168, 138]),
    roofing: roofing([88, 84, 80], [170, 156, 128]),
    dirt: dirt([176, 148, 108], [132, 104, 72]),
    road: road([136, 128, 116], [104, 90, 72]),
    paving: paving([188, 176, 150], [150, 132, 100]),
    rubble: rubble([196, 180, 146], [150, 112, 80], [140, 136, 128]),
  },
};

export const PROP_A: AtlasFamily = {
  id: 'prop-a',
  size: 512,
  cell: 128,
  gutter: 4,
  seed: 0x9b17,
  surfaces: {
    sandbag: sandbag([168, 146, 104]),
    crate: crate([104, 110, 72]),
    planks: planks([150, 140, 124]),
    drum: drum([78, 92, 60], [132, 76, 40]),
  },
};
