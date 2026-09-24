/** Every generated character (T-4.08, T-4.35). `pnpm gen:art` writes each to `assets/src/<id>.glb`. */
import type { Document } from '@gltf-transform/core';
import { characterDocument, partsDocument } from './document.ts';
import { FIGHTER_PARTS, buildFighter } from './fighter.ts';
import { fighterAtlasPng } from './fighterAtlas.ts';
import { buildDetailedSoldier } from './soldier.ts';
import { soldierAtlasPng } from './soldierAtlas.ts';
import { weaponDocuments } from '../weapons/index.ts';

export interface Character {
  id: string;
  document(): Document;
}

export const CHARACTERS: readonly Character[] = [
  { id: 'soldier-dcu', document: () => characterDocument('soldier-dcu', buildDetailedSoldier(), soldierAtlasPng()) },
  // T-4.35: the enemy fighter, in parts the page shows, hides and tints per variant.
  {
    id: 'fighter',
    document: () => {
      const parts = buildFighter();
      return partsDocument('fighter', FIGHTER_PARTS.map((name) => ({ name: `fighter-${name}`, skin: parts[name] })), fighterAtlasPng());
    },
  },
];

/** Everything else `gen:art` writes that is not a kit piece: the characters, then the weapons (T-4.36). */
export const GENERATED: readonly Character[] = [...CHARACTERS, ...weaponDocuments()];
