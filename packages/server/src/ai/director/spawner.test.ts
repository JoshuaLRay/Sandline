/**
 * The spawner (T-3.32). Against a fake host first — its eyes, squad and
 * living enemies are the test's to set — for when groups spawn, where, and
 * how many at once; then on a real `Session` on the grey-box map, for the
 * posture each group spawns in.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type Encounter,
  TICK_SECONDS,
  type World,
  budgetFor,
  encounterFor,
  scaled,
  loadWorld,
  parseEncounter,
  requireWorld,
} from '@sandline/shared';
import { initNav } from '../nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from '../nav/bakedNav.ts';
import { Session } from '../../session/Session.ts';
import type { EnemyPosture } from '../actions/posture.ts';
import { Spawner, type SpawnerHost, type Vec3, seenByAny, zoneCandidates } from './spawner.ts';

const CHECKS = { sampleM: 0.5, minDistinctShare: 0.5, coverWithinM: 5, maxUncoveredM: { overwatch: 20, assault: 20 }, sightM: 10 };

/**
 * A small world of its own: one zone at (0, 10), a 3 m wall west of the line
 * from the origin to it (x −5..−0.5 at z 5), so an eye at the origin sees the
 * zone's centre and east half and none of its west.
 */
const WORLD: World = loadWorld({
  id: 'spawn-test',
  floor: { halfExtent: 40 },
  cover: [{ id: 'wall', x: -2.75, y: 0, z: 5, w: 4.5, h: 3, d: 0.3 }],
  mission: {
    start: { x: 0, z: -10, radius: 3 },
    objective: { x: 0, z: 20, radius: 3 },
    routes: [
      { id: 'a', role: 'overwatch', via: [] },
      { id: 'b', role: 'assault', via: [] },
    ],
    spawnZones: [
      { id: 'z', on: 'objective', x: 0, z: 10, radius: 4 },
      { id: 'far', on: 'a', x: 20, z: 30, radius: 3 },
    ],
    checks: CHECKS,
  },
});

