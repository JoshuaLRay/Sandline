/**
 * `rpg` (U-157): the `squad` fight (T-3.26) with RPG gunners in the enemy
 * group, headless, seeded.
 *
 * Slot 0 is a human lead over a loopback, south of the range's low wall, kept
 * alive, opening fire up range once; slots 1–5 are bots on the committed
 * `friendly` tree. Up range come riflemen and RPG gunners in one group, each
 * on its committed tree. Nobody else is healed.
 *
 * Measured per run: riflemen killed, gunners the squad hurt or killed, rockets
 * the gunners fired, rockets that went off with one of their own side within
 * the blast (`unsafeBursts`, the rule the gunner must never break), rounds
 * fired by a slot that hurt a slot, bots downed and dead, and the rounds the
 * bots fired. `judgeRpg` checks them against `rpg.json`.
 *
 * Not every gunner is killed, and that is the archetype working: it fights
 * from cover in its band and the lead here never advances, so a gunner behind
 * the east walls is out of every bot's sight once the first exchange is over.
 */
import {
  type Message,
  PROJECTILE_IDS,
  PROTOCOL_VERSION,
  Sfc32,
  TICK_SECONDS,
  buildTree,
  createHealth,
  createLoopbackPair,
  createMoveState,
  decodeMessage,
  encodeMessage,
  getEnemy,
  getProjectile,
  isDead,
  isDowned,
  requireWorld,
  seedFrom,
} from '@sandline/shared';
import { Session } from '../../../server/src/session/Session.ts';
import { createBrainRegistry } from '../../../server/src/ai/Brain.ts';
import { initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from '../../../server/src/ai/nav/bakedNav.ts';
import THRESHOLDS from './rpg.json' with { type: 'json' };

export const RPG_SCENARIO = THRESHOLDS;

const TICKS_PER_SECOND = Math.round(1 / TICK_SECONDS);
const LAUNCHER = getEnemy('rpg').launcher!;
const ROCKET = (PROJECTILE_IDS as readonly string[]).indexOf(LAUNCHER.projectile);
const BLAST_M = getProjectile(LAUNCHER.projectile).blastRadiusM;
/** When the lead opens fire, ticks. */
const OPEN_FIRE_TICK = 30;
/** The lead: south of the low wall (x −12..−6, z −1), hidden from up range. */
const LEAD_AT = { x: -9, y: 0, z: -3 };
/** The riflemen, before the seed's jitter: up range, north-west beyond the west walls (the `squad` scenario's). */
const RIFLEMEN_AT = [
  { x: -8, y: 0, z: 26 },
  { x: -12, y: 0, z: 28 },
];
/** The gunners, before the jitter: further up range, in the band of the wall the squad holds. */
const GUNNERS_AT = [
  { x: -4, y: 0, z: 34 },
  { x: -16, y: 0, z: 36 },
];

export interface RpgRun {
  seed: number;
  kills: number;
  spawned: number;
  /** Riflemen killed, of those spawned; gunners hurt or killed, of those spawned. */
  riflemenKilled: number;
  riflemen: number;
  gunnersHit: number;
  gunners: number;
  /** Rockets the gunners launched, and how many went off with a gunner's own side inside the blast. */
  rockets: number;
  unsafeBursts: number;
  friendlyHits: number;
  botsDowned: number;
  botsDead: number;
  botRounds: number;
  /** Seconds to the last kill, or null if not every enemy died. */
  clearedS: number | null;
}

let navReady: Promise<void> | null = null;

export async function runRpg(seed: number, config = RPG_SCENARIO): Promise<RpgRun> {
  await (navReady ??= initNav());
  const world = requireWorld('range');
  const mesh = loadWorldNavMesh('range');
  const session = new Session(undefined, '', world, {
    navMesh: mesh,
    cover: bakedCoverFor('range'),
    brainTree: buildTree('friendly', createBrainRegistry()),
  });
  const rng = new Sfc32(seedFrom(seed, 0x4b9));

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
  pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'lead', room: '' }));
  pair.settle();
  const lead = session.slots[0]!;
  lead.state = createMoveState(LEAD_AT.x, LEAD_AT.y, LEAD_AT.z);
  for (let i = 1; i < session.slots.length; i++) {
    session.slots[i]!.state = createMoveState(LEAD_AT.x + (rng.next() * 6 - 3), 0, LEAD_AT.z - 1 - rng.next() * 3);
  }

  const ids: number[] = [];
  const gunners = new Set<number>();
  const place = (archetype: string, at: { x: number; y: number; z: number }) => {
    const id = session.spawnEnemy(archetype, {
      x: at.x + (rng.next() * 2 - 1),
      y: 0,
      z: at.z + (rng.next() * 2 - 1),
      yaw: 512,
      tree: buildTree(getEnemy(archetype).tree, createBrainRegistry()),
      group: 1,
    });
    if (id !== null) ids.push(id);
    return id;
  };
  for (let i = 0; i < config.riflemen; i++) place('rifleman', RIFLEMEN_AT[i % RIFLEMEN_AT.length]!);
  for (let i = 0; i < config.gunners; i++) {
    const id = place('rpg', GUNNERS_AT[i % GUNNERS_AT.length]!);
    if (id !== null) gunners.add(id);
  }

  const bots = session.slots.slice(1);
  const wasDowned = bots.map(() => false);
  let botsDowned = 0;
  const killedAt = new Map<number, number>();
  // Every gunner's rocket in the air, where it was last seen: where it is gone from is where it went off.
  const inFlight = new Map<number, { x: number; y: number; z: number }>();
  let rockets = 0;
  let unsafeBursts = 0;
  let inputTick = 0;
  const rounds0 = bots.map((b) => b.weaponState.shotIndex);
  const total = Math.round(config.fightSeconds * TICKS_PER_SECOND);
  for (let t = 0; t < total; t++) {
    pair.b.send(encodeMessage({ kind: 'Input', tick: ++inputTick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0 }));
    if (t >= OPEN_FIRE_TICK && t < OPEN_FIRE_TICK + 6) {
      pair.b.send(encodeMessage({ kind: 'Fire', tick: session.tick, yaw: 0, pitch: 40, renderTimeMs: session.tick * (1000 / TICKS_PER_SECOND), weapon: 0, ads: true }));
    }
    pair.settle();
    // Who stands where before the step: a burst this step is judged against them.
    const sides = session.enemies.filter((e) => !isDead(e.health)).map((e) => ({ x: e.state.x, y: e.state.y, z: e.state.z }));
    session.step((session.tick + 1) * (1000 / TICKS_PER_SECOND));
    pair.settle();
    Object.assign(lead.health, createHealth());

    const now = new Map(session.projectilesNow().filter((p) => p.kind === ROCKET && gunners.has(p.ownerNetId)).map((p) => [p.netId, p] as const));
    for (const [netId, p] of now) {
      if (!inFlight.has(netId)) rockets++;
      inFlight.set(netId, { x: p.x, y: p.y, z: p.z });
    }
    for (const [netId, last] of [...inFlight]) {
      if (now.has(netId)) continue;
      inFlight.delete(netId);
      if (sides.some((s) => Math.hypot(s.x - last.x, s.z - last.z) <= BLAST_M)) unsafeBursts++;
    }

    bots.forEach((b, i) => {
      const down = isDowned(b.health);
      if (down && !wasDowned[i]) botsDowned++;
      wasDowned[i] = down;
    });
    for (const id of ids) {
      const e = session.enemies.find((x) => x.netId === id);
      if ((!e || isDead(e.health)) && !killedAt.has(id)) killedAt.set(id, t);
    }
    if (killedAt.size === ids.length && inFlight.size === 0) break;
  }
  const gunnersHit = [...gunners].filter((id) => {
    const e = session.enemies.find((x) => x.netId === id);
    return !e || e.health.current < e.health.max;
  }).length;
  mesh.destroy();
  const lastKill = killedAt.size === ids.length ? Math.max(...killedAt.values()) : null;
  return {
    seed,
    kills: killedAt.size,
    spawned: ids.length,
    riflemenKilled: ids.filter((id) => !gunners.has(id) && killedAt.has(id)).length,
    riflemen: ids.length - gunners.size,
    gunnersHit,
    gunners: gunners.size,
    rockets,
    unsafeBursts,
    friendlyHits: session.friendlyHits,
    botsDowned,
    botsDead: bots.filter((b) => isDead(b.health)).length,
    botRounds: bots.reduce((a, b, i) => a + b.weaponState.shotIndex - rounds0[i]!, 0),
    clearedS: lastKill === null ? null : lastKill / TICKS_PER_SECOND,
  };
}

