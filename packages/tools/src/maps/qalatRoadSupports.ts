/** U-149: continuous approved road support, outside the campaign until U-117,
 * bent by U-159 so each fight sits round a corner and closed by U-160's
 * road-facing rock. Only the accepted insertion's north road cap is opened.
 * New structural slabs start at y5.5: no full-map foundation may fill future
 * basement rooms.
 */
import { createHash } from 'node:crypto';
import { loadLevel, type BoxSpec } from '@sandline/shared';
import source from './qalat-road-supports.json' with { type: 'json' };
import { ROAD_COMBAT, buildRoadCombat, combatFootprint, combatOpenFloors, combatSightBlockers } from './qalatRoadCombat.ts';
import { certifySightBlockers, combatSightReport } from './qalatRoadCombatSight.ts';
import { INSERTION, buildInsertionLevel } from './qalatInsertion.ts';
import { ROAD_TERRAIN, TERRAIN_SPURS, VIEW_FANS, buildRoadTerrain, roadTerrainManifest } from './qalatRoadTerrain.ts';
import { tankSweepReport } from './qalatTankSweep.ts';
import { TANK_INGRESS, tankIngressPath, tankIngressFloors, buildTankIngressShelter } from './qalatTankIngress.ts';
import { RETURN_SHELTERS, returnShelterFloors, buildReturnShelters } from './qalatReturnShelters.ts';
import { RIDGE, buildRidge, ridgeCarve, ridgeFloors, ridgeManifest } from './qalatRidge.ts';
import { scan, sweep, union, type Interval, type Point, type Polygon } from './planStrata.ts';
import {
  discsSeeEachOther, farthestView, longestSegment, ribbonPieces, type Disc, type Segment,
} from './roadSightLines.ts';

export const ROAD_SUPPORTS = source;
const STRATUM_M = .025;
const EDGE_M = .005;
const CIRCLE_SIDES = 512;

// Circumscribed polygon keeps all points on the specified 18 m radius
// supported. Its <0.0004 m expansion is included in the construction tolerance.
const APRON_RADIUS = ROAD_SUPPORTS.apronDiameter / 2 / Math.cos(Math.PI / CIRCLE_SIDES);

/** The larger aprons contain every changing-tangent join, including its bevel. */
export function roadSupportFloors(): readonly Polygon[] {
  const { spine, ribbonWidth, apronNodes } = ROAD_SUPPORTS;
  const aprons = spine.filter((p) => apronNodes.includes(p.id)).map((p) =>
    Array.from({ length: CIRCLE_SIDES }, (_, i) => ({
      x: p.x + APRON_RADIUS * Math.cos(2 * Math.PI * i / CIRCLE_SIDES),
      z: p.z + APRON_RADIUS * Math.sin(2 * Math.PI * i / CIRCLE_SIDES),
    })));
  return [...ribbonPieces(spine, ribbonWidth), ...aprons];
}

const bareFloors = roadSupportFloors();
const floors = [...bareFloors, ...combatOpenFloors(), ...tankIngressFloors(), ...returnShelterFloors()];
// U-163: the raised ridge shelf is carved out of the insertion and road rock
// but carries its own supports and barrier ring; it is never a y8 road floor.
const ridge = ridgeFloors(), ridgeRing = ridgeCarve();
export function tankReturnRoute() { return [...tankIngressPath(), ...ROAD_SUPPORTS.spine.slice(1, 8).reverse()]; }
export function onRoadSupportFloor(p: Point, margin = 0): boolean {
  return floors.some((poly) => {
    const span = scan(poly, p.z);
    return span !== null && p.x >= span[0] - margin && p.x <= span[1] + margin;
  });
}

