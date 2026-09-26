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
  type ScriptBlockerState,
  type World,
  resolveArea,
} from '@sandline/shared';

export interface EventCheckpoint {
  fired: string[];
  flags: [string, boolean][];
  blockers: ScriptBlockerState[];
  previousObjective: { index: number; state: MissionStatus } | null;
}

export interface EventHost {
  squadFeet(): readonly { x: number; z: number }[];
  groupDead(id: string): boolean;
  spawnGroup(id: string, seconds: number): boolean;
  /** U-001: no more waves from the group. */
  stopGroup(id: string, seconds: number): boolean;
  objective(): { index: number; state: MissionStatus } | null;
  setObjective(index: number): boolean;
  setBlocker(blocker: ScriptBlockerState): void;
  message(text: string): void;
  callout(id: string): void;
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
  private readonly flags = new Map<string, boolean>();
  private readonly blockerState = new Map<string, ScriptBlockerState>();
  private previousObjective: { index: number; state: MissionStatus } | null = null;

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
      flags: [...this.flags],
      blockers: this.blockers.map((b) => ({ ...b, boxes: [...b.boxes] })),
      previousObjective: this.previousObjective ? { ...this.previousObjective } : null,
    };
  }

  /** Restore a previously captured checkpoint without replaying already-fired events. */
  restore(checkpoint: EventCheckpoint): void {
    this.fired.clear();
    for (const id of checkpoint.fired) this.fired.add(id);
    this.flags.clear();
    for (const [id, value] of checkpoint.flags) this.flags.set(id, value);
    this.previousObjective = checkpoint.previousObjective ? { ...checkpoint.previousObjective } : null;
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
    this.fired.clear();
    this.flags.clear();
    this.previousObjective = null;
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

  private triggered(trigger: EventTrigger, seconds: number, started: number | null, completed: number | null): boolean {
    switch (trigger.kind) {
      case 'objective-start':
        return started === trigger.objective;
      case 'objective-complete':
        return completed === trigger.objective;
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
    }
  }

  /** Evaluate one mission tick. */
  step(seconds: number): void {
    const now = this.host.objective();
    const started =
      now && now.state === 'progress' && (this.previousObjective === null || now.index !== this.previousObjective.index)
        ? now.index
        : null;
    const completed =
      this.previousObjective &&
      this.previousObjective.state === 'progress' &&
      (now === null || now.index !== this.previousObjective.index || now.state === 'complete')
        ? this.previousObjective.index
        : null;

    // Repeat stable passes so a set-flag can satisfy another event this tick
    // without making file ordering a hidden rule.
    for (let pass = 0; pass <= this.defs.length; pass++) {
      let progressed = false;
      for (const def of this.defs) {
        if (this.fired.has(def.id) || !this.triggered(def.trigger, seconds, started, completed)) continue;
        this.fired.add(def.id);
        progressed = true;
        for (const action of def.actions) this.action(action, seconds);
      }
      if (!progressed) break;
    }
    this.previousObjective = this.host.objective();
  }
}
