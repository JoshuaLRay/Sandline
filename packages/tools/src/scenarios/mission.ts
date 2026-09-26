/**
 * `mission` (T-3.35, T-4.17): any mission played headless, seeded.
 *
 * Six friendly bots run the committed `friendly` tree on the mission's world
 * against its encounter, paced by the director, with the director told
 * the squad is `humans` people (`SessionOptions.testHumanCount` — the one
 * place a bot counts as a person, and only here) so both ends of the budget
 * table are played with the same six bots.
 *
 * Nobody human leads, so a scripted squad leader gives the orders a player
 * would (T-3.27's orders, through `Session.orderFrom`), following the current
 * objective's area or destroy group. An opening clear-and-hold of the map's
 * objective keeps the overwatch/assault approach from T-3.35. Whoever goes
 * down, the nearest bot on its feet is sent to revive, and goes back to its
 * current objective after. Everything else — seeing, fighting, cover, grenades
 * — is the bots' own.
 *
 * Measured per run: whether and when the mission completed or failed;
 * the exit gate's two claims as numbers — the share of time enemies under
 * fire spend in a cover point they hold, and squad suppression episodes per
 * engagement — and the enemies spawned and killed. `benchAi` measures the
 * AI's share of the tick at forty enemies and five bots.
 */
import {
  type Encounter,
  type EventScript,
  type Message,
  type MissionDef,
  type MissionView,
  type World,
  PROTOCOL_VERSION,
  Sfc32,
  TICK_SECONDS,
  buildTree,
  createLoopbackPair,
  createMoveState,
  encodeMessage,
  encounterFor,
  isDead,
  isDowned,
  missionFor,
  requireWorld,
  resolveArea,
  scriptFor,
  seedFrom,
  suppressionLevel,
} from '@sandline/shared';
import { Session } from '../../../server/src/session/Session.ts';
import { createBrainRegistry } from '../../../server/src/ai/Brain.ts';
import { type NavMesh, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from '../../../server/src/ai/nav/bakedNav.ts';
import THRESHOLDS from './mission.json' with { type: 'json' };
import { createMissionLeader } from './missionLeader.ts';

export const MISSION_SCENARIO = THRESHOLDS;
export type MissionConfig = typeof THRESHOLDS;

const WORLD_ID = 'mission-01';
const TICKS_PER_SECOND = Math.round(1 / TICK_SECONDS);
const TICK_MS = 1000 / TICKS_PER_SECOND;
/** Within this of a cover point it holds, a soldier is in it, metres: the fighting leaves' "there" and a little over. */
const IN_COVER_M = 0.6;
/** What the director placed at the start, before any wave: counted over the mission's first seconds. */
const OPENING_SECONDS = 5;
/** The leader looks again this often, ticks. */
const LEADER_EVERY = 15;

export interface MissionRun {
  mission: string;
  world: string;
  objective: MissionView;
  /** The final objective's state, including why a failed/timed-out run stopped. */
  detail: string;
  seed: number;
  humans: number;
  outcome: 'complete' | 'failed' | 'timeout';
  /** Mission seconds at the outcome, or the run's length on a timeout. */
  seconds: number;
  enemiesSpawned: number;
  /** Enemies placed in the first seconds: the director's opening budget, before any wave. */
  openingEnemies: number;
  enemiesKilled: number;
  botsDead: number;
  /** Enemy-ticks under fire, and of those in a held cover point. */
  underFireTicks: number;
  inCoverUnderFireTicks: number;
  /** Squad suppression episodes, and engagements (stretches of enemy contact). */
  episodes: number;
  engagements: number;
  /**
   * U-001: the longest stretch, seconds, no living enemy knew of a squad
   * soldier while a timed objective (clear-and-hold, defend, survive) ran —
   * the owner's "empty map while the timer goes down". Contact, not mere
   * presence: an enemy standing out of sight in its spawn zone is no pressure.
   */
  longestQuietTimed: number;
  /** Which objective that stretch ended in, 1-based, or 0 for none. */
  longestQuietObjective: number;
}

let navReady: Promise<void> | null = null;
const meshes = new Map<string, NavMesh>();

async function worldMesh(worldId = WORLD_ID): Promise<NavMesh> {
  await (navReady ??= initNav());
  let mesh = meshes.get(worldId);
  if (!mesh) {
    mesh = loadWorldNavMesh(worldId);
    meshes.set(worldId, mesh);
  }
  return mesh;
}

const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);

