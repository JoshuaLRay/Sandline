/**
 * The director (T-3.33): intensity from what the squad is going through,
 * waves held while it is high and brought forward while it is low inside
 * the encounter's bounds, and every wave sized by the humans seated — not
 * the squad.
 */
import { describe, expect, it } from 'vitest';
import {
  DIRECTOR,
  type Encounter,
  PROTOCOL_VERSION,
  TICK_SECONDS,
  budgetFor,
  createLoopbackPair,
  encodeMessage,
  encounterFor,
  loadWorld,
  parseDirectorConfig,
  parseEncounter,
  requireWorld,
  scaled,
} from '@sandline/shared';
import RAW_DIRECTOR from '../../../../shared/src/data/director.json' with { type: 'json' };
import { Session } from '../../session/Session.ts';
import { Director, type DirectorSample } from './director.ts';
import { Spawner, type SpawnerHost, type Vec3 } from './spawner.ts';

const CALM: Omit<DirectorSample, 'seconds'> = { humans: 1, squadHealth: 600, contact: 0, suppression: 0 };

describe('intensity (T-3.33)', () => {
  it('weighs recent damage, enemies in contact and squad suppression, each capped, from director.json', () => {
    const d = new Director();
    const c = DIRECTOR.intensity;
    d.sample({ ...CALM, seconds: 0 });
    expect(d.intensity).toBe(0);
    d.sample({ ...CALM, seconds: 1, contact: c.contactFull / 2 });
    expect(d.intensity).toBeCloseTo(c.weights.contact * 0.5, 9);
    d.sample({ ...CALM, seconds: 2, contact: 99, suppression: 1 });
    expect(d.intensity).toBeCloseTo(c.weights.contact + c.weights.suppression, 9);
    // Damage: a drop in the squad's health, counted over the window and then forgotten.
    d.sample({ ...CALM, seconds: 3, squadHealth: 600 - c.damageFull / 2 });
    expect(d.components.damage).toBeCloseTo(0.5, 9);
    d.sample({ ...CALM, seconds: 4, squadHealth: 600 });
    expect(d.components.damage).toBeCloseTo(0.5, 9);
    d.sample({ ...CALM, seconds: 3 + c.windowSeconds + 0.01, squadHealth: 600 });
    expect(d.components.damage).toBe(0);
    d.sample({ ...CALM, seconds: 20, squadHealth: 0 });
    expect(d.components.damage).toBe(1);
  });

  it('refuses tuning that cannot mean anything, by name', () => {
    const bad = (edit: (r: Record<string, unknown>) => void) => () => {
      const raw = structuredClone(RAW_DIRECTOR) as unknown as Record<string, unknown>;
      edit(raw);
      return parseDirectorConfig(raw);
    };
    expect(bad((r) => ((r['intensity'] as Record<string, Record<string, number>>)['weights']!['damage'] = 0.9))).toThrow(/weights must sum to 1/);
    expect(bad((r) => (r['forwardBelow'] = 0.7))).toThrow(/forwardBelow .* must be below holdAbove/);
    expect(bad((r) => (r['budget'] as unknown[]).pop())).toThrow(/a row for each of 1 to 6 humans/);
    expect(bad((r) => ((r['budget'] as Record<string, number>[])[2]!['humans'] = 4))).toThrow(/budget\[2\].humans must be 3/);
    expect(bad((r) => (r['mood'] = 'grim'))).toThrow(/unknown key 'mood'/);
  });
});

/** A hard fight: the squad losing 30 health a second, every enemy in contact, everyone suppressed. */
const hot = (t: number): Omit<DirectorSample, 'seconds'> => ({ humans: 1, squadHealth: 6000 - 30 * t, contact: 99, suppression: 1 });

