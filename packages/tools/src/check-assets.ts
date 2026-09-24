/**
 * Checks the committed asset manifest against ADR-013's budgets (T-4.03,
 * `shared/src/sim/budgets.ts`): one line an asset with its numbers and
 * limits, then every overrun by name and number. Exits 1 on any overrun,
 * so CI fails on it; `pnpm verify` runs the same check as a test.
 *
 * Run: pnpm check:assets
 */
import { ASSET_BUDGETS, ASSET_MANIFEST, checkBudgets } from '@sandline/shared';

let total = 0;
for (const a of ASSET_MANIFEST.assets) {
  const b = ASSET_BUDGETS.classes[a.class];
  total += a.bytes;
  const side = Math.max(0, ...a.textures.map((t) => Math.max(t.width, t.height)));
  console.log(
    `${a.id} (${a.class}): ${a.triangles}/${b?.triangles ?? '?'} triangles, ${a.bones}/${b?.bones ?? '?'} bones, ` +
      `${a.materials}/${b?.materials ?? '?'} materials, ${a.textures.length}/${b?.textures ?? '?'} textures (largest ${side}/${b?.textureSize ?? '?'}), ${a.bytes} bytes`,
  );
}
console.log(`all manifest web copies: ${total} bytes over ${ASSET_MANIFEST.assets.length} assets (T-4.06 checks the initial pack separately with pnpm check:packs)`);
const over = checkBudgets(ASSET_MANIFEST);
for (const line of over) console.error(`OVER BUDGET  ${line}`);
if (over.length > 0) process.exit(1);
console.log('every asset within budget');
