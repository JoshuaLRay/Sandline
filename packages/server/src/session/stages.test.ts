/**
 * U-074: objectives in stages. The objectives of a stage are open together and may be done in either order; the stage
 * is done when every required one is; each completion is a checkpoint that remembers which are done; and a mission
 * with no stages plays exactly as it always did. Rules against a hand-driven world, then the events they raise.
 */
import { describe, expect, it } from 'vitest';
import {
  type GroundArea,
  type MissionDef,
  type ObjectiveDef,
  TICK_SECONDS,
  decodeMessage,
  encodeMessage,
  MissionDataError,
  objectiveStages,
  parseEncounter,
  parseEventScript,
  parseMission,
  requireWorld,
} from '@sandline/shared';
import { EventRun, type EventHost } from './events.ts';
import { MissionRun, type MissionWorld } from './mission.ts';

const AREA: GroundArea = { x: 0, z: 0, radius: 5 };
const ticks = (seconds: number) => Math.round(seconds / TICK_SECONDS);

const reach = (label: string, extra: Partial<ObjectiveDef> = {}) => ({ type: 'reach', label, area: 'a', who: 'any', ...extra }) as ObjectiveDef;
const destroy = (label: string, group: string, extra: Partial<ObjectiveDef> = {}) => ({ type: 'destroy', label, group, ...extra }) as ObjectiveDef;
const survive = (label: string, seconds: number, extra: Partial<ObjectiveDef> = {}) => ({ type: 'survive', label, seconds, ...extra }) as ObjectiveDef;
const upload = (label: string, extra: Partial<ObjectiveDef> = {}) =>
  ({ type: 'upload', label, terminal: { x: 1, y: 1, z: 1 }, reachM: 2, seconds: 2, onInterrupt: 'keep-progress', ...extra }) as ObjectiveDef;

function runOf(objectives: ObjectiveDef[]): MissionRun {
  const def: MissionDef = { id: 'test', world: 'greybox-01', respawn: false, objectives };
  return new MissionRun(def, (ref) => (typeof ref === 'string' ? AREA : ref));
}

function fake() {
  const w = {
    standingAll: 6,
    standing: new Map<GroundArea, number>(),
    groups: new Map<string, { dead: boolean; spawned: number; down: number }>(),
    dead: false,
  };
  const world: MissionWorld = {
    enemiesIn: () => 0,
    squadIn: () => 0,
    standing: () => w.standingAll,
    standingIn: (a) => w.standing.get(a) ?? 0,
    soldierDead: () => w.dead,
    protectedLost: () => false,
    group: (id) => w.groups.get(id) ?? { dead: false, spawned: 0, down: 0 },
    rescue: () => ({ held: 0, holding: null }),
  };
  const kill = (id: string) => w.groups.set(id, { dead: true, spawned: 2, down: 2 });
  return { w, world, kill };
}

describe('stage data (U-074)', () => {
  const mission = (objectives: unknown[]) => parseMission({ id: 'm', world: 'greybox-01', respawn: false, objectives });

  it('groups objectives by stage, and a mission with none has one in each', () => {
    const staged = mission([
      { type: 'reach', label: 'a', area: 'objective', who: 'any', stage: 0 },
      { type: 'destroy', label: 'b', group: 'g', stage: 0, optional: true },
      { type: 'survive', label: 'c', seconds: 5, stage: 1 },
    ]);
    expect(objectiveStages(staged)).toEqual([[0, 1], [2]]);
    expect(staged.objectives[1]).toMatchObject({ stage: 0, optional: true });
    const plain = mission([{ type: 'survive', label: 'x', seconds: 5 }, { type: 'survive', label: 'y', seconds: 5 }]);
    expect(objectiveStages(plain)).toEqual([[0], [1]]);
    expect(plain.objectives[0]).not.toHaveProperty('stage');
  });

  it('refuses mixed or gappy stages, a stage with nothing required, and two uploads or rescues in one', () => {
    const o = (stage: number | undefined, extra: object = {}) => ({ type: 'survive', label: 'x', seconds: 5, ...(stage === undefined ? {} : { stage }), ...extra });
    expect(() => mission([o(0), o(undefined)])).toThrow(/every objective a stage, or none/);
    expect(() => mission([o(1), o(1)])).toThrow(/stage must be 0/);
    expect(() => mission([o(0), o(2)])).toThrow(/stay or grow by one/);
    expect(() => mission([o(1), o(0)])).toThrow(MissionDataError);
    expect(() => mission([o(0, { optional: true }), o(1)])).toThrow(/needs at least one objective that is not optional/);
    expect(() => mission([o(undefined, { optional: true })])).toThrow(/optional needs stages/);
    const up = { type: 'upload', label: 'u', terminal: { x: 1, y: 1, z: 1 }, reachM: 2, seconds: 5, onInterrupt: 'keep-progress', stage: 0 };
    expect(() => mission([up, up])).toThrow(/at most one upload/);
    const rescue = { type: 'rescue', label: 'r', holdSeconds: 5, reachM: 2, stage: 0 };
    expect(() => mission([rescue, rescue])).toThrow(/at most one rescue/);
    expect(() => mission([{ ...o(0), stage: 16 }])).toThrow(/stage must be a whole number/);
  });
});

