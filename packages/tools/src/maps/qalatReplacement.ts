/** U-227: complete, unregistered revision-2 construction bundle. Never consult a live world lookup. */
import { gzipSync, gunzipSync } from 'node:zlib';
import { loadLevel, parseMission } from '@sandline/shared';
import { bakedBytes } from '../../../server/src/ai/nav/baked/types.ts';
import { NavMesh } from '../../../server/src/ai/nav/NavMesh.ts';
import { digest, exportInputHash, exportWorldBake } from '../nav/export.ts';
import { coverCounts } from '../nav/cover.ts';
import { buildOutpostLevel } from './qalatOutpost.ts';
import { outpostDecorations } from './qalatOutpostFurniture.ts';
import { buildOutpostCaptiveFixture } from './qalatOutpostCaptives.ts';
import { QALAT_TILED_PLAN } from './qalatRoadNav.ts';
import { insertionSurface } from './insertionSurface.ts';
import { buildReplacementEncounter } from './qalatReplacementEncounter.ts';
import { buildReplacementSupplies } from './qalatReplacementSupplies.ts';

export function replacementInputs() {
  const level = { ...buildOutpostLevel(), mapRevision: 2 };
  const world = loadLevel(level), { mission, pow } = buildOutpostCaptiveFixture(world);
  const decorations = outpostDecorations();
  return { level, world, mission, pow, decorations };
}
const yieldPhase = () => new Promise<void>((resolve) => setImmediate(resolve));
export async function buildReplacementBundle() {
  const { level, world, mission, pow, decorations } = replacementInputs();
  const { encounter, encounterMission, emplacements } = buildReplacementEncounter(world);
  const encounterDigest = digest({ encounter, encounterMission, emplacements });
  const supplyCaches = buildReplacementSupplies(world);
  const supplyDigest = digest(supplyCaches);
  const levelHash = digest(level), renderHash = digest([...level.boxes, ...decorations]);
  await yieldPhase();
  const rendered = insertionSurface([...level.boxes, ...decorations]);
  await yieldPhase();
  // Lossless transport only; the exact union/ceiling faces remain the render input.
  const surface = { levelHash, renderHash, encoding: 'gzip-json-v1', contentHash: digest(rendered),
    triangles: rendered.indices.length / 3,
    data: gzipSync(JSON.stringify(rendered), { level: 9 }).toString('base64') };
  await yieldPhase();
  const nav = await exportWorldBake(world, QALAT_TILED_PLAN);
  const hashes = { level: levelHash, render: renderHash, surface: digest(surface), mission: digest(mission),
    navInput: nav.hash, nav: digest(nav), cover: digest(nav.cover),
    starts: digest(level.squadStarts), holdings: digest({ pow, carried: mission.prisonerHoldings }) };
  return { level, surface, mission, nav, encounter, encounterMission, emplacements, encounterDigest,
    supplyCaches, supplyDigest, manifest: {
    task: 'U-227', world: world.id, mapRevision: 2, registered: false,
    levelHash, renderHash, decorations, pow, hashes, bundleHash: digest(hashes),
    navPlan: QALAT_TILED_PLAN, boxes: level.boxes.length,
    squadStarts: level.squadStarts, cover: coverCounts(nav.cover),
    bytes: { nav: bakedBytes(nav).length, level: Buffer.byteLength(JSON.stringify(level)),
      surface: Buffer.byteLength(JSON.stringify(surface)) },
    review: '/packages/tools/src/maps/outpost-review.html?replacement',
    activation: 'U-233 only, after U-228 through U-232; then U-118 and U-119',
    humanVerdict: 'pending U-119',
  } };
}
export type ReplacementBundle = Awaited<ReturnType<typeof buildReplacementBundle>>;

/** Validate serialized artifacts before handing their explicit data to a Session or reviewer. */
export function reloadReplacement(bundle: ReplacementBundle) {
  const { level, surface, mission, nav, manifest: m, encounter, encounterMission, emplacements, encounterDigest,
    supplyCaches, supplyDigest } = bundle;
  // Reject serialized tampering against the existing source-bound manifest
  // before loading 110k collision boxes and auditing all encounter sockets.
  // This also bounds the negative-test matrix without skipping any checks.
  if (digest(supplyCaches) !== supplyDigest)
    throw new Error('stale or altered U-229 replacement supplies');
  if (m.registered !== false || m.mapRevision !== 2 || level.mapRevision !== 2 ||
    m.world !== level.id || nav.world !== level.id ||
    digest(level) !== m.hashes.level || digest(mission) !== m.hashes.mission ||
    digest(surface) !== m.hashes.surface || digest(nav) !== m.hashes.nav ||
    digest(nav.cover) !== m.hashes.cover || digest(level.squadStarts) !== m.hashes.starts ||
    digest({ pow: m.pow, carried: mission.prisonerHoldings }) !== m.hashes.holdings ||
    m.levelHash !== m.hashes.level || m.renderHash !== m.hashes.render ||
    surface.levelHash !== m.hashes.level || surface.renderHash !== m.hashes.render ||
    digest(m.hashes) !== m.bundleHash || digest(m.navPlan) !== digest(QALAT_TILED_PLAN))
    throw new Error('stale or inconsistent unregistered Qalat replacement bundle');
  const world = loadLevel(level), parsed = parseMission(mission);
  const hashes = { level: digest(level), render: digest([...level.boxes, ...m.decorations]),
    surface: digest(surface), mission: digest(mission), navInput: exportInputHash(world, m.navPlan),
    nav: digest(nav), cover: digest(nav.cover), starts: digest(level.squadStarts),
    holdings: digest({ pow: m.pow, carried: mission.prisonerHoldings }) };
  if (digest(buildReplacementSupplies(world)) !== supplyDigest)
    throw new Error('stale or altered U-229 replacement supplies');
  if (parsed.id !== world.id || parsed.world !== world.id ||
    nav.hash !== hashes.navInput || m.hashes.render !== hashes.render ||
    m.hashes.navInput !== hashes.navInput || digest(hashes) !== m.bundleHash)
    throw new Error('stale or inconsistent unregistered Qalat replacement bundle');
  if (digest({ encounter, encounterMission, emplacements }) !== encounterDigest ||
    encounter.world !== world.id)
    throw new Error('stale or altered U-228 replacement encounter');
  const authored = buildReplacementEncounter(world);
  if (digest(authored) !== encounterDigest)
    throw new Error('stale or altered U-228 replacement encounter');
  if (surface.encoding !== 'gzip-json-v1' ||
    digest(JSON.parse(gunzipSync(Buffer.from(surface.data, 'base64')).toString('utf8'))) !== surface.contentHash)
    throw new Error('replacement render surface content changed');
  const fixture = buildOutpostCaptiveFixture(world, parsed);
  if (digest(fixture.pow) !== digest(m.pow)) throw new Error('replacement POW holding changed');
  return { ...fixture, encounter, encounterMission, emplacements, supplyCaches,
    nav: NavMesh.load(bakedBytes(nav), nav.agent.height) };
}
