/** Every generated character (T-4.08). `pnpm gen:art` writes each to `assets/src/<id>.glb`. */
import type { Document } from '@gltf-transform/core';
import { characterDocument } from './document.ts';
import { buildDetailedSoldier } from './soldier.ts';
import { soldierAtlasPng } from './soldierAtlas.ts';

export interface Character {
  id: string;
  document(): Document;
}

export const CHARACTERS: readonly Character[] = [
  { id: 'soldier-dcu', document: () => characterDocument('soldier-dcu', buildDetailedSoldier(), soldierAtlasPng()) },
];
