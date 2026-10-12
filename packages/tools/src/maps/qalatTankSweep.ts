/** U-151 construction proof: closed interval enclosures, never centre-point
 * sampling. A disk encloses every yaw of both shared capsules and the larger
 * controller track footprint. Every supporting slab boundary is checked. */
import { Session } from '@sandline/server/session';
import { TICK_SECONDS, driveForward, getEnemy, type WorldBox } from '@sandline/shared';
import { union, type Interval } from './planStrata.ts';

export interface TankRoutePoint { id?: string; x: number; y: number; z: number }
const vehicle = getEnemy('tank').vehicle!;
const trackHalf = vehicle.hull.radius + .1;
const trackReach = Math.abs(vehicle.hull.to[2] - vehicle.hull.from[2]) / 2;
const capsuleRadius = Math.max(...[vehicle.hull, vehicle.turret].map((p) =>
  Math.max(...[p.from, p.to].map(([x, , z]) => Math.hypot(x, z))) + p.radius));
export const TANK_SWEEP_RADIUS_M = Math.max(capsuleRadius, Math.hypot(trackReach + trackHalf, trackHalf));
export const TANK_BODY_HEIGHT_M = Math.max(...[vehicle.hull, vehicle.turret].map((p) => Math.max(p.from[1], p.to[1]) + p.radius));
const EPS = 1e-8;

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
const overlaps = (a: Rect, b: Rect) => a.maxX >= b.minX && a.minX <= b.maxX && a.maxZ >= b.minZ && a.minZ <= b.maxZ;
const enclosure = (a: TankRoutePoint, b = a): Rect => ({
  minX: Math.min(a.x, b.x) - TANK_SWEEP_RADIUS_M, maxX: Math.max(a.x, b.x) + TANK_SWEEP_RADIUS_M,
  minZ: Math.min(a.z, b.z) - TANK_SWEEP_RADIUS_M, maxZ: Math.max(a.z, b.z) + TANK_SWEEP_RADIUS_M,
});

/** Distance from a closed centre interval to a box's closed plan rectangle.
 * Closest disjoint features are an endpoint/face or a corner/segment; slab
 * clipping detects edge crossings. This avoids a square enclosure's corners
 * falsely hitting an offset retaining return outside the all-yaw disk. */
function segmentRectDistance(a: TankRoutePoint, b: TankRoutePoint, r: Rect): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  let from = 0, to = 1;
  for (const [start, delta, lo, hi] of [[a.x, dx, r.minX, r.maxX], [a.z, dz, r.minZ, r.maxZ]]) {
    if (delta === 0) { if (start! < lo! || start! > hi!) { from = 2; break; } }
    else { const t0 = (lo! - start!) / delta!, t1 = (hi! - start!) / delta!; from = Math.max(from, Math.min(t0, t1)); to = Math.min(to, Math.max(t0, t1)); }
  }
  if (from <= to) return 0;
  const endpoint = (p: TankRoutePoint) => Math.hypot(Math.max(r.minX - p.x, 0, p.x - r.maxX), Math.max(r.minZ - p.z, 0, p.z - r.maxZ));
  const corner = (x: number, z: number) => {
    const t = dx * dx + dz * dz ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz))) : 0;
    return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
  };
  return Math.min(endpoint(a), endpoint(b), ...[r.minX, r.maxX].flatMap((x) => [r.minZ, r.maxZ].map((z) => corner(x, z))));
}

/** Exact broad phase; exclusions cannot intersect any query footprint/ray. */
function boxQuery(boxes: readonly WorldBox[]) {
  const bands = new Map<number, WorldBox[]>();
  for (const b of boxes) for (let z = Math.floor(b.minZ); z <= Math.floor(b.maxZ); z++) {
    const band = bands.get(z) ?? []; band.push(b); bands.set(z, band);
  }
  return (r: Rect) => {
    const found = new Set<WorldBox>();
    for (let z = Math.floor(r.minZ); z <= Math.floor(r.maxZ); z++)
      for (const b of bands.get(z) ?? []) if (overlaps(r, b)) found.add(b);
    return [...found];
  };
}