describe('a wave is held while intensity is high, never past the encounter’s maximum (T-3.33)', () => {
  const waves = { count: 2, everySeconds: 20, minSeconds: 10, maxSeconds: 40 };
  /** The first second, on the tick grid, at which the next wave goes under a steady intensity. */
  const dueAt = (sample: (t: number) => Omit<DirectorSample, 'seconds'>) => {
    const d = new Director();
    for (let t = 0; t < 60; t += TICK_SECONDS) {
      d.sample({ ...sample(t), seconds: t });
      if (d.waveDue(t, waves)) return { at: t, intensity: d.intensity };
    }
    return null;
  };

  it('high: held to the maximum and sent on it; low: at the minimum; between: on schedule', () => {
    const high = dueAt(hot);
    const low = dueAt(() => CALM);
    const mid = dueAt(() => ({ ...CALM, contact: DIRECTOR.intensity.contactFull, suppression: 0.5 }));
    console.log(`[director] next wave (min 10, every 20, max 40): high ${high!.intensity.toFixed(2)} → ${high!.at.toFixed(2)} s, low ${low!.intensity.toFixed(2)} → ${low!.at.toFixed(2)} s, middle ${mid!.intensity.toFixed(2)} → ${mid!.at.toFixed(2)} s`);
    expect(high!.intensity).toBeGreaterThan(DIRECTOR.holdAbove);
    expect(high!.at).toBeGreaterThanOrEqual(40);
    expect(high!.at).toBeLessThan(40 + TICK_SECONDS);
    expect(low!.intensity).toBeLessThan(DIRECTOR.forwardBelow);
    expect(low!.at).toBeGreaterThanOrEqual(10);
    expect(low!.at).toBeLessThan(10 + TICK_SECONDS);
    expect(mid!.intensity).toBeGreaterThanOrEqual(DIRECTOR.forwardBelow);
    expect(mid!.intensity).toBeLessThanOrEqual(DIRECTOR.holdAbove);
    expect(mid!.at).toBeGreaterThanOrEqual(20);
    expect(mid!.at).toBeLessThan(20 + TICK_SECONDS);
  });

  it('a wave held back goes the moment intensity drops, and the spawner sends it then', () => {
    const d = new Director();
    const e = smallEncounter(4, { count: 2, everySeconds: 20, minSeconds: 10, maxSeconds: 40 });
    const host = fakeHost();
    const spawner = new Spawner(e, WORLD, host, undefined, d);
    let t = 0;
    for (; t < 30; t += TICK_SECONDS) {
      d.sample({ ...hot(t), seconds: t });
      spawner.step(t);
    }
    expect(spawner.wavesOf('g')).toHaveLength(1);
    for (; spawner.wavesOf('g').length < 2 && t < 60; t += TICK_SECONDS) {
      d.sample({ ...CALM, seconds: t });
      spawner.step(t);
    }
    expect(spawner.wavesOf('g')[1]).toBeGreaterThanOrEqual(30);
    expect(spawner.wavesOf('g')[1]).toBeLessThan(30 + 2 * TICK_SECONDS);
  });
});

/* -- A world and host of the test's own, as spawner.test.ts has ------------------ */

const WORLD = loadWorld({
  id: 'director-test',
  floor: { halfExtent: 40 },
  cover: [{ id: 'c', x: 30, y: 0, z: 30, w: 1, h: 1, d: 1 }],
  mission: {
    start: { x: 0, z: -10, radius: 3 },
    objective: { x: 0, z: 20, radius: 3 },
    routes: [
      { id: 'a', role: 'overwatch', via: [] },
      { id: 'b', role: 'assault', via: [] },
    ],
    spawnZones: [{ id: 'z', on: 'objective', x: 0, z: 20, radius: 6 }],
    checks: { sampleM: 0.5, minDistinctShare: 0.5, coverWithinM: 5, maxUncoveredM: { overwatch: 20, assault: 20 }, sightM: 10 },
  },
});

function smallEncounter(count: number, waves: { count: number; everySeconds: number; minSeconds: number; maxSeconds: number }, aliveCap = 30): Encounter {
  return parseEncounter(
    {
      world: 'director-test',
      aliveCap,
      probes: [1],
      areas: {},
      groups: [{ id: 'g', members: [{ archetype: 'rifleman', count }], zone: 'z', posture: { kind: 'hold' }, trigger: { kind: 'start' }, waves }],
    },
    () => WORLD,
  );
}

function fakeHost() {
  let next = 2000;
  const alive = new Map<number, Vec3>();
  const host = {
    humanEyes: () => [],
    squadFeet: () => [],
    enemyFeet: () => [...alive.values()],
    isAlive: (netId: number) => alive.has(netId),
    spawn: (_a: string, at: Vec3) => {
      alive.set(next, { x: at.x, y: at.y, z: at.z });
      return next++;
    },
    kill: (netId: number) => alive.delete(netId),
  };
  return host satisfies SpawnerHost & Record<string, unknown>;
}

