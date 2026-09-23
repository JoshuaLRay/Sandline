/**
 * `cover-duel` (T-3.20): one rifleman running the committed `rifleman` tree
 * against a scripted shooter on the range, headless, seeded.
 *
 * The shooter is slot 0 over a loopback, firing real `Fire` messages: bursts
 * whenever it can see any part of the rifleman, aimed at what it sees with a
 * seeded error. It stands still until the rifleman has been in cover a while,
 * then is moved round to the rifleman's flank. The other five slots are parked
 * far behind, out of sight and mind, so the rifleman has one threat. Both
 * soldiers are healed every tick: this measures how the rifleman fights, not
 * who wins.
 *
 * Measured per run, from first contact (the tick the rifleman first has a
 * target): the time to reach cover; the fraction of the fight spent exposed
 * (the shooter's eye sees a probe of its body in its stance) while not firing;
 * ticks spent reloading exposed while holding cover (a flank that lands
 * mid-reload is answered by relocating, and is the relocation's to measure);
 * and, after the flank, the time until it holds a different point. `summarise` checks the numbers
 * against `cover-duel.json` over every seed.
 */
import {
  DEFAULT_MUZZLE_RIG,
  type Message,
  PROTOCOL_VERSION,
  Sfc32,
  TICK_SECONDS,
  buildTree,
  createHealth,
  createLoopbackPair,
  createMoveState,
  decodeMessage,
  encodeMessage,
  eyePosition,
  fromRadians,
  requireWorld,
  rayWorld,
  seedFrom,
} from '@sandline/shared';
import { Session } from '../../../server/src/session/Session.ts';
import { createBrainRegistry } from '../../../server/src/ai/Brain.ts';
import { DEFAULT_COVER_BODY, protects } from '../../../server/src/ai/cover.ts';
import { aimPoints, visibleAimPoint } from '../../../server/src/ai/aim.ts';
import { initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from '../../../server/src/ai/nav/bakedNav.ts';
import type { CoverPoint } from '../../../server/src/ai/nav/baked/types.ts';
import THRESHOLDS from './cover-duel.json' with { type: 'json' };

type Vec3 = { x: number; y: number; z: number };

export const COVER_DUEL = THRESHOLDS;

const TICKS_PER_SECOND = Math.round(1 / TICK_SECONDS);
/** Where the shooter stands to begin with: south of the west walls, beside the lane. */
const SHOOTER_AT = { x: -2, y: 0, z: -4 };
/** Where the rifleman starts, before the seed's jitter: north-west, up range. */
const RIFLEMAN_AT = { x: -6, y: 0, z: 22 };
/** The shooter's burst and pause, seconds, and its aim error, degrees either way. */
const BURST_S = 0.5;
const PAUSE_S = 1.0;
const AIM_ERROR_DEG = 1.5;
/** At its point: the rifleman's own measure (`actions/rifleman.ts`). */
const AT_POINT_M = 0.4;

export interface DuelResult {
  seed: number;
  /** Seconds from first contact to first reaching cover, or null for never. */
  toCoverS: number | null;
  /** Fraction of the fight, from first contact, exposed while not firing. */
  exposedIdleFraction: number;
  /** Ticks reloading while exposed and holding cover, not counting a flank it is answering. */
  reloadTicksExposed: number;
  /** Seconds from the flank to holding a different point, null for never; undefined when there was no flank. */
  relocateS: number | null | undefined;
  /** Rounds the rifleman fired. */
  shotsFired: number;
}

/** The rifleman's body probes in its stance — shin, chest, eye — as the cover query probes a point. */
function probes(state: { x: number; y: number; z: number; crouched: boolean }): Vec3[] {
  const heights = state.crouched ? DEFAULT_COVER_BODY.crouched : DEFAULT_COVER_BODY.standing;
  return heights.map((h) => ({ x: state.x, y: state.y + h, z: state.z }));
}

function sees(from: Vec3, to: Vec3, boxes: ReturnType<typeof requireWorld>['boxes']): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return rayWorld({ origin: from, direction: { x: dx / length, y: dy / length, z: dz / length }, maxDistance: length }, boxes) === null;
}

/**
 * A flank on `point`: somewhere on the rifleman's own side of its cover,
 * off to one side, from which its point no longer hides it and nothing
 * stands in the way. Nearest first; null if the world offers none.
 */
function flankFor(point: CoverPoint, world: ReturnType<typeof requireWorld>): Vec3 | null {
  const tx = -point.nz;
  const tz = point.nx;
  for (const back of [6, 9, 12]) {
    for (const side of [8, -8, 12, -12, 4, -4]) {
      const feet = { x: point.x + point.nx * back + tx * side, y: 0, z: point.z + point.nz * back + tz * side };
      if (Math.abs(feet.x) > 90 || Math.abs(feet.z) > 90) continue;
      const blocked = world.boxes.some((b) => feet.x > b.minX - 0.5 && feet.x < b.maxX + 0.5 && feet.z > b.minZ - 0.5 && feet.z < b.maxZ + 0.5);
      if (blocked) continue;
      const eye = eyePosition(feet.x, 0, feet.z, DEFAULT_MUZZLE_RIG);
      if (!protects(point, eye, world.boxes)) return feet;
    }
  }
  return null;
}

