/**
 * The mission's objectives, in order (T-3.34's one objective, a sequence
 * since T-4.14). Evaluated once a tick on the server from what the session
 * answers (`MissionWorld`); nothing here reads the session, so each rule is
 * testable on its own.
 *
 * The types (`ObjectiveDef`, `shared/src/sim/mission.ts`):
 *   - clear-and-hold: the hold counts a tick when no living enemy is inside
 *     the area and a living squad soldier is; any living enemy inside sets
 *     it back to zero; the squad stepping out with the area still clear
 *     pauses it. Complete at the hold.
 *   - reach: complete the tick every standing squad soldier (`all`) or any
 *     one (`any`) is inside. Standing is alive and not downed: a soldier
 *     who cannot move cannot be asked to arrive.
 *   - destroy: complete once the encounter group is dead (the spawner's
 *     rule: every member it will send placed, none alive).
 *   - defend: the clock runs; the area is overrun while a living enemy is
 *     inside and no living squad soldier is, and `breachSeconds` of it in a
 *     row fails the objective, and the mission with it. Complete when the
 *     clock reaches `seconds`.
 *   - survive: complete when the clock reaches `seconds`.
 *   - upload (U-009): `idle` until a soldier starts it at its terminal
 *     (`startUpload`, which the session calls only for a press it has
 *     validated); then `active`, a tick of progress a tick with nobody
 *     standing anywhere, complete at `seconds`. `interruptUpload` stops a
 *     running one: `interrupted`, keeping its progress or starting over as
 *     the objective's `onInterrupt` says, until a soldier starts it again.
 *     Neither call does anything in any other phase, objective or state, so
 *     a repeated or late request cannot advance it, and progress only ever
 *     comes from ticks while it runs, up to the goal.
 *   - rescue (U-063): the hold counts a tick while the session says a
 *     standing soldier is holding interact beside a prisoner, and starts over
 *     the tick they stop; complete at the hold, or at once with nobody held.
 *     The session frees the prisoner when it completes.
 *
 * Whatever the objective, any soldier's death or all six soldiers unable to stand fails the
 * mission. The next stage starts the tick the last required objective of one completes; the mission is
 * complete when the last stage does. Complete and failed are final until a
 * restart (`reset`).
 *
 * STAGES (U-074). A stage is the objectives that are open together: each runs on its own state every tick, and they
 * may be done in any order. The stage is done when every one that is not `optional` is; an optional one still open is
 * dropped with it. A mission whose objectives name no stage has one objective in each, which is how every mission
 * before U-074 plays, tick for tick. The view a client sees describes the first objective still to do and, when the
 * stage has several, lists them all (`open`). Each completion is a checkpoint: the stage it is in and which of its
 * objectives are done.
 */
import {
  type AreaRef,
  type GroundArea,
  type MissionDef,
  type MissionView,
  type ObjectiveDef,
  type OpenObjective,
  TICK_SECONDS,
  objectiveStages,
} from '@sandline/shared';

/** What the session answers the mission each tick. */
export interface MissionWorld {
  /** Living enemies inside an area. */
  enemiesIn(area: GroundArea): number;
  /** Living squad soldiers inside an area (downed ones count: they are there). */
  squadIn(area: GroundArea): number;
  /** Standing squad soldiers — alive, not downed — in all, and inside an area. */
  standing(): number;
  standingIn(area: GroundArea): number;
  /** U-075: the escorted characters — how many there are (alive) and how many of those are inside an area. Absent: none. */
  escortsIn?(area: GroundArea): { total: number; inside: number };
  /** Whether any squad soldier is dead. */
  soldierDead(): boolean;
  /** A protected encounter entity has spawned and been lost. */
  protectedLost(id: string): boolean;
  /** An encounter group: whether it is dead, and how many it has placed and lost so far. */
  group(id: string): { dead: boolean; spawned: number; down: number };
  /**
   * U-063: the prisoners a rescue could free (`slot`, or any when null): how many are held, and whether a standing
   * soldier is holding interact beside one now (`scale` is that soldier's multiple on an interaction's time).
   */
  rescue(slot: number | null, reachM: number): { held: number; holding: { scale: number } | null };
}

const ticksOf = (seconds: number): number => Math.max(1, Math.round(seconds / TICK_SECONDS));

