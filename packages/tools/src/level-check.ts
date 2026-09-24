/**
 * T-4.11: level validation and review renders.
 *
 * Levels stay data-first: this tool consumes a level JSON, expands it through
 * the shared loader, checks the resulting world and committed navmesh, and
 * writes deterministic PNGs for human review. It intentionally has no editor
 * dependency and no browser dependency.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  ASSET_BUDGETS,
  ASSET_MANIFEST,
  DEFAULT_MUZZLE_RIG,
  loadLevel,
  rayWorld,
  type AssetManifest,
  type LevelBoxSpec,
  type World,
  type WorldMission,
} from '@sandline/shared';
import { initNav, type NavMesh, type NavPath, type NavPoint } from '../../server/src/ai/nav/NavMesh.ts';
import { bakedNavFor, loadWorldNavMesh } from '../../server/src/ai/nav/bakedNav.ts';

const LEVELS_DIR = fileURLToPath(new URL('../../shared/src/data/levels/', import.meta.url));
const DEFAULT_RENDER_DIR = join(process.cwd(), 'artifacts', 'level-review');
const REACH_M = 0.5;
const OVERLAP_EPS_M = 1e-9;
const SPAWN_PROBES_M = [0.3, 1.0, 1.7] as const;

export interface LevelIssue {
  check: 'collision-overlap' | 'navmesh-island' | 'spawn-visibility' | 'route-connectivity' | 'piece-budget';
  message: string;
}

export interface PieceBudgetTotals {
  instances: number;
  bytes: number;
  triangles: number;
  bones: number;
  materials: number;
  textures: number;
  byClass: Record<string, {
    instances: number;
    bytes: number;
    triangles: number;
    bones: number;
    materials: number;
    textures: number;
  }>;
}

export interface ReviewRenders {
  topDown: string;
  cameras: string[];
}

export interface LevelCheckReport {
  id: string;
  checks: {
    collisionOverlaps: number;
    navmeshIslands: number;
    visibleSpawnZones: number;
    brokenRouteLegs: number;
    budgetBytes: number;
  };
  budgets: PieceBudgetTotals;
  issues: LevelIssue[];
  renders?: ReviewRenders;
}

export type LevelNavProbe = Pick<NavMesh, 'path' | 'polygons'>;

function issue(check: LevelIssue['check'], message: string): LevelIssue {
  return { check, message };
}

function axisOverlap(aMin: number, aMax: number, bMin: number, bMax: number): number {
  return Math.min(aMax, bMax) - Math.max(aMin, bMin);
}

function boxExtents(box: LevelBoxSpec): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
  return {
    minX: box.x - box.w / 2,
    maxX: box.x + box.w / 2,
    minY: box.y,
    maxY: box.y + box.h,
    minZ: box.z - box.d / 2,
    maxZ: box.z + box.d / 2,
  };
}

export function collisionOverlaps(boxes: readonly LevelBoxSpec[]): LevelIssue[] {
  const out: LevelIssue[] = [];
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]!;
    const ae = boxExtents(a);
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j]!;
      const be = boxExtents(b);
      if (
        axisOverlap(ae.minX, ae.maxX, be.minX, be.maxX) > OVERLAP_EPS_M &&
        axisOverlap(ae.minY, ae.maxY, be.minY, be.maxY) > OVERLAP_EPS_M &&
        axisOverlap(ae.minZ, ae.maxZ, be.minZ, be.maxZ) > OVERLAP_EPS_M
      ) {
        out.push(issue(
          'collision-overlap',
          'collision boxes ' + a.id + ' and ' + b.id + ' overlap with positive volume',
        ));
      }
    }
  }
  return out;
}

export function navmeshIslands(nav: LevelNavProbe, root: NavPoint): LevelIssue[] {
  const polygons = nav.polygons();
  if (polygons.length === 0) {
    return [issue('navmesh-island', 'navmesh has no walkable polygons')];
  }

  const out: LevelIssue[] = [];
  for (const polygon of polygons) {
    const path = nav.path(root, polygon.centre);
    if (path === null) {
      out.push(issue(
        'navmesh-island',
        'polygon ' + polygon.ref + ' at (' +
          polygon.centre.x.toFixed(2) + ', ' +
          polygon.centre.z.toFixed(2) +
          ') is not reachable from the level start',
      ));
      if (out.length >= 20) {
        out.push(issue('navmesh-island', 'more unreachable polygons exist; first 20 are shown'));
        break;
      }
    }
  }
  return out;
}

function spawnSamples(zone: { x: number; z: number; radius: number }): { x: number; z: number }[] {
  const out = [{ x: zone.x, z: zone.z }];
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    out.push({
      x: zone.x + Math.sin(a) * zone.radius,
      z: zone.z + Math.cos(a) * zone.radius,
    });
  }
  return out;
}

export function visibleSpawnZones(world: World): LevelIssue[] {
  const mission = world.mission;
  if (mission === null) return [];

  const out: LevelIssue[] = [];
  for (const zone of mission.spawnZones) {
    let visibleAt: { x: number; y: number; z: number } | null = null;
    outer:
    for (const sample of spawnSamples(zone)) {
      for (const y of SPAWN_PROBES_M) {
        const target = { x: sample.x, y, z: sample.z };
        const dx = target.x - mission.start.x;
        const dy = target.y - DEFAULT_MUZZLE_RIG.eyeHeight;
        const dz = target.z - mission.start.z;
        const distance = Math.hypot(dx, dy, dz);
        if (distance <= 1e-6) continue;
        const clear = rayWorld({
          origin: { x: mission.start.x, y: DEFAULT_MUZZLE_RIG.eyeHeight, z: mission.start.z },
          direction: { x: dx / distance, y: dy / distance, z: dz / distance },
          maxDistance: distance,
        }, world.boxes) === null;
        if (clear) {
          visibleAt = target;
          break outer;
        }
      }
    }
    if (visibleAt !== null) {
      out.push(issue(
        'spawn-visibility',
        'spawn zone ' + zone.id + ' is visible from the mission start near (' +
          visibleAt.x.toFixed(2) + ', ' +
          visibleAt.y.toFixed(2) + ', ' +
          visibleAt.z.toFixed(2) + ')',
      ));
    }
  }
  return out;
}

function routeStops(mission: WorldMission, route: WorldMission['routes'][number]): NavPoint[] {
  return [
    { x: mission.start.x, y: 0, z: mission.start.z },
    ...route.via.map((p) => ({ x: p.x, y: 0, z: p.z })),
    { x: mission.objective.x, y: 0, z: mission.objective.z },
  ];
}

export interface RouteConnectivityResult {
  issues: LevelIssue[];
  routePaths: Map<string, NavPath[]>;
}

export function routeConnectivity(nav: LevelNavProbe, mission: WorldMission): RouteConnectivityResult {
  const issues: LevelIssue[] = [];
  const routePaths = new Map<string, NavPath[]>();

  for (const route of mission.routes) {
    const stops = routeStops(mission, route);
    const paths: NavPath[] = [];
    for (let i = 1; i < stops.length; i++) {
      const path = nav.path(stops[i - 1]!, stops[i]!);
      if (path === null) {
        issues.push(issue(
          'route-connectivity',
          route.id + ': no navmesh path for leg ' + i +
            ' (' + stops[i - 1]!.x.toFixed(1) + ', ' + stops[i - 1]!.z.toFixed(1) +
            ') -> (' + stops[i]!.x.toFixed(1) + ', ' + stops[i]!.z.toFixed(1) + ')',
        ));
        continue;
      }
      paths.push(path);
      const last = path.points[path.points.length - 1];
      if (last === undefined) {
        issues.push(issue('route-connectivity', route.id + ': leg ' + i + ' returned an empty path'));
      } else {
        const gap = Math.hypot(last.x - stops[i]!.x, last.z - stops[i]!.z);
        if (gap > REACH_M) {
          issues.push(issue(
            'route-connectivity',
            route.id + ': leg ' + i + ' stops ' + gap.toFixed(2) + ' m short of its target',
          ));
        }
      }
    }
    routePaths.set(route.id, paths);
  }
  return { issues, routePaths };
}

function emptyClassBudget(): PieceBudgetTotals['byClass'][string] {
  return { instances: 0, bytes: 0, triangles: 0, bones: 0, materials: 0, textures: 0 };
}

export function pieceBudgetTotals(world: World, manifest: AssetManifest = ASSET_MANIFEST): { totals: PieceBudgetTotals; issues: LevelIssue[] } {
  const totals: PieceBudgetTotals = {
    instances: world.pieces.length,
    bytes: 0,
    triangles: 0,
    bones: 0,
    materials: 0,
    textures: 0,
    byClass: {},
  };
  const issues: LevelIssue[] = [];

  for (const piece of world.pieces) {
    const asset = manifest.assets.find((a) => a.id === piece.piece);
    if (asset === undefined) {
      issues.push(issue('piece-budget', 'piece ' + piece.id + ' references missing asset ' + piece.piece));
      continue;
    }
    const current = totals.byClass[asset.class] ?? emptyClassBudget();
    current.instances++;
    current.bytes += asset.bytes;
    current.triangles += asset.triangles;
    current.bones += asset.bones;
    current.materials += asset.materials;
    current.textures += asset.textures.length;
    totals.byClass[asset.class] = current;
    totals.bytes += asset.bytes;
    totals.triangles += asset.triangles;
    totals.bones += asset.bones;
    totals.materials += asset.materials;
    totals.textures += asset.textures.length;
  }

  if (totals.bytes > ASSET_BUDGETS.initialDownloadBytes) {
    issues.push(issue(
      'piece-budget',
      'placed pieces sum to ' + totals.bytes + ' bytes, over the initial-download budget of ' +
        ASSET_BUDGETS.initialDownloadBytes + ' bytes',
    ));
  }

  return { totals, issues };
}

function rootFor(world: World, nav: LevelNavProbe): NavPoint {
  if (world.mission !== null) {
    return { x: world.mission.start.x, y: 0, z: world.mission.start.z };
  }
  const first = nav.polygons()[0];
  return first?.centre ?? { x: 0, y: 0, z: 0 };
}

export function checkLevel(world: World, nav: LevelNavProbe, manifest: AssetManifest = ASSET_MANIFEST): LevelCheckReport {
  const overlapIssues = collisionOverlaps(world.boxes);
  const islandIssues = navmeshIslands(nav, rootFor(world, nav));
  const spawnIssues = visibleSpawnZones(world);
  const routeResult = world.mission === null
    ? { issues: [], routePaths: new Map<string, NavPath[]>() }
    : routeConnectivity(nav, world.mission);
  const budgetResult = pieceBudgetTotals(world, manifest);

  return {
    id: world.id,
    checks: {
      collisionOverlaps: overlapIssues.length,
      navmeshIslands: islandIssues.length,
      visibleSpawnZones: spawnIssues.length,
      brokenRouteLegs: routeResult.issues.length,
      budgetBytes: budgetResult.totals.bytes,
    },
    budgets: budgetResult.totals,
    issues: [
      ...overlapIssues,
      ...islandIssues,
      ...spawnIssues,
      ...routeResult.issues,
      ...budgetResult.issues,
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* Deterministic software review renderer                                     */
/* -------------------------------------------------------------------------- */

