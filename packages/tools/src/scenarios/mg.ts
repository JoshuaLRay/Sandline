/**
 * `mg` (T-3.23): the machine gunner against the rifleman, headless, seeded.
 *
 * Every seed runs two fights twice over, once with an MG and once with a
 * rifleman in the same place, so the only difference is the archetype:
 *
 * - **pinned** — that archetype and a rifleman in one group, against slot 0
 *   holding the low wall as in `pinned` (prone, standing a second in five to
 *   fire at whatever it sees). The group pins it and hands out a suppressor.
 *   Measured: whom the group made the suppressor, and the suppression that
 *   member's rounds dealt per second while it held the role
 *   (`Session.suppressionDealtBy`).
 * - **flanked** — that archetype alone against a shooter that goes round to
 *   its flank each time it has held a point for `flankEverySeconds`, firing
 *   bursts at whatever of it shows. Measured: how often it relocates (takes a
 *   different point), over the fight.
 *
 * In every MG fight an observer of its own — horizontal movement per tick
 * against the archetype's `deploy.movingSpeedMps`, and the magazine's shot
 * count — records any round fired within `deploy.seconds` of the MG having
 * moved. Every soldier is healed every tick: this measures how they fight,
 * not who wins. `judgeMg` checks the numbers against `mg.json`.
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
  decodeMessage,
  encodeMessage,
  eyePosition,
  fromRadians,
  getEnemy,
  requireWorld,
  seedFrom,
} from '@sandline/shared';
import { type EnemyEntity, Session } from '../../../server/src/session/Session.ts';
import { createBrainRegistry } from '../../../server/src/ai/Brain.ts';
import { aimPoints, visibleAimPoint } from '../../../server/src/ai/aim.ts';
import { initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from '../../../server/src/ai/nav/bakedNav.ts';
import { flankFor } from './coverDuel.ts';
import THRESHOLDS from './mg.json' with { type: 'json' };

export const MG = THRESHOLDS;

export type Archetype = 'mg' | 'rifleman';

const TICKS_PER_SECOND = Math.round(1 / TICK_SECONDS);
const AIM_ERROR_DEG = 1.5;
/** Pinned: the soldier behind the low wall, and the group up range beyond the west walls (as `pinned`). */
const SOLDIER_AT = { x: -9, y: 0, z: -1.6 };
const GROUP_AT = [
  { x: -7.5, y: 0, z: 19 },
  { x: -11.5, y: 0, z: 17 },
];
const DOWN_S = 4;
const UP_S = 1;
/** Flanked: the shooter to begin with, and the lone soldier, up range (as `cover-duel`). */
const SHOOTER_AT = { x: -2, y: 0, z: -4 };
const LONE_AT = { x: -6, y: 0, z: 22 };
const BURST_S = 0.5;
const PAUSE_S = 1.0;
/** At its point: the fighting leaves' own measure (`actions/rifleman.ts`). */
const AT_POINT_M = 0.4;

export interface MgRun {
  seed: number;
  archetype: Archetype;
  /** Pinned: whether the group handed out a suppressor, and whether it was this archetype's soldier. */
  suppressorAssigned: boolean;
  suppressorIsSubject: boolean;
  /** Pinned: the suppressor's suppression dealt per second while it held the role. */
  suppressionPerS: number;
  /** Flanked: times it took a different point after its first. */
  relocations: number;
  /** Flanked: times the shooter went round. */
  flanks: number;
  /** Rounds the subject fired over both fights. */
  shots: number;
  /** MG only: rounds fired within its deploy time of having moved. */
  undeployedShots: number;
}

let navReady: Promise<void> | null = null;

/** A session on the range with slot 0 as a real client, every other slot parked out of sight. */
function rangeSession() {
  const world = requireWorld('range');
  const mesh = loadWorldNavMesh('range');
  const session = new Session(undefined, '', world, { navMesh: mesh, cover: bakedCoverFor('range') });
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
  session.slots.forEach((slot, i) => {
    if (i > 0) slot.state = createMoveState(-60 + i * 4, 0, -95);
  });
  return { world, mesh, session, pair, soldier: session.slots[0]! };
}