export function buildRoadSupportLevel() {
  const roadMouth = ROAD_SUPPORTS.spine[1]!;
  const insertion = buildInsertionLevel({ ...INSERTION,
    continuations: INSERTION.continuations.map((p) => p.id === 'road' ? { ...p, x: roadMouth.x, z: roadMouth.z } : p),
  }, [...floors, ...ridge]);
  const boxes: BoxSpec[] = [];
  const minZ = Math.min(...floors.flatMap((p) => p.map((v) => v.z)));
  const maxZ = Math.max(...floors.flatMap((p) => p.map((v) => v.z)));
  let previous = new Map<string, BoxSpec>();
  for (let row = 0; row < Math.ceil((maxZ - minZ) / STRATUM_M); row++) {
    const z0 = minZ + row * STRATUM_M, z1 = Math.min(maxZ, minZ + (row + 1) * STRATUM_M);
    // Conservative bounds across the whole row, not midpoint sampling. The
    // skin supports required perpendicular shoulder probes through row seams.
    const spans = union(floors.map((p) => sweep(p, z0 - EDGE_M, z1 + EDGE_M))
      .filter((s): s is Interval => s !== null).map(([a, b]) => [a - EDGE_M, b + EDGE_M]));
    const next = new Map<string, BoxSpec>();
    for (const [lo, hi] of spans) {
      const key = `${lo},${hi}`, old = previous.get(key);
      if (old) { old.d = z1 + EDGE_M - (old.z - old.d / 2); old.z = z1 + EDGE_M - old.d / 2; next.set(key, old); }
      else {
        const b = { id: `road-support-${boxes.length}`, x: (lo + hi) / 2, y: ROAD_SUPPORTS.supportBottomY,
          z: (z0 + z1) / 2, w: hi - lo, h: ROAD_SUPPORTS.floorY - ROAD_SUPPORTS.supportBottomY, d: z1 - z0 + 2 * EDGE_M };
        boxes.push(b); next.set(key, b);
      }
    }
    previous = next;
  }
  return { ...insertion, id: ROAD_SUPPORTS.id, floor: { halfWidth: 150, halfDepth: 470 },
    boxes: [...insertion.boxes, ...boxes, ...buildRoadTerrain(floors, ROAD_SUPPORTS.spine, TANK_INGRESS.terrainMaxZ, ridgeRing),
      ...buildRoadCombat(), ...buildTankIngressShelter(), ...buildReturnShelters(), ...buildRidge(floors)] };
}

export function buildRoadSupportWorld() { return loadLevel(buildRoadSupportLevel()); }

type Spine = readonly { id: string; x: number; z: number }[];
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
const planPoint = (p: Point) => ({ x: round(p.x, 2), z: round(p.z, 2) });
const planSegment = (s: Segment, places = 2) => ({ length: round(s.length, places), from: planPoint(s.from), to: planPoint(s.to) });

/** U-159 plan-view pieces of the bare road: the 12 m tank lane nothing may ever
 * stand in, and the walking surface with each built apron as its circumscribed
 * disc (a superset of the 512-sided slab outline). */
export function roadSightPieces(spine: Spine = ROAD_SUPPORTS.spine) {
  const { carriagewayWidth, ribbonWidth, apronNodes } = ROAD_SUPPORTS;
  return {
    lane: ribbonPieces(spine, carriagewayWidth),
    surface: { polygons: ribbonPieces(spine, ribbonWidth),
      discs: spine.filter((p) => apronNodes.includes(p.id)).map((p) => ({ x: p.x, z: p.z, r: APRON_RADIUS })) },
  };
}

/** A fight's area: the 18 m-radius turning apron around each of its nodes. */
function fightArea(spine: Spine, id: string): Disc {
  const p = spine.find((s) => s.id === id)!;
  return { x: p.x, z: p.z, r: ROAD_SUPPORTS.apronDiameter / 2 };
}

