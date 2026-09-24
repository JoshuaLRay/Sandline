/**
 * Writes the code-built soldier as the pipeline's test input,
 * `assets/src/soldier.glb` (T-4.02; see `assets/soldierSource.ts`). Run once
 * and committed; `pnpm gen:assets` then processes it like any other source.
 *
 * Run: pnpm export:soldier
 */
import { writeFileSync } from 'node:fs';
import { createIO } from './assets/pipeline.ts';
import { soldierSourceDocument } from './assets/soldierSource.ts';

const io = await createIO();
const bytes = await io.writeBinary(soldierSourceDocument());
const out = new URL('../../../assets/src/soldier.glb', import.meta.url);
writeFileSync(out, bytes);
console.log(`wrote assets/src/soldier.glb: ${bytes.length} bytes`);
