/** Environment-derived server config (T-0.07). */
import { DEFAULT_WORLD_ID, WORLD_IDS } from '@sandline/shared';
import { MIN_SECRET_LENGTH, secretsFromEnv } from './identity/Identity.ts';
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
  /**
   * `HOST_AI=1`: rooms get the AI the in-page session has — the world's
   * navmesh and cover, friendly bots that follow, fight and take orders, and
   * on a world with an encounter the mission. Off by default, so a bare
   * `pnpm host` stays the netcode instrument `pnpm bot --url` compares against.
   */
  hostAi: boolean;
  /**
   * `JOIN_KEY`: the shared password a Join must carry. Empty means none, which
   * is what `pnpm host` on a laptop wants. A deployed host sets it as a secret.
   */
  joinKey: string;
  /**
   * T-4.22: `IDENTITY_SECRET`, the keys player-identity tokens are signed
   * with, comma-separated: the first signs, all verify, so a secret can be
   * retired without refusing every player at once. Empty: a random one per
   * process, which is fine on a laptop and wrong on a deployed host, where a
   * restart would then refuse every saved identity.
   */
  identitySecrets: string[];
  /** T-4.23: SQLite campaign/player database path. */
  campaignDbPath: string;
  /** `IDLE_TIMEOUT_MS`: drop a player who has not moved or looked in this long. 0 = never. */
  idleTimeoutMs: number;
  /** `MAX_SESSION_MS`: drop any player connected this long. 0 = never. */
  maxSessionMs: number;
}

/** Ten minutes: long enough for a break between rounds, short enough for a forgotten tab. */
export const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000;
/** Four hours: longer than any playtest, shorter than a weekend of a bot holding the machine up. */
export const DEFAULT_MAX_SESSION_MS = 4 * 60 * 60_000;

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be an integer, got '${raw}'`);
  return n;
}

function nonNegative(name: string, fallback: number): number {
  const n = intFromEnv(name, fallback);
  if (n < 0) throw new Error(`${name} must be 0 (off) or a positive number of ms, got '${n}'`);
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

/** `HOST_AI=1 pnpm host`. As `AI_DEBUG`: unset, empty, `0` or `1`, and anything else a startup error. */
function hostAiFromEnv(): boolean {
  const raw = process.env['HOST_AI'];
  if (raw === undefined || raw === '' || raw === '0') return false;
  if (raw === '1') return true;
  throw new Error(`HOST_AI must be 0 or 1, got '${raw}'`);
}

/** `IDENTITY_SECRET=…`. A short secret is a startup error, not a forgeable host. */
function identitySecretsFromEnv(): string[] {
  const secrets = secretsFromEnv(process.env['IDENTITY_SECRET']);
  if (secrets.some((s) => s.length < MIN_SECRET_LENGTH)) {
    throw new Error(`IDENTITY_SECRET: every secret must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  return secrets;
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
    hostAi: hostAiFromEnv(),
    joinKey: process.env['JOIN_KEY'] ?? '',
    identitySecrets: identitySecretsFromEnv(),
    campaignDbPath: process.env['CAMPAIGN_DB_PATH'] ?? 'sandline.sqlite',
    idleTimeoutMs: nonNegative('IDLE_TIMEOUT_MS', DEFAULT_IDLE_TIMEOUT_MS),
    maxSessionMs: nonNegative('MAX_SESSION_MS', DEFAULT_MAX_SESSION_MS),
  };
}
