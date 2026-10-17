/** Publish only the unregistered U-227 construction, never campaign data. */
import { mkdir, writeFile } from 'node:fs/promises';
import { buildReplacementBundle } from './maps/qalatReplacement.ts';
const output = new URL('../../client/public/wip-qalat/', import.meta.url);
const bundle = await buildReplacementBundle();
await mkdir(output, { recursive: true });
for (const name of ['level', 'surface', 'nav', 'manifest'] as const) {
  const data = JSON.stringify(bundle[name]);
  if (Buffer.byteLength(data) > 25 * 1024 * 1024) throw new Error(`preview ${name} exceeds Worker asset limit`);
  await writeFile(new URL(`${name}.json`, output), data);
}
console.log(`Staged Qalat WIP: ${bundle.manifest.bundleHash}`);