/** Every pair of nodes belonging to different fights, with the proof result. */
export function fightSeparation(spine: Spine = ROAD_SUPPORTS.spine) {
  const { fights, proofMarginM } = ROAD_SUPPORTS.sightLines, { surface } = roadSightPieces(spine);
  return fights.flatMap((f, i) => fights.slice(i + 1).flatMap((g) => f.nodes.flatMap((a) => g.nodes.map((b) => {
    const seen = discsSeeEachOther(surface, fightArea(spine, a), fightArea(spine, b), { marginM: proofMarginM });
    return { fights: [f.id, g.id], nodes: [a, b], separated: !seen.visible, witness: seen.witness };
  }))));
}

let report: ReturnType<typeof sightReport> | undefined;
function sightReport() {
  const spine = ROAD_SUPPORTS.spine, { lane, surface } = roadSightPieces(spine);
  const { fights, maxLaneViewM, proofMarginM } = ROAD_SUPPORTS.sightLines;
  return {
    maxLaneViewM, proofMarginM,
    longestLaneView: planSegment(longestSegment(lane)),
    separatedFights: fightSeparation(spine).filter((s) => s.separated).map((s) => s.nodes.join('-')),
    // Upper bounds of the longest bare-surface view from each fight area. Any
    // view longer than the lane's leaves the lane, so cover can still cut it.
    longestFightViews: Object.fromEntries(fights.flatMap((f) => f.nodes).map((id) => [id,
      planSegment(farthestView(surface, fightArea(spine, id), 200, { stepDeg: .1, stepM: .2 }), 1)])),
  };
}
/** The committed sight-line evidence for the current road (computed once). */
export function roadSightReport() { return report ??= sightReport(); }

let combatReport: ReturnType<typeof combatSightReport> & { certification: ReturnType<typeof certifySightBlockers> };
export function roadCombatReport() {
  if (combatReport) return combatReport;
  const surface = roadSightPieces().surface;
  const blockers = combatSightBlockers();
  combatReport = {
    ...combatSightReport({ ...surface, polygons: [...surface.polygons, ...combatOpenFloors()] },
      [...ROAD_SUPPORTS.sightLines.fights.flatMap((f) => f.nodes).map((id) => ({ id, ...fightArea(ROAD_SUPPORTS.spine, id) })),
        { id: ROAD_COMBAT.frontageMG.id, x: ROAD_COMBAT.frontageMG.x, z: ROAD_COMBAT.frontageMG.z, r: .35 },
        ...ROAD_COMBAT.frontageRiflemen.map((p) => ({ id: p.id, x: p.x, z: p.z, r: .35 }))], blockers),
    certification: certifySightBlockers(blockers, buildRoadCombat()),
  };
  return combatReport;
}

let tankReport: ReturnType<typeof tankSweepReport> & { levelHash: string };
let tankReportInputHash: string;
/** Independently verifiable expensive evidence, shared with the complete
 * manifest. The current generated level selects this cache; committed report
 * contents never populate it. */
export function roadTankSweepReport(level = buildRoadSupportLevel()) {
  const levelHash = createHash('sha256').update(JSON.stringify(level)).digest('hex');
  const route = tankReturnRoute();
  const inputHash = createHash('sha256').update(JSON.stringify({ levelHash, route })).digest('hex');
  if (tankReportInputHash !== inputHash) {
    tankReport = { levelHash, ...tankSweepReport(loadLevel(level).boxes, route) };
    tankReportInputHash = inputHash;
  }
  return tankReport;
}

