/**
 * `mission` (T-3.35): the grey-box mission played headless, seeded.
 *
 * Six friendly bots run the committed `friendly` tree on greybox-01 against
 * its committed encounter, paced by the director, with the director told
 * the squad is `humans` people (`SessionOptions.testHumanCount` — the one
 * place a bot counts as a person, and only here) so both ends of the budget
 * table are played with the same six bots.
 *
 * Nobody human leads, so a scripted squad leader gives the orders a player
 * would (T-3.27's orders, through `Session.orderFrom`): fireteam 1 up the
 * overwatch route and fireteam 2 up the assault route, one stop at a time,
 * each stop reached once every member on its feet is near it (or after a
 * while regardless); at the objective, a hold on its centre. Whoever goes
 * down, the nearest bot on its feet is sent to revive, and goes back to its
 * fireteam's stop after. Everything else — seeing, fighting, cover, grenades
 * — is the bots' own.
 *
 * Measured per run: whether and when the mission completed or failed;
 * the exit gate's two claims as numbers — the share of time enemies under
 * fire spend in a cover point they hold, and squad suppression episodes per
 * engagement — and the enemies spawned and killed. `benchAi` measures the
 * AI's share of the tick at forty enemies and five bots.
 */
import {
  type Message,
  PROTOCOL_VERSION,
  SQUAD,
  Sfc32,
  TICK_SECONDS,
  buildTree,
  createLoopbackPair,
  createMoveState,
  encodeMessage,
  encounterFor,
  isDead,
  isDowned,
  requireWorld,
  seedFrom,
  suppressionLevel,
} from '@sandline/shared';
import { Session } from '../../../server/src/session/Session.ts';
import { createBrainRegistry } from '../../../server/src/ai/Brain.ts';
import { type NavMesh, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from '../../../server/src/ai/nav/bakedNav.ts';
import THRESHOLDS from './mission.json' with { type: 'json' };

export const MISSION_SCENARIO = THRESHOLDS;
export type MissionConfig = typeof THRESHOLDS;

const WORLD_ID = 'greybox-01';
const TICKS_PER_SECOND = Math.round(1 / TICK_SECONDS);
const TICK_MS = 1000 / TICKS_PER_SECOND;
/** Within this of a cover point it holds, a soldier is in it, metres: the fighting leaves' "there" and a little over. */
const IN_COVER_M = 0.6;
/** The leader looks again this often, ticks. */
const LEADER_EVERY = 15;

export interface MissionRun {
  seed: number;
  humans: number;
  outcome: 'complete' | 'failed' | 'timeout';
  /** Mission seconds at the outcome, or the run's length on a timeout. */
  seconds: number;
  enemiesSpawned: number;
  enemiesKilled: number;
  botsDead: number;
  /** Enemy-ticks under fire, and of those in a held cover point. */
  underFireTicks: number;
  inCoverUnderFireTicks: number;
  /** Squad suppression episodes, and engagements (stretches of enemy contact). */
  episodes: number;
  engagements: number;
}

let navReady: Promise<void> | null = null;
let mesh: NavMesh | null = null;

async function worldMesh(): Promise<NavMesh> {
  await (navReady ??= initNav());
  return (mesh ??= loadWorldNavMesh(WORLD_ID));
}

const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);