type Rgba = readonly [number, number, number, number];
interface ScreenPoint {
  x: number;
  y: number;
  depth: number;
}

const COLORS = {
  background: [20, 23, 24, 255] as Rgba,
  floor: [42, 47, 49, 255] as Rgba,
  lowBox: [102, 111, 117, 255] as Rgba,
  highBox: [145, 150, 153, 255] as Rgba,
  topBox: [180, 184, 187, 255] as Rgba,
  routeA: [238, 177, 71, 255] as Rgba,
  routeB: [83, 176, 227, 255] as Rgba,
  routeOther: [201, 123, 221, 255] as Rgba,
  spawn: [230, 82, 82, 255] as Rgba,
  start: [90, 224, 124, 255] as Rgba,
  objective: [249, 222, 82, 255] as Rgba,
  grid: [61, 68, 70, 255] as Rgba,
  edge: [8, 10, 11, 255] as Rgba,
} as const;

function setPixel(png: PNG, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (y * png.width + x) * 4;
  png.data[i] = color[0];
  png.data[i + 1] = color[1];
  png.data[i + 2] = color[2];
  png.data[i + 3] = color[3];
}

function drawLine(png: PNG, a: { x: number; y: number }, b: { x: number; y: number }, color: Rgba, width = 1): void {
  const dx = Math.abs(b.x - a.x);
  const sx = a.x < b.x ? 1 : -1;
  const dy = -Math.abs(b.y - a.y);
  const sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  let x = Math.round(a.x);
  let y = Math.round(a.y);
  const ex = Math.round(b.x);
  const ey = Math.round(b.y);
  const radius = Math.max(0, Math.floor(width / 2));
  for (;;) {
    for (let oy = -radius; oy <= radius; oy++) {
      for (let ox = -radius; ox <= radius; ox++) setPixel(png, x + ox, y + oy, color);
    }
    if (x === ex && y === ey) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function fillRect(png: PNG, x0: number, y0: number, x1: number, y1: number, color: Rgba): void {
  const left = Math.max(0, Math.floor(Math.min(x0, x1)));
  const right = Math.min(png.width - 1, Math.ceil(Math.max(x0, x1)));
  const top = Math.max(0, Math.floor(Math.min(y0, y1)));
  const bottom = Math.min(png.height - 1, Math.ceil(Math.max(y0, y1)));
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) setPixel(png, x, y, color);
  }
}

