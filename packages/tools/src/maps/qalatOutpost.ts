/** U-175: isolated outpost shell, wrapping the accepted U-173 depot unchanged.
 * The only inherited replacements are three-dimensional courtyard/gate voids;
 * supporting material below y8 and all exterior routes remain intact. */
import { createHash } from 'node:crypto';
import { loadLevel, type BoxSpec } from '@sandline/shared';
import source from './qalat-outpost.json' with { type: 'json' };
import { buildDepotLevel } from './qalatDepot.ts';
import { rectPolygon, type Polygon } from './planStrata.ts';

export const OUTPOST = source;
type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
type Cut = Rect & { minY: number; maxY: number };
const D = OUTPOST, F = D.floorY, T = D.wallM, C = D.courtyard;
const grow = (r: Rect, t: number): Rect => ({ minX: r.minX - t, maxX: r.maxX + t, minZ: r.minZ - t, maxZ: r.maxZ + t });
const inside = (r: Rect, x: number, z: number) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ;
const box = (id: string, r: Rect, minY: number, maxY: number): BoxSpec => ({ id, x: (r.minX + r.maxX) / 2,
  y: minY, z: (r.minZ + r.maxZ) / 2, w: r.maxX - r.minX, h: maxY - minY, d: r.maxZ - r.minZ });
const extent = (b: BoxSpec): Cut => ({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2,
  maxZ: b.z + b.d / 2, minY: b.y, maxY: b.y + b.h });

/** Exact six-piece AABB subtraction: a cut cannot remove earth below its floor,
 * roofs above its ceiling, or neighbouring route/courtyard geometry. */
function subtract(b: BoxSpec, cut: Cut): BoxSpec[] {
  const a = extent(b), c = { minX: Math.max(a.minX, cut.minX), maxX: Math.min(a.maxX, cut.maxX),
    minZ: Math.max(a.minZ, cut.minZ), maxZ: Math.min(a.maxZ, cut.maxZ),
    minY: Math.max(a.minY, cut.minY), maxY: Math.min(a.maxY, cut.maxY) };
  if (c.maxX - c.minX < 1e-9 || c.maxZ - c.minZ < 1e-9 || c.maxY - c.minY < 1e-9) return [b];
  return [{ ...a, maxX: c.minX }, { ...a, minX: c.maxX },
    { ...a, minX: c.minX, maxX: c.maxX, maxZ: c.minZ }, { ...a, minX: c.minX, maxX: c.maxX, minZ: c.maxZ },
    { ...c, minY: a.minY, maxY: c.minY }, { ...c, minY: c.maxY, maxY: a.maxY }]
    .filter((p) => p.maxX - p.minX > 1e-9 && p.maxZ - p.minZ > 1e-9 && p.maxY - p.minY > 1e-9)
    .map((p, i) => box(`${b.id}-outpost-cut-${i}`, p, p.minY, p.maxY));
}
const carve = (boxes: readonly BoxSpec[], cuts: readonly Cut[]) => cuts.reduce((parts, c) => parts.flatMap((b) => subtract(b, c)), [...boxes]);

function aperture(d: { axis: string; x: number; z: number; normal: number }, width: number, depth: number): Rect {
  return d.axis === 'x' ? { minX: Math.min(d.x, d.x + d.normal * depth), maxX: Math.max(d.x, d.x + d.normal * depth), minZ: d.z - width / 2, maxZ: d.z + width / 2 }
    : { minX: d.x - width / 2, maxX: d.x + width / 2, minZ: Math.min(d.z, d.z + d.normal * depth), maxZ: Math.max(d.z, d.z + d.normal * depth) };
}
export function outpostDoors() { return D.doors.map((d) => ({ ...d, y: F, width: 4, height: 3 })); }
const reserveRoom = D.rooms.find((r) => r.id === 'reserve')!;
const annexFloors: Rect[] = [D.reserve.vestibule, reserveRoom, ...D.reserve.spine.slice(1).map((b, i) => {
  const a = D.reserve.spine[i]!, t = D.reserve.width / 2;
  return { minX: Math.min(a.x, b.x) - (a.x === b.x ? t : 0), maxX: Math.max(a.x, b.x) + (a.x === b.x ? t : 0),
    minZ: Math.min(a.z, b.z) - (a.z === b.z ? t : 0), maxZ: Math.max(a.z, b.z) + (a.z === b.z ? t : 0) };
}), ...D.reserve.spine.slice(1, -1).map((p) => ({ minX: p.x - 2, maxX: p.x + 2, minZ: p.z - 2, maxZ: p.z + 2 }))];
export function outpostFloors(): readonly Polygon[] { return [C, D.eastGatePad, ...annexFloors].map(rectPolygon); }