export interface RpgSummary {
  runs: RpgRun[];
  riflemanKillShare: number;
  gunnerHitShare: number;
  rockets: number;
  unsafeBursts: number;
  botsDead: number;
  failures: string[];
}

export async function summariseRpg(config = RPG_SCENARIO): Promise<RpgSummary> {
  const runs: RpgRun[] = [];
  for (let seed = 1; seed <= config.seeds; seed++) runs.push(await runRpg(seed, config));
  return judgeRpg(runs, config);
}

export function judgeRpg(runs: RpgRun[], config = RPG_SCENARIO): RpgSummary {
  const sum = (f: (r: RpgRun) => number) => runs.reduce((a, r) => a + f(r), 0);
  const riflemen = sum((r) => r.riflemen);
  const riflemanKillShare = riflemen === 0 ? 0 : sum((r) => r.riflemenKilled) / riflemen;
  const gunnerHitShare = runs.filter((r) => r.gunnersHit > 0).length / Math.max(1, runs.length);
  const rockets = sum((r) => r.rockets);
  const unsafeBursts = sum((r) => r.unsafeBursts);
  const botsDead = sum((r) => r.botsDead);
  const failures: string[] = [];
  if (riflemanKillShare < config.minRiflemanKillShare) failures.push(`the squad killed ${(riflemanKillShare * 100).toFixed(0)}% of the riflemen (floor ${config.minRiflemanKillShare * 100}%)`);
  if (gunnerHitShare < config.minRunsGunnerHit) failures.push(`the squad hit a gunner in ${(gunnerHitShare * 100).toFixed(0)}% of runs (floor ${config.minRunsGunnerHit * 100}%)`);
  const fired = runs.filter((r) => r.rockets > 0).length / Math.max(1, runs.length);
  if (fired < config.minRunsWithRockets) failures.push(`rockets were fired in ${(fired * 100).toFixed(0)}% of runs (floor ${config.minRunsWithRockets * 100}%)`);
  if (unsafeBursts > 0) failures.push(`${unsafeBursts} rockets went off with the gunners' own side inside the blast (ceiling 0)`);
  const hitRuns = runs.filter((r) => r.friendlyHits > config.maxFriendlyHits);
  if (hitRuns.length > 0) failures.push(`friendly hits in ${hitRuns.length} runs (ceiling ${config.maxFriendlyHits} a run)`);
  const deadPerRun = botsDead / Math.max(1, runs.length);
  if (deadPerRun > config.maxBotsDeadPerRun) failures.push(`${deadPerRun.toFixed(1)} bots died a run (ceiling ${config.maxBotsDeadPerRun})`);
  if (runs.some((r) => r.botRounds === 0)) failures.push(`the bots fired nothing in ${runs.filter((r) => r.botRounds === 0).length} runs`);
  return { runs, riflemanKillShare, gunnerHitShare, rockets, unsafeBursts, botsDead, failures };
}

