/** Environment-derived server config (T-0.07). */
import { DEFAULT_WORLD_ID, WORLD_IDS } from '@sandline/shared';
import { DEFAULT_MAX_ROOMS, DEFAULT_ROOM_GRACE_MS } from './session/Registry.ts';

export interface ServerConfig {
  port: number;
  tickHz: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Rooms this process will hold at once (T-1.5.05). */
  maxRooms: number;
  /** How long an emptied room lives before it is reclaimed, ms. */
  roomGraceMs: number;
  /** The named world every room on this host is built with (T-3.02). */
  world: string;
  /** T-3.09: `AI_DEBUG=1` lets clients ask for AI debug reports. */
  aiDebug: boolean;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be an integer, got '${raw}'`);
  return n;
}

/** `WORLD=range pnpm host`. An id this build lacks is a startup error, not a room of nothing. */
function worldFromEnv(): string {
  const raw = process.env['WORLD'];
  if (raw === undefined || raw === '') return DEFAULT_WORLD_ID;
  if (!WORLD_IDS.includes(raw)) throw new Error(`WORLD must be one of ${WORLD_IDS.join('|')}, got '${raw}'`);
  return raw;
}

/** `AI_DEBUG=1 pnpm host`. Anything but unset, empty, `0` or `1` is a startup error. */
function aiDebugFromEnv(): boolean {
  const raw = process.env['AI_DEBUG'];
  if (raw === undefined || raw === '' || raw === '0') return false;
  if (raw === '1') return true;
  throw new Error(`AI_DEBUG must be 0 or 1, got '${raw}'`);
}

export function loadConfig(): ServerConfig {
  const level = process.env['LOG_LEVEL'] ?? 'info';
  if (!['debug', 'info', 'warn', 'error'].includes(level)) {
    throw new Error(`LOG_LEVEL must be debug|info|warn|error, got '${level}'`);
  }
  return {
    port: intFromEnv('PORT', 8080),
    tickHz: intFromEnv('TICK_HZ', 30),
    logLevel: level as ServerConfig['logLevel'],
    maxRooms: intFromEnv('MAX_ROOMS', DEFAULT_MAX_ROOMS),
    roomGraceMs: intFromEnv('ROOM_GRACE_MS', DEFAULT_ROOM_GRACE_MS),
    world: worldFromEnv(),
    aiDebug: aiDebugFromEnv(),
  };
}
