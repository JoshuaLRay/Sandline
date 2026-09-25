/**
 * `pinned` (T-3.21): two riflemen, one group, against a scripted soldier
 * holding cover — headless, seeded.
 *
 * The soldier is slot 0 over a loopback, prone behind the range's low wall
 * facing north (crouched, its head would show over the 1.0 m top). Every few seconds it stands for a moment and fires a burst at
 * whichever rifleman it can see, then goes back down — holding cover, not
 * hiding forever, so the group keeps it located. The riflemen start ~20 m up
 * range and run the committed `rifleman` tree; once the soldier has gone to
 * ground the group hands out a suppressor and a flanker. Both sides are healed
 * every tick; the other slots are parked out of sight.
 *
 * Measured per run, over the flank (roles handed out, until the flanker is at
 * its point or the fight ends): the share of it the soldier's suppression is
 * at or above the floor; whether the flanker got to a point with sight of the
 * soldier's concealed side; and how much of the flanker's walk the soldier's
 * standing eye could see, against the same for the direct navmesh route from
 * where it started to where it went. `judge` checks them against
 * `pinned.json` over every seed.
 */
import {
  DEFAULT_MUZZLE_RIG,
  INPUT_BUTTONS,
  type Message,
  PROTOCOL_VERSION,
  Sfc32,
  TICK_SECONDS,
  buildTree,
  createHealth,
  createLoopbackPair,
  createMoveState,
  createWeaponState,
  decodeMessage,
  encodeMessage,
  eyePosition,
  fromRadians,
  getWeapon,
  isReloading,
  requireWorld,
  seedFrom,
  startReload,
  suppressionLevel,
  tryFire,
} from '@sandline/shared';
import { Session } from '../../../server/src/session/Session.ts';
import { createBrainRegistry } from '../../../server/src/ai/Brain.ts';
import { aimPoints, visibleAimPoint } from '../../../server/src/ai/aim.ts';
import { seesConcealed, seesGround } from '../../../server/src/ai/group.ts';
import { initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from '../../../server/src/ai/nav/bakedNav.ts';
import THRESHOLDS from './pinned.json' with { type: 'json' };


export const PINNED = THRESHOLDS;

const TICKS_PER_SECOND = Math.round(1 / TICK_SECONDS);
/** Behind the low wall's south face, at its middle (a baked cover point). */
const SOLDIER_AT = { x: -9, y: 0, z: -1.6 };
/** Wire yaw facing +Z, north, over the wall. */
const FACING_NORTH = 0;
/**
 * Where the two riflemen start, before the seed's jitter of a metre either
 * way: both north-west, beyond the west walls — one up the line of the west
 * doorway, where the soldier's first peek sees it (so contact is certain), one
 * beside it behind the wall. From there the direct way to the only flank
 * point on the range (crate C's west face) runs out through the doorway in
 * the soldier's view; a covered way runs east behind the walls first. That
 * choice is what the scenario measures.
 */
const RIFLEMEN_AT = [
  { x: -7.5, y: 0, z: 19 },
  { x: -11.5, y: 0, z: 17 },
];
/** The soldier's rhythm: down this long, then up this long firing, seconds. */
const DOWN_S = 4;
const UP_S = 1;
const AIM_ERROR_DEG = 1.5;
/** Spacing the direct route is sampled at, metres. */
const SAMPLE_M = 0.5;

export interface PinnedResult {
  seed: number;
  /** Seconds from the first contact to the roles being handed out, or null for never. */
  pinnedAfterS: number | null;
  /** Seconds the flank lasted (roles to arrival, or to the end). */
  flankS: number;
  /** Share of the flank the soldier was at or above the suppression floor. */
  suppressedShare: number;
  /** Whether the flanker reached its point and, standing there, saw the soldier's concealed side. */
  flanked: boolean;
  /** Share of the flanker's walk the soldier could see, and of the direct route. */
  walkExposure: number;
  directExposure: number;
  /** Rounds the suppressor fired during the flank. */
  suppressingRounds: number;
}

let navReady: Promise<void> | null = null;

export async function runPinned(seed: number, config = PINNED): Promise<PinnedResult> {
  await (navReady ??= initNav());
  const world = requireWorld('range');
  const mesh = loadWorldNavMesh('range');
  const session = new Session(undefined, '', world, { navMesh: mesh, cover: bakedCoverFor('range') });
  const rng = new Sfc32(seedFrom(seed, 0x9e1));

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
  pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'soldier', room: '' }));
  pair.settle();
  const soldier = session.slots[0]!;
  soldier.state = createMoveState(SOLDIER_AT.x, SOLDIER_AT.y, SOLDIER_AT.z);
  session.slots.forEach((slot, i) => {
    if (i > 0) slot.state = createMoveState(-60 + i * 4, 0, -95);
  });

  const tree = () => buildTree('rifleman', createBrainRegistry());
  const ids = RIFLEMEN_AT.map(
    (at) => session.spawnEnemy('rifleman', { x: at.x + (rng.next() * 2 - 1), y: 0, z: at.z + (rng.next() * 2 - 1), yaw: 512, tree: tree(), group: 1 }) as number,
  );
  const riflemen = ids.map((id) => session.enemies.find((e) => e.netId === id)!);
  const group = session.group(1)!;

  const phase = Math.floor(rng.next() * (DOWN_S + UP_S) * TICKS_PER_SECOND);
  const cycle = Math.round((DOWN_S + UP_S) * TICKS_PER_SECOND);
  const totalTicks = Math.round(config.fightSeconds * TICKS_PER_SECOND);
  let inputTick = 0;
  /**
   * The soldier's trigger, pulled as the page pulls it (`CombatQA`): on its own
   * cadence and magazine, reloading when empty. A Fire every tick would be read
   * by the server's slack as the carbine's full 720 rpm rather than the page's
   * 600 (three whole ticks a shot), which is not what a player can do.
   */
  const carbine = getWeapon('carbine');
  const trigger = createWeaponState(carbine);
  let contact: number | null = null;
  let flankStart: number | null = null;
  let flankEnd: number | null = null;
  let flankerId: number | null = null;
  let suppressorId: number | null = null;
  let suppressedTicks = 0;
  let flankTicks = 0;
  let walkSeen = 0;
  let walkTicks = 0;
  let directExposure = 0;
  let roundsAtStart = 0;
  let rounds = 0;
  let flanked = false;

  for (let t = 0; t < totalTicks; t++) {
    const now = (session.tick + 1) * (1000 / TICKS_PER_SECOND);
    const up = (t + phase) % cycle >= DOWN_S * TICKS_PER_SECOND;
    const pageNow = t * TICK_SECONDS;
    if (trigger.ammo === 0 && !isReloading(trigger, pageNow)) startReload(carbine, trigger, pageNow);
    // Its stance, as a player's is: an input every tick — prone while down, which
    // the low wall hides entirely (crouched, its head shows over the 1.0 m top).
    pair.b.send(
      encodeMessage({ kind: 'Input', tick: ++inputTick, moveX: 0, moveY: 0, yaw: FACING_NORTH, pitch: 0, buttons: up ? 0 : INPUT_BUTTONS.prone }),
    );
    if (up && !soldier.state.crouched && !soldier.state.prone) {
      const eye = eyePosition(soldier.state.x, soldier.state.y, soldier.state.z, DEFAULT_MUZZLE_RIG);
      const seen = riflemen
        .map((r) => visibleAimPoint(eye, aimPoints(r.state, r.state.crouched, r.state.prone), world.boxes))
        .find((p) => p !== null);
      if (seen && tryFire(carbine, trigger, pageNow, true) !== null) {
        const dx = seen.x - eye.x;
        const dy = seen.y - eye.y;
        const dz = seen.z - eye.z;
        const err = () => ((rng.next() * 2 - 1) * AIM_ERROR_DEG * Math.PI) / 180;
        pair.b.send(
          encodeMessage({
            kind: 'Fire',
            tick: session.tick,
            yaw: fromRadians(Math.atan2(dx, dz) + err()),
            pitch: fromRadians(Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) + err()),
            renderTimeMs: now,
            weapon: 0,
            ads: true,
          }),
        );
      }
    }
    pair.settle();
    session.step(now);
    pair.settle();
    Object.assign(soldier.health, createHealth());
    for (const r of riflemen) Object.assign(r.health, { ...r.health, current: r.health.max, downedAt: null, diedAt: null });

    if (contact === null && riflemen.some((r) => r.target !== null)) contact = t;
    const flank = group.flank;
    if (flankStart === null && flank) {
      flankStart = t;
      flankerId = flank.netId;
      suppressorId = [...group.roles].find(([, role]) => role === 'suppressor')?.[0] ?? null;
      roundsAtStart = riflemen.find((r) => r.netId === suppressorId)?.weaponState.shotIndex ?? 0;
      // The direct route from where the flanker stood to where it was sent.
      const from = riflemen.find((r) => r.netId === flankerId)!.state;
      const direct = mesh.path(from, flank.point);
      if (direct) {
        let seenN = 0;
        let n = 0;
        for (let i = 1; i < direct.points.length; i++) {
          const a = direct.points[i - 1]!;
          const b = direct.points[i]!;
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          for (let d = 0; d < len; d += SAMPLE_M) {
            const f = d / len;
            n++;
            if (seesGround(SOLDIER_AT, { x: a.x + (b.x - a.x) * f, y: a.y, z: a.z + (b.z - a.z) * f }, world.boxes)) seenN++;
          }
        }
        directExposure = n === 0 ? 0 : seenN / n;
      }
    }
    if (flankStart !== null && flankEnd === null) {
      flankTicks++;
      if (suppressionLevel(soldier.suppression, now / 1000) >= config.suppressionFloor) suppressedTicks++;
      const flanker = riflemen.find((r) => r.netId === flankerId)!;
      walkTicks++;
      if (seesGround(SOLDIER_AT, flanker.state, world.boxes)) walkSeen++;
      if (group.flank?.arrived) {
        flankEnd = t;
        flanked = seesConcealed(flanker.state, SOLDIER_AT, world.boxes);
        rounds = (riflemen.find((r) => r.netId === suppressorId)?.weaponState.shotIndex ?? 0) - roundsAtStart;
      }
    }
  }
  if (flankStart !== null && flankEnd === null) rounds = (riflemen.find((r) => r.netId === suppressorId)?.weaponState.shotIndex ?? 0) - roundsAtStart;
  mesh.destroy();

  return {
    seed,
    pinnedAfterS: contact !== null && flankStart !== null ? (flankStart - contact) / TICKS_PER_SECOND : null,
    flankS: flankTicks / TICKS_PER_SECOND,
    suppressedShare: flankTicks === 0 ? 0 : suppressedTicks / flankTicks,
    flanked,
    walkExposure: walkTicks === 0 ? 0 : walkSeen / walkTicks,
    directExposure,
    suppressingRounds: rounds,
  };
}

