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

export interface EventHost {
  squadFeet(): readonly { x: number; z: number }[];
  groupDead(id: string): boolean;
  spawnGroup(id: string, seconds: number): boolean;
  objective(): { index: number; state: MissionStatus } | null;
  setObjective(index: number): boolean;
  setBlocker(blocker: ScriptBlockerState): void;
  message(text: string): void;
  callout(id: string): void;
}

function encounterEvent(group: Encounter['groups'][number]): EventDef {
  const t = group.trigger;
  const trigger: EventTrigger =
    t.kind === 'start'
      ? { kind: 'time', seconds: 0 }
      : t.kind === 'time'
        ? { kind: 'time', seconds: t.seconds }
        : t.kind === 'enter'
          ? { kind: 'enter', area: t.area }
          : { kind: 'group-dead', group: t.group };
  return { id: `@encounter:${group.id}`, trigger, actions: [{ kind: 'spawn-group', group: group.id }] };
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
    this.defs = [...encounter.groups.map(encounterEvent), ...script.events];
    this.reset();
  }

  /** Full blocker state for replication, in authored order. */
  get blockers(): readonly ScriptBlockerState[] {
    return this.script.blockers.map((b) => this.blockerState.get(b.id) ?? { id: b.id, active: b.active, boxes: b.boxes });
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