describe('waves scale on humans, not squad size (T-3.33)', () => {
  it('a bot swapped for a human mid-mission changes the next wave, not the current one', () => {
    const d = new Director();
    const host = fakeHost();
    // Six a wave as written; a cap that makes the first wave wait in the queue.
    const e = smallEncounter(6, { count: 2, everySeconds: 10, minSeconds: 10, maxSeconds: 10 }, 12);
    const spawner = new Spawner(e, WORLD, host, undefined, d);
    // Ten enemies already alive, not the spawner's: one-human cap is 6, so nothing fits.
    for (let i = 0; i < 10; i++) host.spawn('rifleman', { x: -30 + i, y: 0, z: 30 });
    let t = 0;
    const tick = (humans: number) => {
      d.sample({ ...CALM, humans, seconds: t });
      spawner.step(t);
      t += TICK_SECONDS;
    };
    tick(1);
    expect(spawner.wavesOf('g')).toHaveLength(1);
    const one = scaled(6, budgetFor(1).size);
    expect(spawner.pending).toBe(one);
    expect(spawner.spawnedBy('g')).toHaveLength(0);
    // A human takes a bot's slot: six now. The queued wave keeps its one-human size.
    for (let i = 2000; i < 2010; i++) host.kill(i);
    while (t < 5) tick(6);
    expect(spawner.log.filter((l) => l.wave === 1)).toHaveLength(one);
    // The next wave is the six-human wave.
    while (t < 12) tick(6);
    const six = scaled(6, budgetFor(6).size);
    expect(spawner.log.filter((l) => l.wave === 2)).toHaveLength(six);
    expect(six).toBeGreaterThan(one);
  });

  describe('on a real session: one human and five bots get the one-human budget; six humans the six-human', () => {
    const world = requireWorld('greybox-01');
    const encounter = encounterFor('greybox-01')!;
    const garrison = encounter.groups.find((g) => g.id === 'garrison')!;

    /** A session with `humans` humans seated over loopback, stepped a second. */
    function seat(humans: number) {
      const session = new Session(undefined, '', world, { encounter });
      const pairs = Array.from({ length: humans }, (_, i) => {
        const pair = createLoopbackPair();
        session.addConnection(pair.a, 0);
        pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: `h${i}`, room: '' }));
        pair.settle();
        return pair;
      });
      let now = 0;
      for (let t = 0; t < 30; t++) {
        now += 1000 / 30;
        session.step(now);
        pairs.forEach((p) => p.settle());
      }
      return session;
    }

    it.each([1, 6])('%i human(s)', (humans) => {
      const session = seat(humans);
      expect(session.slots.filter((s) => !s.isBot)).toHaveLength(humans);
      expect(session.director!.humans).toBe(humans);
      const row = budgetFor(humans);
      const want = garrison.members.reduce((a, m) => a + scaled(m.count, row.size), 0);
      const got = session.spawner!.log.filter((l) => l.group === 'garrison').length + session.spawner!.pending;
      console.log(`[director] ${humans} human(s), ${6 - humans} bot(s): garrison of ${want} (file ${garrison.members.reduce((a, m) => a + m.count, 0)}), alive cap ${session.director!.aliveCap(encounter.aliveCap)} of ${encounter.aliveCap}`);
      expect(session.spawner!.spawnedBy('garrison').length).toBeLessThanOrEqual(want);
      expect(session.spawner!.log.filter((l) => l.group === 'garrison').length).toBe(want);
      expect(got).toBeGreaterThanOrEqual(want);
      expect(session.director!.aliveCap(encounter.aliveCap)).toBe(scaled(encounter.aliveCap, row.aliveCap));
    });

    it('the six-human budget is the file as written, and the one-human budget is smaller', () => {
      expect(budgetFor(6)).toMatchObject({ size: 1, aliveCap: 1 });
      expect(budgetFor(1).size).toBeLessThan(1);
      // No human, or more than six, is clamped to the table.
      expect(budgetFor(0)).toBe(budgetFor(1));
      expect(budgetFor(9)).toBe(budgetFor(6));
    });
  });
});