/** Fire at the first of `enemies` the soldier's eye sees, with a seeded error. */
function fireAtSeen(ctx: ReturnType<typeof rangeSession>, enemies: EnemyEntity[], rng: Sfc32, now: number): void {
  const { soldier, world, pair, session } = ctx;
  const eye = eyePosition(soldier.state.x, soldier.state.y, soldier.state.z, DEFAULT_MUZZLE_RIG);
  const seen = enemies.map((r) => visibleAimPoint(eye, aimPoints(r.state, r.state.crouched, r.state.prone), world.boxes)).find((p) => p !== null);
  if (!seen) return;
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

function heal(ctx: ReturnType<typeof rangeSession>, enemies: EnemyEntity[]): void {
  Object.assign(ctx.soldier.health, createHealth());
  for (const e of enemies) Object.assign(e.health, { ...e.health, current: e.health.max, downedAt: null, diedAt: null });
}

/** The observer of an MG's deploy rule: rounds fired within `deploy.seconds` of having moved. */
function deployWatch(subject: EnemyEntity) {
  const deploy = subject.def.deploy;
  let last = { x: subject.state.x, z: subject.state.z };
  let movedAt = -Infinity;
  let shots = subject.weaponState.shotIndex;
  let undeployed = 0;
  return {
    /** After a step at `t` (ticks). */
    step(t: number): void {
      const speed = Math.hypot(subject.state.x - last.x, subject.state.z - last.z) / TICK_SECONDS;
      last = { x: subject.state.x, z: subject.state.z };
      if (deploy && (speed > deploy.movingSpeedMps || subject.state.vault)) movedAt = t;
      const fired = subject.weaponState.shotIndex - shots;
      shots = subject.weaponState.shotIndex;
      // Fired this tick with the last move under its deploy time ago: a round it may not fire.
      if (deploy && fired > 0 && (t - movedAt) / TICKS_PER_SECOND < deploy.seconds - 1e-9) undeployed += fired;
    },
    get undeployed() {
      return undeployed;
    },
  };
}

async function runPinnedFight(seed: number, archetype: Archetype, config: typeof MG) {
  const ctx = rangeSession();
  const { session, pair, soldier } = ctx;
  const rng = new Sfc32(seedFrom(seed, 0x3a7));
  soldier.state = createMoveState(SOLDIER_AT.x, SOLDIER_AT.y, SOLDIER_AT.z);
  const kinds: Archetype[] = [archetype, 'rifleman'];
  const ids = GROUP_AT.map(
    (at, i) =>
      session.spawnEnemy(kinds[i]!, {
        x: at.x + (rng.next() * 2 - 1),
        y: 0,
        z: at.z + (rng.next() * 2 - 1),
        yaw: 512,
        tree: buildTree(getEnemy(kinds[i]!).tree, createBrainRegistry()),
        group: 1,
      }) as number,
  );
  const enemies = ids.map((id) => session.enemies.find((e) => e.netId === id)!);
  const subject = enemies[0]!;
  const group = session.group(1)!;
  const watch = deployWatch(subject);
  const shotsFrom = subject.weaponState.shotIndex;

  const phase = Math.floor(rng.next() * (DOWN_S + UP_S) * TICKS_PER_SECOND);
  const cycle = Math.round((DOWN_S + UP_S) * TICKS_PER_SECOND);
  let inputTick = 0;
  let suppressor: number | null = null;
  let dealtFrom = 0;
  let roleTicks = 0;
  const total = Math.round(config.pinnedSeconds * TICKS_PER_SECOND);
  for (let t = 0; t < total; t++) {
    const now = (session.tick + 1) * (1000 / TICKS_PER_SECOND);
    const up = (t + phase) % cycle >= DOWN_S * TICKS_PER_SECOND;
    pair.b.send(encodeMessage({ kind: 'Input', tick: ++inputTick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: up ? 0 : INPUT_BUTTONS.prone }));
    if (up && !soldier.state.crouched && !soldier.state.prone) fireAtSeen(ctx, enemies, rng, now);
    pair.settle();
    session.step(now);
    pair.settle();
    heal(ctx, enemies);
    watch.step(t);
    const holder = [...group.roles].find(([, role]) => role === 'suppressor')?.[0] ?? null;
    if (suppressor === null && holder !== null) {
      suppressor = holder;
      dealtFrom = session.suppressionDealtBy(holder);
    }
    if (suppressor !== null && holder === suppressor) roleTicks++;
  }
  const dealt = suppressor === null ? 0 : session.suppressionDealtBy(suppressor) - dealtFrom;
  ctx.mesh.destroy();
  return {
    suppressorAssigned: suppressor !== null,
    suppressorIsSubject: suppressor === subject.netId,
    suppressionPerS: roleTicks === 0 ? 0 : dealt / (roleTicks / TICKS_PER_SECOND),
    shots: subject.weaponState.shotIndex - shotsFrom,
    undeployed: watch.undeployed,
  };
}

async function runFlankedFight(seed: number, archetype: Archetype, config: typeof MG) {
  const ctx = rangeSession();
  const { session, soldier, world } = ctx;
  const rng = new Sfc32(seedFrom(seed, 0xf1a));
  soldier.state = createMoveState(SHOOTER_AT.x, SHOOTER_AT.y, SHOOTER_AT.z);
  const start = { x: LONE_AT.x + (rng.next() * 6 - 3), y: 0, z: LONE_AT.z + (rng.next() * 6 - 3) };
  const id = session.spawnEnemy(archetype, { ...start, yaw: 512, tree: buildTree(getEnemy(archetype).tree, createBrainRegistry()) }) as number;
  const subject = session.enemies.find((e) => e.netId === id)!;
  const watch = deployWatch(subject);
  const shotsFrom = subject.weaponState.shotIndex;
  const cover = session.cover!;

  const burstPhase = Math.floor(rng.next() * (BURST_S + PAUSE_S) * TICKS_PER_SECOND);
  const burstCycle = Math.round((BURST_S + PAUSE_S) * TICKS_PER_SECOND);
  type Point = NonNullable<ReturnType<typeof cover.heldPoint>>;
  let held: Point | null = null;
  let points = 0;
  let settledAt: number | null = null;
  let flankedPoint: Point | null = null;
  let flanks = 0;
  const total = Math.round(config.flankedSeconds * TICKS_PER_SECOND);
  for (let t = 0; t < total; t++) {
    const now = (session.tick + 1) * (1000 / TICKS_PER_SECOND);
    if ((t + burstPhase) % burstCycle < BURST_S * TICKS_PER_SECOND) fireAtSeen(ctx, [subject], rng, now);
    ctx.pair.settle();
    session.step(now);
    ctx.pair.settle();
    heal(ctx, [subject]);
    watch.step(t);

    const point = cover.heldPoint(id);
    if (point && point !== held) {
      points++;
      held = point;
      settledAt = null;
    }
    const at = held !== null && Math.hypot(subject.state.x - held.x, subject.state.z - held.z) <= AT_POINT_M;
    if (at && settledAt === null) settledAt = t;
    // Held a point a while, and not already flanked there: the shooter goes round.
    if (held && settledAt !== null && held !== flankedPoint && t - settledAt >= config.flankEverySeconds * TICKS_PER_SECOND) {
      const to = flankFor(held, world);
      if (to) {
        soldier.state = createMoveState(to.x, 0, to.z);
        flankedPoint = held;
        flanks++;
      }
    }
  }
  ctx.mesh.destroy();
  return { relocations: Math.max(0, points - 1), flanks, shots: subject.weaponState.shotIndex - shotsFrom, undeployed: watch.undeployed };
}

export async function runMg(seed: number, archetype: Archetype, config = MG): Promise<MgRun> {
  await (navReady ??= initNav());
  const pinned = await runPinnedFight(seed, archetype, config);
  const flanked = await runFlankedFight(seed, archetype, config);
  return {
    seed,
    archetype,
    suppressorAssigned: pinned.suppressorAssigned,
    suppressorIsSubject: pinned.suppressorIsSubject,
    suppressionPerS: pinned.suppressionPerS,
    relocations: flanked.relocations,
    flanks: flanked.flanks,
    shots: pinned.shots + flanked.shots,
    undeployedShots: pinned.undeployed + flanked.undeployed,
  };
}

export interface MgSummary {
  runs: MgRun[];
  /** Mean suppression per second of the suppressor in MG fights, and in rifleman fights. */
  mgSuppressionPerS: number;
  riflemanSuppressionPerS: number;
  suppressionRatio: number;
  mgSuppressorRate: number;
  mgRelocations: number;
  riflemanRelocations: number;
  relocationRatio: number;
  undeployedShots: number;
  failures: string[];
}

export async function summariseMg(config = MG): Promise<MgSummary> {
  const runs: MgRun[] = [];
  for (let seed = 1; seed <= config.seeds; seed++) {
    runs.push(await runMg(seed, 'mg', config));
    runs.push(await runMg(seed, 'rifleman', config));
  }
  return judgeMg(runs, config);
}

export function judgeMg(runs: MgRun[], config = MG): MgSummary {
  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  const mg = runs.filter((r) => r.archetype === 'mg');
  const rifle = runs.filter((r) => r.archetype === 'rifleman');
  const mgSuppressionPerS = mean(mg.filter((r) => r.suppressorIsSubject).map((r) => r.suppressionPerS));
  const riflemanSuppressionPerS = mean(rifle.filter((r) => r.suppressorAssigned).map((r) => r.suppressionPerS));
  const suppressionRatio = riflemanSuppressionPerS === 0 ? Infinity : mgSuppressionPerS / riflemanSuppressionPerS;
  const mgSuppressorRate = mg.length === 0 ? 0 : mg.filter((r) => r.suppressorIsSubject).length / mg.length;
  const mgRelocations = mg.reduce((a, r) => a + r.relocations, 0);
  const riflemanRelocations = rifle.reduce((a, r) => a + r.relocations, 0);
  const relocationRatio = riflemanRelocations === 0 ? Infinity : mgRelocations / riflemanRelocations;
  const undeployedShots = mg.reduce((a, r) => a + r.undeployedShots, 0);

  const failures: string[] = [];
  if (rifle.some((r) => !r.suppressorAssigned)) failures.push(`${rifle.filter((r) => !r.suppressorAssigned).length} rifleman fights never handed out a suppressor`);
  if (!(suppressionRatio >= config.minSuppressionRatio))
    failures.push(`the MG suppressed ${suppressionRatio.toFixed(2)}× the rifleman per second (floor ${config.minSuppressionRatio}×)`);
  if (mgSuppressorRate < config.minMgSuppressorRate)
    failures.push(`the MG was the group's suppressor in ${(mgSuppressorRate * 100).toFixed(0)}% of its fights (floor ${config.minMgSuppressorRate * 100}%)`);
  if (riflemanRelocations < config.minRiflemanRelocations)
    failures.push(`the rifleman relocated ${riflemanRelocations} times in all (floor ${config.minRiflemanRelocations}): the flank is not biting`);
  if (!(relocationRatio <= config.maxRelocationRatio))
    failures.push(`the MG relocated ${mgRelocations} times to the rifleman's ${riflemanRelocations} (ratio ceiling ${config.maxRelocationRatio})`);
  if (undeployedShots > 0) failures.push(`the MG fired ${undeployedShots} rounds within its deploy time of moving (ceiling 0)`);
  const silent = mg.filter((r) => r.shots === 0);
  if (silent.length > 0) failures.push(`the MG fired nothing in ${silent.length} runs`);
  return { runs, mgSuppressionPerS, riflemanSuppressionPerS, suppressionRatio, mgSuppressorRate, mgRelocations, riflemanRelocations, relocationRatio, undeployedShots, failures };
}

export function reportMg(summary: MgSummary, config = MG): string {
  const lines = summary.runs.map(
    (r) =>
      `  seed ${String(r.seed).padStart(2)} ${r.archetype.padEnd(8)}: suppressor ${r.suppressorIsSubject ? 'it' : r.suppressorAssigned ? 'the other' : 'none'}, ` +
      `${r.suppressionPerS.toFixed(2)}/s; relocated ${r.relocations} of ${r.flanks} flanks; fired ${r.shots}` +
      (r.archetype === 'mg' ? `, ${r.undeployedShots} undeployed` : ''),
  );
  return [
    `scenario=mg seeds=${config.seeds} pinned=${config.pinnedSeconds}s flanked=${config.flankedSeconds}s`,
    ...lines,
    `suppression per second as suppressor: MG ${summary.mgSuppressionPerS.toFixed(2)} vs rifleman ${summary.riflemanSuppressionPerS.toFixed(2)} = ${summary.suppressionRatio.toFixed(2)}× (floor ${config.minSuppressionRatio}×)`,
    `MG made the suppressor: ${(summary.mgSuppressorRate * 100).toFixed(0)}% of its fights (floor ${config.minMgSuppressorRate * 100}%)`,
    `relocations: MG ${summary.mgRelocations} vs rifleman ${summary.riflemanRelocations} = ${summary.relocationRatio.toFixed(2)} (ceiling ${config.maxRelocationRatio}; rifleman floor ${config.minRiflemanRelocations})`,
    `MG rounds fired undeployed: ${summary.undeployedShots} (ceiling 0)`,
  ].join('\n');
}
