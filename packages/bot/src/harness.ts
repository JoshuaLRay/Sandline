/**
 * Deterministic multi-bot test harness (T-1.20, T-1.22).
 *
 * Wires N bots to one authoritative session through NetSim, and drives
 * everything from a virtual clock. Nothing here reads wall time, so a run is
 * reproducible: a failure at 200ms/20% loss fails the same way next time,
 * which is the whole reason this is worth building.
 */
import {
  NetSim,
  type NetSimOptions,
  createLoopbackPair,
  TICK_SECONDS,
} from '@sandline/shared';
import { Session } from '@sandline/server';
import { BotClient, type BotMetrics } from './BotClient.ts';

export interface ScenarioOptions {
  bots: number;
  ticks: number;
  latencyMs?: number;
  jitterMs?: number;
  lossRate?: number;
  seed?: number;
}

export interface ScenarioResult {
  bots: number;
  ticks: number;
  latencyMs: number;
  lossRate: number;
  /** Worst prediction divergence across all bots, in metres. */
  peakDivergence: number;
  /** Highest per-bot fraction of reconciles needing a correction. */
  worstCorrectionRate: number;
  /** Lowest per-bot count of snapshots successfully applied. */
  minSnapshotsApplied: number;
  totalMissedBaselines: number;
  /**
   * Reconciles that could not match the acknowledged tick, summed. A
   * STRUCTURAL number, not a statistical one: matching either works or it does
   * not, so anything above zero means reconciliation is broken rather than
   * merely stressed.
   */
  totalUnmatched: number;
  /** Highest per-bot correction rate counted from `result.corrected`. */
  worstTrueCorrectionRate: number;
  allJoined: boolean;
  perBot: BotMetrics[];
}

export function runScenario(options: ScenarioOptions): ScenarioResult {
  const { bots: botCount, ticks, latencyMs = 0, jitterMs = 0, lossRate = 0, seed = 1 } = options;

  const session = new Session();
  const bots: BotClient[] = [];
  const sims: NetSim[] = [];
  const pumps: (() => void)[] = [];

  for (let i = 0; i < botCount; i++) {
    const pair = createLoopbackPair();
    const netOpts: NetSimOptions = { latencyMs, jitterMs, lossRate, seed: seed + i * 977 };

    // Both directions get the same conditions: a real link is symmetric, and
    // only delaying one way would flatter the reconciliation numbers.
    const serverSide = new NetSim(pair.a, netOpts);
    const clientSide = new NetSim(pair.b, { ...netOpts, seed: seed + i * 977 + 13 });

    session.addConnection(serverSide, 0);
    const bot = new BotClient(clientSide, { name: `bot${i}`, seed: seed + i });
    bot.join();

    bots.push(bot);
    sims.push(serverSide, clientSide);
    pumps.push(() => pair.settle());
  }

  const stepMs = TICK_SECONDS * 1000;
  // Let the handshake land before ticking; at high latency it is still in flight.
  for (let warm = 0; warm < 40; warm++) {
    const now = warm * stepMs;
    for (const s of sims) s.pump(now);
    for (const p of pumps) p();
  }

  for (let tick = 1; tick <= ticks; tick++) {
    const now = (40 + tick) * stepMs;
    for (const bot of bots) bot.tick();
    for (const s of sims) s.pump(now);
    for (const p of pumps) p();
    session.step(now);
    for (const s of sims) s.pump(now);
    for (const p of pumps) p();
  }

  // Drain anything still in flight so the final numbers are complete.
  for (let drain = 1; drain <= 60; drain++) {
    const now = (40 + ticks + drain) * stepMs;
    for (const s of sims) s.pump(now);
    for (const p of pumps) p();
  }

  const perBot = bots.map((b) => b.metrics);
  return {
    bots: botCount,
    ticks,
    latencyMs,
    lossRate,
    peakDivergence: Math.max(...perBot.map((m) => m.peakDivergence)),
    worstCorrectionRate: Math.max(...bots.map((b) => b.correctionRate)),
    minSnapshotsApplied: Math.min(...perBot.map((m) => m.snapshotsApplied)),
    totalMissedBaselines: perBot.reduce((n, m) => n + m.missedBaselines, 0),
    totalUnmatched: perBot.reduce((n, m) => n + m.unmatched, 0),
    worstTrueCorrectionRate: Math.max(
      ...perBot.map((m) => (m.reconciles === 0 ? 0 : m.trueCorrections / m.reconciles)),
    ),
    allJoined: perBot.every((m) => m.joined),
    perBot,
  };
}

export function formatRow(r: ScenarioResult): string {
  return (
    `  ${String(r.bots).padStart(2)} bots  ` +
    `${String(r.latencyMs).padStart(3)}ms  ` +
    `${String(Math.round(r.lossRate * 100)).padStart(2)}% loss  |  ` +
    `peak ${r.peakDivergence.toFixed(4).padStart(8)} m  ` +
    `corrections ${(r.worstCorrectionRate * 100).toFixed(1).padStart(5)}%  ` +
    `snapshots ${String(r.minSnapshotsApplied).padStart(4)}`
  );
}