function missionDetail(session: Session, def: MissionDef, encounter: Encounter, world: World, outcome: MissionRun['outcome']): string {
  const view = session.mission!;
  const objective = def.objectives[view.objective]!;
  const parts = [`objective ${view.objective + 1}/${view.objectives} ${view.type} '${view.label}' ${view.progress}/${view.goal}`];
  const wiped = session.slots.every((s) => isDead(s.health));
  if (outcome === 'failed') parts.push(wiped ? 'squad wipe' : 'defended area overrun');
  if (outcome === 'timeout') parts.push('simulation time limit reached');
  if ('area' in objective) {
    const area = resolveArea(objective.area, encounter, world);
    const standing = session.slots.filter((s) => !isDead(s.health) && !isDowned(s.health));
    parts.push(`standing in area ${standing.filter((s) => flat(s.state, area) <= area.radius).length}/${standing.length}, living enemies in area ${session.enemies.filter((e) => !isDead(e.health) && flat(e.state, area) <= area.radius).length}`);
  }
  if (objective.type === 'destroy') {
    const ids = session.spawner!.spawnedBy(objective.group);
    parts.push(`group '${objective.group}': triggered=${session.spawner!.fired(objective.group)}, spawned=${ids.length}, alive=${session.enemies.filter((e) => ids.includes(e.netId) && !isDead(e.health)).length}, waves=${session.spawner!.wavesOf(objective.group).length}, pending spawns=${session.spawner!.pending}`);
  }
  return parts.join('; ');
}

/** The committed event script of a mission that is the committed one, by value. */
function committedScript(def: MissionDef): EventScript | undefined {
  const committed = missionFor(def.world);
  if (!committed || committed.id !== def.id || JSON.stringify(committed) !== JSON.stringify(def)) return undefined;
  return scriptFor(def.id);
}