export function roadSupportManifest() {
  const level = buildRoadSupportLevel();
  const levelHash = createHash('sha256').update(JSON.stringify(level)).digest('hex');
  return { task: 'U-163', parent: 'U-140', foundation: 'U-149', bend: 'U-159', rock: 'U-160', road: 'U-139',
    kind: 'isolated surface whitebox: road fights, screened tank ingress, D0 return store and R0–R7 ridge shelf',
    activeCampaign: 'unchanged; activation belongs to U-117',
    sourceHash: createHash('sha256').update(JSON.stringify({ insertion: INSERTION, road: ROAD_SUPPORTS, terrain: ROAD_TERRAIN, combat: ROAD_COMBAT, ingress: TANK_INGRESS, shelters: RETURN_SHELTERS, ridge: RIDGE })).digest('hex'),
    levelHash, boxCount: level.boxes.length,
    stratumM: STRATUM_M, edgeExpansionM: EDGE_M, circleSides: CIRCLE_SIDES,
    floorY: ROAD_SUPPORTS.floorY, supportBottomY: ROAD_SUPPORTS.supportBottomY,
    ribbonWidth: ROAD_SUPPORTS.ribbonWidth, carriagewayWidth: ROAD_SUPPORTS.carriagewayWidth,
    shoulderWidth: ROAD_SUPPORTS.shoulderWidth, apronDiameter: ROAD_SUPPORTS.apronDiameter,
    spine: ROAD_SUPPORTS.spine, apronNodes: ROAD_SUPPORTS.apronNodes,
    reservedBridge: ROAD_SUPPORTS.reservedBridge, reservedVault: ROAD_SUPPORTS.reservedVault,
    sightLines: roadSightReport(),
    terrain: roadTerrainManifest(level.boxes),
    combat: ROAD_COMBAT,
    ingress: TANK_INGRESS,
    returnShelters: RETURN_SHELTERS,
    ridge: ridgeManifest(level.boxes),
    tankSweep: roadTankSweepReport(level),
    combatSightLines: roadCombatReport(),
    ownerQualityVerdict: 'road look/play batched in U-139; ridge look/play batched in U-140',
    unfinished: ['R7b bridge and R8/R9 descent: U-164', 'ridge huts, cover and R5 hold: U-165',
      'support bays/C12 stairs: U-141', 'outpost: U-116', 'basement: U-115'],
  };
}

