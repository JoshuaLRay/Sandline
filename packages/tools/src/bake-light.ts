/**
 * T-4.12 lightmap spike.
 *
 * This does not write a bake. It inspects the current level/asset contract and
 * records whether a conventional level lightmap has the UV ownership it needs.
 * Run with `pnpm bake:light [level-id]`.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ASSET_MANIFEST, requireWorld } from '@sandline/shared';
import { createIO } from './assets/pipeline.ts';

export interface LightmapSpikeReport {
  level: string;
  placements: number;
  uniqueAssets: number;
  repeatedPlacements: number;
  assetsWithoutUv2: string[];
  outcome: 'candidate-lightmap' | 'fallback-piece-ao';
  reasons: string[];
}

export async function inspectLightmapBake(levelId = 'mission-01'): Promise<LightmapSpikeReport> {
  const world = requireWorld(levelId);
  const counts = new Map<string, number>();
  for (const piece of world.pieces) counts.set(piece.piece, (counts.get(piece.piece) ?? 0) + 1);

  const io = await createIO();
  const assetsWithoutUv2: string[] = [];
  for (const id of [...counts.keys()].sort()) {
    const entry = ASSET_MANIFEST.assets.find((asset) => asset.id === id);
    if (!entry) throw new Error(`level '${levelId}' references missing asset '${id}'`);
    const source = new Uint8Array(readFileSync(new URL(`../../../${entry.source}`, import.meta.url)));
    const doc = await io.readBinary(source);
    const primitives = doc.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives());
    if (primitives.length === 0 || primitives.some((primitive) => primitive.getAttribute('TEXCOORD_1') === null)) {
      assetsWithoutUv2.push(id);
    }
  }

  const repeatedPlacements = [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
  const fallback = assetsWithoutUv2.length > 0;
  const reasons = [
    `${assetsWithoutUv2.length}/${counts.size} placed asset types lack a complete TEXCOORD_1 set for lightmaps`,
    `${repeatedPlacements} placements reuse geometry through T-4.07 instancing, so unique per-placement UV2 ownership is not in the current render contract`,
    fallback
      ? 'the transport solver (Chromium lightmapper vs CPU tracer) does not solve the UV/atlas ownership problem; use PLAN.md fallback'
      : 'the current geometry contract can carry a second UV set; a transport bake may be spiked next',
  ];

  return {
    level: levelId,
    placements: world.pieces.length,
    uniqueAssets: counts.size,
    repeatedPlacements,
    assetsWithoutUv2,
    outcome: fallback ? 'fallback-piece-ao' : 'candidate-lightmap',
    reasons,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await inspectLightmapBake(process.argv[2] ?? 'mission-01');
  console.log(JSON.stringify(report, null, 2));
}
