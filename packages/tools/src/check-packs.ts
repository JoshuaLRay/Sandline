/**
 * T-4.06 asset-pack budget/coverage gate.
 *
 * The initial pack, not every asset in the repository, owns ADR-013's 80 MB
 * initial-download ceiling now that levels stream. Every known world must
 * have a pack, and every visual piece placed by that world must be in it.
 *
 * Run: pnpm check:packs
 */
import { ASSET_BUDGETS, ASSET_MANIFEST, ASSET_PACKS, WORLD_IDS, requireWorld } from '@sandline/shared';

const byId = new Map(ASSET_MANIFEST.assets.map((asset) => [asset.id, asset] as const));
const bytes = (ids: readonly string[]): number => ids.reduce((sum, id) => sum + (byId.get(id)?.bytes ?? 0), 0);
const errors: string[] = [];

const initial = new Set(ASSET_PACKS.initial);
const initialBytes = bytes(ASSET_PACKS.initial);
console.log(`initial pack: ${initialBytes}/${ASSET_BUDGETS.initialDownloadBytes} bytes over ${ASSET_PACKS.initial.length} assets (menu code ships in the app bundle)`);
if (initialBytes >= ASSET_BUDGETS.initialDownloadBytes) {
  errors.push(`initial pack: ${initialBytes} bytes, budget requires less than ${ASSET_BUDGETS.initialDownloadBytes}`);
}
if (!initial.has('soldier-dcu')) errors.push("initial pack: missing playable soldier 'soldier-dcu'");
for (const asset of ASSET_MANIFEST.assets) {
  if (asset.class === 'weapon' && !initial.has(asset.id)) errors.push(`initial pack: missing weapon '${asset.id}'`);
}

for (const worldId of WORLD_IDS) {
  const ids = ASSET_PACKS.levels[worldId];
  if (!ids) {
    errors.push(`level '${worldId}': no asset pack`);
    continue;
  }
  const set = new Set(ids);
  const world = requireWorld(worldId);
  for (const piece of world.pieces) {
    if (!set.has(piece.piece)) errors.push(`level '${worldId}': placed asset '${piece.piece}' is not in its pack`);
  }
  console.log(`level pack ${worldId}: ${bytes(ids)} bytes over ${ids.length} assets`);
}

for (const error of errors) console.error(`PACK ERROR  ${error}`);
if (errors.length > 0) process.exit(1);
console.log('asset packs cover every level and initial pack is within budget');
