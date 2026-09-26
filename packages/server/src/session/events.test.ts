/**
 * T-4.15 scripted events: every trigger/action against the deterministic
 * runner, then a real Session proving an active blocker stops both movement
 * and a shot and is replicated to the client.
 */
import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  type Message,
  TICK_SECONDS,
  createLoopbackPair,
  decodeMessage,
  encodeMessage,
  encounterFor,
  missionFor,
  scriptFor,
  parseEncounter,
  parseEventScript,
  requireWorld,
  spawnFor,
} from '@sandline/shared';
import { initNav } from '../ai/nav/NavMesh.ts';
import { loadWorldNavMesh } from '../ai/nav/bakedNav.ts';
import { EventRun, type EventHost } from './events.ts';
import { Session } from './Session.ts';

const TICK_MS = TICK_SECONDS * 1000;
const WORLD = requireWorld('greybox-01');
const MISSION = missionFor('greybox-01')!;
const ENCOUNTER = parseEncounter({
  world: 'greybox-01',
  aliveCap: 4,
  probes: [0.3, 1, 1.7],
  areas: { gate: { x: 0, z: 0, radius: 2 } },
  groups: [
    {
      id: 'g',
      members: [{ archetype: 'rifleman', count: 1 }],
      zone: 'behind-objective',
      posture: { kind: 'hold' },
      trigger: { kind: 'time', seconds: 99 },
    },
  ],
});

describe('event runner triggers and actions (T-4.15)', () => {
  it('fires objective start/completion, area, time, group-dead and flag triggers and every action deterministically', () => {
    const script = parseEventScript(
      {
        world: 'greybox-01',
        blockers: [{ id: 'gate', active: false, boxes: [{ x: -1, y: 0, z: 0, w: 2, h: 2, d: 0.4 }] }],
        events: [
          { id: 'started', trigger: { kind: 'objective-start', objective: 0 }, actions: [{ kind: 'message', text: 'started' }] },
          { id: 'completed', trigger: { kind: 'objective-complete', objective: 0 }, actions: [{ kind: 'callout', id: 'objective-clear' }] },
          { id: 'entered', trigger: { kind: 'enter', area: 'gate' }, actions: [{ kind: 'toggle-blocker', blocker: 'gate', active: true }] },
          { id: 'clock', trigger: { kind: 'time', seconds: 2 }, actions: [{ kind: 'set-flag', flag: 'ready', value: true }] },
          {
            id: 'ready',
            trigger: { kind: 'flag', flag: 'ready' },
            actions: [{ kind: 'spawn-group', group: 'g' }, { kind: 'set-objective', objective: 0 }],
          },
          { id: 'dead', trigger: { kind: 'group-dead', group: 'g' }, actions: [{ kind: 'message', text: 'group dead' }, { kind: 'stop-group', group: 'g' }] },
        ],
      },
      ENCOUNTER,
      WORLD,
      MISSION,
    );

    let objective = { index: 0, state: 'progress' as const };
    let squad = [{ x: 10, z: 10 }];
    let dead = false;
    const messages: string[] = [];
    const callouts: string[] = [];
    const spawns: string[] = [];
    const stops: string[] = [];
    const objectiveSets: number[] = [];
    const blockers: { id: string; active: boolean }[] = [];
    const host: EventHost = {
      squadFeet: () => squad,
      groupDead: () => dead,
      spawnGroup: (id) => (spawns.push(id), true),
      stopGroup: (id) => (stops.push(id), true),
      objective: () => objective,
      setObjective: (index) => {
        objectiveSets.push(index);
        objective = { index, state: 'progress' };
        return true;
      },
      setBlocker: (b) => blockers.push({ id: b.id, active: b.active }),
      message: (text) => messages.push(text),
      callout: (id) => callouts.push(id),
    };
    const run = new EventRun(script, ENCOUNTER, WORLD, host);

    expect(blockers).toEqual([{ id: 'gate', active: false }]);
    run.step(0);
    expect(messages).toEqual(['started']);

    objective = { index: 1, state: 'progress' };
    run.step(0.1);
    expect(callouts).toEqual(['objective-clear']);

    squad = [{ x: 0, z: 0 }];
    run.step(0.2);
    expect(blockers.at(-1)).toEqual({ id: 'gate', active: true });

    run.step(2);
    expect(spawns).toEqual(['g']);
    expect(objectiveSets).toEqual([0]);
    // U-001: what a checkpoint of this moment would have to send again.
    expect(run.groups()).toEqual({ sent: ['g'], stopped: [] });

    dead = true;
    run.step(3);
    expect(messages).toEqual(['started', 'group dead']);
    expect(stops).toEqual(['g']);
    expect(run.groups()).toEqual({ sent: [], stopped: ['g'] });

    // Once means once even while every condition stays true.
    run.step(10);
    expect(messages).toEqual(['started', 'group dead']);
    expect(spawns).toEqual(['g']);
  });
});