let navReady: Promise<void> | null = null;

/** One seeded duel. */
export async function runCoverDuel(seed: number, config = COVER_DUEL): Promise<DuelResult> {
  await (navReady ??= initNav());
  const world = requireWorld('range');
  const session = new Session(undefined, '', world, { navMesh: loadWorldNavMesh('range'), cover: bakedCoverFor('range') });
  const rng = new Sfc32(seedFrom(seed, 0xc0de));

  // The shooter: slot 0, a real client.
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  pair.b.onMessage((bytes) => {
    let msg: Message;
    try {
      msg = decodeMessage(bytes);
    } catch {
      return;
    }
    if (msg.kind === 'Delta') pair.b.send(encodeMessage({ kind: 'Ack', tick: msg.tick }));
  });
  pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'shooter', room: '' }));
  pair.settle();
  const shooter = session.slots[0]!;
  shooter.state = createMoveState(SHOOTER_AT.x, SHOOTER_AT.y, SHOOTER_AT.z);
  // Everyone else, parked well out of sight and out of the way.
  session.slots.forEach((slot, i) => {
    if (i > 0) slot.state = createMoveState(-60 + i * 4, 0, -95);
  });

  const start = { x: RIFLEMAN_AT.x + (rng.next() * 6 - 3), y: 0, z: RIFLEMAN_AT.z + (rng.next() * 6 - 3) };
  const netId = session.spawnEnemy('rifleman', { ...start, yaw: 512, tree: buildTree('rifleman', createBrainRegistry()) }) as number;
  const rifleman = session.enemies.find((e) => e.netId === netId)!;

  const cover = session.cover!;
  const burstPhase = Math.floor(rng.next() * (BURST_S + PAUSE_S) * TICKS_PER_SECOND);
  const totalTicks = Math.round(config.fightSeconds * TICKS_PER_SECOND);
  let contact: number | null = null;
  let reached: number | null = null;
  let flankedAt: number | null = null;
  let flankedPoint: CoverPoint | null = null;
  let relocated: number | null = null;
  /** When, after relocating, it first stood at its new point. */
  let resettled: number | null = null;
  let exposedIdle = 0;
  let fight = 0;
  let reloadExposed = 0;

  for (let t = 0; t < totalTicks; t++) {
    const now = (session.tick + 1) * (1000 / TICKS_PER_SECOND);
    // The shooter fires first, into the world as the last tick left it.
    const eye = eyePosition(shooter.state.x, shooter.state.y, shooter.state.z, DEFAULT_MUZZLE_RIG);
    const firing = (t + burstPhase) % Math.round((BURST_S + PAUSE_S) * TICKS_PER_SECOND) < BURST_S * TICKS_PER_SECOND;
    const target = visibleAimPoint(eye, aimPoints(rifleman.state, rifleman.state.crouched, rifleman.state.prone), world.boxes);
    if (firing && target) {
      const dx = target.x - eye.x;
      const dy = target.y - eye.y;
      const dz = target.z - eye.z;
      const err = () => ((rng.next() * 2 - 1) * AIM_ERROR_DEG * Math.PI) / 180;
      const yaw = fromRadians(Math.atan2(dx, dz) + err());
      const pitch = fromRadians(Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) + err());
      pair.b.send(encodeMessage({ kind: 'Fire', tick: session.tick, yaw, pitch, renderTimeMs: now, weapon: 0, ads: true }));
      pair.settle();
    }

    session.step(now);
    pair.settle();
    Object.assign(shooter.health, createHealth());
    Object.assign(rifleman.health, { ...rifleman.health, current: rifleman.health.max, downedAt: null, diedAt: null });

    if (contact === null && rifleman.target !== null) contact = t;
    if (contact === null) continue;
    fight++;
    const held = cover.heldPoint(netId);
    const inCover = held !== null && Math.hypot(rifleman.state.x - held.x, rifleman.state.z - held.z) <= AT_POINT_M;
    if (reached === null && inCover) reached = t;
    const exposed = probes(rifleman.state).some((p) => sees(eye, p, world.boxes));
    const firingNow = rifleman.brain?.read('fireAt') != null;
    if (exposed && !firingNow) exposedIdle++;
    // Reloading exposed while holding cover — except while answering a flank
    // that caught it mid-reload: that is the relocation, measured below.
    if (relocated !== null && resettled === null && inCover) resettled = t;
    const answeringFlank = flankedAt !== null && resettled === null;
    if (exposed && held && !answeringFlank && rifleman.weaponState.reloadEndsAt > now / 1000) reloadExposed++;

    // The flank: once it has been in cover a while, the shooter goes round.
    if (flankedAt === null && reached !== null && held && t - reached >= config.flankAfterCoverSeconds * TICKS_PER_SECOND) {
      const to = flankFor(held, world);
      if (to) {
        shooter.state = createMoveState(to.x, 0, to.z);
        flankedAt = t;
        flankedPoint = held;
      }
    }
    if (flankedAt !== null && relocated === null && held && held !== flankedPoint) relocated = t;
  }

  return {
    seed,
    toCoverS: contact !== null && reached !== null ? (reached - contact) / TICKS_PER_SECOND : null,
    exposedIdleFraction: fight === 0 ? 0 : exposedIdle / fight,
    reloadTicksExposed: reloadExposed,
    relocateS: flankedAt === null ? undefined : relocated === null ? null : (relocated - flankedAt) / TICKS_PER_SECOND,
    shotsFired: rifleman.weaponState.shotIndex,
  };
}