/** `watch`, when given, sees the session after every tick: for diagnosing a run, never for changing it. */
export async function runMission(seed: number, humans: number, config: MissionConfig = MISSION_SCENARIO, def: MissionDef = missionFor(WORLD_ID)!, watch?: (session: Session, seconds: number) => void): Promise<MissionRun> {
  const world = requireWorld(def.world);
  const encounter = encounterFor(def.world);
  if (!encounter) throw new Error(`mission '${def.id}': no encounter for world '${def.world}'`);
  const navMesh = await worldMesh(def.world);
  const session = new Session(undefined, '', world, {
    navMesh,
    cover: bakedCoverFor(def.world),
    brainTree: buildTree('friendly', createBrainRegistry()),
    encounter,
    mission: def,
    // U-001: the committed mission's event script, whether `def` is the committed object or a file parsed
    // to the same thing (`--all-missions`): the session only finds it for the object itself.
    ...(committedScript(def) ? { events: committedScript(def)! } : {}),
    testHumanCount: humans,
  });
  // The seed moves each bot a little off its spawn point: the one thing that differs between runs.
  const rng = new Sfc32(seedFrom(seed, 0x315));
  for (const s of session.slots) s.state = createMoveState(s.state.x + (rng.next() * 2 - 1), s.state.y, s.state.z + (rng.next() * 2 - 1));

  const lead = createMissionLeader(session, def, encounter, world, config);

  let underFireTicks = 0;
  let inCoverUnderFireTicks = 0;
  let episodes = 0;
  let engagements = 0;
  let inContact = false;
  const suppressedBefore = session.slots.map(() => false);
  const killed = new Set<number>();
  const spawned = new Set<number>();
  let openingEnemies = 0;
  let quietTicks = 0;
  let longestQuiet = 0;
  let longestQuietObjective = 0;
  let now = 0;
  const total = config.runSeconds * TICKS_PER_SECOND;
  let outcome: MissionRun['outcome'] = 'timeout';
  for (let t = 0; t < total; t++) {
    if (t % LEADER_EVERY === 0) lead();
    now += TICK_MS;
    session.step(now);
    const seconds = now / 1000;
    watch?.(session, seconds);
    let contact = false;
    if (seconds <= OPENING_SECONDS) openingEnemies = session.enemies.length;
    for (const e of session.enemies) {
      spawned.add(e.netId);
      if (isDead(e.health)) {
        killed.add(e.netId);
        continue;
      }
      if (e.target !== null) contact = true;
      const underFire = suppressionLevel(e.suppression, seconds) >= config.underFireLevel || seconds - e.lastDamagedAt <= config.hurtSeconds;
      if (!underFire) continue;
      underFireTicks++;
      // T-4.29: a gunner on an emplacement is behind its sandbag — in cover by the level's design, at no cover point.
      const held = session.cover?.heldPoint(e.netId) ?? null;
      if (e.mounted !== null || (held && flat(held, e.state) <= IN_COVER_M)) inCoverUnderFireTicks++;
    }
    if (contact && !inContact) engagements++;
    inContact = contact;
    session.slots.forEach((s, i) => {
      const on = !isDead(s.health) && suppressionLevel(s.suppression, seconds) >= config.episodeLevel;
      if (on && !suppressedBefore[i]) episodes++;
      suppressedBefore[i] = on;
    });
    const view = session.mission!;
    const timed = view.type === 'clear-and-hold' || view.type === 'defend' || view.type === 'survive';
    const quiet = timed && view.state === 'progress' && !contact;
    quietTicks = quiet ? quietTicks + 1 : 0;
    if (quietTicks > longestQuiet) {
      longestQuiet = quietTicks;
      longestQuietObjective = view.objective + 1;
    }
    const state = view.state;
    if (state !== 'progress') {
      outcome = state;
      break;
    }
  }
  return {
    mission: def.id,
    world: def.world,
    objective: { ...session.mission! },
    detail: missionDetail(session, def, encounter, world, outcome),
    seed,
    humans,
    outcome,
    seconds: (session.tick - 0) / TICKS_PER_SECOND,
    enemiesSpawned: spawned.size,
    openingEnemies,
    enemiesKilled: killed.size,
    botsDead: session.slots.filter((s) => isDead(s.health)).length,
    underFireTicks,
    inCoverUnderFireTicks,
    episodes,
    engagements,
    longestQuietTimed: longestQuiet / TICKS_PER_SECOND,
    longestQuietObjective,
  };
}

export interface MissionSummary {
  runs: MissionRun[];
  completion: Record<string, number>;
  coverShare: number;
  episodesPerEngagement: number;
  bench: AiBench | null;
  failures: string[];
}

export interface AiBench {
  enemies: number;
  bots: number;
  ticks: number;
  aiUsPerTick: number;
  stepUsPerTick: number;
  aiShare: number;
}

