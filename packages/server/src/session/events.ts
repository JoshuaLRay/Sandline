/**
 * Deterministic server-side event runner (T-4.15).
 *
 * Existing encounter triggers are translated into event definitions here,
 * then authored events are appended. Each event fires at most once per
 * mission attempt. Actions execute in file order; flag chains are drained in
 * stable passes during the same tick.
 */
import {
  type Encounter,
  type EventAction,
  type EventDef,
  type EventScript,
  type EventTrigger,
  type GroundArea,
  type MissionStatus,
  type ObjectivePhase,
  type ScriptBlockerState,
  type World,
  resolveArea,
} from '@sandline/shared';

export interface EventCheckpoint {
  pending?: [string, number][];
  fired: string[];
  flags: [string, boolean][];
  blockers: ScriptBlockerState[];
  /** U-074: the objectives to do at the last step (U-069 and earlier saves have `previousObjective` instead). */
  previousActive?: number[] | null;
  previousObjective?: { index: number; state: MissionStatus } | null;
}

export interface EventHost {
  squadFeet(): readonly { x: number; z: number }[];
  groupDead(id: string): boolean;
  spawnGroup(id: string, seconds: number): boolean;
  /** U-001: no more waves from the group. */
  stopGroup(id: string, seconds: number): boolean;
  /**
   * U-074: where the mission stands and which of its objectives are open and still to do (a stage can have several,
   * each in its own phase); null with no mission.
   */
  objectives(): { state: MissionStatus; active: readonly { index: number; phase: ObjectivePhase }[] } | null;
  setObjective(index: number): boolean;
  /** U-009: stop the running upload, if one is. */
  interruptUpload(): boolean;
  setBlocker(blocker: ScriptBlockerState): void;
  message(text: string): void;
  callout(id: string): void;
  /** U-052: authored loot on the ground. */
  placeLoot(weapon: string, ammo: number, at: { x: number; y: number; z: number }, yawDeg: number): void;
  /** U-069: a vehicle to drive `path` from where it is put. */
  spawnVehicle(vehicle: string, at: { x: number; z: number }, yawDeg: number, path: readonly { x: number; z: number }[]): void;
  /** U-069: every driving vehicle heads out the way it came. */
  withdrawVehicles(): void;
}

/** A group's own trigger as an event; none for a group only a script sends (U-001). */
function encounterEvent(group: Encounter['groups'][number]): EventDef[] {
  const t = group.trigger;
  if (t.kind === 'script') return [];
  const trigger: EventTrigger =
    t.kind === 'start'
      ? { kind: 'time', seconds: 0 }
      : t.kind === 'time'
        ? { kind: 'time', seconds: t.seconds }
        : t.kind === 'enter'
          ? { kind: 'enter', area: t.area }
          : { kind: 'group-dead', group: t.group };
  return [{ id: `@encounter:${group.id}`, trigger, actions: [{ kind: 'spawn-group', group: group.id }] }];
}

export class EventRun {
  private readonly defs: readonly EventDef[];
  private readonly fired = new Set<string>();
  private readonly pending = new Map<string, number>();
  private readonly flags = new Map<string, boolean>();
  private readonly blockerState = new Map<string, ScriptBlockerState>();
  /** The objectives that were open and to do at the last step; null before the first. */
  private previousActive: number[] | null = null;

  constructor(
    private readonly script: EventScript,
    private readonly encounter: Encounter,
    private readonly world: World,
    private readonly host: EventHost,
  ) {
    if (script.world !== world.id || encounter.world !== world.id) throw new Error(`event script for '${script.world}' on world '${world.id}'`);
    this.defs = [...encounter.groups.flatMap(encounterEvent), ...script.events];
    this.reset();
  }

  /** Full blocker state for replication, in authored order. */
  get blockers(): readonly ScriptBlockerState[] {
    return this.script.blockers.map((b) => this.blockerState.get(b.id) ?? { id: b.id, active: b.active, boxes: b.boxes });
  }

  /** State needed to resume scripted events from an objective checkpoint. */
  checkpoint(): EventCheckpoint {
    return {
      fired: [...this.fired],
      ...(this.pending.size > 0 ? { pending: [...this.pending] } : {}),
      flags: [...this.flags],
      blockers: this.blockers.map((b) => ({ ...b, boxes: [...b.boxes] })),
      previousActive: this.previousActive ? [...this.previousActive] : null,
    };
  }

  /** Restore a previously captured checkpoint without replaying already-fired events. */
  restore(checkpoint: EventCheckpoint): void {
    this.pending.clear();
    this.fired.clear();
    for (const [id, due] of checkpoint.pending ?? []) this.pending.set(id, due);
    for (const id of checkpoint.fired) this.fired.add(id);
    this.flags.clear();
    for (const [id, value] of checkpoint.flags) this.flags.set(id, value);
    this.previousActive = checkpoint.previousActive
      ? [...checkpoint.previousActive]
      : checkpoint.previousObjective
        ? checkpoint.previousObjective.state === 'progress' ? [checkpoint.previousObjective.index] : []
        : null;
    this.blockerState.clear();
    for (const b of checkpoint.blockers) {
      const state = { ...b, boxes: [...b.boxes] };
      this.blockerState.set(b.id, state);
      this.host.setBlocker(state);
    }
  }

