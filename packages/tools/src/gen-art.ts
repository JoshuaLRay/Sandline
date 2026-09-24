/**
 * Writes every generated piece as a glTF source (T-4.04, ADR-018):
 * `assets/src/<id>.glb`, from `art/pieces/`. Then `pnpm gen:assets` makes
 * the web copies and the manifest. `art.test.ts` rebuilds every piece and
 * fails when a committed source is not what its generator writes now.
 *
 * Run: pnpm gen:art && pnpm gen:assets
 */
import { writeFileSync } from 'node:fs';
import { createIO } from './assets/pipeline.ts';
import { pieceDocument } from './art/piece.ts';
import { PIECES } from './art/pieces/index.ts';

const io = await createIO();
for (const piece of PIECES) {
  const bytes = await io.writeBinary(pieceDocument(piece));
  writeFileSync(new URL(`../../../assets/src/${piece.id}.glb`, import.meta.url), bytes);
  console.log(`${piece.id}: ${bytes.length} bytes`);
}