/** Grid decomposition of the union keeps every axis-aligned inside face exact,
 * including four-metre corners; a shared wall never fills another tube's void. */
function annexShell(): BoxSpec[] {
  const outer = annexFloors.map((r) => grow(r, T));
  const xs = [...new Set([...annexFloors, ...outer].flatMap((r) => [r.minX, r.maxX]))].sort((a, b) => a - b);
  const zs = [...new Set([...annexFloors, ...outer].flatMap((r) => [r.minZ, r.maxZ]))].sort((a, b) => a - b);
  const boxes: BoxSpec[] = [];
  for (let i = 1; i < xs.length; i++) for (let j = 1; j < zs.length; j++) {
    const r = { minX: xs[i - 1]!, maxX: xs[i]!, minZ: zs[j - 1]!, maxZ: zs[j]! }, x = (r.minX + r.maxX) / 2, z = (r.minZ + r.maxZ) / 2;
    if (!outer.some((p) => inside(p, x, z))) continue;
    const open = annexFloors.some((p) => inside(p, x, z));
    boxes.push(box(`outpost-annex-${open ? 'floor' : 'wall'}-${i}-${j}`, r, open ? F - D.floorM : F, open ? F : D.reserve.ceiling + D.roofM));
    if (open) boxes.push(box(`outpost-annex-roof-${i}-${j}`, r, D.reserve.ceiling, D.reserve.ceiling + D.roofM));
  }
  // The reserve room retains a standard 4x3 doorway beneath the tube's y12 roof.
  const door = D.doors.find((d) => d.room === 'reserve')!;
  return [...carve(boxes, [{ minX: 28, maxX: 36, minZ: C.maxZ - T, maxZ: C.maxZ + C.wallM, minY: F, maxY: 12 }]),
    box('outpost-reserve-door-lintel', aperture(door, 4, T), F + 3, D.reserve.ceiling + D.roofM)];
}

export function buildOutpostShell(): BoxSpec[] {
  let perimeter = carve([box('outpost-perimeter-solid', grow(C, C.wallM), F, C.topY)], [{ ...C, minY: F, maxY: C.topY }]);
  for (const g of D.gates) {
    const opening = { ...aperture(g, g.archWidth, C.wallM), minY: F, maxY: g.ceiling };
    perimeter = carve(perimeter, [opening]);
    if (g.width < g.archWidth) {
      const infill = box(`outpost-${g.id}-arch-infill`, aperture(g, g.archWidth, C.wallM), F, g.ceiling);
      perimeter.push(...carve([infill], [{ ...aperture(g, g.width, C.wallM), minY: F, maxY: F + 3 }]));
    }
  }
  const rooms = D.rooms.filter((r) => r.id !== 'reserve').flatMap((r) => {
    let walls = carve([box(`outpost-${r.id}-walls`, grow(r, T), F, r.ceiling)], [{ ...r, minY: F, maxY: r.ceiling }]);
    // Proposed owner option A: only the cell supplies the shared divider.
    if (r.id === 'antechamber') walls = carve(walls, [{ minX: r.minX - T, maxX: r.maxX + T, minZ: D.sharedDivider.minZ, maxZ: r.maxZ + T, minY: F, maxY: r.ceiling }]);
    const cuts = [...D.doors.filter((d) => d.room === r.id).map((d) => ({ ...aperture(d, 4, T), minY: F, maxY: F + 3 })),
      ...D.windows.filter((w) => w.room === r.id).map((w) => ({ ...aperture(w, w.width, T), minY: w.sill, maxY: w.sill + w.height }))];
    return [...carve(walls, cuts), box(`outpost-${r.id}-roof`, grow(r, T), r.ceiling, r.ceiling + D.roofM)];
  });
  const bars = D.windows.filter((w) => w.barred).flatMap((w) => Array.from({ length: 7 }, (_, i) =>
    box(`outpost-${w.id}-bar-${i}`, { minX: w.x - 1.5 + i * .5 - .04, maxX: w.x - 1.5 + i * .5 + .04, minZ: w.z, maxZ: w.z + T }, w.sill, w.sill + w.height)));
  // Bounded external turning pad gives all four metres of the side door a y8
  // floor; returns meet the old R9 barrier without opening an exterior escape.
  const p = D.eastGatePad;
  return [...perimeter, ...rooms, ...bars, ...annexShell(), box('outpost-courtyard-floor', C, F - D.floorM, F),
    box('outpost-east-gate-floor', p, F - D.floorM, F),
    box('outpost-east-pad-north-return', { minX: p.minX, maxX: p.maxX + T, minZ: p.maxZ, maxZ: p.maxZ + T }, F, C.topY),
    box('outpost-east-pad-east-return', { minX: p.maxX, maxX: p.maxX + T, minZ: p.minZ, maxZ: p.maxZ }, F, C.topY)];
}