/** The AI's cost at `enemies` riflemen and `bots` friendly bots beside one human: its share of the tick. */
export async function benchAi(config: MissionConfig = MISSION_SCENARIO): Promise<AiBench> {
  const navMesh = await worldMesh();
  const world = requireWorld(WORLD_ID);
  const session = new Session(undefined, '', world, {
    navMesh,
    cover: bakedCoverFor(WORLD_ID),
    brainTree: buildTree('friendly', createBrainRegistry()),
    profileAi: true,
  });
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'lead', room: '' }));
  pair.settle();
  pair.b.onMessage((bytes) => void bytes);
  const bots = session.slots.filter((s) => s.isBot).length;
  // Forty riflemen across both lanes and round the compound, in groups of four, facing the start.
  const rng = new Sfc32(seedFrom(40, 0xa1));
  const places: { x: number; z: number }[] = [...world.mission!.spawnZones.flatMap((z) => [z, z]), ...world.mission!.routes.flatMap((r) => r.via)];
  const tree = buildTree('rifleman', createBrainRegistry());
  for (let i = 0; i < config.bench.enemies; i++) {
    const p = places[i % places.length]!;
    const a = rng.next() * Math.PI * 2;
    session.spawnEnemy('rifleman', { x: p.x + Math.sin(a) * rng.next() * 2, y: 0, z: p.z + Math.cos(a) * rng.next() * 2, yaw: 512, tree, group: 1 + Math.floor(i / 4) });
  }
  let now = 0;
  const ticks = config.bench.seconds * TICKS_PER_SECOND;
  let stepMs = 0;
  for (let t = 0; t < ticks; t++) {
    pair.b.send(encodeMessage({ kind: 'Input', tick: t + 1, moveX: 0, moveY: 1, yaw: 0, pitch: 0, buttons: 0 } as Message));
    pair.settle();
    now += TICK_MS;
    const t0 = performance.now();
    session.step(now);
    stepMs += performance.now() - t0;
    pair.settle();
  }
  const aiUsPerTick = (session.aiMs / ticks) * 1000;
  return { enemies: config.bench.enemies, bots, ticks, aiUsPerTick, stepUsPerTick: (stepMs / ticks) * 1000, aiShare: aiUsPerTick / (TICK_MS * 1000) };
}

export async function summariseMission(seeds: number = MISSION_SCENARIO.seeds, config: MissionConfig = MISSION_SCENARIO, bench = true): Promise<MissionSummary> {
  const runs: MissionRun[] = [];
  for (const humans of config.budgets) for (let seed = 1; seed <= seeds; seed++) runs.push(await runMission(seed, humans, config));
  return judgeMission(runs, bench ? await benchAi(config) : null, config);
}

/**
 * U-001's no-stall check: a run in which no enemy was in contact with the
 * squad for longer than `maxQuietSeconds` while a timed objective ran.
 * Asserted on every run, the CI job's three included: unlike a completion
 * rate, one run is enough to show it.
 */
export function stalls(runs: readonly MissionRun[], config: MissionConfig = MISSION_SCENARIO): string[] {
  return runs
    .filter((r) => r.longestQuietTimed > config.maxQuietSeconds)
    .map((r) => `${r.mission} ${r.humans}h seed ${r.seed}: no enemy in contact for ${r.longestQuietTimed.toFixed(0)} s, ending in objective ${r.longestQuietObjective} (ceiling ${config.maxQuietSeconds} s)`);
}

export function judgeMission(runs: MissionRun[], bench: AiBench | null, config: MissionConfig = MISSION_SCENARIO): MissionSummary {
  const failures: string[] = [];
  const completion: Record<string, number> = {};
  for (const humans of config.budgets) {
    const mine = runs.filter((r) => r.humans === humans);
    const share = mine.length === 0 ? 0 : mine.filter((r) => r.outcome === 'complete').length / mine.length;
    completion[String(humans)] = share;
    const floor = (config.minCompletion as Record<string, number>)[String(humans)] ?? 1;
    // A rate is asserted only over enough seeds to be one (the CI job's three report it).
    if (mine.length >= config.completionMinSeeds && share < floor) {
      const lost = mine.filter((r) => r.outcome !== 'complete').map((r) => `${r.seed} (${r.outcome})`);
      failures.push(`${humans}-human budget completed ${(share * 100).toFixed(0)}% (floor ${floor * 100}%); seeds not completed: ${lost.join(', ')}`);
    }
  }
  const underFire = runs.reduce((a, r) => a + r.underFireTicks, 0);
  const coverShare = underFire === 0 ? 0 : runs.reduce((a, r) => a + r.inCoverUnderFireTicks, 0) / underFire;
  if (coverShare < config.minCoverShare) failures.push(`enemies under fire in cover ${(coverShare * 100).toFixed(0)}% of the time (floor ${config.minCoverShare * 100}%)`);
  const engagements = runs.reduce((a, r) => a + r.engagements, 0);
  const episodesPerEngagement = engagements === 0 ? 0 : runs.reduce((a, r) => a + r.episodes, 0) / engagements;
  if (episodesPerEngagement < config.minEpisodesPerEngagement) failures.push(`${episodesPerEngagement.toFixed(2)} suppression episodes per engagement (floor ${config.minEpisodesPerEngagement})`);
  failures.push(...stalls(runs, config));
  if (bench && bench.aiShare >= config.maxAiShare) failures.push(`AI took ${(bench.aiShare * 100).toFixed(1)}% of the tick at ${bench.enemies} enemies and ${bench.bots} bots (ceiling ${config.maxAiShare * 100}%)`);
  return { runs, completion, coverShare, episodesPerEngagement, bench, failures };
}