/** One objective's own running state (U-074): what the single `MissionView` carried before stages. */
interface ObjectiveState {
  done: boolean;
  progress: number;
  goal: number;
  phase: MissionView['phase'];
  satisfied: boolean;
  /** Ticks in a row the defended area has been overrun. */
  breach: number;
}

/** Where a checkpoint resumes: the stage's first objective and which of the stage's were already done. */
export interface MissionPoint {
  objective: number;
  done: readonly number[];
}

export class MissionRun {
  private view: MissionView;
  /** Mission ticks elapsed across the attempt; retry keeps the time already spent before its checkpoint. */
  private elapsedTicks = 0;
  /** Where to resume after a failure, and the elapsed time when it began. */
  private checkpointObjective = 0;
  private checkpointDone: number[] = [];
  private checkpointElapsedTicks = 0;
  private readonly areas: (GroundArea | null)[];
  private readonly stages: number[][];
  private readonly stageOfObjective: number[];
  private states: ObjectiveState[] = [];
  /** The stage being played. */
  private stage = 0;
  private attempt = 1;

  constructor(
    private readonly def: MissionDef,
    /** Resolves an objective's named area (`resolveArea` with the encounter and world). */
    resolve: (ref: AreaRef) => GroundArea,
  ) {
    this.areas = def.objectives.map((o) => ('area' in o ? resolve(o.area) : null));
    this.stages = objectiveStages(def);
    this.stageOfObjective = [];
    this.stages.forEach((group, s) => group.forEach((i) => (this.stageOfObjective[i] = s)));
    this.view = this.open(0, [], 1);
  }

  /** Where the mission stands. */
  get current(): Readonly<MissionView> {
    return this.view;
  }

  /** T-4.28: the mission's clock, ticks, across the attempt. */
  get elapsed(): number {
    return this.elapsedTicks;
  }

  /** Whether the respawn rule applies (the mission's `respawn`). */
  get respawns(): boolean {
    return this.def.respawn;
  }

  /** Objective index a failed run retries from (the first of its stage); 0 before the first objective completes. */
  get checkpoint(): number {
    return this.checkpointObjective;
  }

  /** U-074: which objectives of that stage were already done at the checkpoint. */
  get checkpointDoneList(): readonly number[] {
    return this.checkpointDone;
  }

  /** Elapsed mission ticks captured with the latest checkpoint (T-4.23 persistence). */
  get checkpointElapsed(): number {
    return this.checkpointElapsedTicks;
  }

  /** U-074: how many objectives are done in all, the final one included once the mission is complete. */
  get doneCount(): number {
    return this.states.filter((s) => s.done).length;
  }

  /** U-074: the indices of the objectives done so far, and the definition of one. */
  get doneObjectives(): number[] {
    return this.states.flatMap((s, i) => (s.done ? [i] : []));
  }

  objectiveDef(index: number): ObjectiveDef {
    return this.def.objectives[index]!;
  }

  /** U-074: where a checkpoint taken now would resume. */
  get point(): MissionPoint {
    return { objective: this.stages[this.stage]![0]!, done: this.doneInStage() };
  }

  private doneInStage(): number[] {
    return this.stages[this.stage]!.filter((i) => this.states[i]!.done);
  }

  /**
   * Restore the latest durable checkpoint into a new session. The attempt
   * number starts fresh on a new host process, but objective/time continue.
   */
  restoreCheckpoint(objective: number, elapsedTicks: number, done: readonly number[] = []): void {
    this.checkObjective(objective, 'checkpoint');
    if (!Number.isInteger(elapsedTicks) || elapsedTicks < 0) {
      throw new Error(`mission checkpoint elapsed ticks ${elapsedTicks} is invalid`);
    }
    this.checkDone(objective, done);
    this.checkpointObjective = objective;
    this.checkpointDone = [...done];
    this.checkpointElapsedTicks = elapsedTicks;
    this.elapsedTicks = elapsedTicks;
    this.view = this.open(this.stageOfObjective[objective]!, done, 1);
  }

  /**
   * U-059: move the retry point without touching the play in progress — where a failed run goes back to, and
   * the elapsed time it had then. `restoreCheckpoint` is for a new session; this is for the one in play.
   */
  setCheckpoint(objective: number, elapsedTicks: number, done: readonly number[] = []): void {
    this.checkObjective(objective, 'checkpoint');
    this.checkDone(objective, done);
    this.checkpointObjective = objective;
    this.checkpointDone = [...done];
    this.checkpointElapsedTicks = elapsedTicks;
  }