function fillCircle(png: PNG, cx: number, cy: number, radius: number, color: Rgba): void {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(png.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(png.height - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) setPixel(png, x, y, color);
    }
  }
}

function fillPolygon(png: PNG, points: readonly { x: number; y: number }[], color: Rgba): void {
  if (points.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(png.height - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        const t = (y - a.y) / (b.y - a.y);
        xs.push(a.x + (b.x - a.x) * t);
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const left = Math.max(0, Math.ceil(xs[i]!));
      const right = Math.min(png.width - 1, Math.floor(xs[i + 1]!));
      for (let x = left; x <= right; x++) setPixel(png, x, y, color);
    }
  }
}

function fillStrokeCircle(png: PNG, cx: number, cy: number, radius: number, color: Rgba, edge: Rgba): void {
  fillCircle(png, cx, cy, radius, color);
  const inner = Math.max(0, radius - 2);
  if (inner > 0) fillCircle(png, cx, cy, inner, color);
  const steps = Math.max(24, Math.ceil(radius * 4));
  let prev = { x: cx + radius, y: cy };
  for (let i = 1; i <= steps; i++) {
    const a = i * Math.PI * 2 / steps;
    const next = { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius };
    drawLine(png, prev, next, edge, 2);
    prev = next;
  }
}

