/** Reproduce U-173's furnished depot and covered stairs without campaign activation. */
import { mkdir, writeFile } from 'node:fs/promises';
import { buildDepotLevel, depotManifest, depotPlanSvg } from './maps/qalatDepot.ts';
import { insertionSurface } from './maps/insertionSurface.ts';
import { depotDecorations } from './maps/qalatDepotFurniture.ts';
const output = new URL('../../../artifacts/qalat-depot/', import.meta.url);
await mkdir(output, { recursive: true });
const level = buildDepotLevel(), manifest = depotManifest();
await writeFile(new URL('level.json', output), JSON.stringify(level) + '\n');
await writeFile(new URL('surface.json', output), JSON.stringify({ levelHash: manifest.levelHash, renderHash: manifest.renderHash,
  ...insertionSurface([...level.boxes, ...depotDecorations()]) }) + '\n');
await writeFile(new URL('construction.json', output), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(new URL('plan.svg', output), depotPlanSvg());
console.log(`U-173: furnished B1–B9 depot, covered stairs and exact joins (${manifest.furniture.length} fixed internals; ${manifest.decorations.length} noncolliding construction cues)`);