  private checkObjective(objective: number, what: string): void {
    if (!Number.isInteger(objective) || objective < 0 || objective >= this.def.objectives.length) {
      throw new Error(`mission ${what} objective ${objective} is out of range`);
    }
  }

  /** Done objectives must be of the checkpoint's own stage, and not all of it (then it would be the next stage). */
  private checkDone(objective: number, done: readonly number[]): void {
    const group = this.stages[this.stageOfObjective[objective]!]!;
    if (done.some((i) => !group.includes(i))) throw new Error(`mission checkpoint done objectives ${done.join(',')} are not in the stage of ${objective}`);
  }

  /** The first objective of the stage still to do (a required one before an optional), or the last one if all are done. */
  get objective(): { def: ObjectiveDef; area: GroundArea | null } {
    const index = this.focus();
    return { def: this.def.objectives[index]!, area: this.areas[index] ?? null };
  }

  /** U-074: the objectives of the stage being played, done or not. */
  openObjectives(): { index: number; def: ObjectiveDef; area: GroundArea | null; done: boolean; phase: MissionView['phase'] }[] {
    if (this.view.state !== 'progress') return [];
    return this.stages[this.stage]!.map((index) => ({ index, def: this.def.objectives[index]!, area: this.areas[index] ?? null, done: this.states[index]!.done, phase: this.states[index]!.phase }));
  }

  private focus(): number {
    const group = this.stages[this.stage]!;
    const todo = group.filter((i) => !this.states[i]!.done);
    return todo.find((i) => !this.def.objectives[i]!.optional) ?? todo[0] ?? group[group.length - 1]!;
  }

  /** The opening state of objective `index`. */
  private fresh(index: number): ObjectiveState {
    const o = this.def.objectives[index]!;
    const goal = o.type === 'clear-and-hold' || o.type === 'rescue' ? ticksOf(o.holdSeconds) : o.type === 'defend' || o.type === 'survive' || o.type === 'upload' ? ticksOf(o.seconds) : 1;
    return {
      done: false,
      progress: 0,
      goal,
      phase: o.type === 'upload' ? 'idle' : 'active',
      satisfied: o.type !== 'clear-and-hold' && o.type !== 'reach' && o.type !== 'upload' && o.type !== 'rescue',
      breach: 0,
    };
  }

  /**
   * Open stage `stage` with `done` of its objectives already done (a checkpoint taken mid-stage); every earlier stage's
   * objectives count as done, every later one's as not yet started.
   */
  private open(stage: number, done: readonly number[], attempt: number): MissionView {
    this.stage = stage;
    this.attempt = attempt;
    this.states = this.def.objectives.map((_, i) => {
      const s = this.fresh(i);
      const s0 = this.stageOfObjective[i]!;
      if (s0 < stage || (s0 === stage && done.includes(i))) return { ...s, done: true, progress: s.goal, satisfied: true };
      return s;
    });
    return this.build('progress', undefined);
  }

  /** The view for the state of the objectives now. */
  private build(state: MissionView['state'], failureReason: MissionView['failureReason']): MissionView {
    const index = this.focus();
    const st = this.states[index]!;
    const o = this.def.objectives[index]!;
    const group = this.stages[this.stage]!;
    const open: OpenObjective[] | undefined =
      group.length > 1
        ? group.map((i) => {
            const x = this.states[i]!;
            const d = this.def.objectives[i]!;
            return { index: i, type: d.type, label: d.label, phase: x.phase, satisfied: x.satisfied, progress: x.progress, goal: x.goal, done: x.done, optional: d.optional === true };
          })
        : undefined;
    return {
      state,
      ...(failureReason ? { failureReason } : {}),
      attempt: this.attempt,
      objective: index,
      objectives: this.def.objectives.length,
      type: o.type,
      phase: st.phase,
      label: o.label,
      progress: st.progress,
      goal: st.goal,
      satisfied: st.satisfied,
      ...(open ? { open } : {}),
    };
  }

  /** U-009: the upload being played, if the stage has one still to finish. */
  private get upload(): { index: number; def: Extract<ObjectiveDef, { type: 'upload' }> } | null {
    if (this.view.state !== 'progress') return null;
    for (const i of this.stages[this.stage]!) {
      const def = this.def.objectives[i]!;
      if (def.type === 'upload' && !this.states[i]!.done) return { index: i, def };
    }
    return null;
  }

