/** Every generated character (T-4.08). `pnpm gen:art` writes each to `assets/src/<id>.glb`. */
import type { Document } from '@gltf-transform/core';
import { characterDocument } from './document.ts';
import { buildDetailedSoldier } from './soldier.ts';
import { soldierAtlasPng } from './soldierAtlas.ts';
import { weaponDocuments } from '../weapons/index.ts';

export interface Character {
  id: string;
  document(): Document;
}

export const CHARACTERS: readonly Character[] = [
  { id: 'soldier-dcu', document: () => characterDocument('soldier-dcu', buildDetailedSoldier(), soldierAtlasPng()) },
];

/** Everything else `gen:art` writes that is not a kit piece: the characters, then the weapons (T-4.36). */
export const GENERATED: readonly Character[] = [...CHARACTERS, ...weaponDocuments()];
