/**
 * Formation following (T-3.25).
 *
 * The lead rules as pure functions, then real `Session`s: humans over
 * loopback, bot slots running the committed `friendly` tree on the range's
 * navmesh. The route walk has one human stand-in in slot 0 walking the range
 * south off the spawn line (away from the bots beside it), east round a
 * corner, north round a second, and west at a sprint round a third, then
 * standing — every other slot a bot following it: slots 1 and 2 as its
 * own fireteam's wedge, slots 3–5 (a fireteam with no human, so following the
 * squad's first) falling in behind.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ClientConnection, INPUT_BUTTONS, SQUAD, buildTree, createLoopbackPair, fireteamOf, formationBand, parseSquadConfig } from '@sandline/shared';
import RAW_SQUAD from '../../../../shared/src/data/squad.json' with { type: 'json' };
import { createBrainRegistry } from '../Brain.ts';
import { type NavMesh, initNav } from '../nav/NavMesh.ts';
import { loadWorldNavMesh } from '../nav/bakedNav.ts';
import { Session } from '../../session/Session.ts';
import { Formation, type FormationSlot, leadOf } from './formation.ts';

const TICK_MS = 1000 / 30;

let mesh: NavMesh;
beforeAll(async () => {
  await initNav();
  mesh = loadWorldNavMesh('range');
});

/** A human over loopback: joins on creation; `input` sends one tick's; `leave` closes the socket. */
function human(session: Session, name: string) {
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  let slot = -1;
  let tick = 0;
  const client = new ClientConnection(pair.b, {
    onJoinAck: (_netId, s) => {
      slot = s;
    },
  });
  client.join(name);
  pair.settle();
  return {
    get slot() {
      return slot;
    },
    input(moveY: number, yaw: number, sprint: boolean) {
      client.send({ kind: 'Input', tick: ++tick, moveX: 0, moveY, yaw, pitch: 0, buttons: sprint ? INPUT_BUTTONS.sprint : 0 });
      pair.settle();
    },
    leave() {
      pair.b.close('gone');
      pair.settle();
    },
  };
}

function friendlySession(): Session {
  return new Session(undefined, '', 'range', { navMesh: mesh, brainTree: buildTree('friendly', createBrainRegistry()) });
}

describe('squad.json (T-3.25)', () => {
  it('splits the six slots into two fireteams of three, and refuses bad data', () => {
    expect(SQUAD.fireteams.map((t) => t.slots)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
    ]);
    expect([0, 1, 2, 3, 4, 5].map((s) => fireteamOf(s))).toEqual([0, 0, 0, 1, 1, 1]);
    expect(() => parseSquadConfig({ ...RAW_SQUAD, extra: 1 })).toThrow(/unknown key/);
    expect(() => parseSquadConfig({ ...RAW_SQUAD, fireteams: [{ slots: [0, 1, 2], formation: 'wedge' }] })).toThrow(/every one/);
    expect(() => parseSquadConfig({ ...RAW_SQUAD, fireteams: [{ slots: [0, 1, 2], formation: 'wedge' }, { slots: [2, 3, 4, 5], formation: 'file' }] })).toThrow(/two fireteams/);
    expect(() => parseSquadConfig({ ...RAW_SQUAD, fireteams: [{ slots: [0, 1, 2], formation: 'box' }, { slots: [3, 4, 5], formation: 'file' }] })).toThrow(/box/);
    expect(() => parseSquadConfig({ ...RAW_SQUAD, formations: { ...RAW_SQUAD.formations, wedge: [[0, 0], [1, 3], [2, 3], [3, 3], [4, 3]] } })).toThrow(/within 1 m/);
    expect(() => parseSquadConfig({ ...RAW_SQUAD, formations: { ...RAW_SQUAD.formations, file: [[0, 3]] } })).toThrow(/offsets/);
  });
});