  /** U-074: the upload to finish, if there is one — its objective and phase — for the terminal, the lever and the prompt. */
  openUpload(): { index: number; def: Extract<ObjectiveDef, { type: 'upload' }>; phase: MissionView['phase'] } | null {
    const up = this.upload;
    return up ? { ...up, phase: this.states[up.index]!.phase } : null;
  }

  /**
   * U-009: start (or restart) the current upload. The session calls this
   * only for an interaction it has validated — who, where, the line to the
   * terminal. Refused, returning false, unless the objective is an upload
   * that is not already running: a second press, or one that arrives after
   * it completed or the mission moved on, changes nothing.
   */
  startUpload(): boolean {
    const up = this.upload;
    if (!up || this.states[up.index]!.phase === 'active') return false;
    this.states[up.index] = { ...this.states[up.index]!, phase: 'active', satisfied: true };
    this.view = this.build('progress', undefined);
    return true;
  }

  /**
   * U-009: stop a running upload (an event script's `interrupt-upload`; the
   * enemy's lever in U-010). It keeps what it had sent or starts over, as the
   * objective's `onInterrupt` says. False, changing nothing, unless an
   * upload is running.
   */
  interruptUpload(): boolean {
    const up = this.upload;
    if (!up || this.states[up.index]!.phase !== 'active') return false;
    const st = this.states[up.index]!;
    this.states[up.index] = { ...st, phase: 'interrupted', satisfied: false, progress: up.def.onInterrupt === 'reset-progress' ? 0 : st.progress };
    this.view = this.build('progress', undefined);
    return true;
  }

  /** One objective, one tick: its next state (it does not decide failure; the caller has). */
  private advance(index: number, w: MissionWorld): { next: ObjectiveState; overrun: boolean } {
    const def = this.def.objectives[index]!;
    const area = this.areas[index] ?? null;
    let next: ObjectiveState = { ...this.states[index]! };
    let overrun = false;
    switch (def.type) {
      case 'clear-and-hold': {
        const clear = w.enemiesIn(area!) === 0;
        const held = !clear ? 0 : w.squadIn(area!) > 0 ? Math.min(next.goal, next.progress + 1) : next.progress;
        next = { ...next, satisfied: clear, progress: held };
        break;
      }
      case 'reach': {
        const need = def.who === 'all' ? w.standing() : 1;
        const there = Math.min(w.standingIn(area!), Math.max(need, 1));
        // U-075: an extraction that needs the escort needs every escorted character with the squad.
        const escorts = def.escort ? (w.escortsIn?.(area!) ?? { total: 0, inside: 0 }) : null;
        const escortsThere = escorts === null || (escorts.total > 0 && escorts.inside >= escorts.total);
        next = { ...next, goal: Math.max(need, 1), progress: there, satisfied: need > 0 && there >= need && escortsThere };
        break;
      }
      case 'destroy': {
        const g = w.group(def.group);
        next = { ...next, goal: Math.max(1, g.spawned), progress: Math.min(g.down, Math.max(1, g.spawned)), satisfied: true };
        if (g.dead) next.progress = next.goal;
        break;
      }
      case 'defend': {
        const over = w.enemiesIn(area!) > 0 && w.squadIn(area!) === 0;
        next = { ...next, breach: over ? next.breach + 1 : 0, satisfied: !over, progress: Math.min(next.goal, next.progress + 1) };
        if (next.breach >= ticksOf(def.breachSeconds)) overrun = true;
        break;
      }
      case 'survive':
        next = { ...next, progress: Math.min(next.goal, next.progress + 1) };
        break;
      case 'upload':
        if (next.phase === 'active') next = { ...next, progress: Math.min(next.goal, next.progress + 1) };
        break;
      case 'rescue': {
        // U-063: nobody held, nothing to free. Otherwise the hold counts while a soldier keeps it and starts over when they do not.
        const r = w.rescue(def.slot ?? null, def.reachM);
        if (r.held === 0) {
          next = { ...next, goal: 1, progress: 1, satisfied: true };
          break;
        }
        const goal = ticksOf(def.holdSeconds * (r.holding?.scale ?? 1));
        next = { ...next, goal, progress: r.holding ? Math.min(goal, next.progress + 1) : 0, satisfied: r.holding !== null };
        break;
      }
    }
    return { next, overrun };
  }

