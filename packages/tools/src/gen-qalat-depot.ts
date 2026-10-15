/** Reproduce U-171's enclosed depot and covered endpoint stairs without campaign activation. */
import { mkdir, writeFile } from 'node:fs/promises';
import { buildDepotLevel, depotManifest, depotPlanSvg } from './maps/qalatDepot.ts';
import { insertionSurface } from './maps/insertionSurface.ts';
const output = new URL('../../../artifacts/qalat-depot/', import.meta.url);
await mkdir(output, { recursive: true });
const level = buildDepotLevel(), manifest = depotManifest();
await writeFile(new URL('level.json', output), JSON.stringify(level) + '\n');
await writeFile(new URL('surface.json', output), JSON.stringify({ levelHash: manifest.levelHash, ...insertionSurface(level.boxes) }) + '\n');
await writeFile(new URL('construction.json', output), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(new URL('plan.svg', output), depotPlanSvg());
console.log(`U-171: enclosed B1–B9 depot, B0/B10 covered stairs and endpoint joins beneath the isolated surface (${manifest.shellBoxCount} shell boxes)`);