describe('the lead (T-3.25)', () => {
  const squad = (humans: number[]) => [0, 1, 2, 3, 4, 5].map((index) => ({ index, human: humans.includes(index) }));

  it('is the fireteam’s first human, else the squad’s first human, else slot 0', () => {
    expect(leadOf(0, squad([]))).toBe(0);
    expect(leadOf(1, squad([]))).toBe(0);
    expect(leadOf(0, squad([2, 1]))).toBe(1);
    expect(leadOf(1, squad([2, 1]))).toBe(1);
    expect(leadOf(1, squad([1, 4, 5]))).toBe(4);
    expect(leadOf(0, squad([4]))).toBe(4);
  });

  it('changes as humans join and leave fireteams on the session', () => {
    const session = friendlySession();
    const leads = () => [session.leadFor(1), session.leadFor(4)];
    session.step(TICK_MS);
    expect(leads()).toEqual([0, 0]); // Nobody here: slot 0's bot.
    const a = human(session, 'a');
    const b = human(session, 'b');
    const c = human(session, 'c');
    const d = human(session, 'd');
    expect([a.slot, b.slot, c.slot, d.slot]).toEqual([0, 1, 2, 3]);
    session.step(2 * TICK_MS);
    expect(leads()).toEqual([0, 3]); // Each fireteam has a human of its own.
    a.leave();
    session.step(3 * TICK_MS);
    expect(leads()).toEqual([1, 3]); // Fireteam 0's next human.
    d.leave();
    session.step(4 * TICK_MS);
    expect(leads()).toEqual([1, 1]); // Fireteam 1 has none: the squad's first.
    b.leave();
    c.leave();
    session.step(5 * TICK_MS);
    expect(leads()).toEqual([0, 0]);
    // A human is nobody's follower, and a lead follows nobody.
    const e = human(session, 'e');
    session.step(6 * TICK_MS);
    expect(e.slot).toBe(0);
    expect(session.formationPlace(0)).toBeNull();
    expect(session.formationPlace(1)?.lead).toBe(0);
  });

  it('ranks its own fireteam first, then the other, each in slot order', () => {
    const f = new Formation((p) => p);
    const slots: FormationSlot[] = [0, 1, 2, 3, 4, 5].map((index) => ({ index, human: index === 4, x: index, y: 0, z: 0, yaw: 0, speed: 0, sprint: false }));
    f.update(slots);
    expect(f.followersOf(4)).toEqual([3, 5, 0, 1, 2]);
  });
});

/** The route: waypoints, and whether the lead sprints the leg that ends there. */
const ROUTE: { x: number; z: number; sprint: boolean }[] = [
  { x: -3.75, z: -16, sprint: false },
  { x: 15, z: -16, sprint: false },
  { x: 15, z: 15, sprint: false },
  { x: -1, z: 15, sprint: true },
];
/** In band this long without a break counts as back in formation, ticks. */
const REJOINED_TICKS = 30;

