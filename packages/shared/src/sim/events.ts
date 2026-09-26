/**
 * Data-driven mission events (T-4.15).
 *
 * Encounter spawn triggers are played through the same server event runner as
 * authored mission events. A script may react to an objective starting or
 * completing, an area entry, mission time, a dead encounter group, or a flag.
 * Actions may spawn a group, stop one sending more waves (U-001), jump to an
 * objective, toggle a blocker, show a message, request a callout, or set a
 * flag.
 *
 * Blockers are authored as ordinary axis-aligned boxes. The server adds their
 * boxes to collision while active and marks the matching nav polygons
 * unwalkable; the replicated ScriptState carries the same boxes to clients.
 */
import type { Encounter, AreaRef } from './encounters.ts';
import type { MissionDef } from './mission.ts';
import { boxFrom, type BoxSpec, type World, type WorldBox } from './world.ts';

export const EVENT_TRIGGER_KINDS = ['objective-start', 'objective-complete', 'enter', 'time', 'group-dead', 'flag'] as const;
export type EventTrigger =
  | { kind: 'objective-start'; objective: number }
  | { kind: 'objective-complete'; objective: number }
  | { kind: 'enter'; area: AreaRef }
  | { kind: 'time'; seconds: number }
  | { kind: 'group-dead'; group: string }
  | { kind: 'flag'; flag: string; value: boolean };

export const EVENT_ACTION_KINDS = ['spawn-group', 'stop-group', 'set-objective', 'toggle-blocker', 'message', 'callout', 'set-flag'] as const;
export type EventAction =
  | { kind: 'spawn-group'; group: string }
  /** U-001: no more waves from the group, and none of its queued members placed; the living fight on. */
  | { kind: 'stop-group'; group: string }
  | { kind: 'set-objective'; objective: number }
  | { kind: 'toggle-blocker'; blocker: string; active: boolean }
  | { kind: 'message'; text: string }
  | { kind: 'callout'; id: string }
  | { kind: 'set-flag'; flag: string; value: boolean };

export interface EventDef {
  id: string;
  trigger: EventTrigger;
  actions: readonly EventAction[];
}

export interface BlockerDef {
  id: string;
  active: boolean;
  boxes: readonly WorldBox[];
}

export interface EventScript {
  world: string;
  blockers: readonly BlockerDef[];
  events: readonly EventDef[];
}

/** Full replicated state of one blocker. */
export interface ScriptBlockerState {
  id: string;
  active: boolean;
  boxes: readonly WorldBox[];
}

export class EventDataError extends Error {}

type Obj = Record<string, unknown>;
const ID = /^[a-z][a-z0-9-]{0,31}$/;

function obj(where: string, value: unknown, required: readonly string[], optional: readonly string[] = []): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new EventDataError(`${where}: expected an object`);
  const o = value as Obj;
  for (const key of Object.keys(o)) if (!required.includes(key) && !optional.includes(key) && key !== '$comment') throw new EventDataError(`${where}: unknown key '${key}'`);
  for (const key of required) if (!(key in o)) throw new EventDataError(`${where}: missing '${key}'`);
  return o;
}

function id(where: string, value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new EventDataError(`${where}: expected a lowercase id`);
  return value;
}

function finite(where: string, value: unknown, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new EventDataError(`${where}: expected a number in [${min}, ${max}]`);
  }
  return value;
}

function whole(where: string, value: unknown, min: number, max: number): number {
  const n = finite(where, value, min, max);
  if (!Number.isInteger(n)) throw new EventDataError(`${where}: expected a whole number`);
  return n;
}

function bool(where: string, value: unknown): boolean {
  if (typeof value !== 'boolean') throw new EventDataError(`${where}: expected true or false`);
  return value;
}

function text(where: string, value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new EventDataError(`${where}: expected 1–${max} characters`);
  return value;
}

function area(where: string, value: unknown, encounter: Encounter, _world: World): AreaRef {
  if (typeof value === 'string') {
    if (value !== 'start' && value !== 'objective' && !(value in encounter.areas)) throw new EventDataError(`${where}: no area '${value}'`);
    return value;
  }
  const o = obj(where, value, ['x', 'z', 'radius']);
  const radius = finite(`${where}.radius`, o['radius'], 1e-3);
  return { x: finite(`${where}.x`, o['x']), z: finite(`${where}.z`, o['z']), radius };
}

function box(where: string, value: unknown, blocker: string, index: number): WorldBox {
  const o = obj(where, value, ['x', 'y', 'z', 'w', 'h', 'd']);
  const spec: BoxSpec = {
    id: `blocker:${blocker}/${index}`,
    x: finite(`${where}.x`, o['x']),
    y: finite(`${where}.y`, o['y']),
    z: finite(`${where}.z`, o['z']),
    w: finite(`${where}.w`, o['w'], 1e-3),
    h: finite(`${where}.h`, o['h'], 1e-3),
    d: finite(`${where}.d`, o['d'], 1e-3),
  };
  return boxFrom(spec, 'blocker');
}

