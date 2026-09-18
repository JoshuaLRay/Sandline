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
 */
import { SessionHost, hostBanner, linkFromEnv } from './session/SessionHost.ts';
import { loadConfig } from './config.ts';
import { createLogger } from './log.ts';

const config = loadConfig();
const log = createLogger(config.logLevel);

const link = linkFromEnv();
const host = new SessionHost({ port: config.port, log, link });
const port = await host.start();

log.info('host ready', hostBanner(port, link));

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  // `stats` already carries the tick, plus what the session actually did.
  log.info('shutting down', { signal, ...host.session.stats });
  await host.stop(`host ${signal}`);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