function supportSlabs(boxes: readonly WorldBox[], floorY: number) {
  const events = new Map<number, { add: WorldBox[]; remove: WorldBox[] }>();
  for (const b of boxes.filter((b) => Math.abs(b.maxY - floorY) < EPS)) {
    for (const [z, action] of [[b.minZ, 'add'], [b.maxZ, 'remove']] as const) {
      const event = events.get(z) ?? { add: [], remove: [] };
      event[action].push(b); events.set(z, event);
    }
  }
  const cuts = [...events.keys()].sort((a, b) => a - b), active = new Set<WorldBox>();
  return cuts.slice(0, -1).map((z, i) => {
    const event = events.get(z)!;
    for (const b of event.remove) active.delete(b);
    for (const b of event.add) active.add(b);
    return { minZ: z, maxZ: cuts[i + 1]!, spans: union([...active].map((b): Interval => [b.minX, b.maxX])) };
  });
}

/** Covers every real number along every route interval, every hull and turret
 * yaw independently, and all on-the-spot rotations/stops at its endpoints. */
export function certifyTankRoute(boxes: readonly WorldBox[], route: readonly TankRoutePoint[]) {
  if (route.length < 2 || route.some((p) => p.y !== 8 || !Number.isFinite(p.x) || !Number.isFinite(p.z)))
    throw new Error('tank route must contain at least two finite y8 points');
  const slabs = supportSlabs(boxes, 8), query = boxQuery(boxes);
  let intervals = 0, slabChecks = 0, lengthM = 0;
  const certify = (a: TankRoutePoint, b: TankRoutePoint, label: string) => {
    const r = enclosure(a, b);
    const obstacle = query(r).find((box) => box.maxY > 8 + EPS && box.minY < 8 + TANK_BODY_HEIGHT_M && segmentRectDistance(a, b, box) <= capsuleRadius);
    if (obstacle) throw new Error(`${label}: rotating hull/turret enclosure hits ${obstacle.id}`);
    let lo = 0, hi = slabs.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (slabs[mid]!.maxZ <= r.minZ) lo = mid + 1; else hi = mid; }
    let coveredZ = r.minZ;
    for (let i = lo; i < slabs.length && coveredZ < r.maxZ - EPS; i++) {
      const slab = slabs[i]!; slabChecks++;
      if (slab.minZ > coveredZ + EPS) throw new Error(`${label}: rotating track enclosure leaves supported floor`);
      if (slab.maxZ - slab.minZ <= EPS) { coveredZ = slab.maxZ; continue; }
      if (!slab.spans.some(([x0, x1]) => x0 <= r.minX + EPS && x1 >= r.maxX - EPS))
        throw new Error(`${label}: rotating track enclosure unsupported at z=${Math.max(slab.minZ, coveredZ)}`);
      coveredZ = slab.maxZ;
    }
    if (coveredZ < r.maxZ - EPS) throw new Error(`${label}: rotating track enclosure leaves supported floor`);
    intervals++;
  };
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!, b = route[i]!, length = Math.hypot(b.x - a.x, b.z - a.z);
    lengthM += length;
    // Partition improves the bound; entire closed intervals are enclosed, so
    // tiny obstacles or floor gaps between these boundaries remain detectable.
    const count = Math.max(1, Math.ceil(length / .5));
    const at = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: 8, z: a.z + (b.z - a.z) * t });
    for (let n = 0; n < count; n++) certify(at(n / count), at((n + 1) / count), `${a.id ?? i - 1}→${b.id ?? i}`);
  }
  return { method: 'closed interval disk tubes; complete support prism slab union', radiusM: TANK_SWEEP_RADIUS_M,
    capsuleRadiusM: capsuleRadius, bodyHeightM: TANK_BODY_HEIGHT_M, allHullAndTurretYaws: true,
    endpointsAndStops: true, intervals, slabChecks, lengthM, floorY: 8 };
}