export function reportMission(summary: MissionSummary, config: MissionConfig = MISSION_SCENARIO): string {
  const lines = summary.runs.map(
    (r) =>
      `  ${r.humans}h seed ${String(r.seed).padStart(2)}: ${r.outcome.padEnd(8)} at ${r.seconds.toFixed(0).padStart(3)} s; enemies killed ${r.enemiesKilled}/${r.enemiesSpawned}, bots dead ${r.botsDead}; ` +
      `under fire in cover ${r.underFireTicks === 0 ? '-' : ((r.inCoverUnderFireTicks / r.underFireTicks) * 100).toFixed(0) + '%'}, ${r.episodes} suppression episodes in ${r.engagements} engagements; longest quiet ${r.longestQuietTimed.toFixed(0)} s (objective ${r.longestQuietObjective}); ${r.detail}`,
  );
  const done = (humans: number) => summary.runs.filter((r) => r.humans === humans && r.outcome === 'complete');
  const mean = (xs: number[]) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);
  const median = (xs: number[]) => {
    const sorted = [...xs].sort((a, b) => a - b);
    return sorted.length === 0 ? NaN : sorted.length % 2 ? sorted[sorted.length >> 1]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  };
  return [
    `scenario=mission world=${summary.runs[0]?.world ?? WORLD_ID} seeds=${summary.runs.length / config.budgets.length} budgets=${config.budgets.join(',')} run=${config.runSeconds}s`,
    ...lines,
    ...config.budgets.map(
      (h) =>
        `${h}-human budget: completed ${((summary.completion[String(h)] ?? 0) * 100).toFixed(0)}% (floor ${((config.minCompletion as Record<string, number>)[String(h)] ?? 1) * 100}%${summary.runs.filter((r) => r.humans === h).length < config.completionMinSeeds ? `, not asserted under ${config.completionMinSeeds} seeds` : ''}), mean time ${done(h).length === 0 ? '-' : mean(done(h).map((r) => r.seconds)).toFixed(0)} s, median ${done(h).length === 0 ? '-' : median(done(h).map((r) => r.seconds)).toFixed(0)} s`,
    ),
    `enemies under fire in cover: ${(summary.coverShare * 100).toFixed(0)}% (floor ${config.minCoverShare * 100}%)`,
    `suppression episodes per engagement: ${summary.episodesPerEngagement.toFixed(2)} (floor ${config.minEpisodesPerEngagement})`,
    summary.bench
      ? `AI cost at ${summary.bench.enemies} enemies and ${summary.bench.bots} bots: ${(summary.bench.aiUsPerTick / 1000).toFixed(2)} ms a tick of ${(summary.bench.stepUsPerTick / 1000).toFixed(2)} ms stepped, ${(summary.bench.aiShare * 100).toFixed(1)}% of the 33.3 ms tick (ceiling ${config.maxAiShare * 100}%)`
      : 'AI cost: not measured',
  ].join('\n');
}