function levelBounds(world: World): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
  let minX = -world.floorHalfExtent;
  let maxX = world.floorHalfExtent;
  let minY = 0;
  let maxY = 2;
  let minZ = -world.floorHalfExtent;
  let maxZ = world.floorHalfExtent;
  for (const box of world.boxes) {
    const e = boxExtents(box);
    minX = Math.min(minX, e.minX);
    maxX = Math.max(maxX, e.maxX);
    minY = Math.min(minY, e.minY);
    maxY = Math.max(maxY, e.maxY);
    minZ = Math.min(minZ, e.minZ);
    maxZ = Math.max(maxZ, e.maxZ);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function topDownProject(bounds: ReturnType<typeof levelBounds>, width: number, height: number): (p: { x: number; z: number }) => { x: number; y: number } {
  const margin = 44;
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanZ = Math.max(1, bounds.maxZ - bounds.minZ);
  const scale = Math.min((width - margin * 2) / spanX, (height - margin * 2) / spanZ);
  const ox = (width - spanX * scale) / 2;
  const oy = (height - spanZ * scale) / 2;
  return (p) => ({
    x: ox + (p.x - bounds.minX) * scale,
    y: height - (oy + (p.z - bounds.minZ) * scale),
  });
}

function drawTopDown(world: World): PNG {
  const width = 1024;
  const height = 768;
  const png = new PNG({ width, height });
  fillRect(png, 0, 0, width - 1, height - 1, COLORS.background);
  const bounds = levelBounds(world);
  const map = topDownProject(bounds, width, height);
  const floorA = map({ x: -world.floorHalfExtent, z: -world.floorHalfExtent });
  const floorB = map({ x: world.floorHalfExtent, z: world.floorHalfExtent });
  fillRect(png, floorA.x, floorB.y, floorB.x, floorA.y, COLORS.floor);

  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  const gridStep = span > 100 ? 20 : 10;
  const firstX = Math.ceil(bounds.minX / gridStep) * gridStep;
  const firstZ = Math.ceil(bounds.minZ / gridStep) * gridStep;
  for (let x = firstX; x <= bounds.maxX; x += gridStep) {
    const a = map({ x, z: bounds.minZ });
    const b = map({ x, z: bounds.maxZ });
    drawLine(png, a, b, COLORS.grid, 1);
  }
  for (let z = firstZ; z <= bounds.maxZ; z += gridStep) {
    const a = map({ x: bounds.minX, z });
    const b = map({ x: bounds.maxX, z });
    drawLine(png, a, b, COLORS.grid, 1);
  }

  for (const box of world.boxes) {
    const e = boxExtents(box);
    const a = map({ x: e.minX, z: e.minZ });
    const b = map({ x: e.maxX, z: e.maxZ });
    const fill = e.maxY >= 1.6 ? COLORS.highBox : e.maxY >= 0.6 ? COLORS.lowBox : COLORS.topBox;
    fillRect(png, a.x, b.y, b.x, a.y, fill);
    drawLine(png, { x: a.x, y: a.y }, { x: b.x, y: a.y }, COLORS.edge, 1);
    drawLine(png, { x: b.x, y: a.y }, { x: b.x, y: b.y }, COLORS.edge, 1);
    drawLine(png, { x: b.x, y: b.y }, { x: a.x, y: b.y }, COLORS.edge, 1);
    drawLine(png, { x: a.x, y: b.y }, { x: a.x, y: a.y }, COLORS.edge, 1);
  }

  if (world.mission !== null) {
    const roles = [COLORS.routeA, COLORS.routeB, COLORS.routeOther];
    world.mission.routes.forEach((route, i) => {
      const points = [
        { x: world.mission!.start.x, z: world.mission!.start.z },
        ...route.via,
        { x: world.mission!.objective.x, z: world.mission!.objective.z },
      ].map(map);
      for (let p = 1; p < points.length; p++) drawLine(png, points[p - 1]!, points[p]!, roles[i % roles.length]!, 5);
    });
    const s = map({ x: world.mission.start.x, z: world.mission.start.z });
    const o = map({ x: world.mission.objective.x, z: world.mission.objective.z });
    fillStrokeCircle(png, s.x, s.y, Math.max(8, world.mission.start.radius * 3), COLORS.start, COLORS.edge);
    fillStrokeCircle(png, o.x, o.y, Math.max(8, world.mission.objective.radius * 3), COLORS.objective, COLORS.edge);
    for (const zone of world.mission.spawnZones) {
      const z = map({ x: zone.x, z: zone.z });
      fillStrokeCircle(png, z.x, z.y, Math.max(6, zone.radius * 3), COLORS.spawn, COLORS.edge);
    }
  }
  return png;
}

function cameraProject(
  p: { x: number; y: number; z: number },
  center: { x: number; y: number; z: number },
  yaw: number,
  pitch: number,
  scale: number,
  width: number,
  height: number,
): ScreenPoint {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const dz = p.z - center.z;
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const horizontal = -sy * dx + cy * dz;
  const along = cy * dx + sy * dz;
  const screenVertical = dy * Math.cos(pitch) - along * Math.sin(pitch);
  const depth = along * Math.cos(pitch) + dy * Math.sin(pitch);
  return {
    x: width / 2 + horizontal * scale,
    y: height / 2 - screenVertical * scale,
    depth,
  };
}

function boxCorners(box: LevelBoxSpec): { x: number; y: number; z: number }[] {
  const e = boxExtents(box);
  return [
    { x: e.minX, y: e.minY, z: e.minZ },
    { x: e.maxX, y: e.minY, z: e.minZ },
    { x: e.maxX, y: e.minY, z: e.maxZ },
    { x: e.minX, y: e.minY, z: e.maxZ },
    { x: e.minX, y: e.maxY, z: e.minZ },
    { x: e.maxX, y: e.maxY, z: e.minZ },
    { x: e.maxX, y: e.maxY, z: e.maxZ },
    { x: e.minX, y: e.maxY, z: e.maxZ },
  ];
}

function drawCamera(world: World, yaw: number): PNG {
  const width = 960;
  const height = 640;
  const png = new PNG({ width, height });
  fillRect(png, 0, 0, width - 1, height - 1, COLORS.background);

  const bounds = levelBounds(world);
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: Math.max(0, (bounds.minY + bounds.maxY) * 0.28),
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, bounds.maxY * 4);
  const scale = Math.min(width - 100, height - 100) / Math.max(span * 1.2, 1);
  const pitch = 0.55;

  const projectedGround = [
    { x: -world.floorHalfExtent, y: 0, z: -world.floorHalfExtent },
    { x: world.floorHalfExtent, y: 0, z: -world.floorHalfExtent },
    { x: world.floorHalfExtent, y: 0, z: world.floorHalfExtent },
    { x: -world.floorHalfExtent, y: 0, z: world.floorHalfExtent },
  ].map((p) => cameraProject(p, center, yaw, pitch, scale, width, height));
  fillPolygon(png, projectedGround, COLORS.floor);

  interface Face {
    points: ScreenPoint[];
    depth: number;
    color: Rgba;
  }
  const faces: Face[] = [];
  const faceIndices = [
    [0, 1, 2, 3],
    [4, 7, 6, 5],
    [0, 4, 5, 1],
    [1, 5, 6, 2],
    [2, 6, 7, 3],
    [3, 7, 4, 0],
  ] as const;

  for (const box of world.boxes) {
    const corners = boxCorners(box);
    const e = boxExtents(box);
    const base = e.maxY >= 1.6 ? COLORS.highBox : e.maxY >= 0.6 ? COLORS.lowBox : COLORS.topBox;
    for (const [fi, indices] of faceIndices.entries()) {
      const projected = indices.map((index) => cameraProject(corners[index]!, center, yaw, pitch, scale, width, height));
      const average = projected.reduce((sum, p) => sum + p.depth, 0) / projected.length;
      const shade = fi === 1 ? COLORS.topBox : base;
      faces.push({ points: projected, depth: average, color: shade });
    }
  }

  faces.sort((a, b) => a.depth - b.depth);
  for (const face of faces) {
    fillPolygon(png, face.points, face.color);
    for (let i = 0; i < face.points.length; i++) {
      drawLine(png, face.points[i]!, face.points[(i + 1) % face.points.length]!, COLORS.edge, 1);
    }
  }

  if (world.mission !== null) {
    const roles = [COLORS.routeA, COLORS.routeB, COLORS.routeOther];
    world.mission.routes.forEach((route, i) => {
      const points = [
        { x: world.mission!.start.x, y: 0.05, z: world.mission!.start.z },
        ...route.via.map((p) => ({ x: p.x, y: 0.05, z: p.z })),
        { x: world.mission!.objective.x, y: 0.05, z: world.mission!.objective.z },
      ].map((p) => cameraProject(p, center, yaw, pitch, scale, width, height));
      for (let p = 1; p < points.length; p++) drawLine(png, points[p - 1]!, points[p]!, roles[i % roles.length]!, 3);
    });
    const start = cameraProject({ x: world.mission.start.x, y: 0.05, z: world.mission.start.z }, center, yaw, pitch, scale, width, height);
    const objective = cameraProject({ x: world.mission.objective.x, y: 0.05, z: world.mission.objective.z }, center, yaw, pitch, scale, width, height);
    fillCircle(png, start.x, start.y, 7, COLORS.start);
    fillCircle(png, objective.x, objective.y, 7, COLORS.objective);
  }

  return png;
}

