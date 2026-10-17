/** Reproduce the furnished prisoner outpost and screened reserve annex (U-175/U-179/U-180, U-222 cell door leaf and U-223 refuge screen). */
import { mkdir, writeFile } from 'node:fs/promises';
import { buildOutpostLevel, outpostManifest, outpostPlanSvg } from './maps/qalatOutpost.ts';
import { insertionSurface } from './maps/insertionSurface.ts';

const output = new URL('../../../artifacts/qalat-outpost/', import.meta.url);
await mkdir(output, { recursive: true });
const level = buildOutpostLevel(), manifest = outpostManifest();
await writeFile(new URL('level.json', output), JSON.stringify(level) + '\n');
await writeFile(new URL('surface.json', output), JSON.stringify({ levelHash: manifest.levelHash, renderHash: manifest.renderHash,
  ...insertionSurface([...level.boxes, ...manifest.decorations]) }) + '\n');
await writeFile(new URL('construction.json', output), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(new URL('plan.svg', output), outpostPlanSvg());
console.log(`U-223: isolated prisoner outpost, all three player gates and screened reserve annex (${level.boxes.length} collision boxes)`);
