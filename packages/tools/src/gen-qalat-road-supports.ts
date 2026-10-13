/** Generate isolated road supports and the furnished R0–R9 ridge/service bridge with U-168's C12 stairs and support bays without altering production data. */
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
console.log(`U-168: C12-L/C12-U stairs and V1–V3 support bays on the furnished R0–R9 ridge and service bridge, first-X5 ingress, road fights and D0 return store generated (${manifest.boxCount} boxes, ${surface.indices.length / 3} exposed triangles)`);