/** Exercise the actual Session enemy-drive and turret/fire ticks against the
 * generated boxes. Broad-phase selection includes every possible body/support
 * intersection and the full ray to the close contact target. No tuning changes. */
export function measureTankTravel(boxes: readonly WorldBox[], route: readonly TankRoutePoint[], contactSeconds = 0) {
  const start = route[0]!;
  const session = new Session(undefined, '', { id: 'qalat-tank-proof', boxes, floorHalfExtent: 500,
    floorHalfWidth: 500, floorHalfDepth: 500, mission: null, encounter: null, pieces: [], emplacements: [] }, { roomLobby: false });
  const id = session.spawnEnemy('tank', { ...start, yaw: 0, path: route.slice(1), authoredHeight: true })!;
  const enemy = session.enemies.find((e) => e.netId === id)!;
  const internals = session as unknown as { collisionBoxes: WorldBox[]; nowMs: number;
    stepEnemies(now: number): void; fireTanks(now: number): void };
  for (const s of session.slots) { s.state = { ...s.state, x: -400 - s.index, y: 8, z: 0 }; s.health.current = s.health.max = 100000; }
  const query = boxQuery(boxes), trace: TankRoutePoint[] = [{ ...start }];
  let ticks = 0, blockedTicks = 0, contactTicks = 0, firedShells = 0, aimingTicks = 0, unexpectedBlockedTicks = 0;
  const waypointTimesSeconds: Record<string, number> = { [start.id ?? '0']: 0 };
  let contactStarted = false;
  const contactWaypoint = route.findIndex((point) => point.id === 'X5');
  const target = session.slots[0]!;
  while (enemy.drive!.phase !== 'arrived' && ticks < 30 * 600) {
    if (contactSeconds > 0 && !contactStarted && enemy.drive!.next >= contactWaypoint) {
      const f = driveForward(enemy.drive!);
      target.state = { ...target.state, x: enemy.state.x + f.x * 2.3, y: 8, z: enemy.state.z + f.z * 2.3 };
      contactStarted = true; contactTicks = Math.round(contactSeconds / TICK_SECONDS);
    }
    if (contactStarted && contactTicks === 0) target.state = { ...target.state, x: -400, z: 0 };
    const holdingContact = contactTicks > 0;
    if (contactTicks > 0) contactTicks--;
    const nearby = query({ minX: enemy.state.x - 5, maxX: enemy.state.x + 5, minZ: enemy.state.z - 5, maxZ: enemy.state.z + 5 });
    internals.collisionBoxes.splice(0, internals.collisionBoxes.length, ...nearby);
    ticks++; internals.nowMs = ticks * TICK_SECONDS * 1000;
    const beforeNext = enemy.drive!.next;
    internals.stepEnemies(ticks * TICK_SECONDS); internals.fireTanks(ticks * TICK_SECONDS);
    for (let i = beforeNext; i < enemy.drive!.next; i++) waypointTimesSeconds[route[i + 1]!.id ?? `${i + 1}`] = ticks * TICK_SECONDS;
    if (enemy.drive!.phase === 'blocked') blockedTicks++;
    unexpectedBlockedTicks = enemy.drive!.phase === 'blocked' && !holdingContact ? unexpectedBlockedTicks + 1 : 0;
    if (unexpectedBlockedTicks >= 3) throw new Error(`real tank controller blocked at ${JSON.stringify(enemy.state)}`);
    if (enemy.tell) aimingTicks++;
    firedShells = session.projectilesNow().length;
    const at = enemy.state, previous = trace.at(-1)!;
    if (at.x !== previous.x || at.z !== previous.z) trace.push({ x: at.x, y: at.y, z: at.z });
    if (at.y !== 8) throw new Error('real tank controller left y8');
  }
  if (enemy.drive!.phase !== 'arrived') throw new Error(`real tank controller failed to arrive: ${enemy.drive!.phase} at ${JSON.stringify(enemy.state)}`);
  return { seconds: ticks * TICK_SECONDS, ticks, blockedSeconds: blockedTicks * TICK_SECONDS,
    contactSeconds, firedShells, aimingTicks, waypointTimesSeconds, endpoint: { x: enemy.state.x, y: enemy.state.y, z: enemy.state.z },
    stopYaw: enemy.yaw, trace };
}

