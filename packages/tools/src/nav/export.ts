/** Explicit-data export seam shared by registered generators and staged candidates. */
import { createHash } from 'node:crypto';
import type { World } from '@sandline/shared';
import { NavMesh, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import type { BakedNav } from '../../../server/src/ai/nav/baked/types.ts';
import { DEFAULT_NAV_AGENT, bakeWorld, navBakeHash, navConfigFor, onMesh, worldSolids, worldSoup } from './bake.ts';
import { coverPoints } from './cover.ts';
import { bakeSolidTiledNavMesh } from './solidBake.ts';

export type TiledStandingPlan = { kind: 'tiled-standing'; tileSize: number;
  bounds: [[number, number, number], [number, number, number]] };
export const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** No special traversal links: the accepted construction uses standing routes. */
export function bakeTiledStanding(world: World, plan: TiledStandingPlan): Promise<Uint8Array> {
  return bakeSolidTiledNavMesh(worldSoup(world), worldSolids(world), { ...navConfigFor(DEFAULT_NAV_AGENT), ...plan });
}
export function exportInputHash(world: World, plan?: TiledStandingPlan): string {
  // Preserve every existing registered hash when no plan is explicitly injected.
  return plan ? digest({ pipeline: 'solid-tiled-standing-v1', inputs: navBakeHash(world), plan }) : navBakeHash(world);
}
export async function exportWorldBake(world: World, plan?: TiledStandingPlan): Promise<BakedNav> {
  const bytes = await (plan ? bakeTiledStanding(world, plan) : bakeWorld(world));
  await initNav();
  const mesh = NavMesh.load(bytes);
  try {
    return { world: world.id, hash: exportInputHash(world, plan), agent: DEFAULT_NAV_AGENT,
      base64: Buffer.from(bytes).toString('base64'),
      cover: coverPoints(world, DEFAULT_NAV_AGENT, (p) => onMesh(mesh, p, DEFAULT_NAV_AGENT.climb)) };
  } finally { mesh.destroy(); }
}

/** Chunk large arrays so the generated module stays within TypeScript parser/union limits. */
export function bakedModule(bake: BakedNav, header: string): string {
  const lines = bake.base64.match(/.{1,100}/g) ?? [], coverLines: string[] = [];
  for (let offset = 0; offset < bake.cover.length; offset += 256) {
    coverLines.push(`...([${bake.cover.slice(offset, offset + 256).map((c) => JSON.stringify(c)).join(',\n    ')}] as BakedNav['cover'])`);
  }
  const cover = bake.cover.length > 1000 ? coverLines.join(',\n    ') : bake.cover.map((c) => JSON.stringify(c)).join(',\n    ');
  const low = bake.cover.filter((c) => c.height === 'low').length;
  return `${header}
import type { BakedNav } from './types.ts';

/** World '${bake.world}': ${Buffer.from(bake.base64, 'base64').length} bytes of Detour navmesh. */
export const BAKED: BakedNav = {
  world: '${bake.world}',
  hash: '${bake.hash}',
  agent: ${JSON.stringify(bake.agent)},
  // An array joined once at load, not a chain of \`+\`: two thousand
  // concatenations nest too deep for a parser to walk.
  base64: [
    ${lines.map((l) => `'${l}'`).join(',\n    ')},
  ].join(''),
  // T-3.18: ${bake.cover.length} cover points, ${low} low and ${bake.cover.length - low} high.
  cover: [
    ${cover},
  ],
};
`;
}