export function reportRpg(summary: RpgSummary, config = RPG_SCENARIO): string {
  const lines = summary.runs.map(
    (r) =>
      `  seed ${String(r.seed).padStart(2)}: killed ${r.kills}/${r.spawned}${r.clearedS === null ? '' : ` by ${r.clearedS.toFixed(1)} s`} ` +
      `(riflemen ${r.riflemenKilled}/${r.riflemen}, gunners hit ${r.gunnersHit}/${r.gunners}), ` +
      `${r.rockets} rockets (${r.unsafeBursts} unsafe), ${r.botRounds} bot rounds, ${r.friendlyHits} friendly hits; bots downed ${r.botsDowned}, dead ${r.botsDead}`,
  );
  return [
    `scenario=rpg seeds=${config.seeds} fight=${config.fightSeconds}s riflemen=${config.riflemen} gunners=${config.gunners}`,
    ...lines,
    `riflemen killed: ${(summary.riflemanKillShare * 100).toFixed(0)}% (floor ${config.minRiflemanKillShare * 100}%)`,
    `runs with a gunner hit: ${(summary.gunnerHitShare * 100).toFixed(0)}% (floor ${config.minRunsGunnerHit * 100}%)`,
    `rockets: ${summary.rockets} in all, ${summary.unsafeBursts} with their own side in the blast (ceiling 0)`,
    `bots dead: ${(summary.botsDead / Math.max(1, summary.runs.length)).toFixed(1)} a run (ceiling ${config.maxBotsDeadPerRun})`,
  ].join('\n');
}
