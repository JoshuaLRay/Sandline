/**
 * Every generated piece (T-4.04, T-4.10). `pnpm gen:art` writes each to
 * `assets/src/<id>.glb`; `data/kit.json` gives each its cover class.
 */
import type { Piece } from '../piece.ts';
import { CRATE_LARGE, CRATE_SMALL, CRATE_STACK, DRUM, FENCE_WOOD_2M, SANDBAGS_2M, SANDBAGS_CORNER } from './props.ts';
import {
  CONCRETE_BARRIER_2M,
  GROUND_DIRT_4M,
  GROUND_PAVING_4M,
  GROUND_ROAD_4M,
  PARAPET_4M,
  ROOF_SLAB_4M,
  RUBBLE_LARGE,
  RUBBLE_SMALL,
  STAIRS_3M,
} from './shell.ts';
import {
  PILLAR,
  WALL_BROKEN_2M,
  WALL_BROKEN_4M,
  WALL_DOOR_4M,
  WALL_LOW_2M,
  WALL_LOW_4M,
  WALL_PLASTER_2M,
  WALL_PLASTER_4M,
  WALL_WINDOW_4M,
} from './walls.ts';

export const PIECES: readonly Piece[] = [
  WALL_PLASTER_4M,
  WALL_PLASTER_2M,
  WALL_LOW_4M,
  WALL_LOW_2M,
  WALL_BROKEN_4M,
  WALL_BROKEN_2M,
  WALL_DOOR_4M,
  WALL_WINDOW_4M,
  PILLAR,
  ROOF_SLAB_4M,
  PARAPET_4M,
  STAIRS_3M,
  CONCRETE_BARRIER_2M,
  RUBBLE_SMALL,
  RUBBLE_LARGE,
  GROUND_DIRT_4M,
  GROUND_ROAD_4M,
  GROUND_PAVING_4M,
  SANDBAGS_2M,
  SANDBAGS_CORNER,
  CRATE_SMALL,
  CRATE_LARGE,
  CRATE_STACK,
  DRUM,
  FENCE_WOOD_2M,
];
