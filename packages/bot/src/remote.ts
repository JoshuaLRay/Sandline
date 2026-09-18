/**
 * Bots against a real host over a real socket (T-1.5.01).
 *
 * WHY THIS IS NOT `runScenario`. The in-process harness owns every clock in the
 * system: it steps the session, pumps the wire and ticks the bots in a fixed
 * order off a virtual clock, which is what makes a failure at 200 ms / 20% loss
 * reproduce exactly. None of that survives a socket. The host is a separate
 * process ticking on its own wall clock, nothing here can pump it, and delivery
 * order is the operating system's business. So this is a second runner rather
 * than an option on the first — pretending otherwise would have meant
 * loosening the deterministic one until it could accommodate a
 * non-deterministic case, and the deterministic one is the CI gate (T-1.22).
 *
 * WHAT IT IS FOR. Exactly one thing: running the same bots, the same
 * prediction, the same reconciliation and the same aggregation (`summarize`)
 * across a wire, so the numbers can be held up against the in-process ones. A
 * difference between them is the finding. They should match, because nothing in
 * the netcode is supposed to know which transport it is on — and if they do
 * not, something was depending on the loopback pair.
 */
import { BaseTransport, type Channel, TICK_SECONDS } from '@sandline/shared';
import { BotClient } from './BotClient.ts';
import { type ScenarioResult, summarize } from './harness.ts';

/**
 * A client socket, using Node's own global `WebSocket` (Node 22+).
 *
 * Deliberately NOT the client's `WsClientTransport`: that reconnects with
 * exponential backoff, which is right for a player and wrong for a measurement.
 * A bot whose connection drops mid-run and silently comes back reports a clean
 * sheet for a run that was not clean — and "the host died and both bots
 * reported it" is one of the things this runner has to be able to show.
 */
class SocketTransport extends BaseTransport {
  private readonly socket: WebSocket;

  constructor(url: string) {
    super();
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    // Event types are inferred from Node's own global WebSocket (Node 22+);
    // annotating them would pull in DOM lib types this package does not have.
    socket.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) this.emitMessage(new Uint8Array(ev.data));
    };
    socket.onclose = (ev) => super.close(ev.reason || `socket closed (${ev.code})`);
    socket.onerror = () => super.close('socket error');
    this.socket = socket;
  }

  /** Resolves when the socket is usable, rejects if it closes first. */
  opened(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve(), { once: true });
      this.socket.addEventListener(
        'close',
        () => reject(new Error(`could not connect to ${this.socket.url}`)),
        { once: true },
      );
    });
  }

  send(data: Uint8Array, _channel: Channel = 'reliable'): void {
    if (!this.isOpen || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(data);
  }

  override close(reason = 'closed'): void {
    if (!this.isOpen) return;
    super.close(reason);
    this.socket.close();
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)));

export interface RemoteScenarioOptions {
  url: string;
  bots: number;
  ticks: number;
  seed?: number;
  /** Ms to wait for every bot's JoinAck before giving up. */
  joinTimeoutMs?: number;
  /** Ms to keep receiving after the last input, so in-flight deltas land. */
  drainMs?: number;
}

export interface RemoteScenarioResult extends ScenarioResult {
  /** Wall-clock seconds the tick loop actually took. */
  elapsedSeconds: number;
  /**
   * Ticks actually driven. Short of `ticks` means the run was cut off — the
   * host went away — and the numbers describe a fragment, not a run.
   */
  completedTicks: number;
  /** Why the run stopped early, or null if it ran to the end. */
  endedEarly: string | null;
  /**
   * Worst lateness of a bot tick against its nominal 30 Hz schedule, in ms.
   *
   * Reported because it is the one number that can make a remote run look worse
   * than the netcode is. A bot that misses its slot by 40 ms did not send an
   * input the server was expecting, and the server holds that character still
   * for a tick rather than guessing (ADR-012 addendum) — which shows up as
   * divergence that belongs to this runner's scheduling, not to prediction.
   */
  peakTickLatenessMs: number;
}

/** Connect `bots` clients to `url`, drive them for `ticks`, and report. */
export async function runRemoteScenario(
  options: RemoteScenarioOptions,
): Promise<RemoteScenarioResult> {
  const { url, bots: botCount, ticks, seed = 1, joinTimeoutMs = 5000, drainMs = 500 } = options;

  const transports: SocketTransport[] = [];
  const clients: BotClient[] = [];
  try {
    for (let i = 0; i < botCount; i++) {
      const transport = new SocketTransport(url);
      transports.push(transport);
      await transport.opened();
      clients.push(new BotClient(transport, { name: `bot${i}`, seed: seed + i }));
    }

    for (const bot of clients) bot.join();
    const joinDeadline = performance.now() + joinTimeoutMs;
    while (!clients.every((b) => b.joined) && performance.now() < joinDeadline) await sleep(5);

    /**
     * Tick against an absolute schedule, never `sleep(33)` in a loop.
     *
     * Sleeping a fixed amount accumulates every scheduling overshoot, so the
     * bots drift slower than 30 Hz for the whole run and the server's input
     * queue starves a little more with each tick. Anchoring each tick to
     * `start + n x period` means an overshoot is repaid by the next one instead
     * of compounding.
     */
    const periodMs = TICK_SECONDS * 1000;
    const start = performance.now();
    let peakTickLatenessMs = 0;
    let completedTicks = 0;
    let endedEarly: string | null = null;
    for (let tick = 1; tick <= ticks; tick++) {
      const due = start + tick * periodMs;
      await sleep(due - performance.now());

      /**
       * Stop the moment the host goes away, and say so.
       *
       * Ticking on into a closed socket costs the rest of the run in wall
       * clock and, worse, ends with a summary that passes: divergence and
       * correction counts are frozen at whatever they were when the host
       * died, which is a short clean run by construction. A measurement tool
       * that reports OK for a run it did not finish is worse than no tool.
       */
      const lost = clients.find((b) => b.metrics.disconnectReason);
      if (lost) {
        endedEarly = lost.metrics.disconnectReason;
        break;
      }

      const lateness = performance.now() - due;
      if (lateness > peakTickLatenessMs) peakTickLatenessMs = lateness;
      for (const bot of clients) bot.tick();
      completedTicks = tick;
    }
    const elapsedSeconds = (performance.now() - start) / 1000;

    // Let the last round of deltas and acks land before reading the metrics,
    // or the final reconciles are missing and the numbers flatter the run.
    await sleep(drainMs);

    return {
      ...summarize(clients, { bots: botCount, ticks: completedTicks, latencyMs: 0, lossRate: 0 }),
      elapsedSeconds,
      completedTicks,
      endedEarly,
      peakTickLatenessMs,
    };
  } finally {
    for (const t of transports) t.close('run finished');
  }
}
