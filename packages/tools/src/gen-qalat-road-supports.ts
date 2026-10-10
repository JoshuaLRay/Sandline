/** Generate the U-149 isolated road supports, bent by U-159, without altering production data. */
import { mkdir, writeFile } from 'node:fs/promises';
import { buildRoadSupportLevel, roadSupportManifest, roadSupportPlanSvg } from './maps/qalatRoadSupports.ts';
import { insertionSurface } from './maps/insertionSurface.ts';
const output = new URL('../../../artifacts/qalat-road-supports/', import.meta.url);
await mkdir(output, { recursive: true });
const level = buildRoadSupportLevel(), manifest = roadSupportManifest();
await writeFile(new URL('level.json', output), JSON.stringify(level) + '\n');
const surface = insertionSurface(level.boxes);
await writeFile(new URL('surface.json', output), JSON.stringify({ levelHash: manifest.levelHash, ...surface }) + '\n');
await writeFile(new URL('construction.json', output), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(new URL('plan.svg', output), roadSupportPlanSvg());
console.log(`U-159: bent isolated road supports generated (${manifest.boxCount} boxes, ${surface.indices.length / 3} exposed triangles)`);