const BLOCKER_SCRIPT = parseEventScript(
  {
    world: 'greybox-01',
    blockers: [{ id: 'spawn-gate', active: false, boxes: [{ x: spawnFor(0).x, y: 0, z: -3, w: 2, h: 3, d: 0.4 }] }],
    events: [{ id: 'close-gate', trigger: { kind: 'time', seconds: 0 }, actions: [{ kind: 'toggle-blocker', blocker: 'spawn-gate', active: true }] }],
  },
  ENCOUNTER,
  WORLD,
  MISSION,
);

function connect(session: Session) {
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  let tick = 0;
  let moveY = 0;
  const states: Extract<Message, { kind: 'ScriptState' }>[] = [];
  const hits: Extract<Message, { kind: 'HitEvent' }>[] = [];
  const said: string[] = [];
  pair.b.onMessage((bytes) => {
    const msg = decodeMessage(bytes);
    if (msg.kind === 'ScriptState') states.push(msg);
    if (msg.kind === 'HitEvent') hits.push(msg);
    if (msg.kind === 'ScriptMessage') said.push(`message:${msg.text}`);
    if (msg.kind === 'ScriptCallout') said.push(`callout:${msg.id}`);
  });
  pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'events', room: '' }));
  pair.settle();
  const send = (msg: Message) => {
    pair.b.send(encodeMessage(msg));
    pair.settle();
  };
  return {
    states,
    hits,
    said,
    send,
    hold(value: number) {
      moveY = value;
    },
    fire() {
      send({ kind: 'Fire', tick, yaw: 0, pitch: 0, renderTimeMs: tick * TICK_MS, weapon: 0, ads: false });
    },
    run(count: number) {
      for (let i = 0; i < count; i++) {
        tick += 1;
        send({ kind: 'Input', tick, moveX: 0, moveY, yaw: 0, pitch: 0, buttons: 0 });
        session.step(session.tick * TICK_MS + TICK_MS);
        pair.settle();
      }
    },
  };
}

describe('blockers in a real Session (T-4.15)', () => {
  it('replicates the toggle and the same boxes stop a soldier and a shot', () => {
    const session = new Session(undefined, '', WORLD, { encounter: ENCOUNTER, mission: MISSION, events: BLOCKER_SCRIPT });
    const client = connect(session);
    expect(client.states.at(-1)?.blockers[0]?.active).toBe(false);

    client.run(2);
    expect(client.states.at(-1)?.blockers[0]?.active).toBe(true);
    client.fire();
    client.run(2);
    expect(client.hits[0]).toBeDefined();
    expect(client.hits[0]!.targetNetId).toBe(0);
    expect(client.hits[0]!.z).toBeCloseTo(-3.2, 1);

    client.hold(1);
    client.run(60);
    expect(session.slots[0]!.state.z).toBeCloseTo(-3.2 - 0.35, 2);
  });
});