/** Compact generator evidence against the completed ridge, including every
 * bridge approach, stair, landing, parapet and foundation in the world. */
export function tankSweepReport(boxes: readonly WorldBox[], route: readonly TankRoutePoint[]) {
  const bridge = boxes.find((b) => b.id === 'ridge-bridge-deck');
  if (!bridge) throw new Error('built R7b bridge deck is missing');
  const r8 = { minX: 66, maxX: 74, minZ: 348, maxZ: 352 };
  const landing = boxes.filter((b) => b.id.startsWith('ridge-slab-') && Math.abs(b.maxY - 12) < EPS
    && b.maxX > r8.minX && b.minX < r8.maxX && b.maxZ > r8.minZ && b.minZ < r8.maxZ);
  let coveredZ = r8.minZ;
  for (const slab of supportSlabs(landing, 12)) {
    if (slab.maxZ <= coveredZ) continue;
    if (slab.minZ > coveredZ + EPS || !slab.spans.some(([a, b]) => a <= r8.minX + EPS && b >= r8.maxX - EPS))
      throw new Error('built R8 landing has an unsupported footprint');
    coveredZ = slab.maxZ;
    if (coveredZ >= r8.maxZ - EPS) break;
  }
  if (coveredZ < r8.maxZ - EPS) throw new Error('built R8 landing is missing');
  const undersideY = Math.min(...landing.map((b) => b.minY));
  const clear = measureTankTravel(boxes, route), contact = measureTankTravel(boxes, route, 10);
  const summary = ({ trace: _trace, ...result }: ReturnType<typeof measureTankTravel>) => result;
  return { route: certifyTankRoute(boxes, route), realController: {
    withoutTarget: summary(clear), safetyRadiusTargetContact: summary(contact),
    withoutTargetSweep: certifyTankRoute(boxes, clear.trace),
    contactSweep: certifyTankRoute(boxes, contact.trace),
    X5WaypointAfterPrisonerReleaseSeconds: { radioAlive: 5 + clear.waypointTimesSeconds['X5']!, radioDead: 20 + clear.waypointTimesSeconds['X5']! },
    finalA1AfterPrisonerReleaseSeconds: { radioAlive: 5 + clear.seconds, radioDead: 20 + clear.seconds },
    contactMethod: 'standing visible target held 2.3 m ahead near X5 for 10 seconds; actual Session drive and fire ticks',
    behavior: 'current controller stops for the soldier safety radius; visibility alone does not hold its drive',
    measurementScope: 'actual Session drive and fire ticks; projectiles and wider encounter are not advanced; authored final facing belongs to activation',
    finalSouthwestOrientationCovered: true,
  }, builtBridge: { minX: bridge.minX, maxX: bridge.maxX, minZ: bridge.minZ, maxZ: bridge.maxZ,
    undersideY: bridge.minY, deckY: bridge.maxY,
    minimumBodyClearanceM: bridge.minY - 8 - TANK_BODY_HEIGHT_M, constructed: true },
  builtR8Landing: { ...r8, floorY: 12, minimumUndersideY: undersideY,
    minimumBodyClearanceM: undersideY - 8 - TANK_BODY_HEIGHT_M, slabBoxes: landing.length,
    constructed: true, obligation: 'completed bridge approaches, R8 stairs/landing and every support certified against authored and both controller traces' },
  sharedVehicle: vehicle };
}