describe('following a lead over a route (T-3.25)', () => {
  it('keeps every bot in its band most of the way, rejoins after the corner, never on the lead, at the lead’s pace', () => {
    const session = friendlySession();
    const lead = human(session, 'lead');
    expect(lead.slot).toBe(0);
    const leader = session.slots[0]!;
    const followers = [1, 2, 3, 4, 5];
    const inBand = new Map(followers.map((i) => [i, 0]));
    const sprintTicks = new Map(followers.map((i) => [i, 0]));
    let closest = Infinity;
    let routeTicks = 0;
    let sprintLegTicks = 0;
    /** Per corner, per follower: ticks from the corner until back in band for good (a second), or null while not yet. */
    const corners: { tick: number; back: Map<number, number | null>; runIn: Map<number, number> }[] = [];
    let leg = 0;
    let stoodFor = 0;

    for (let t = 0; t < 30 * 40 && stoodFor < 30 * 4; t++) {
      const w = ROUTE[leg];
      let yaw = leader.yaw;
      let moveY = 0;
      if (w) {
        const dx = w.x - leader.state.x;
        const dz = w.z - leader.state.z;
        if (Math.hypot(dx, dz) < 0.6) {
          if (leg < ROUTE.length - 1) corners.push({ tick: t, back: new Map(followers.map((i) => [i, null])), runIn: new Map(followers.map((i) => [i, 0])) });
          leg++;
        } else {
          yaw = ((Math.round((Math.atan2(dx, dz) / (Math.PI * 2)) * 1024) % 1024) + 1024) % 1024;
          moveY = 1;
        }
      }
      const sprint = w?.sprint === true && moveY > 0;
      lead.input(moveY, yaw, sprint);
      session.step((session.tick + 1) * TICK_MS);
      if (!w) stoodFor++;

      for (const i of followers) {
        const bot = session.slots[i]!;
        closest = Math.min(closest, Math.hypot(bot.state.x - leader.state.x, bot.state.z - leader.state.z));
        if (!w) continue;
        const place = session.formationPlace(i);
        if (!place) continue;
        const off = Math.hypot(bot.state.x - place.goal.x, bot.state.z - place.goal.z);
        const band = formationBand(place.offset);
        if (off <= band) inBand.set(i, inBand.get(i)! + 1);
        // Back after each corner: in band and staying there a second, counted from the corner.
        for (const c of corners) {
          if (c.back.get(i) !== null) continue;
          c.runIn.set(i, off <= band ? c.runIn.get(i)! + 1 : 0);
          if (c.runIn.get(i)! >= REJOINED_TICKS) c.back.set(i, t - c.tick - REJOINED_TICKS + 1);
        }
        if (sprint && bot.input.sprint) sprintTicks.set(i, sprintTicks.get(i)! + 1);
      }
      if (w) routeTicks++;
      if (sprint) sprintLegTicks++;
    }

    expect(leg).toBe(ROUTE.length);
    expect(corners.length).toBe(ROUTE.length - 1);
    const share = followers.map((i) => inBand.get(i)! / routeTicks);
    // The slowest rejoin of each follower over the corners; null if it never did.
    const rejoin = followers.map((i) => {
      const times = corners.map((c) => c.back.get(i) ?? null);
      return times.some((x) => x === null) ? null : Math.max(...(times as number[]));
    });
    console.log(
      `formation: in band ${share.map((s) => `${(s * 100).toFixed(0)}%`).join(' ')}; ` +
        `back in band after its worst corner in ${rejoin.map((r) => (r === null ? 'never' : `${(r! / 30).toFixed(1)} s`)).join(' ')}; ` +
        `sprinting ${followers.map((i) => `${((sprintTicks.get(i)! / sprintLegTicks) * 100).toFixed(0)}%`).join(' ')} of the sprint leg; ` +
        `closest to the lead ${closest.toFixed(2)} m`,
    );
    // In band for most of the route, each of them.
    for (const s of share) expect(s).toBeGreaterThanOrEqual(0.8);
    // Rejoined within a few seconds of every corner.
    for (const r of rejoin) {
      expect(r).not.toBeNull();
      expect(r! / 30).toBeLessThanOrEqual(4);
    }
    // Sprinting when the lead sprints, most of that leg.
    for (const i of followers) expect(sprintTicks.get(i)! / sprintLegTicks).toBeGreaterThanOrEqual(0.7);
    // Never where the lead stands: not within two capsule radii of it, ever.
    expect(closest).toBeGreaterThan(0.7);

    // Stopped, they have closed up: each nearer the lead than its full offset, and standing.
    for (const i of followers) {
      const place = session.formationPlace(i)!;
      const bot = session.slots[i]!;
      expect(Math.hypot(bot.state.x - place.goal.x, bot.state.z - place.goal.z)).toBeLessThanOrEqual(formationBand(place.offset));
      expect(session.slots[i]!.brain?.intent ?? null).toBeNull();
    }
    const wedgeRank0 = SQUAD.formations['wedge']![0]!;
    const bot1 = session.slots[1]!;
    expect(Math.hypot(bot1.state.x - leader.state.x, bot1.state.z - leader.state.z)).toBeLessThan(Math.hypot(wedgeRank0[0], wedgeRank0[1]));
  }, 30_000);
});