describe('a stage of two objectives (U-074)', () => {
  const both = () => runOf([reach('the road', { stage: 0 }), destroy('the post', 'g', { stage: 0 }), survive('then', 1, { stage: 1 })]);

  it('is open together and finishes in either order, advancing only when both are done', () => {
    for (const first of ['reach', 'destroy'] as const) {
      const run = both();
      const { w, world, kill } = fake();
      expect(run.current.open?.map((o) => [o.index, o.done])).toEqual([[0, false], [1, false]]);
      expect(run.current.objective).toBe(0);
      const doReach = () => w.standing.set(AREA, 1);
      first === 'reach' ? doReach() : kill('g');
      run.step(world);
      expect(run.current).toMatchObject({ state: 'progress', objective: first === 'reach' ? 1 : 0 });
      expect(run.current.open?.map((o) => o.done)).toEqual(first === 'reach' ? [true, false] : [false, true]);
      expect(run.doneCount).toBe(1);
      first === 'reach' ? kill('g') : doReach();
      run.step(world);
      // Both done: the second stage opens (a stage of one lists no `open`).
      expect(run.current).toMatchObject({ state: 'progress', objective: 2, type: 'survive' });
      expect(run.current.open).toBeUndefined();
      expect(run.doneCount).toBe(2);
    }
  });

  it('keeps an objective done once done, even if its condition stops holding', () => {
    const run = both();
    const { w, world, kill } = fake();
    w.standing.set(AREA, 1);
    run.step(world);
    w.standing.set(AREA, 0);
    run.step(world);
    expect(run.current.open?.[0]?.done).toBe(true);
    kill('g');
    run.step(world);
    expect(run.current.objective).toBe(2);
  });

  it('completes the mission when the last stage does, with every objective counted done', () => {
    const run = runOf([survive('a', 1, { stage: 0 }), survive('b', 1, { stage: 0 })]);
    const { world } = fake();
    for (let i = 0; i < ticks(1) + 2; i++) run.step(world);
    expect(run.current.state).toBe('complete');
    expect(run.doneCount).toBe(2);
  });
});

describe('an optional objective (U-074)', () => {
  const withOptional = () => runOf([reach('the road', { stage: 0 }), destroy('the bonus', 'bonus', { stage: 0, optional: true }), survive('then', 1, { stage: 1 })]);

  it('is not needed for the stage to finish, and is dropped with it', () => {
    const run = withOptional();
    const { w, world } = fake();
    w.standing.set(AREA, 1);
    run.step(world);
    expect(run.current).toMatchObject({ objective: 2 });
    expect(run.current.open).toBeUndefined();
  });

  it('is credited if done first, and is the focus only when nothing required is left', () => {
    const run = withOptional();
    const { world, kill } = fake();
    expect(run.current.objective).toBe(0);
    kill('bonus');
    run.step(world);
    expect(run.current.open?.map((o) => [o.optional, o.done])).toEqual([[false, false], [true, true]]);
    expect(run.current.objective).toBe(0);
    expect(run.doneCount).toBe(1);
  });
});

describe('checkpoints inside a stage (U-074)', () => {
  it('save which objectives were done, and a retry resumes with them done', () => {
    const run = runOf([reach('the road', { stage: 0 }), destroy('the post', 'g', { stage: 0 }), survive('then', 1000, { stage: 1 })]);
    const { w, world, kill } = fake();
    kill('g');
    run.step(world);
    expect([run.checkpoint, run.checkpointDoneList]).toEqual([0, [1]]);
    // Fail, and retry: the destroyed one stays destroyed; only the road is left.
    w.dead = true;
    run.step(world);
    expect(run.current.state).toBe('failed');
    w.dead = false;
    run.retry();
    expect(run.current).toMatchObject({ state: 'progress', attempt: 2, objective: 0 });
    expect(run.current.open?.map((o) => o.done)).toEqual([false, true]);
    w.standing.set(AREA, 1);
    run.step(world);
    expect(run.current.objective).toBe(2);
    // The new stage's checkpoint is its first objective with nothing done.
    expect([run.checkpoint, run.checkpointDoneList]).toEqual([2, []]);
  });

  it('can be restored into a new run, and refuses done objectives from another stage', () => {
    const run = runOf([reach('a', { stage: 0 }), destroy('b', 'g', { stage: 0 }), survive('c', 5, { stage: 1 })]);
    run.restoreCheckpoint(0, 100, [1]);
    expect(run.current.open?.map((o) => o.done)).toEqual([false, true]);
    expect(() => run.restoreCheckpoint(0, 100, [2])).toThrow(/not in the stage/);
    expect(() => run.setCheckpoint(0, 100, [2])).toThrow(/not in the stage/);
  });

  it('a mission without stages checkpoints exactly as before: the next objective, nothing done', () => {
    const run = runOf([survive('a', 1), survive('b', 1000)]);
    const { world } = fake();
    for (let i = 0; i < ticks(1) + 2; i++) run.step(world);
    expect(run.current.objective).toBe(1);
    expect([run.checkpoint, run.checkpointDoneList]).toEqual([1, []]);
  });
});