  /**
   * U-001: the groups fired events have sent and stopped, in the order the
   * events are defined. After `restore`, a sent group the checkpoint did not
   * count beaten is the session's to send again, and a stopped one to stop
   * again: the fired set says it happened, but the retry cleared the world
   * and built a fresh spawner that has done neither.
   */
  groups(): { sent: string[]; stopped: string[] } {
    const sent: string[] = [];
    const stopped: string[] = [];
    for (const def of this.defs) {
      if (!this.fired.has(def.id)) continue;
      for (const action of def.actions) {
        if (action.kind === 'spawn-group' && !sent.includes(action.group)) sent.push(action.group);
        if (action.kind === 'stop-group' && !stopped.includes(action.group)) stopped.push(action.group);
      }
    }
    return { sent: sent.filter((g) => !stopped.includes(g)), stopped };
  }

  /** Start a new mission attempt. */
  reset(): void {
    this.pending.clear();
    this.fired.clear();
    this.flags.clear();
    this.previousActive = null;
    this.blockerState.clear();
    for (const b of this.script.blockers) {
      const state = { id: b.id, active: b.active, boxes: b.boxes };
      this.blockerState.set(b.id, state);
      this.host.setBlocker(state);
    }
  }

  private inArea(area: GroundArea): boolean {
    return this.host.squadFeet().some((p) => Math.hypot(p.x - area.x, p.z - area.z) <= area.radius);
  }

  private triggered(trigger: EventTrigger, seconds: number, started: readonly number[], completed: readonly number[]): boolean {
    switch (trigger.kind) {
      case 'objective-start':
        return started.includes(trigger.objective);
      case 'upload-start': {
        const now = this.host.objectives();
        return now !== null && now.state === 'progress' && now.active.some((o) => o.index === trigger.objective && o.phase === 'active');
      }
      case 'objective-complete':
        return completed.includes(trigger.objective);
      case 'enter':
        return this.inArea(resolveArea(trigger.area, this.encounter, this.world));
      case 'time':
        return seconds >= trigger.seconds;
      case 'group-dead':
        return this.host.groupDead(trigger.group);
      case 'flag':
        return (this.flags.get(trigger.flag) ?? false) === trigger.value;
    }
  }

  private action(action: EventAction, seconds: number): void {
    switch (action.kind) {
      case 'spawn-group':
        this.host.spawnGroup(action.group, seconds);
        break;
      case 'stop-group':
        this.host.stopGroup(action.group, seconds);
        break;
      case 'set-objective':
        this.host.setObjective(action.objective);
        break;
      case 'interrupt-upload':
        this.host.interruptUpload();
        break;
      case 'toggle-blocker': {
        const current = this.blockerState.get(action.blocker);
        if (!current || current.active === action.active) break;
        const next = { ...current, active: action.active };
        this.blockerState.set(action.blocker, next);
        this.host.setBlocker(next);
        break;
      }
      case 'message':
        this.host.message(action.text);
        break;
      case 'callout':
        this.host.callout(action.id);
        break;
      case 'set-flag':
        this.flags.set(action.flag, action.value);
        break;
      case 'pickup':
        this.host.placeLoot(action.weapon, action.ammo, { x: action.x, y: action.y, z: action.z }, action.yawDeg);
        break;
      case 'spawn-vehicle':
        this.host.spawnVehicle(action.vehicle, { x: action.x, z: action.z }, action.yawDeg, action.path);
        break;
      case 'withdraw-vehicles':
        this.host.withdrawVehicles();
        break;
    }
  }

  /** Evaluate one mission tick. */
  step(seconds: number): void {
    // U-074: the objectives open and still to do now against at the last step: newly open ones started, ones no longer
    // to do (done, or left with their stage) completed. A failed mission completes nothing and leaves the record alone.
    const now = this.host.objectives();
    const active = now && now.state === 'progress' ? now.active.map((o) => o.index) : [];
    const previous = this.previousActive;
    const started = previous === null || now?.state === 'progress' ? active.filter((i) => previous === null || !previous.includes(i)) : [];
    const completed = previous && now?.state !== 'failed' ? previous.filter((i) => !active.includes(i)) : [];

    // Repeat stable passes so a set-flag can satisfy another event this tick
    // without making file ordering a hidden rule.
    for (let pass = 0; pass <= this.defs.length; pass++) {
      let progressed = false;
      for (const def of this.defs) {
        if (this.fired.has(def.id)) continue;
        let due = this.pending.get(def.id);
        if (due === undefined) {
          if (!this.triggered(def.trigger, seconds, started, completed)) continue;
          due = seconds + (def.delaySeconds ?? 0);
          this.pending.set(def.id, due);
        }
        if (seconds + 1e-9 < due) continue;
        this.pending.delete(def.id);
        this.fired.add(def.id);
        if ((def.ifGroupAlive && this.host.groupDead(def.ifGroupAlive)) || (def.unlessFlag && this.flags.get(def.unlessFlag))) continue;
        progressed = true;
        for (const action of def.actions) this.action(action, seconds);
      }
      if (!progressed) break;
    }
    const after = this.host.objectives();
    if (after?.state !== 'failed') this.previousActive = after && after.state === 'progress' ? after.active.map((o) => o.index) : [];
  }
}