/** Parse and validate an authored event file against its encounter, world and mission. */
export function parseEventScript(raw: unknown, encounter: Encounter, world: World, mission: MissionDef | null): EventScript {
  const top = obj('events', raw, ['world', 'blockers', 'events']);
  if (top['world'] !== world.id || encounter.world !== world.id) throw new EventDataError(`events.world must be '${world.id}'`);
  if (!Array.isArray(top['blockers'])) throw new EventDataError('events.blockers: expected a list');
  if (!Array.isArray(top['events'])) throw new EventDataError('events.events: expected a list');

  const blockerIds = new Set<string>();
  const blockers: BlockerDef[] = top['blockers'].map((rawBlocker, i) => {
    const where = `events.blockers[${i}]`;
    const o = obj(where, rawBlocker, ['id', 'active', 'boxes']);
    const blockerId = id(`${where}.id`, o['id']);
    if (blockerIds.has(blockerId)) throw new EventDataError(`${where}: duplicate blocker '${blockerId}'`);
    blockerIds.add(blockerId);
    if (!Array.isArray(o['boxes']) || o['boxes'].length === 0) throw new EventDataError(`${where}.boxes: expected a non-empty list`);
    return { id: blockerId, active: bool(`${where}.active`, o['active']), boxes: o['boxes'].map((b, j) => box(`${where}.boxes[${j}]`, b, blockerId, j)) };
  });

  const groups = new Set(encounter.groups.map((g) => g.id));
  const objectiveCount = mission?.objectives.length ?? 0;
  const eventIds = new Set<string>();
  const objective = (where: string, value: unknown): number => {
    if (!mission) throw new EventDataError(`${where}: this world has no mission`);
    return whole(where, value, 0, objectiveCount - 1);
  };
  const group = (where: string, value: unknown): string => {
    const name = id(where, value);
    if (!groups.has(name)) throw new EventDataError(`${where}: no encounter group '${name}'`);
    return name;
  };
  const flag = (where: string, value: unknown): string => id(where, value);

  const events: EventDef[] = top['events'].map((rawEvent, i) => {
    const where = `events.events[${i}]`;
    const o = obj(where, rawEvent, ['id', 'trigger', 'actions']);
    const eventId = id(`${where}.id`, o['id']);
    if (eventIds.has(eventId)) throw new EventDataError(`${where}: duplicate event '${eventId}'`);
    eventIds.add(eventId);

    const tr = o['trigger'] as Obj | null;
    const tk = typeof tr === 'object' && tr !== null ? tr['kind'] : undefined;
    let trigger: EventTrigger;
    switch (tk) {
      case 'objective-start': {
        const t = obj(`${where}.trigger`, tr, ['kind', 'objective']);
        trigger = { kind: tk, objective: objective(`${where}.trigger.objective`, t['objective']) };
        break;
      }
      case 'objective-complete': {
        const t = obj(`${where}.trigger`, tr, ['kind', 'objective']);
        trigger = { kind: tk, objective: objective(`${where}.trigger.objective`, t['objective']) };
        break;
      }
      case 'enter': {
        const t = obj(`${where}.trigger`, tr, ['kind', 'area']);
        trigger = { kind: tk, area: area(`${where}.trigger.area`, t['area'], encounter, world) };
        break;
      }
      case 'time': {
        const t = obj(`${where}.trigger`, tr, ['kind', 'seconds']);
        trigger = { kind: tk, seconds: finite(`${where}.trigger.seconds`, t['seconds'], 0, 3600) };
        break;
      }
      case 'group-dead': {
        const t = obj(`${where}.trigger`, tr, ['kind', 'group']);
        trigger = { kind: tk, group: group(`${where}.trigger.group`, t['group']) };
        break;
      }
      case 'flag': {
        const t = obj(`${where}.trigger`, tr, ['kind', 'flag'], ['value']);
        trigger = { kind: tk, flag: flag(`${where}.trigger.flag`, t['flag']), value: t['value'] === undefined ? true : bool(`${where}.trigger.value`, t['value']) };
        break;
      }
      default:
        throw new EventDataError(`${where}.trigger.kind must be one of ${EVENT_TRIGGER_KINDS.join(', ')}`);
    }

    if (!Array.isArray(o['actions']) || o['actions'].length === 0) throw new EventDataError(`${where}.actions: expected a non-empty list`);
    const actions: EventAction[] = o['actions'].map((rawAction, j) => {
      const aw = `${where}.actions[${j}]`;
      const a = rawAction as Obj | null;
      const ak = typeof a === 'object' && a !== null ? a['kind'] : undefined;
      switch (ak) {
        case 'spawn-group':
        case 'stop-group': {
          const x = obj(aw, a, ['kind', 'group']);
          return { kind: ak, group: group(`${aw}.group`, x['group']) };
        }
        case 'set-objective': {
          const x = obj(aw, a, ['kind', 'objective']);
          return { kind: ak, objective: objective(`${aw}.objective`, x['objective']) };
        }
        case 'toggle-blocker': {
          const x = obj(aw, a, ['kind', 'blocker', 'active']);
          const blocker = id(`${aw}.blocker`, x['blocker']);
          if (!blockerIds.has(blocker)) throw new EventDataError(`${aw}.blocker: no blocker '${blocker}'`);
          return { kind: ak, blocker, active: bool(`${aw}.active`, x['active']) };
        }
        case 'message': {
          const x = obj(aw, a, ['kind', 'text']);
          return { kind: ak, text: text(`${aw}.text`, x['text'], 160) };
        }
        case 'callout': {
          const x = obj(aw, a, ['kind', 'id']);
          return { kind: ak, id: text(`${aw}.id`, x['id'], 64) };
        }
        case 'set-flag': {
          const x = obj(aw, a, ['kind', 'flag', 'value']);
          return { kind: ak, flag: flag(`${aw}.flag`, x['flag']), value: bool(`${aw}.value`, x['value']) };
        }
        default:
          throw new EventDataError(`${aw}.kind must be one of ${EVENT_ACTION_KINDS.join(', ')}`);
      }
    });
    return { id: eventId, trigger, actions };
  });

  return { world: world.id, blockers, events };
}

/** A typed empty authored script; encounter triggers are still added by the server runner. */
export function emptyEventScript(world: string): EventScript {
  return { world, blockers: [], events: [] };
}
