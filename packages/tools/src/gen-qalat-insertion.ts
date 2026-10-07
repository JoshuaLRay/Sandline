/** Generate the isolated authoring level and review plan; does not touch production. */
import { mkdir, writeFile } from 'node:fs/promises';
import { buildInsertionLevel, insertionManifest, insertionPlanSvg } from './maps/qalatInsertion.ts';
import { insertionSurface } from './maps/insertionSurface.ts';
const output = new URL('../../../artifacts/qalat-insertion/', import.meta.url);
await mkdir(output, { recursive: true });
const level = buildInsertionLevel(), manifest = insertionManifest();
await writeFile(new URL('level.json', output), JSON.stringify(level) + '\n');
const surface = insertionSurface(level.boxes);
await writeFile(new URL('surface.json', output), JSON.stringify({ levelHash: manifest.levelHash, ...surface }) + '\n');
await writeFile(new URL('construction.json', output), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(new URL('plan.svg', output), insertionPlanSvg());
console.log(`U-138: isolated insertion generated (${manifest.boxCount} boxes, ${surface.indices.length / 3} exposed triangles); campaign unchanged`);