export async function runMission(seed: number, humans: number, config: MissionConfig = MISSION_SCENARIO): Promise<MissionRun> {
  const navMesh = await worldMesh();
  const world = requireWorld(WORLD_ID);
  const mission = world.mission!;
  const session = new Session(undefined, '', world, {
    navMesh,
    cover: bakedCoverFor(WORLD_ID),
    brainTree: buildTree('friendly', createBrainRegistry()),
    encounter: encounterFor(WORLD_ID)!,
    testHumanCount: humans,
  });
  // The seed moves each bot a little off its spawn point: the one thing that differs between runs.
  const rng = new Sfc32(seedFrom(seed, 0x315));
  for (const s of session.slots) s.state = createMoveState(s.state.x + (rng.next() * 2 - 1), 0, s.state.z + (rng.next() * 2 - 1));

  // The leader's routes: fireteam i takes the route of the role it is given, then the objective.
  const roles = ['overwatch', 'assault'] as const;
  const stops = SQUAD.fireteams.map((_, i) => {
    const route = mission.routes.find((r) => r.role === roles[i % roles.length])!;
    return route.via.map((p) => ({ x: p.x, y: 0, z: p.z }));
  });
  const objective = { x: mission.objective.x, y: 0, z: mission.objective.z };
  const at = SQUAD.fireteams.map(() => 0);
  const since = SQUAD.fireteams.map(() => 0);
  const teamOf = (slot: number) => SQUAD.fireteams.findIndex((f) => f.slots.includes(slot));
  /** Who is sent to revive whom: reviver slot → downed slot. */
  const reviving = new Map<number, number>();
  const standing = (i: number) => {
    const s = session.slots[i]!;
    return !isDead(s.health) && !isDowned(s.health);
  };
  const goalOf = (team: number) => (at[team]! < stops[team]!.length ? stops[team]![at[team]!]! : objective);
  const orderTeamMember = (slot: number) => {
    const team = teamOf(slot);
    const goal = goalOf(team);
    const last = at[team]! >= stops[team]!.length;
    session.orderFrom(0, { order: last ? 'hold' : 'move', address: { to: 'slot', index: slot }, point: { ...goal }, target: null });
  };
  const orderTeam = (team: number) => {
    for (const slot of SQUAD.fireteams[team]!.slots) if (!reviving.has(slot)) orderTeamMember(slot);
  };
  SQUAD.fireteams.forEach((_, t) => orderTeam(t));

  const lead = () => {
    const tick = session.tick;
    SQUAD.fireteams.forEach((f, t) => {
      if (at[t]! >= stops[t]!.length) return;
      const goal = goalOf(t);
      const up = f.slots.filter((i) => standing(i) && !reviving.has(i));
      const arrived = up.length > 0 && up.every((i) => flat(session.slots[i]!.state, goal) <= config.arriveM);
      if (arrived || tick - since[t]! >= config.stopSeconds * TICKS_PER_SECOND) {
        at[t]!++;
        since[t] = tick;
        orderTeam(t);
      }
    });
    // Revives: the nearest bot on its feet goes to each downed one; back to its stop once it is up (or gone).
    for (const [reviver, downed] of [...reviving]) {
      const d = session.slots[downed]!.health;
      if (!isDowned(d) || !standing(reviver)) {
        reviving.delete(reviver);
        if (standing(reviver)) orderTeamMember(reviver);
      }
    }
    for (const s of session.slots) {
      if (!isDowned(s.health) || [...reviving.values()].includes(s.index)) continue;
      const helpers = session.slots.filter((h) => h.index !== s.index && standing(h.index) && !reviving.has(h.index));
      if (helpers.length === 0) continue;
      const nearest = helpers.reduce((a, b) => (flat(a.state, s.state) <= flat(b.state, s.state) ? a : b));
      reviving.set(nearest.index, s.index);
      session.orderFrom(0, { order: 'revive', address: { to: 'slot', index: nearest.index }, point: null, target: s.netId });
    }
  };

  let underFireTicks = 0;
  let inCoverUnderFireTicks = 0;
  let episodes = 0;
  let engagements = 0;
  let inContact = false;
  const suppressedBefore = session.slots.map(() => false);
  const killed = new Set<number>();
  const spawned = new Set<number>();
  let now = 0;
  const total = config.runSeconds * TICKS_PER_SECOND;
  let outcome: MissionRun['outcome'] = 'timeout';
  for (let t = 0; t < total; t++) {
    if (t % LEADER_EVERY === 0) lead();
    now += TICK_MS;
    session.step(now);
    const seconds = now / 1000;
    let contact = false;
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
      const held = session.cover?.heldPoint(e.netId) ?? null;
      if (held && flat(held, e.state) <= IN_COVER_M) inCoverUnderFireTicks++;
    }
    if (contact && !inContact) engagements++;
    inContact = contact;
    session.slots.forEach((s, i) => {
      const on = !isDead(s.health) && suppressionLevel(s.suppression, seconds) >= config.episodeLevel;
      if (on && !suppressedBefore[i]) episodes++;
      suppressedBefore[i] = on;
    });
    const state = session.mission!.state;
    if (state !== 'progress') {
      outcome = state;
      break;
    }
  }
  return {
    seed,
    humans,
    outcome,
    seconds: (session.tick - 0) / TICKS_PER_SECOND,
    enemiesSpawned: spawned.size,
    enemiesKilled: killed.size,
    botsDead: session.slots.filter((s) => isDead(s.health)).length,
    underFireTicks,
    inCoverUnderFireTicks,
    episodes,
    engagements,
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
  if (bench && bench.aiShare >= config.maxAiShare) failures.push(`AI took ${(bench.aiShare * 100).toFixed(1)}% of the tick at ${bench.enemies} enemies and ${bench.bots} bots (ceiling ${config.maxAiShare * 100}%)`);
  return { runs, completion, coverShare, episodesPerEngagement, bench, failures };
}