function encounter(groups: unknown[], aliveCap = 10, areas: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Encounter {
  return parseEncounter({ world: 'spawn-test', aliveCap, probes: [0.3, 1.0, 1.7], areas, groups, ...extra }, (id) => (id === 'spawn-test' ? WORLD : undefined));
}

const group = (id: string, trigger: unknown, extra: Record<string, unknown> = {}) => ({
  id,
  members: [{ archetype: 'rifleman', count: 1 }],
  zone: 'far',
  posture: { kind: 'hold' },
  trigger,
  ...extra,
});

/** A host whose world the test owns. Spawned enemies live until `kill`. */
function fakeHost() {
  let next = 2000;
  const alive = new Map<number, Vec3>();
  const host = {
    eyes: [] as Vec3[],
    squad: [] as { x: number; z: number }[],
    spawns: [] as { netId: number; at: Vec3 & { yaw: number; posture: EnemyPosture; group: number } }[],
    humanEyes: () => host.eyes,
    squadFeet: () => host.squad,
    enemyFeet: () => [...alive.values()],
    isAlive: (netId: number) => alive.has(netId),
    spawn: (_archetype: string, at: Vec3 & { yaw: number; posture: EnemyPosture; group: number }) => {
      const netId = next++;
      alive.set(netId, { x: at.x, y: at.y, z: at.z });
      host.spawns.push({ netId, at });
      return netId;
    },
    kill: (netId: number) => alive.delete(netId),
    get alive() {
      return alive.size;
    },
  };
  return host satisfies SpawnerHost & Record<string, unknown>;
}

/** Step the spawner through `seconds` of ticks from `from`, calling `each` after every one. */
function run(spawner: Spawner, from: number, seconds: number, each?: (t: number) => void): number {
  let t = from;
  const end = from + seconds;
  for (; t < end - 1e-9; t += TICK_SECONDS) {
    spawner.step(t);
    each?.(t);
  }
  return t;
}

describe('groups spawn on their triggers, and not before (T-3.32)', () => {
  it('start at once; time at its second; enter when a squad soldier steps in; dead when every member it sent is dead', () => {
    const host = fakeHost();
    const e = encounter(
      [
        group('first', { kind: 'start' }),
        group('timed', { kind: 'time', seconds: 5 }),
        group('entered', { kind: 'enter', area: 'gate' }),
        group('after', { kind: 'dead', group: 'first' }),
      ],
      10,
      { gate: { x: 0, z: 0, radius: 2 } },
    );
    const spawner = new Spawner(e, WORLD, host);
    host.squad = [{ x: 10, z: -10 }];
    spawner.step(0);
    expect(spawner.fired('first')).toBe(true);
    expect(spawner.spawnedBy('first')).toHaveLength(1);
    expect(['timed', 'entered', 'after'].map((g) => spawner.fired(g))).toEqual([false, false, false]);

    let t = run(spawner, TICK_SECONDS, 4.9);
    expect(spawner.fired('timed')).toBe(false);
    t = run(spawner, t, 0.2);
    expect(spawner.fired('timed')).toBe(true);
    expect(spawner.log.find((l) => l.group === 'timed')!.seconds).toBeGreaterThanOrEqual(5);

    // The squad walks up to the gate: nothing until a soldier is inside it.
    host.squad = [{ x: 10, z: -10 }, { x: 0, z: -2.5 }];
    t = run(spawner, t, 1);
    expect(spawner.fired('entered')).toBe(false);
    host.squad = [{ x: 10, z: -10 }, { x: 0, z: -1.5 }];
    t = run(spawner, t, TICK_SECONDS);
    expect(spawner.fired('entered')).toBe(true);

    // `first` alive: `after` waits. Dead: `after` comes.
    t = run(spawner, t, 10);
    expect(spawner.fired('after')).toBe(false);
    host.kill(spawner.spawnedBy('first')[0]!);
    run(spawner, t, TICK_SECONDS * 2);
    expect(spawner.fired('after')).toBe(true);
  });

  it('a group with waves is not dead until its last wave has come and died', () => {
    const host = fakeHost();
    const e = encounter([group('waves', { kind: 'start' }, { waves: { count: 3, everySeconds: 4, minSeconds: 4, maxSeconds: 4 } }), group('then', { kind: 'dead', group: 'waves' })]);
    const spawner = new Spawner(e, WORLD, host);
    let t = run(spawner, 0, 1);
    host.kill(spawner.spawnedBy('waves')[0]!);
    t = run(spawner, t, 2);
    // One wave down, two to come: not dead.
    expect(spawner.fired('then')).toBe(false);
    t = run(spawner, t, 6);
    expect(spawner.spawnedBy('waves')).toHaveLength(3);
    for (const id of spawner.spawnedBy('waves')) host.kill(id);
    run(spawner, t, TICK_SECONDS * 2);
    expect(spawner.fired('then')).toBe(true);
    expect(spawner.log.filter((l) => l.group === 'waves').map((l) => l.wave)).toEqual([1, 2, 3]);
  });
});

describe('nothing holds the mission back for ever (U-001)', () => {
  it('a group down to its stragglers long enough counts as beaten to what waits on it; a destroy still wants them all', () => {
    const host = fakeHost();
    const e = encounter(
      [{ ...group('first', { kind: 'start' }), members: [{ archetype: 'rifleman', count: 3 }] }, group('after', { kind: 'dead', group: 'first' })],
      10,
      {},
      { stragglers: { alive: 1, seconds: 10 } },
    );
    const spawner = new Spawner(e, WORLD, host);
    let t = run(spawner, 0, 1);
    const [a, b, c] = spawner.spawnedBy('first');
    host.kill(a!);
    t = run(spawner, t, 20);
    // Two of three alive is a fight, not stragglers.
    expect(spawner.status().find((g) => g.id === 'first')).toMatchObject({ state: 'fighting', alive: 2, placed: 3 });
    expect(spawner.fired('after')).toBe(false);
    host.kill(b!);
    t = run(spawner, t, 9.8);
    expect(spawner.status().find((g) => g.id === 'first')!.state).toBe('stragglers');
    expect(spawner.broken('first')).toBe(false);
    expect(spawner.fired('after')).toBe(false);
    t = run(spawner, t, 0.4);
    expect(spawner.broken('first')).toBe(true);
    expect(spawner.dead('first')).toBe(false);
    expect(spawner.status().find((g) => g.id === 'first')!.state).toBe('beaten');
    expect(spawner.fired('after')).toBe(true);
    host.kill(c!);
    run(spawner, t, TICK_SECONDS);
    expect(spawner.status().find((g) => g.id === 'first')!.state).toBe('dead');
  });

  it('one enemy never lost is not a straggler, and `stragglers.alive` 0 turns the rule off', () => {
    const host = fakeHost();
    const spawner = new Spawner(encounter([group('lone', { kind: 'start' }), group('after', { kind: 'dead', group: 'lone' })], 10, {}, { stragglers: { alive: 1, seconds: 1 } }), WORLD, host);
    run(spawner, 0, 5);
    expect(spawner.fired('after')).toBe(false);
    const off = fakeHost();
    const strict = new Spawner(encounter([{ ...group('pair', { kind: 'start' }), members: [{ archetype: 'rifleman', count: 2 }] }, group('after', { kind: 'dead', group: 'pair' })], 10, {}, { stragglers: { alive: 0, seconds: 1 } }), WORLD, off);
    const t = run(strict, 0, 1);
    off.kill(strict.spawnedBy('pair')[0]!);
    run(strict, t, 10);
    expect(strict.fired('after')).toBe(false);
  });

  it('a script group waits for the script; stop ends its waves and drops what it has queued; the living fight on', () => {
    const host = fakeHost();
    const e = encounter(
      [
        { ...group('push', { kind: 'script' }, { waves: { count: 10, everySeconds: 2, minSeconds: 2, maxSeconds: 2 } }), members: [{ archetype: 'rifleman', count: 3 }] },
        group('never', { kind: 'script' }),
        group('after', { kind: 'dead', group: 'push' }),
      ],
      4,
    );
    const spawner = new Spawner(e, WORLD, host);
    let t = run(spawner, 0, 30);
    expect(spawner.fired('push')).toBe(false);
    expect(spawner.status().find((g) => g.id === 'push')).toMatchObject({ state: 'waiting', trigger: 'script' });
    spawner.activate('push', t);
    t = run(spawner, t, 3);
    // Two waves sent, the cap of 4 placed, the rest queued and held back by the cap.
    expect(spawner.wavesOf('push')).toHaveLength(2);
    expect(host.alive).toBe(4);
    expect(spawner.pending).toBe(2);
    expect(spawner.heldBack).toEqual({ cap: 2, seen: 0, occupied: 0 });
    expect(spawner.describe()).toMatch(/push fighting 4\/4 w2\/10 q2.*held back: cap 2/);
    expect(spawner.stop('push', t)).toBe(true);
    expect(spawner.stop('push', t)).toBe(false);
    expect(spawner.pending).toBe(0);
    t = run(spawner, t, 20);
    expect(spawner.wavesOf('push')).toHaveLength(2);
    expect(spawner.spawnedBy('push')).toHaveLength(4);
    expect(spawner.dead('push')).toBe(false);
    for (const id of spawner.spawnedBy('push')) host.kill(id);
    run(spawner, t, TICK_SECONDS * 2);
    expect(spawner.status().find((g) => g.id === 'push')!.state).toBe('stopped');
    expect(spawner.fired('after')).toBe(true);
    // Stopped before it was ever sent: sent-and-empty, dead at once, and it never spawns.
    spawner.stop('never', t);
    expect(spawner.dead('never')).toBe(true);
    expect(spawner.activate('never', t)).toBe(false);
    expect(spawner.spawnedBy('never')).toHaveLength(0);
  });

  it('says a member waited because every candidate was in view', () => {
    const host = fakeHost();
    host.eyes = [{ x: 0, y: 1.6, z: 0 }, { x: -6, y: 1.6, z: 10 }];
    const spawner = new Spawner(encounter([{ ...group('g', { kind: 'start' }), zone: 'z', members: [{ archetype: 'rifleman', count: 2 }] }]), WORLD, host);
    run(spawner, 0, 1);
    expect(spawner.heldBack).toEqual({ cap: 0, seen: 2, occupied: 0 });
    expect(spawner.status()[0]).toMatchObject({ state: 'queued', queued: 2, alive: 0 });
  });
});

describe('never where a human can see (T-3.32)', () => {
  it('lists a zone’s candidates nearest the centre first', () => {
    const c = zoneCandidates({ x: 0, z: 10, radius: 4 });
    expect(c).toHaveLength(19);
    expect(c[0]).toEqual({ x: 0, z: 10 });
    expect(Math.hypot(c[1]!.x, c[1]!.z - 10)).toBeCloseTo(2, 6);
    expect(Math.hypot(c[18]!.x, c[18]!.z - 10)).toBeCloseTo(4, 6);
  });

  it('skips a candidate a human can see for the next one nobody can', () => {
    const host = fakeHost();
    host.eyes = [{ x: 0, y: 1.6, z: 0 }];
    const spawner = new Spawner(encounter([{ ...group('g', { kind: 'start' }), zone: 'z' }]), WORLD, host);
    spawner.step(0);
    const [event] = spawner.log;
    expect(event).toBeDefined();
    // The centre is in plain view: passed over.
    expect(seenByAny({ x: 0, y: 0, z: 10 }, [0.3, 1.0, 1.7], host.eyes, WORLD.boxes)).toBe(true);
    expect(event!.skippedVisible).toBeGreaterThan(0);
    expect(event!.point).not.toEqual({ x: 0, y: 0, z: 10 });
    // Where it went, no probe is in view, and it is behind the wall (west of the line).
    expect(seenByAny(event!.point, [0.3, 1.0, 1.7], host.eyes, WORLD.boxes)).toBe(false);
    expect(event!.point.x).toBeLessThan(0);
    // It is the first such candidate in the zone's order.
    const order = spawner.candidatesOf('z');
    const first = order.findIndex((p) => !seenByAny(p, [0.3, 1.0, 1.7], host.eyes, WORLD.boxes));
    expect(order[first]).toEqual(event!.point);
    expect(event!.skippedVisible).toBe(first);
  });

  it('waits while every candidate is in view, and spawns the tick one is not', () => {
    const host = fakeHost();
    // Two eyes that between them see the whole zone: one either side of the wall.
    host.eyes = [{ x: 0, y: 1.6, z: 0 }, { x: -6, y: 1.6, z: 10 }];
    const spawner = new Spawner(encounter([{ ...group('g', { kind: 'start' }), zone: 'z' }]), WORLD, host);
    const t = run(spawner, 0, 2);
    expect(spawner.spawnedBy('g')).toHaveLength(0);
    expect(spawner.pending).toBe(1);
    host.eyes = [{ x: 0, y: 1.6, z: 0 }];
    run(spawner, t, TICK_SECONDS);
    expect(spawner.spawnedBy('g')).toHaveLength(1);
    expect(spawner.pending).toBe(0);
  });

  it('puts no two enemies on one point', () => {
    const host = fakeHost();
    const spawner = new Spawner(encounter([{ ...group('g', { kind: 'start' }), zone: 'z', members: [{ archetype: 'rifleman', count: 5 }] }]), WORLD, host);
    spawner.step(0);
    const points = spawner.log.map((l) => l.point);
    expect(points).toHaveLength(5);
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) expect(Math.hypot(points[i]!.x - points[j]!.x, points[i]!.z - points[j]!.z)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('the alive cap holds under repeated waves (T-3.32)', () => {
  it('never more alive than the cap; what it holds back comes as the living die', () => {
    const host = fakeHost();
    const e = encounter([{ ...group('horde', { kind: 'start' }, { waves: { count: 6, everySeconds: 1, minSeconds: 1, maxSeconds: 1 } }), members: [{ archetype: 'rifleman', count: 4 }] }], 5);
    const spawner = new Spawner(e, WORLD, host);
    let peak = 0;
    let t = run(spawner, 0, 10, () => (peak = Math.max(peak, host.alive)));
    expect(peak).toBe(5);
    expect(spawner.spawnedBy('horde')).toHaveLength(5);
    expect(spawner.pending).toBe(24 - 5);
    // Kill one a second: each death lets exactly one more in, never past the cap.
    for (let k = 0; k < 30 && spawner.pending > 0; k++) {
      host.kill(spawner.spawnedBy('horde').find((id) => host.isAlive(id))!);
      t = run(spawner, t, 1, () => (peak = Math.max(peak, host.alive)));
      expect(host.alive).toBeLessThanOrEqual(5);
    }
    expect(peak).toBe(5);
    expect(spawner.spawnedBy('horde')).toHaveLength(24);
    // The cap counts every living enemy, not only the spawner's own.
    const other = fakeHost();
    other.spawn('rifleman', { x: 30, y: 0, z: 30, yaw: 0, posture: {} as EnemyPosture, group: 0 });
    other.spawn('rifleman', { x: 30, y: 0, z: 34, yaw: 0, posture: {} as EnemyPosture, group: 0 });
    const capped = new Spawner(encounter([{ ...group('g', { kind: 'start' }), members: [{ archetype: 'rifleman', count: 3 }] }], 3), WORLD, other);
    capped.step(0);
    expect(capped.spawnedBy('g')).toHaveLength(1);
  });
});

describe('the committed encounter (T-3.32)', () => {
  it('parses against its world, and refuses what does not fit it — by name', () => {
    const e = encounterFor('greybox-01')!;
    expect(e.groups.map((g) => g.posture.kind).sort()).toEqual(['garrison', 'garrison', 'hold', 'hold', 'patrol']);
    expect(new Set(e.groups.map((g) => g.trigger.kind))).toEqual(new Set(['start', 'enter', 'dead', 'time']));
    const bad = (groups: unknown[], extra: Record<string, unknown> = {}) => () => parseEncounter({ world: 'spawn-test', aliveCap: 4, probes: [1], areas: {}, groups, ...extra }, () => WORLD);
    expect(bad([{ ...group('g', { kind: 'start' }), zone: 'moon' }])).toThrow(/no spawn zone "moon"/);
    expect(bad([group('g', { kind: 'enter', area: 'gate' })])).toThrow(/no area 'gate'/);
    expect(bad([group('g', { kind: 'dead', group: 'ghost' })])).toThrow(/waits on no group 'ghost'/);
    expect(bad([group('g', { kind: 'dead', group: 'g' })])).toThrow(/waits on itself/);
    expect(bad([{ ...group('g', { kind: 'start' }), members: [{ archetype: 'dragon', count: 1 }] }])).toThrow(/archetype must be one of/);
    expect(bad([{ ...group('g', { kind: 'start' }), members: [{ archetype: 'sniper', count: 1 }] }])).toThrow(/archetype must be one of rifleman, mg/);
    expect(bad([{ ...group('g', { kind: 'start' }), posture: { kind: 'dance' } }])).toThrow(/posture.kind must be one of/);
    expect(bad([group('g', { kind: 'soon' })])).toThrow(/trigger.kind must be one of/);
    expect(bad([group('g', { kind: 'start' })], { aliveCap: 0 })).toThrow(/aliveCap/);
    expect(bad([group('g', { kind: 'start' }, { waves: { count: 2, everySeconds: 10, minSeconds: 20, maxSeconds: 30 } })])).toThrow(/minSeconds ≤ everySeconds ≤ maxSeconds/);
    expect(bad([group('g', { kind: 'start' }, { waves: { count: 2, everySeconds: 10 } })])).toThrow(/missing 'minSeconds'/);
    expect(bad([group('g', { kind: 'start' }, { colour: 'red' })])).toThrow(/unknown key 'colour'/);
    expect(bad([group('g', { kind: 'script', at: 3 })])).toThrow(/unknown key 'at'/);
    expect(bad([group('g', { kind: 'start' })], { stragglers: { alive: 1 } })).toThrow(/missing 'seconds'/);
    expect(bad([group('g', { kind: 'start' })], { stragglers: { alive: -1, seconds: 5 } })).toThrow(/stragglers.alive/);
    expect(e.stragglers).toEqual({ alive: 1, seconds: 60 });
    expect(() => parseEncounter({ world: 'range', aliveCap: 4, probes: [1], areas: {}, groups: [] })).toThrow(/has no mission/);
  });
});

describe('posture is honoured on spawn, on the grey-box map (T-3.32)', () => {
  const world = requireWorld('greybox-01');
  const e = parseEncounter({
    world: 'greybox-01',
    aliveCap: 10,
    probes: [0.3, 1.0, 1.7],
    areas: {},
    groups: [
      { id: 'garrison', members: [{ archetype: 'rifleman', count: 3 }], zone: 'behind-objective', posture: { kind: 'garrison', at: 'objective' }, trigger: { kind: 'start' } },
      { id: 'patrol', members: [{ archetype: 'rifleman', count: 1 }], zone: 'overwatch-flank', posture: { kind: 'patrol', route: [{ x: -24, z: 22 }] }, trigger: { kind: 'start' } },
      { id: 'hold', members: [{ archetype: 'rifleman', count: 1 }], zone: 'assault-flank', posture: { kind: 'hold', face: 'start' }, trigger: { kind: 'start' } },
    ],
  });
  let session: Session;
  const seen = { patrolNearTurn: false, patrolBack: false, holdMoved: 0 };
  const TICK_MS = 1000 / 30;
  beforeAll(async () => {
    await initNav();
    session = new Session(undefined, '', world, { navMesh: loadWorldNavMesh('greybox-01'), cover: bakedCoverFor('greybox-01'), encounter: e });
    // The squad out of every enemy's sight (80 m), so nothing here fights: this is posture alone.
    for (const s of session.slots) s.state = { ...s.state, x: 95, z: -95 };
    let now = 0;
    for (let t = 0; t < 30 * 40; t++) {
      now += TICK_MS;
      session.step(now);
      const patrol = session.enemies.find((x) => x.netId === session.spawner!.spawnedBy('patrol')[0]);
      if (patrol) {
        if (Math.hypot(patrol.state.x + 24, patrol.state.z - 22) < 1.5) seen.patrolNearTurn = true;
        const post = patrol.posture!.post;
        if (seen.patrolNearTurn && Math.hypot(patrol.state.x - post.x, patrol.state.z - post.z) < 1.5) seen.patrolBack = true;
      }
      const hold = session.enemies.find((x) => x.netId === session.spawner!.spawnedBy('hold')[0]);
      if (hold) seen.holdMoved = Math.max(seen.holdMoved, Math.hypot(hold.state.x - hold.posture!.post.x, hold.state.z - hold.posture!.post.z));
    }
  });

  it('spawns every group at once in its zone, none knowing of the squad', () => {
    const log = session.spawner!.log;
    // No human seated: the director's one-human budget sizes every wave (T-3.33).
    const size = (n: number) => scaled(n, budgetFor(0).size);
    expect(log.map((l) => l.group).sort()).toEqual([...Array(size(3)).fill('garrison'), ...Array(size(1)).fill('hold'), ...Array(size(1)).fill('patrol')]);
    for (const l of log) {
      const zone = world.mission!.spawnZones.find((z) => z.id === e.groups.find((g) => g.id === l.group)!.zone)!;
      expect(Math.hypot(l.point.x - zone.x, l.point.z - zone.z)).toBeLessThanOrEqual(zone.radius + 1e-6);
      expect(l.seconds).toBe(0);
    }
    for (const enemy of session.enemies) expect(enemy.target).toBeNull();
  });

  it('garrison: into cover inside the objective, and there it stays', () => {
    const area = world.mission!.objective;
    for (const id of session.spawner!.spawnedBy('garrison')) {
      const g = session.enemies.find((x) => x.netId === id)!;
      const off = Math.hypot(g.state.x - area.x, g.state.z - area.z);
      console.log(`[spawner] garrison ${id}: ${off.toFixed(1)} m from the objective's centre (radius ${area.radius}), ${g.brain!.tree.runningPath().at(-1)}`);
      expect(off).toBeLessThanOrEqual(area.radius);
      const held = session.cover?.heldPoint(id) ?? null;
      expect(held).not.toBeNull();
      expect(Math.hypot(held!.x - g.state.x, held!.z - g.state.z)).toBeLessThanOrEqual(0.5);
    }
  });

  it('patrol: out to its route point and back to where it spawned, walking', () => {
    expect(seen.patrolNearTurn).toBe(true);
    expect(seen.patrolBack).toBe(true);
  });

  it('hold: stays on its post, facing what it was told to', () => {
    const id = session.spawner!.spawnedBy('hold')[0]!;
    const h = session.enemies.find((x) => x.netId === id)!;
    expect(seen.holdMoved).toBeLessThanOrEqual(0.6);
    const start = world.mission!.start;
    const want = Math.atan2(start.x - h.state.x, start.z - h.state.z);
    const have = (h.yaw / 1024) * Math.PI * 2;
    const diff = Math.abs(((have - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    console.log(`[spawner] hold ${id}: moved at most ${seen.holdMoved.toFixed(2)} m, facing ${((diff * 180) / Math.PI).toFixed(1)}° off the start`);
    expect(diff).toBeLessThan((10 * Math.PI) / 180);
  });
});
