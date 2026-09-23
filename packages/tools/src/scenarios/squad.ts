/**
 * `squad` (T-3.26): five friendly bots against a group of riflemen, headless,
 * seeded.
 *
 * Slot 0 is a human over a loopback — the lead — standing just south of the
 * range's low wall, kept alive so the formation has somewhere to be; it
 * fires but once — a burst up range in the first second, opening the fight
 * as a player would, so every run has contact. Slots 1–5 are bots running
 * the committed `friendly` tree: they follow it, see and hear the enemy, take cover near their places, fire (never
 * through a squadmate), throw grenades and revive whoever goes down. A group
 * of riflemen runs the committed `rifleman` tree from up range, north of the
 * west walls. Nobody else is healed: bots go down, bleed out and die, enemies
 * die.
 *
 * Measured per run: riflemen killed, rounds fired by a slot that hurt a slot
 * (`Session.friendlyHits`), bots downed, bots revived by a bot, bots dead.
 * `judgeSquad` checks them against `squad.json`.
 */
import {
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
  isDead,
  isDowned,
  requireWorld,
  seedFrom,
} from '@sandline/shared';
import { Session } from '../../../server/src/session/Session.ts';
import { createBrainRegistry } from '../../../server/src/ai/Brain.ts';
import { initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from '../../../server/src/ai/nav/bakedNav.ts';
import THRESHOLDS from './squad.json' with { type: 'json' };

export const SQUAD_SCENARIO = THRESHOLDS;

const TICKS_PER_SECOND = Math.round(1 / TICK_SECONDS);
/** When the lead opens fire, ticks. */
const OPEN_FIRE_TICK = 30;
/** The lead: south of the low wall (x −12..−6, z −1), hidden from up range. */
const LEAD_AT = { x: -9, y: 0, z: -3 };
/** The riflemen, before the seed's jitter: up range, north-west beyond the west walls. */
const RIFLEMEN_AT = [
  { x: -8, y: 0, z: 26 },
  { x: -12, y: 0, z: 28 },
  { x: -4, y: 0, z: 28 },
];

export interface SquadRun {
  seed: number;
  kills: number;
  spawned: number;
  friendlyHits: number;
  /** Times a bot went down, was revived by a bot, and died. */
  botsDowned: number;
  revivedByBot: number;
  botsDead: number;
  /** Rounds the bots fired, all told. */
  botRounds: number;
  /** Seconds to the last kill, or null if not every rifleman died. */
  clearedS: number | null;
}

let navReady: Promise<void> | null = null;

export async function runSquad(seed: number, config = SQUAD_SCENARIO): Promise<SquadRun> {
  await (navReady ??= initNav());
  const world = requireWorld('range');
  const mesh = loadWorldNavMesh('range');
  const session = new Session(undefined, '', world, {
    navMesh: mesh,
    cover: bakedCoverFor('range'),
    brainTree: buildTree('friendly', createBrainRegistry()),
  });
  const rng = new Sfc32(seedFrom(seed, 0x5a0));

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
  // The bots start about the lead, each a seeded metre or two off.
  for (let i = 1; i < session.slots.length; i++) {
    session.slots[i]!.state = createMoveState(LEAD_AT.x + (rng.next() * 6 - 3), 0, LEAD_AT.z - 1 - rng.next() * 3);
  }

  const ids: number[] = [];
  for (let i = 0; i < config.riflemen; i++) {
    const at = RIFLEMEN_AT[i % RIFLEMEN_AT.length]!;
    const id = session.spawnEnemy('rifleman', {
      x: at.x + (rng.next() * 2 - 1),
      y: 0,
      z: at.z + (rng.next() * 2 - 1),
      yaw: 512,
      tree: buildTree('rifleman', createBrainRegistry()),
      group: 1,
    });
    if (id !== null) ids.push(id);
  }

  const bots = session.slots.slice(1);
  const wasDowned = bots.map(() => false);
  let botsDowned = 0;
  let revivedByBot = 0;
  const killedAt = new Map<number, number>();
  let inputTick = 0;
  const rounds0 = bots.map((b) => b.weaponState.shotIndex);
  const total = Math.round(config.fightSeconds * TICKS_PER_SECOND);
  for (let t = 0; t < total; t++) {
    // The lead stands where it is, every tick, as a player's client would send.
    pair.b.send(encodeMessage({ kind: 'Input', tick: ++inputTick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0 }));
    // The opening burst: north, a little up, over the wall.
    if (t >= OPEN_FIRE_TICK && t < OPEN_FIRE_TICK + 6) {
      pair.b.send(encodeMessage({ kind: 'Fire', tick: session.tick, yaw: 0, pitch: 40, renderTimeMs: session.tick * (1000 / TICKS_PER_SECOND), weapon: 0, ads: true }));
    }
    pair.settle();
    // Who holds each downed bot's revive lock, before the step completes it.
    const reviver = bots.map((b) => b.reviveBySlot);
    session.step((session.tick + 1) * (1000 / TICKS_PER_SECOND));
    pair.settle();
    Object.assign(lead.health, createHealth());

    bots.forEach((b, i) => {
      const down = isDowned(b.health);
      if (down && !wasDowned[i]) botsDowned++;
      if (!down && wasDowned[i] && !isDead(b.health)) {
        const by = session.slots[reviver[i]!];
        if (by && by.isBot) revivedByBot++;
      }
      wasDowned[i] = down;
    });
    for (const id of ids) {
      const e = session.enemies.find((x) => x.netId === id);
      if ((!e || isDead(e.health)) && !killedAt.has(id)) killedAt.set(id, t);
    }
    if (killedAt.size === ids.length) break;
  }
  mesh.destroy();
  const lastKill = killedAt.size === ids.length ? Math.max(...killedAt.values()) : null;
  return {
    seed,
    kills: killedAt.size,
    spawned: ids.length,
    friendlyHits: session.friendlyHits,
    botsDowned,
    revivedByBot,
    botsDead: bots.filter((b) => isDead(b.health)).length,
    botRounds: bots.reduce((a, b, i) => a + b.weaponState.shotIndex - rounds0[i]!, 0),
    clearedS: lastKill === null ? null : lastKill / TICKS_PER_SECOND,
  };
}

export interface SquadSummary {
  runs: SquadRun[];
  killShare: number;
  friendlyHits: number;
  failures: string[];
}

export async function summariseSquad(config = SQUAD_SCENARIO): Promise<SquadSummary> {
  const runs: SquadRun[] = [];
  for (let seed = 1; seed <= config.seeds; seed++) runs.push(await runSquad(seed, config));
  return judgeSquad(runs, config);
}

export function judgeSquad(runs: SquadRun[], config = SQUAD_SCENARIO): SquadSummary {
  const kills = runs.reduce((a, r) => a + r.kills, 0);
  const spawned = runs.reduce((a, r) => a + r.spawned, 0);
  const killShare = spawned === 0 ? 0 : kills / spawned;
  const friendlyHits = runs.reduce((a, r) => a + r.friendlyHits, 0);
  const failures: string[] = [];
  if (killShare < config.minKillShare) failures.push(`the squad killed ${(killShare * 100).toFixed(0)}% of the riflemen (floor ${config.minKillShare * 100}%)`);
  const hitRuns = runs.filter((r) => r.friendlyHits > config.maxFriendlyHits);
  if (hitRuns.length > 0) failures.push(`friendly hits in ${hitRuns.length} runs (${friendlyHits} in all; ceiling ${config.maxFriendlyHits} a run)`);
  if (runs.some((r) => r.botRounds === 0)) failures.push(`the bots fired nothing in ${runs.filter((r) => r.botRounds === 0).length} runs`);
  return { runs, killShare, friendlyHits, failures };
}

export function reportSquad(summary: SquadSummary, config = SQUAD_SCENARIO): string {
  const lines = summary.runs.map(
    (r) =>
      `  seed ${String(r.seed).padStart(2)}: killed ${r.kills}/${r.spawned}${r.clearedS === null ? '' : ` by ${r.clearedS.toFixed(1)} s`}, ` +
      `${r.botRounds} rounds, ${r.friendlyHits} friendly hits; bots downed ${r.botsDowned}, revived by a bot ${r.revivedByBot}, dead ${r.botsDead}`,
  );
  return [
    `scenario=squad seeds=${config.seeds} fight=${config.fightSeconds}s riflemen=${config.riflemen}`,
    ...lines,
    `riflemen killed: ${(summary.killShare * 100).toFixed(0)}% (floor ${config.minKillShare * 100}%)`,
    `friendly hits: ${summary.friendlyHits} (ceiling ${config.maxFriendlyHits} a run)`,
  ].join('\n');
}