export function roadSupportPlanSvg(): string {
  const p = (n: number) => n.toFixed(3);
  const points = (poly: Polygon) => poly.map((v) => `${p(v.x)},${p(-v.z)}`).join(' ');
  const polygons = floors.map((poly) => `<polygon points="${points(poly)}"/>`).join('\n');
  const labels = [...ROAD_SUPPORTS.spine, ...tankIngressPath()].map((s) => `<circle cx="${s.x}" cy="${-s.z}" r="1"/><text x="${s.x + 2}" y="${-s.z - 2}">${s.id} · y8</text>`).join('\n');
  const sight = roadSightReport(), lane = sight.longestLaneView;
  const fights = ROAD_SUPPORTS.sightLines.fights.map((f) => f.nodes.map((id) => {
    const a = fightArea(ROAD_SUPPORTS.spine, id);
    return `<circle cx="${a.x}" cy="${-a.z}" r="${a.r}"/><text x="${a.x - 6}" y="${-a.z + 5}" fill="#8a2f1d" stroke="none">${f.id}</text>`;
  }).join('\n')).join('\n');
  // U-160: the rock's outline traced from the generated boxes in 1 m bands,
  // its zones and reservations.
  const t = ROAD_TERRAIN, rock = buildRoadSupportLevel().boxes.filter((b) => b.id.startsWith('road-rock') || b.id.startsWith('road-cap-'));
  const east = Array.from({ length: TANK_INGRESS.terrainMaxZ - t.minZ }, (_, i) => {
    const z0 = t.minZ + i, band = rock.filter((b) => b.z + b.d / 2 > z0 && b.z - b.d / 2 < z0 + 1);
    const x = Math.max(...band.map((b) => b.x + b.w / 2));
    return [{ x, z: z0 }, { x, z: z0 + 1 }];
  }).flat();
  const region = [{ x: t.minX, z: t.minZ }, { x: t.minX, z: TANK_INGRESS.terrainMaxZ }, ...east.reverse()];
  const spurs = TERRAIN_SPURS.map((s) => `<polygon points="${points(s.polygon)}" stroke-dasharray=".6 .6"/><text x="${s.polygon.reduce((a, v) => a + v.x, 0) / s.polygon.length - 6}" y="${-s.polygon.reduce((a, v) => a + v.z, 0) / s.polygon.length}" stroke="none" fill="#3c3f33">${s.id} y${s.top}</text>`).join('\n');
  const fins = t.fins.map((f) => `<rect x="${f.minX}" y="${-f.maxZ}" width="${f.maxX - f.minX}" height="${f.maxZ - f.minZ}"/><text x="${f.maxX + 1}" y="${-f.minZ}" fill="#3c3f33">${f.id} y${f.top}</text>`).join('\n');
  const caps = t.temporaryCaps.map((c) => `<rect x="${c.minX}" y="${-c.maxZ}" width="${c.maxX - c.minX}" height="${c.maxZ - c.minZ}"/>`).join('\n');
  const fans = VIEW_FANS.map((f) => `<polygon points="${points(f.hull)}"/>${f.rays.map((r) => `<line x1="${f.eye.x}" y1="${-f.eye.z}" x2="${r.to.x}" y2="${-r.to.z}"/>`).join('')}<text x="${f.eye.x - 9}" y="${-f.eye.z - 2}" stroke="none" fill="#5d3a7a">${f.id}</text>`).join('\n');
  const cover = [...ROAD_COMBAT.cover, ...ROAD_COMBAT.screens, ...ROAD_COMBAT.facades].map((c) =>
    `<polygon points="${points(combatFootprint(c))}"/><text x="${c.x + 1}" y="${-c.z - 1}" fill="#3f2517" stroke="none">${c.id}</text>`).join('\n');
  const trees = ROAD_COMBAT.orchard.trees.map((c) => `<circle cx="${c.x}" cy="${-c.z}" r=".35"/>`).join('\n');
  const regroup = ROAD_COMBAT.regroupPads.map((c) => `<rect x="${c.x - c.w / 2}" y="${-c.z - c.d / 2}" width="${c.w}" height="${c.d}"/>`).join('\n');
  const ingressScreens = TANK_INGRESS.forecourtScreens.map((c) =>
    `<rect x="${c.x - c.w / 2}" y="${-c.z - c.d / 2}" width="${c.w}" height="${c.d}"/>`).join('\n');
  const frontage = [ROAD_COMBAT.frontageMG, ...ROAD_COMBAT.frontageRiflemen].map((c) => `<circle cx="${c.x}" cy="${-c.z}" r=".6"/><text x="${c.x + 1}" y="${-c.z}">${c.id}</text>`).join('\n');
  const office = combatOpenFloors().map((c) => `<polygon points="${points(c)}"/>`).join('\n');
  // U-163: the ridge shelf, its node floors and the temporary caps for U-141/U-164.
  const shelf = ridge.map((c) => `<polygon points="${points(c)}"/>`).join('\n');
  const ridgeNodes = RIDGE.spine.map((n) => `<circle cx="${n.x}" cy="${-n.z}" r="1"/><text x="${n.x + 2}" y="${-n.z + 1}">${n.id} · y${n.y}</text>`).join('\n');
  const ridgeCaps = RIDGE.temporaryCaps.map((c) => `<rect x="${c.minX}" y="${-c.maxZ}" width="${c.maxX - c.minX}" height="${c.maxZ - c.minZ}"/>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1900" viewBox="-74 -516 216 470">
<rect x="-74" y="-516" width="216" height="470" fill="#b7c6ca"/>
<polygon points="${points(region)}" fill="#8d917f"/>
<g fill="none" stroke="#3c3f33" stroke-width=".2" font-family="sans-serif" font-size="2.5">${spurs}</g>
<g fill="#5e6152" font-family="sans-serif" font-size="2.5">${fins}</g>
<g fill="#5c6b80" fill-opacity=".85">${caps}</g>
<g fill="#d8ccb6" stroke="#766a54" stroke-width=".1">${polygons}</g>
<g fill="none" stroke="#2b7c61" stroke-width=".25">${regroup}</g>
<g fill="#a8804c" stroke="#3f2517" stroke-width=".15" font-family="sans-serif" font-size="1.8">${cover}${trees}</g>
<g fill="#5e6152" fill-opacity=".65" stroke="#3c3f33" stroke-width=".2">${ingressScreens}</g>
<g fill="#a8804c" fill-opacity=".7" stroke="#3f2517" stroke-width=".15">${office}</g>
<g fill="#e6dcc4" stroke="#8a6a3a" stroke-width=".12">${shelf}</g>
<g fill="#5c6b80" fill-opacity=".85">${ridgeCaps}</g>
<g fill="#5a3d1c" font-family="sans-serif" font-size="2.5">${ridgeNodes}</g>
<rect x="45.4" y="-62.6" width="9.2" height="9.2" fill="#a8804c" stroke="#3f2517" stroke-width=".2"/>
<rect x="44" y="-60" width="6" height="4" fill="#d8ccb6"/>
<circle cx="50" cy="-58" r=".5" fill="#2b7c61"/>
<text x="55" y="-58" fill="#3f2517" font-family="sans-serif" font-size="1.8">D0 store · y8/12</text>
<text x="-8" y="-118" fill="#3f2517" font-family="sans-serif" font-size="1.8">toll office</text>
<g fill="#993434" font-family="sans-serif" font-size="2">${frontage}</g>
<rect x="16" y="-288" width="28" height="36" fill="none" stroke="#5b6d86" stroke-dasharray="1 1"/>
<rect x="66" y="-342" width="8" height="12" fill="none" stroke="#5b6d86" stroke-dasharray="1 1"/>
<g fill="none" stroke="#5d3a7a" stroke-width=".25" stroke-dasharray="1.5 .8" font-family="sans-serif" font-size="2.5">${fans}</g>
<g fill="none" stroke="#8a2f1d" stroke-width=".35" stroke-dasharray="2 1" font-family="sans-serif" font-size="3">${fights}</g>
<line x1="${lane.from.x}" y1="${-lane.from.z}" x2="${lane.to.x}" y2="${-lane.to.z}" stroke="#c0392b" stroke-width=".6"/>
<g fill="#162e35" font-family="sans-serif" font-size="2.5">${labels}
<text x="-69" y="-507" font-size="3.5">U-163 · R0–R7 ridge shelf, first-X5 mouth, D0 return store and road fights · north ↑</text>
<text x="-69" y="-501">20 m ribbon / 12 m carriageway / 36 m aprons; grey: rock from y5.5, ≥${t.edgeMinHeightM} m above the road</text>
<text x="-69" y="-496">West T-W crest y${t.sideTops.left}; east T-C/T-E foot y${t.sideTops.right}; dotted: inside-corner spur zones (off-road part)</text>
<text x="-69" y="-491">Purple: ridge bay fans and target rays; rock stays ${t.viewFans.rayClearanceM} m under them</text>
<text x="-69" y="-486">Blue-grey: temporary caps (C12-L mouth and V1–V3 bay fronts for U-141, R7 bridge mouth for U-164, south gate for U-116)</text>
<text x="-69" y="-481">Dashed red: the three fights. Solid red: longest tank-lane view ${lane.length.toFixed(1)} m (limit ${sight.maxLaneViewM} m)</text>
<text x="-69" y="-476">Dashed blue: future B6 vault and ridge bridge; reserved.</text>
<text x="-69" y="-471" fill="#5a3d1c">Pale: 8 m ridge shelf, 0.20 m risers in 10-riser flights on 0.40 m treads, ≥2 m rest landings, rock ≥2.2 m above every edge</text>
<text x="-69" y="-50">Isolated whitebox; X0–X6 and R0–R7 built, bridge reserved for U-164. Road look/play: U-139; ridge look/play: U-140.</text></g>
</svg>\n`;
}
