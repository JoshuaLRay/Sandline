/**
 * Server entrypoint (T-1.5.01, replacing T-0.07's bootstrap).
 *
 * T-0.07 proved the shared simulation runs headless in Node, which is the
 * property the whole architecture depends on, and left transport to M1. M1
 * built the transport and never connected it to this file: the result was a
 * server binary that stepped a physics world nobody could reach. This boots a
 * `SessionHost` instead — the authoritative session (ADR-012) on a real socket
 * (ADR-008), which is what a second human needs in order to have anywhere to
 * join (PLAN.md §4.2).
 *
 * Link conditioning comes from the environment rather than a flag so a deployed
 * host can be given it without redeploying an argument list:
 *
 *   pnpm host
 *   LINK_LATENCY_MS=100 LINK_JITTER_MS=20 LINK_LOSS=0.05 pnpm host
 *   MAX_ROOMS=4 ROOM_GRACE_MS=60000 pnpm host      # T-1.5.05: rooms per process, reclaim grace
 *   AI_DEBUG=1 pnpm host                           # T-3.09: clients may ask for AI debug reports
 *   JOIN_KEY=hunter2 pnpm host                     # every Join must carry this key
 *   IDENTITY_SECRET=<32+ chars> pnpm host          # T-4.22: player IDs survive a restart
 *   CAMPAIGN_DB_PATH=/path/to/sandline.sqlite pnpm host   # T-4.23: campaign/player SQLite file
 *   IDLE_TIMEOUT_MS=600000 MAX_SESSION_MS=14400000 pnpm host   # per-player limits; 0 turns one off
 */
import { Identity } from './identity/Identity.ts';
import { CampaignDatabase, SqlitePlayerDirectory } from './persistence/index.ts';
import { SessionHost, hostBanner, linkFromEnv } from './session/SessionHost.ts';
import { loadConfig } from './config.ts';
import { createLogger } from './log.ts';

const config = loadConfig();
const log = createLogger(config.logLevel);
const campaigns = new CampaignDatabase(config.campaignDbPath);
const identity = new Identity({
  secrets: config.identitySecrets,
  directory: new SqlitePlayerDirectory(campaigns),
});

const link = linkFromEnv();
const host = new SessionHost({
  port: config.port,
  log,
  link,
  joinKey: config.joinKey,
  identity,
  campaigns,
  registry: {
    maxRooms: config.maxRooms,
    graceMs: config.roomGraceMs,
    world: config.world,
    aiDebug: config.aiDebug,
    ai: config.hostAi,
    idleTimeoutMs: config.idleTimeoutMs,
    maxSessionMs: config.maxSessionMs,
  },
});
const port = await host.start();

log.info('host ready', {
  ...hostBanner(port, link),
  maxRooms: config.maxRooms,
  roomGraceMs: config.roomGraceMs,
  world: config.world,
  aiDebug: config.aiDebug,
  hostAi: config.hostAi,
  campaignDb: config.campaignDbPath,
  // Never the key itself: the log is not a secret store.
  joinKey: config.joinKey === '' ? 'none - anyone with the address can join' : 'required',
  // Never the secret either. Random means every saved identity dies with this process.
  identitySecret: config.identitySecrets.length === 0 ? 'random - identities do not survive a restart' : `${config.identitySecrets.length} configured`,
  idleTimeoutMs: config.idleTimeoutMs,
  maxSessionMs: config.maxSessionMs,
  health: `http://localhost:${port}/healthz`,
});

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  // `stats` already carries the tick, plus what the session actually did.
  log.info('shutting down', { signal, ...host.registry.stats });
  await host.stop(`host ${signal}`);
  campaigns.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