function writePng(path: string, png: PNG): void {
  mkdirSync(dirname(path), { recursive: true });
  const bytes = PNG.sync.write(png);
  writeFileSync(path, bytes);
}


export function renderReviewRenders(world: World, outputDir = DEFAULT_RENDER_DIR): ReviewRenders {
  const dir = join(outputDir, world.id);
  mkdirSync(dir, { recursive: true });
  const topDown = join(dir, world.id + '-topdown.png');
  writePng(topDown, drawTopDown(world));

  const cameras = [-0.9, 1.2, 3.3].map((yaw, i) => {
    const path = join(dir, world.id + '-camera-' + String(i + 1).padStart(2, '0') + '.png');
    writePng(path, drawCamera(world, yaw));
    return path;
  });

  return { topDown, cameras };
}

export async function checkAllLevels(options: {
  levelsDir?: string;
  renderDir?: string;
} = {}): Promise<LevelCheckReport[]> {
  await initNav();
  const levelsDir = options.levelsDir ?? LEVELS_DIR;
  const renderDir = options.renderDir ?? DEFAULT_RENDER_DIR;
  const reports: LevelCheckReport[] = [];

  const files = readdirSync(levelsDir)
    .filter((name) => name.endsWith('.json'))
    .sort();

  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(levelsDir, file), 'utf8')) as unknown;
    const world = loadLevel(raw);
    if (bakedNavFor(world.id) === undefined) {
      reports.push({
        id: world.id,
        checks: {
          collisionOverlaps: 0,
          navmeshIslands: 0,
          visibleSpawnZones: 0,
          brokenRouteLegs: 0,
          budgetBytes: 0,
        },
        budgets: {
          instances: world.pieces.length,
          bytes: 0,
          triangles: 0,
          bones: 0,
          materials: 0,
          textures: 0,
          byClass: {},
        },
        issues: [issue('navmesh-island', 'no committed navmesh for level ' + world.id)],
      });
      continue;
    }

    const nav = loadWorldNavMesh(world.id);
    try {
      const report = checkLevel(world, nav);
      report.renders = renderReviewRenders(world, renderDir);
      reports.push(report);
    } finally {
      nav.destroy();
    }
  }

  return reports;
}

async function main(): Promise<void> {
  const levelsDir = process.argv[2] ? resolve(process.argv[2]) : LEVELS_DIR;
  const renderDir = process.argv[3] ? resolve(process.argv[3]) : DEFAULT_RENDER_DIR;
  const reports = await checkAllLevels({ levelsDir, renderDir });
  let failed = false;
  for (const report of reports) {
    const status = report.issues.length === 0 ? 'PASS' : 'FAIL';
    console.log(
      '[level-check] ' + status + ' ' + report.id +
      ' | pieces=' + report.budgets.instances +
      ' bytes=' + report.budgets.bytes +
      ' triangles=' + report.budgets.triangles,
    );
    for (const problem of report.issues) console.error('[level-check] ' + report.id + ' | ' + problem.check + ' | ' + problem.message);
    if (report.issues.length > 0) failed = true;
    if (report.renders) {
      console.log('[level-check] renders ' + report.id + ': ' + report.renders.topDown + ', ' + report.renders.cameras.join(', '));
    }
  }
  if (failed) throw new Error('one or more levels failed T-4.11 validation');
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const modulePath = resolve(fileURLToPath(import.meta.url));
if (invokedPath !== '' && invokedPath === modulePath) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