export interface PinnedSummary {
  results: PinnedResult[];
  worstSuppressedShare: number;
  flankRate: number;
  meanWalkExposure: number;
  meanDirectExposure: number;
  failures: string[];
}

export async function summarisePinned(config = PINNED): Promise<PinnedSummary> {
  const results: PinnedResult[] = [];
  for (let seed = 1; seed <= config.seeds; seed++) results.push(await runPinned(seed, config));
  return judgePinned(results, config);
}

export function judgePinned(results: PinnedResult[], config = PINNED): PinnedSummary {
  const withFlank = results.filter((r) => r.pinnedAfterS !== null);
  const worstSuppressedShare = withFlank.length === 0 ? 0 : Math.min(...withFlank.map((r) => r.suppressedShare));
  const flankRate = results.filter((r) => r.flanked).length / results.length;
  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  const meanWalkExposure = mean(withFlank.map((r) => r.walkExposure));
  const meanDirectExposure = mean(withFlank.map((r) => r.directExposure));
  const failures: string[] = [];
  if (withFlank.length < results.length) failures.push(`${results.length - withFlank.length} runs never handed out a flank`);
  if (worstSuppressedShare < config.minSuppressedShare)
    failures.push(`suppression at or above ${config.suppressionFloor} for ${(worstSuppressedShare * 100).toFixed(0)}% of a flank at worst (< ${config.minSuppressedShare * 100}%)`);
  if (flankRate < config.minFlankRate) failures.push(`the flanker reached sight of the concealed side in ${(flankRate * 100).toFixed(0)}% of runs (< ${config.minFlankRate * 100}%)`);
  if (!(meanWalkExposure <= meanDirectExposure * config.maxExposureRatio))
    failures.push(`the flank walk was seen ${(meanWalkExposure * 100).toFixed(1)}% of the time against the direct route's ${(meanDirectExposure * 100).toFixed(1)}% (ratio ceiling ${config.maxExposureRatio})`);
  return { results, worstSuppressedShare, flankRate, meanWalkExposure, meanDirectExposure, failures };
}