describe('an upload beside another objective (U-074)', () => {
  it('starts, runs and finishes on its own state while the other objective waits', () => {
    const run = runOf([upload('the relay', { stage: 0 }), reach('the road', { stage: 0 })]);
    const { w, world } = fake();
    expect(run.openUpload()?.phase).toBe('idle');
    run.step(world);
    expect(run.current.open?.[0]?.progress).toBe(0);
    expect(run.startUpload()).toBe(true);
    for (let i = 0; i < ticks(2) + 2; i++) run.step(world);
    expect(run.current.open?.[0]?.done).toBe(true);
    expect(run.openUpload()).toBeNull();
    expect(run.current.state).toBe('progress');
    w.standing.set(AREA, 1);
    run.step(world);
    expect(run.current.state).toBe('complete');
  });
});

describe('scripts hear every objective (U-074)', () => {
  const ENCOUNTER = parseEncounter({
    world: 'greybox-01',
    aliveCap: 4,
    probes: [0.3, 1, 1.7],
    areas: {},
    groups: [{ id: 'g', members: [{ archetype: 'rifleman', count: 1 }], zone: 'behind-objective', posture: { kind: 'hold' }, trigger: { kind: 'script' } }],
  });
  const WORLD = requireWorld('greybox-01');
  const MISSION: MissionDef = {
    id: 'm',
    world: 'greybox-01',
    respawn: false,
    objectives: [reach('r', { stage: 0, area: 'start' }), destroy('d', 'g', { stage: 0 }), survive('s', 5, { stage: 1 })],
  };

  it('fires start and complete for each objective of a stage, as each opens and finishes', () => {
    const script = parseEventScript(
      {
        world: 'greybox-01',
        blockers: [],
        events: [0, 1, 2].flatMap((n) => [
          { id: `start-${n}`, trigger: { kind: 'objective-start', objective: n }, actions: [{ kind: 'message', text: `start ${n}` }] },
          { id: `done-${n}`, trigger: { kind: 'objective-complete', objective: n }, actions: [{ kind: 'message', text: `done ${n}` }] },
        ]),
      },
      ENCOUNTER,
      WORLD,
      MISSION,
    );
    const said: string[] = [];
    let state: 'progress' | 'complete' = 'progress';
    let active = [0, 1];
    const host: EventHost = {
      squadFeet: () => [],
      groupDead: () => false,
      spawnGroup: () => true,
      stopGroup: () => true,
      objectives: () => ({ state, active: active.map((index) => ({ index, phase: 'active' as const })) }),
      setObjective: () => true,
      interruptUpload: () => true,
      setBlocker: () => {},
      message: (text) => said.push(text),
      callout: () => {},
      placeLoot: () => {},
      spawnVehicle: () => {},
      withdrawVehicles: () => {},
    };
    const events = new EventRun(script, ENCOUNTER, WORLD, host);
    events.step(0);
    expect(said).toEqual(['start 0', 'start 1']);
    // The destroy finishes first: only it completes; the stage is still open.
    active = [0];
    events.step(0.1);
    expect(said.slice(2)).toEqual(['done 1']);
    // Then the road: the stage ends and the next opens.
    active = [2];
    events.step(0.2);
    expect(said.slice(3)).toEqual(['done 0', 'start 2']);
    active = [];
    state = 'complete';
    events.step(0.3);
    expect(said.slice(5)).toEqual(['done 2']);
    // Saved mid-way and restored, it does not hear the same objectives again.
    const saved = events.checkpoint();
    expect(saved.previousActive).toEqual([]);
  });
});

describe('the wire carries a stage (U-074)', () => {
  it('round-trips the open list, and a mission without one is unchanged', () => {
    const run = runOf([reach('the road', { stage: 0 }), destroy('the post', 'g', { stage: 0, optional: true }), survive('then', 5, { stage: 1 })]);
    const msg = { kind: 'Mission', ...run.current } as const;
    expect(decodeMessage(encodeMessage(msg))).toEqual(msg);
    const plain = runOf([survive('x', 5)]);
    const plainMsg = { kind: 'Mission', ...plain.current } as const;
    const back = decodeMessage(encodeMessage(plainMsg));
    expect(back).toEqual(plainMsg);
    expect(back).not.toHaveProperty('open');
  });
});