export interface DuelSummary {
  results: DuelResult[];
  coverRate: number;
  worstExposedIdle: number;
  reloadTicksExposed: number;
  flanked: number;
  worstRelocateS: number | null;
  failures: string[];
}

/** Every seed's duel, and what the thresholds make of them. */
export async function summarise(config = COVER_DUEL): Promise<DuelSummary> {
  const results: DuelResult[] = [];
  for (let seed = 1; seed <= config.seeds; seed++) results.push(await runCoverDuel(seed, config));
  return judge(results, config);
}

/** What the thresholds make of a set of runs. */
export function judge(results: DuelResult[], config = COVER_DUEL): DuelSummary {
  const inTime = results.filter((r) => r.toCoverS !== null && r.toCoverS <= config.maxSecondsToCover).length;
  const coverRate = inTime / results.length;
  const worstExposedIdle = Math.max(...results.map((r) => r.exposedIdleFraction));
  const reloadTicksExposed = results.reduce((n, r) => n + r.reloadTicksExposed, 0);
  const flankedRuns = results.filter((r) => r.relocateS !== undefined);
  const relocations = flankedRuns.map((r) => (r.relocateS === null ? Infinity : (r.relocateS as number)));
  const worstRelocateS = relocations.length === 0 ? null : Math.max(...relocations);
  const failures: string[] = [];
  if (coverRate < config.minCoverRate) failures.push(`reached cover within ${config.maxSecondsToCover} s in ${(coverRate * 100).toFixed(0)}% of runs (< ${config.minCoverRate * 100}%)`);
  if (worstExposedIdle > config.maxExposedIdleFraction) failures.push(`exposed while not firing ${(worstExposedIdle * 100).toFixed(1)}% of a fight (> ${config.maxExposedIdleFraction * 100}%)`);
  if (reloadTicksExposed > config.maxReloadTicksExposed) failures.push(`${reloadTicksExposed} ticks reloading exposed while holding cover`);
  if (flankedRuns.length < results.length) failures.push(`${results.length - flankedRuns.length} runs never got to the flank`);
  if (worstRelocateS === null || worstRelocateS > config.maxRelocateSeconds) failures.push(`relocated after the flank in ${worstRelocateS} s at worst (> ${config.maxRelocateSeconds} s)`);
  const fewestShots = Math.min(...results.map((r) => r.shotsFired));
  if (fewestShots < config.minShotsFired) failures.push(`a run fired ${fewestShots} rounds (< ${config.minShotsFired}): hiding is not fighting`);
  return { results, coverRate, worstExposedIdle, reloadTicksExposed, flanked: flankedRuns.length, worstRelocateS, failures };
}

/** The report `pnpm sim-run --scenario cover-duel` prints. */
export function report(summary: DuelSummary, config = COVER_DUEL): string {
  const lines = summary.results.map(
    (r) =>
      `  seed ${String(r.seed).padStart(2)}: to cover ${r.toCoverS === null ? 'never' : `${r.toCoverS.toFixed(2)} s`}, ` +
      `exposed idle ${(r.exposedIdleFraction * 100).toFixed(1)}%, reload exposed ${r.reloadTicksExposed} ticks, ` +
      `relocate ${r.relocateS === undefined ? 'no flank' : r.relocateS === null ? 'never' : `${r.relocateS.toFixed(2)} s`}, fired ${r.shotsFired}`,
  );
  return [
    `scenario=cover-duel seeds=${summary.results.length} fight=${config.fightSeconds}s`,
    ...lines,
    `cover within ${config.maxSecondsToCover} s: ${(summary.coverRate * 100).toFixed(0)}% (floor ${config.minCoverRate * 100}%)`,
    `worst exposed while not firing: ${(summary.worstExposedIdle * 100).toFixed(1)}% (ceiling ${config.maxExposedIdleFraction * 100}%)`,
    `ticks reloading exposed in cover: ${summary.reloadTicksExposed} (ceiling ${config.maxReloadTicksExposed})`,
    `fewest rounds fired in a run: ${Math.min(...summary.results.map((r) => r.shotsFired))} (floor ${config.minShotsFired})`,
    `flanked ${summary.flanked}/${summary.results.length}; worst relocation ${summary.worstRelocateS === null ? 'n/a' : `${summary.worstRelocateS.toFixed(2)} s`} (ceiling ${config.maxRelocateSeconds} s)`,
  ].join('\n');
}