export function reportPinned(summary: PinnedSummary, config = PINNED): string {
  const lines = summary.results.map(
    (r) =>
      `  seed ${String(r.seed).padStart(2)}: pinned ${r.pinnedAfterS === null ? 'never' : `after ${r.pinnedAfterS.toFixed(1)} s`}, flank ${r.flankS.toFixed(1)} s, ` +
      `suppressed ${(r.suppressedShare * 100).toFixed(0)}% (${r.suppressingRounds} rounds), ${r.flanked ? 'flanked' : 'did not flank'}, ` +
      `walk seen ${(r.walkExposure * 100).toFixed(0)}% vs direct ${(r.directExposure * 100).toFixed(0)}%`,
  );
  return [
    `scenario=pinned seeds=${summary.results.length} fight=${config.fightSeconds}s`,
    ...lines,
    `worst share of a flank at or above ${config.suppressionFloor} suppression: ${(summary.worstSuppressedShare * 100).toFixed(0)}% (floor ${config.minSuppressedShare * 100}%)`,
    `flanked to sight of the concealed side: ${(summary.flankRate * 100).toFixed(0)}% of runs (floor ${config.minFlankRate * 100}%)`,
    `flank walk seen ${(summary.meanWalkExposure * 100).toFixed(1)}% vs direct route ${(summary.meanDirectExposure * 100).toFixed(1)}% (ratio ceiling ${config.maxExposureRatio})`,
  ].join('\n');
}
