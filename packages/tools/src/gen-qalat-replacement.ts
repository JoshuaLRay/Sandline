/** Reproduce the entire candidate without registering any production inputs. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildReplacementBundle } from './maps/qalatReplacement.ts';
const output = new URL('../../../artifacts/qalat-replacement/', import.meta.url);
const bundle = await buildReplacementBundle(), check = process.argv.includes('--check');
await mkdir(output, { recursive: true });
for (const [name, value] of Object.entries(bundle)) {
  const text = JSON.stringify(value, null, name === 'manifest' ? 2 : undefined) + '\n';
  const path = new URL(`${name}.json`, output);
  if (check) {
    if (await readFile(path, 'utf8') !== text) throw new Error(`stale replacement ${name}; run pnpm gen:qalat-replacement`);
  } else await writeFile(path, text);
}
console.log(`U-227 ${check ? 'fresh' : 'generated'}: ${bundle.manifest.bundleHash}; ${bundle.manifest.boxes} boxes; ${bundle.manifest.bytes.nav} nav bytes; ${bundle.manifest.cover.total} cover`);