describe('the committed mission script in real play (T-5.01)', () => {
  it('a session on mission-01 runs its committed script: the brief on start, the callout and message when the garrison dies', () => {
    const world = requireWorld('mission-01');
    const encounter = encounterFor('mission-01')!;
    expect(scriptFor('mission-01')!.events.length).toBeGreaterThan(0);
    const session = new Session(undefined, '', world, { encounter });
    const client = connect(session);
    client.run(2);
    expect(client.said).toContain('message:Clear the patrol holding the west lane');
    const garrison = session.spawner!.spawnedBy('garrison');
    expect(garrison.length).toBeGreaterThan(0);
    for (const e of session.enemies) if (garrison.includes(e.netId)) Object.assign(e.health, { current: 0, diedAt: 0 });
    client.run(4);
    expect(client.said).toContain('callout:objective-clear');
  });

  it('the slice mission (T-5.02): each objective in turn, its script between them, and a failed attempt retries from the last checkpoint', () => {
    const world = requireWorld('mission-01');
    const session = new Session(undefined, '', world, { encounter: encounterFor('mission-01')!, testHumanCount: 1 });
    const client = connect(session);
    // The director places the opening groups where no human can see them: step until the patrol is out.
    for (let i = 0; i < 20 && session.spawner!.spawnedBy('overwatch-patrol').length === 0; i++) client.run(30);
    expect(session.mission).toMatchObject({ objective: 0, objectives: 5, type: 'destroy', label: 'the west-lane patrol' });
    console.log(`slice: the patrol placed after ${(session.tick / 30).toFixed(1)} s`);
    expect(session.spawner!.spawnedBy('overwatch-patrol').length).toBeGreaterThan(0);
    const kill = (group: string) => {
      const ids = session.spawner!.spawnedBy(group);
      for (const e of session.enemies) if (ids.includes(e.netId)) Object.assign(e.health, { current: 0, diedAt: 0 });
    };
    kill('overwatch-patrol');
    client.run(4);
    expect(client.said).toContain('message:West lane clear — now the position holding the east lane');
    expect(session.mission).toMatchObject({ objective: 1, type: 'destroy', label: 'the east-lane position', attempt: 1 });
    // The squad is wiped on the second objective: the attempt fails, and a retry starts from the checkpoint.
    for (const slot of session.slots) Object.assign(slot.health, { current: 0, diedAt: 0 });
    client.run(2);
    expect(session.mission!.state).toBe('failed');
    client.send({ kind: 'MissionRestart' });
    client.run(1);
    expect(session.mission).toMatchObject({ state: 'progress', objective: 1, attempt: 2 });
    expect(session.spawner!.dead('overwatch-patrol')).toBe(true);
  });

  it('a mission other than the committed one under the same world gets no script; greybox-01 has none', () => {
    const world = requireWorld('mission-01');
    const own = { ...missionFor('mission-01')!, objectives: [{ type: 'survive' as const, label: 'wait', seconds: 600 }] };
    const client = connect(new Session(undefined, '', world, { encounter: encounterFor('mission-01')!, mission: own }));
    client.run(2);
    expect(client.said).toEqual([]);
    expect(scriptFor('greybox-01')).toBeUndefined();
  });
});

describe('blocker navigation on the real two-route mission (T-4.15)', () => {
  it('flags the chosen lane closed and Detour routes round it on the other lane', async () => {
    await initNav();
    const nav = loadWorldNavMesh('mission-01');
    const from = { x: 0, y: 0, z: 0 };
    const to = { x: 0, y: 0, z: 70 };
    const direct = nav.path(from, to);
    expect(direct).not.toBeNull();
    // Close the direct centre lane across z=30..36. The blocker must make
    // Detour leave that lane without requiring the test to predict whether it
    // chooses the west or east side of the authored two-route map.
    const gate = { minX: -4, minZ: 30, maxX: 4, maxZ: 36 };
    nav.setBlocker('route-gate', [gate], true);

    const around = nav.path(from, to);
    expect(around).not.toBeNull();
    expect(around!.points.at(-1)!.z).toBeGreaterThan(68);
    expect(around!.points.some((p) => Math.abs(p.x) > 4)).toBe(true);

    nav.setBlocker('route-gate', [gate], false);
    const reopened = nav.path(from, to);
    expect(reopened).not.toBeNull();
    expect(reopened!.points.at(-1)!.z).toBeGreaterThan(68);
    nav.destroy();
  });
});