  private isDone(index: number, st: ObjectiveState, w: MissionWorld): boolean {
    const def = this.def.objectives[index]!;
    return def.type === 'reach' ? st.satisfied : def.type === 'destroy' ? w.group(def.group).dead : st.progress >= st.goal;
  }

  /**
   * Evaluate one tick. Returns true when anything a client shows changed:
   * the state, the objective, whether its condition holds, a count, or a
   * whole second of a clock.
   */
  step(w: MissionWorld): boolean {
    if (this.view.state !== 'progress') return false;
    const before = this.view;
    this.elapsedTicks++;
    const failure = this.def.failure;
    const timedOut = failure?.timeLimitSeconds !== undefined && this.elapsedTicks >= ticksOf(failure.timeLimitSeconds);
    const protectedLost = failure?.protectedGroup !== undefined && w.protectedLost(failure.protectedGroup);
    const reason = w.soldierDead() ? 'soldier-dead' : w.standing() === 0 ? 'all-downed' : timedOut ? 'time-limit' : protectedLost ? 'protected-lost' : null;
    let next: MissionView;
    if (reason) {
      next = { ...before, state: 'failed', failureReason: reason };
    } else {
      let overrun = false;
      let completedNow = false;
      const group = this.stages[this.stage]!;
      for (const index of group) {
        if (this.states[index]!.done) continue;
        const stepped = this.advance(index, w);
        if (stepped.overrun) overrun = true;
        const st = stepped.next;
        if (this.isDone(index, st, w)) {
          st.done = true;
          completedNow = true;
        }
        this.states[index] = st;
      }
      if (overrun) {
        next = { ...this.build('failed', 'area-overrun') };
      } else {
        const requiredLeft = group.some((i) => !this.states[i]!.done && !this.def.objectives[i]!.optional);
        if (completedNow && requiredLeft) {
          // A checkpoint at every completion: this stage, and which of it is done.
          this.checkpointObjective = group[0]!;
          this.checkpointDone = this.doneInStage();
          this.checkpointElapsedTicks = this.elapsedTicks;
          next = this.build('progress', undefined);
        } else if (completedNow && !requiredLeft) {
          if (this.stage + 1 < this.stages.length) {
            // Whatever optional objective was still open goes with the stage; the next stage's first objective is the checkpoint.
            for (const i of group) this.states[i] = { ...this.states[i]!, done: true };
            this.checkpointObjective = this.stages[this.stage + 1]![0]!;
            this.checkpointDone = [];
            this.checkpointElapsedTicks = this.elapsedTicks;
            next = this.open(this.stage + 1, [], this.attempt);
          } else {
            next = this.build('complete', undefined);
          }
        } else {
          next = this.build('progress', undefined);
        }
      }
    }
    this.view = next;
    const second = (progress: number, type: string) => (type === 'reach' || type === 'destroy' ? progress : Math.floor(progress * TICK_SECONDS));
    const openKey = (v: MissionView) => (v.open ?? []).map((o) => `${o.done ? 1 : 0}${o.satisfied ? 1 : 0}${o.phase}${o.goal}:${second(o.progress, o.type)}`).join('|');
    return (
      next.state !== before.state ||
      next.objective !== before.objective ||
      next.phase !== before.phase ||
      next.satisfied !== before.satisfied ||
      next.goal !== before.goal ||
      second(next.progress, next.type) !== second(before.progress, before.type) ||
      openKey(next) !== openKey(before)
    );
  }

  /** Jump to an authored objective's stage in this attempt (T-4.15 scripted action). */
  setObjective(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= this.def.objectives.length) return false;
    const stage = this.stageOfObjective[index]!;
    if (this.view.state === 'progress' && this.stage === stage) return false;
    this.view = this.open(stage, [], this.attempt);
    return true;
  }

  /** Retry after a failure: the latest checkpoint, with earlier objectives still complete. */
  retry(): void {
    this.elapsedTicks = this.checkpointElapsedTicks;
    this.view = this.open(this.stageOfObjective[this.checkpointObjective]!, this.checkpointDone, this.attempt + 1);
  }

  /** Full restart: the first objective, nothing done, the next attempt. */
  reset(): void {
    this.elapsedTicks = 0;
    this.checkpointObjective = 0;
    this.checkpointDone = [];
    this.checkpointElapsedTicks = 0;
    this.view = this.open(0, [], this.attempt + 1);
  }
}
