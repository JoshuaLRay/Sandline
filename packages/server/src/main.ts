/**
 * Server entrypoint (T-0.07).
 *
 * Boots the shared simulation headlessly and runs the authoritative tick loop
 * (ADR-012). Transport lands in M1 (T-1.07); this proves the simulation runs in
 * Node, which is the property the whole architecture depends on.
 */
import { Clock, Simulation, TICK_SECONDS } from '@sandline/shared';
import { loadConfig } from './config.ts';
import { createLogger } from './log.ts';

const config = loadConfig();
const log = createLogger(config.logLevel);

const sim = await Simulation.create();
for (let slot = 0; slot < 6; slot++) {
  sim.spawnActor({ x: slot * 1.5 - 3.75, y: 2, z: 0 });
}

const clock = new Clock();
let last = performance.now();
let running = true;

log.info('server ready', {
  port: config.port,
  tickHz: config.tickHz,
  slots: 6,
  entities: sim.snapshot().entities.length,
});

const timer = setInterval(() => {
  if (!running) return;
  const now = performance.now();
  const steps = clock.advance((now - last) / 1000);
  last = now;
  for (let i = 0; i < steps; i++) sim.step();
  if (clock.dropped > 0) {
    log.warn('tick backlog dropped', { dropped: clock.dropped, tick: clock.tick });
  }
}, (TICK_SECONDS * 1000) / 2);

function shutdown(signal: string): void {
  if (!running) return;
  running = false;
  log.info('shutting down', { signal, tick: clock.tick });
  clearInterval(timer);
  sim.dispose();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