export function outpostCarveVoids(): Cut[] {
  return [{ ...C, minY: F, maxY: Infinity }, ...annexFloors.map((r) => ({ ...r, minY: F, maxY: D.reserve.ceiling })),
    { ...aperture(D.gates[0]!, 8, C.wallM), minY: F, maxY: 12 },
    { minX: 4, maxX: 8, minZ: 372, maxZ: 376, minY: F, maxY: 12 },
    { ...D.eastGatePad, minY: F, maxY: 12 }];
}
export function buildOutpostLevel() {
  const depot = buildDepotLevel();
  return { ...depot, id: D.id, boxes: [...carve(depot.boxes, outpostCarveVoids()), ...buildOutpostShell()] };
}
export function buildOutpostWorld() { return loadLevel(buildOutpostLevel()); }
export function outpostManifest() {
  const level = buildOutpostLevel(), decorations: BoxSpec[] = [];
  return { task: D.task, parent: 'U-116', kind: 'isolated outpost shell and sealed screened reserve annex',
    sourceHash: createHash('sha256').update(JSON.stringify(D)).digest('hex'),
    levelHash: createHash('sha256').update(JSON.stringify(level)).digest('hex'),
    renderHash: createHash('sha256').update(JSON.stringify([...level.boxes, ...decorations])).digest('hex'),
    boxCount: level.boxes.length, shellBoxCount: buildOutpostShell().length, courtyard: C, gates: D.gates,
    rooms: D.rooms, doors: outpostDoors(), windows: D.windows, reserve: D.reserve, sharedDivider: D.sharedDivider, eastJoin: D.eastJoin,
    carveVoids: outpostCarveVoids().map((c) => ({ ...c, maxY: Number.isFinite(c.maxY) ? c.maxY : 'sky' })), decorations,
    activeCampaign: 'unchanged; activation U-117', humanVerdict: 'whole-mission acceptance U-119',
    engineeringEvidence: 'docs/verification/U-175-outpost.md', unfinished: ['U-176 courtyard furniture and tower', 'U-177 real captive/escort tank and blast shelter proofs'] };
}
export function outpostPlanSvg() {
  const floors = outpostFloors().map((p) => `<polygon points="${p.map((v) => `${v.x},${-v.z}`).join(' ')}"/>`).join('');
  const shell = buildOutpostShell().filter((b) => b.y === F && b.h > 1).map((b) => `<rect x="${b.x - b.w / 2}" y="${-b.z - b.d / 2}" width="${b.w}" height="${b.d}"/>`).join('');
  const labels = D.rooms.map((r) => `<text x="${(r.minX + r.maxX) / 2}" y="${-(r.minZ + r.maxZ) / 2}">${r.id}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1200" viewBox="0 -454 66 104"><rect x="0" y="-454" width="66" height="104" fill="#45483d"/><g fill="#d4c2a0">${floors}</g><g fill="#786247">${shell}</g><g font-family="sans-serif" font-size="1.8" text-anchor="middle" fill="#142b32">${labels}</g></svg>\n`;
}
