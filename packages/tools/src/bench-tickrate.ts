/**
 * Measures the real cost of the authoritative tick at 30 vs 60 Hz (ADR-012).
 *
 * Not just physics: the whole tick — character stepping, snapshot build, delta
 * encode against each client's baseline, and message encode. That is what
 * actually scales with tick rate.
 *
 * Run: pnpm bench:tickrate
 */
import { createLoopbackPair, encodeMessage, PROTOCOL_VERSION } from '@sandline/shared';
import { Session } from '@sandline/server';

const SECONDS = 20;
const PLAYERS = 6;

function buildSession(): Session {
  const session = new Session();
  for (let i = 0; i < PLAYERS; i++) {
    const pair = createLoopbackPair();
    session.addConnection(pair.a, 0);
    pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: `p${i}`, room: '' }));
    pair.pump();
    // Everyone moving: the worst realistic case for delta size.
    pair.b.send(
      encodeMessage({ kind: 'Input', tick: 1, moveX: 1, moveY: 1, yaw: i * 100, pitch: 0, buttons: 0 }),
    );
    pair.pump();
  }
  return session;
}

interface Result {
  hz: number;
  ticks: number;
  cpuMs: number;
  usPerTick: number;
  budgetUs: number;
  bytesPerSecPerPlayer: number;
}

function run(hz: number, sendEvery: number): Result {
  const session = buildSession();
  const ticks = hz * SECONDS;
  const stepMs = 1000 / hz;

  const t0 = performance.now();
  for (let i = 1; i <= ticks; i++) session.step(i * stepMs);
  const cpuMs = performance.now() - t0;

  const stats = session.stats;
  return {
    hz,
    ticks,
    cpuMs,
    usPerTick: (cpuMs / ticks) * 1000,
    budgetUs: (1000 / hz) * 1000,
    bytesPerSecPerPlayer: stats.bytesSent / SECONDS / PLAYERS / sendEvery,
  };
}

// Warm the JIT first, then alternate and take the best of several runs.
// Without this the first rate measured absorbs compilation cost and looks
// twice as expensive as it is - which is exactly backwards.
for (let i = 0; i < 3; i++) {
  run(30, 1);
  run(60, 1);
}
const best = (hz: number): Result => {
  let bestRun = run(hz, 1);
  for (let i = 0; i < 4; i++) {
    const r = run(hz, 1);
    if (r.usPerTick < bestRun.usPerTick) bestRun = r;
  }
  return bestRun;
};
const rows = [best(30), best(60)];

console.log(`${PLAYERS} players, all moving, ${SECONDS}s of simulation\n`);
console.log('  rate     cpu/tick   tick budget   % budget   down/player');
for (const r of rows) {
  console.log(
    `  ${String(r.hz).padStart(2)}Hz    ${r.usPerTick.toFixed(1).padStart(7)} us   ` +
      `${r.budgetUs.toFixed(0).padStart(6)} us   ${((r.usPerTick / r.budgetUs) * 100).toFixed(2).padStart(7)}%   ` +
      `${(r.bytesPerSecPerPlayer / 1024).toFixed(1).padStart(6)} KB/s`,
  );
}

const [a, b] = rows as [Result, Result];
console.log(`\n  60Hz costs ${(b.cpuMs / a.cpuMs).toFixed(2)}x the CPU of 30Hz`);
console.log(`  60Hz costs ${(b.bytesPerSecPerPlayer / a.bytesPerSecPerPlayer).toFixed(2)}x the bandwidth of 30Hz`);
console.log(`\n  ADR-012 bandwidth budget: 18 KB/s per player, review above 40 KB/s.`);
console.log(`  Input sampling latency: 30Hz = ${(1000 / 30).toFixed(1)}ms worst case, 60Hz = ${(1000 / 60).toFixed(1)}ms`);

// The session currently holds only the 6 squad slots. A real firefight is
// 6 players + ~40 AI, so project the bandwidth that actually matters.
const REAL_ENTITIES = 46;
const SLOT_ENTITIES = 6;
const scale = REAL_ENTITIES / SLOT_ENTITIES;
console.log(`\n  Projected at ${REAL_ENTITIES} entities (6 players + 40 AI), the real M3 case:`);
for (const r of rows) {
  const kb = (r.bytesPerSecPerPlayer * scale) / 1024;
  console.log(`    ${String(r.hz).padStart(2)}Hz  ${kb.toFixed(1).padStart(5)} KB/s per player  ${kb <= 18 ? 'within budget' : kb <= 40 ? 'over target, under review line' : 'EXCEEDS review line'}`);
}
export {};
