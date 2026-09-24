/**
 * The family atlases (T-4.04, ADR-018). A family is the set of pieces that
 * share one texture and one material. The kit's first family is `kit-a`:
 * the compound's walls and their concrete, in the sun-bleached palette the
 * grey box already implies.
 */
import { type AtlasFamily, concrete, plaster } from './atlas.ts';

export const KIT_A: AtlasFamily = {
  id: 'kit-a',
  size: 512,
  cell: 128,
  gutter: 4,
  seed: 0x5a4d,
  surfaces: {
    plaster: plaster([203, 184, 146], [181, 160, 124]),
    concrete: concrete([150, 146, 138]),
  },
};