export function reportMission(summary: MissionSummary, config: MissionConfig = MISSION_SCENARIO): string {
  const lines = summary.runs.map(
    (r) =>
      `  ${r.humans}h seed ${String(r.seed).padStart(2)}: ${r.outcome.padEnd(8)} at ${r.seconds.toFixed(0).padStart(3)} s; enemies killed ${r.enemiesKilled}/${r.enemiesSpawned}, bots dead ${r.botsDead}; ` +
      `under fire in cover ${r.underFireTicks === 0 ? '-' : ((r.inCoverUnderFireTicks / r.underFireTicks) * 100).toFixed(0) + '%'}, ${r.episodes} suppression episodes in ${r.engagements} engagements`,
  );
  const done = (humans: number) => summary.runs.filter((r) => r.humans === humans && r.outcome === 'complete');
  const mean = (xs: number[]) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);
  return [
    `scenario=mission world=${WORLD_ID} seeds=${summary.runs.length / config.budgets.length} budgets=${config.budgets.join(',')} run=${config.runSeconds}s`,
    ...lines,
    ...config.budgets.map(
      (h) =>
        `${h}-human budget: completed ${((summary.completion[String(h)] ?? 0) * 100).toFixed(0)}% (floor ${((config.minCompletion as Record<string, number>)[String(h)] ?? 1) * 100}%${summary.runs.filter((r) => r.humans === h).length < config.completionMinSeeds ? `, not asserted under ${config.completionMinSeeds} seeds` : ''}), mean time ${done(h).length === 0 ? '-' : mean(done(h).map((r) => r.seconds)).toFixed(0)} s`,
    ),
    `enemies under fire in cover: ${(summary.coverShare * 100).toFixed(0)}% (floor ${config.minCoverShare * 100}%)`,
    `suppression episodes per engagement: ${summary.episodesPerEngagement.toFixed(2)} (floor ${config.minEpisodesPerEngagement})`,
    summary.bench
      ? `AI cost at ${summary.bench.enemies} enemies and ${summary.bench.bots} bots: ${(summary.bench.aiUsPerTick / 1000).toFixed(2)} ms a tick of ${(summary.bench.stepUsPerTick / 1000).toFixed(2)} ms stepped, ${(summary.bench.aiShare * 100).toFixed(1)}% of the 33.3 ms tick (ceiling ${config.maxAiShare * 100}%)`
      : 'AI cost: not measured',
  ].join('\n');
}
