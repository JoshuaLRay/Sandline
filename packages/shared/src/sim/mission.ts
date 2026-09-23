/**
 * The mission's one objective (T-3.34), as data and as the wire sees it:
 * `data/mission.json` (validated by hand, unknown keys refused by name) and
 * the state the host broadcasts. The rule itself is the server's
 * (`server/src/session/mission.ts`).
 */
import RAW_MISSION from '../data/mission.json' with { type: 'json' };

export interface MissionConfig {
  /** How long the cleared area must be held, seconds. */
  holdSeconds: number;
  /** Whether a dead slot respawns during a mission. */
  respawn: boolean;
}

/** Where a mission stands. The order is the wire encoding. */
export const MISSION_STATES = ['progress', 'complete', 'failed'] as const;
export type MissionStatus = (typeof MISSION_STATES)[number];

/** The mission as the host broadcasts it. Ticks, not seconds: integers round-trip exactly. */
export interface MissionView {
  state: MissionStatus;
  /** No living enemy inside the objective area. */
  clear: boolean;
  /** Ticks the area has been held clear. */
  heldTicks: number;
  /** Ticks it must be held for. */
  holdTicks: number;
  /** Which attempt this is: 1, then one more each restart. */
  attempt: number;
}

export class MissionDataError extends Error {}

export function parseMissionConfig(raw: unknown): MissionConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new MissionDataError('mission: expected an object');
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['$comment', 'holdSeconds', 'respawn'].includes(k)) throw new MissionDataError(`mission: unknown key '${k}'`);
  const hold = o['holdSeconds'];
  if (typeof hold !== 'number' || !Number.isFinite(hold) || hold <= 0 || hold > 3600) throw new MissionDataError(`mission.holdSeconds must be a number in (0, 3600], got ${JSON.stringify(hold)}`);
  if (typeof o['respawn'] !== 'boolean') throw new MissionDataError(`mission.respawn must be true or false, got ${JSON.stringify(o['respawn'])}`);
  return { holdSeconds: hold, respawn: o['respawn'] };
}

export const MISSION: MissionConfig = parseMissionConfig(RAW_MISSION);
