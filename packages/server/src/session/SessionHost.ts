/**
 * The session host process (T-1.5.01).
 *
 * WHAT WAS MISSING. Every piece of a real multiplayer session already existed
 * and none of them were joined up. `Session` runs six slots with bot backfill
 * and per-client deltas (T-1.13). `startWsServer` accepts sockets and is tested
 * at eight concurrent connections (T-1.07). `ServerConnection` handshakes,
 * assigns a NetId and a slot, and times out a silent peer (T-1.09). But
 * `main.ts` was still T-0.07's bootstrap — it stepped a bare `Simulation` and
 * never opened a socket — so the dedicated server had never served a session to
 * anything. This class is the missing wire, and it is the whole reason a second
 * human has nowhere to join today (PLAN.md §4.2).
 *
 * NO SIMULATION HERE. T-0.07's bootstrap created a Rapier `Simulation` to prove
 * the physics build loads in Node. `Session` does not use it: movement is
 * `stepCharacter`, which is pure table-trig math (T-1.12), and world collision
 * is still the PARTIAL half of that task. The Rapier load path is covered by
 * T-0.10 and T-0.12 rather than by booting it here and stepping it beside a
 * simulation that ignores it.
 *
 * TIME, AND WHICH CLOCK MEANS WHAT. Two clocks run here and conflating them is
 * the bug this comment exists to prevent:
 *
 *   - SIMULATION time is derived from the tick counter, never read from a
 *     clock. It is what `Session.step` is handed, what hitbox history is
 *     stamped with for lag compensation (T-1.18), and what a client's clock
 *     sync converges on via Pong (T-1.10). Deriving it from the tick is what
 *     keeps a rewind to "120 ms ago" land on the tick that was actually shown.
 *   - WALL time drives the fixed-timestep `Clock` and the link conditioners
 *     below. It is the only thing that reads `performance.now()`.
 *
 * Under a stall the two diverge, and that is correct: `Clock` drops the backlog
 * rather than spiralling (T-0.08), so simulation time falls behind wall time
 * and stays behind. The simulation's story remains internally consistent, which
 * is the property that matters.
 *
 * TESTABILITY. `now` is injectable and the tick timer is optional, so every
 * test below drives the host by hand with no timers and no sockets — the same
 * rule `Session` and `ServerConnection` already follow.
 */
import {
  BaseTransport,
  type Channel,
  Clock,
  MAX_SLOTS,
  NetSim,
  TICK_HZ,
  TICK_SECONDS,
  type Transport,
} from '@sandline/shared';
import { Session } from './Session.ts';
import { type WsServerHandle, startWsServer } from '../net/WsTransport.ts';
import type { Logger } from '../log.ts';

const TICK_MS = TICK_SECONDS * 1000;

/** Link conditions applied to every connection. Dev and test builds only. */
export interface LinkConditions {
  /** One-way latency, applied in BOTH directions — so RTT is roughly twice it. */
  latencyMs: number;
  jitterMs: number;
  lossRate: number;
}

/**
 * Read link conditions from the environment, or `null` for a raw socket.
 *
 * WHY THIS EXISTS. The in-page harness has latency, jitter and loss sliders
 * (T-1.24), and they are the instrument that made the M1 playtest worth
 * running: a tester can feel 200 ms on demand. Moving to a real socket would
 * otherwise throw that instrument away on the first day it stops being a
 * simulation, exactly when a comparison between the modelled link and the real
 * one becomes possible. So the host carries the sliders instead.
 *
 * Unset means unset: an absent variable is a raw socket with no decorator at
 * all, not a decorator configured to zero. A `NetSim` set to zero still queues
 * every packet and waits for a pump, which is a behaviour difference — and the
 * default path should be the one production runs.
 */
export function linkFromEnv(env: NodeJS.ProcessEnv = process.env): LinkConditions | null {
  const num = (name: string): number | null => {
    const raw = env[name];
    if (raw === undefined || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got '${raw}'`);
    return n;
  };
  const latencyMs = num('LINK_LATENCY_MS');
  const jitterMs = num('LINK_JITTER_MS');
  const lossRate = num('LINK_LOSS');
  if (latencyMs === null && jitterMs === null && lossRate === null) return null;
  if (lossRate !== null && lossRate > 1) throw new Error(`LINK_LOSS is a fraction 0..1, got '${lossRate}'`);
  return { latencyMs: latencyMs ?? 0, jitterMs: jitterMs ?? 0, lossRate: lossRate ?? 0 };
}

/** Delivers what a NetSim releases straight into the owning transport. */
class InboundSink extends BaseTransport {
  constructor(private readonly deliver: (data: Uint8Array) => void) {
    super();
  }

  send(data: Uint8Array): void {
    this.deliver(data);
  }
}

/**
 * A real socket with a `NetSim` on each side of it.
 *
 * TWO DIRECTIONS, DELIBERATELY. `NetSim` is a decorator over sends, so one of
 * them conditions only what the server transmits. The project's test matrix
 * (T-1.22) applies `latencyMs` to both directions and calls the result "200 ms"
 * — meaning a ~400 ms round trip. Conditioning one direction here would make
 * the same number mean half as much, and the playtest verdict would not be
 * comparable with the CI cell it is supposed to be checked against.
 *
 * LOSS IS DOWNSTREAM ONLY, AND THAT IS NOT AN OVERSIGHT. `NetSim` drops only
 * `unreliable` traffic, because dropping reliable traffic models a network we
 * never have — TCP would have retransmitted it (ADR-008). The server knows the
 * channel of what it sends. It cannot know the channel of what it receives:
 * both channels map to one TCP socket and the tag does not survive the wire. So
 * inbound gets latency and jitter, which apply to every packet regardless of
 * channel, and not loss, which does not. Upstream loss is covered where the
 * channel is still known — T-1.22's in-process matrix — and input redundancy
 * (T-1.15) is what absorbs it in any case.
 */
class ConditionedTransport extends BaseTransport {
  private readonly outbound: NetSim;
  private readonly inbound: NetSim;

  constructor(
    inner: Transport,
    conditions: LinkConditions,
    seed: number,
    private readonly now: () => number,
  ) {
    super();
    const { latencyMs, jitterMs, lossRate } = conditions;
    this.outbound = new NetSim(inner, { latencyMs, jitterMs, lossRate, seed });
    /**
     * A separate seed per direction, never a shared options object. Sharing one
     * would give both directions the same random stream, so a jitter spike
     * would hit upstream and downstream on the same packet — a link no real
     * network resembles, and a flattering one to reconcile against.
     */
    this.inbound = new NetSim(new InboundSink((data) => this.emitMessage(data)), {
      latencyMs,
      jitterMs,
      seed: seed + 1,
    });
    inner.onMessage((data) => {
      /**
       * Advance the inbound clock to the moment the bytes actually arrived
       * before queuing them. `NetSim` stamps a due time from whenever it was
       * last pumped, and a packet landing between pumps would otherwise be
       * dated as early as the previous one — shaving up to half a tick off its
       * delay. Small, but this decorator is the instrument a tester reads
       * latency off, and an instrument that under-reports is worse than none.
       */
      this.inbound.pump(this.now());
      this.inbound.send(data);
    });
    inner.onClose((reason) => this.close(reason));
  }

  send(data: Uint8Array, channel: Channel = 'reliable'): void {
    if (!this.open) return;
    this.outbound.send(data, channel);
  }

  /**
   * Release everything due at `nowMs`, in both directions. Wall time.
   *
   * OUTBOUND FIRST, AND THE ORDER IS LOAD-BEARING. Delivering an inbound packet
   * runs the session synchronously, which replies — so anything the inbound
   * pump produces is enqueued outbound during this call. If outbound were
   * pumped afterwards, its clock would still read the same instant the reply
   * was stamped with, and every reply to an inbound packet would go out with
   * its latency skipped entirely. The handshake looked instant and the
   * conditioner appeared to work, because only the unprompted traffic —
   * snapshots — was actually being delayed.
   */
  pump(nowMs: number): void {
    this.outbound.pump(nowMs);
    this.inbound.pump(nowMs);
  }

  get inFlight(): number {
    return this.inbound.inFlight + this.outbound.inFlight;
  }

  override close(reason = 'closed'): void {
    if (!this.open) return;
    /**
     * Flush before tearing down. `NetSim.close` discards its queue, and the
     * last thing a closing session sends is the `Disconnect` explaining why
     * (`Session.close`). Dropping it turns "the server said goodbye" into "the
     * connection vanished" — which is what a client's reconnect backoff is
     * for, and which would therefore hide a clean shutdown behind six retries.
     */
    this.outbound.pump(Number.MAX_SAFE_INTEGER);
    super.close(reason);
    this.outbound.close(reason);
    this.inbound.close(reason);
  }
}

export interface SessionHostOptions {
  port: number;
  log: Logger;
  /** Link conditioning for every connection. `null` (default) is a raw socket. */
  link?: LinkConditions | null;
  /** Injected in tests. Defaults to `performance.now()`. */
  now?: () => number;
  /** False drives the tick loop by hand — every test does. Default true. */
  autoTick?: boolean;
}

export class SessionHost {
  readonly session: Session;
  private readonly log: Logger;
  private readonly link: LinkConditions | null;
  private readonly now: () => number;
  private readonly autoTick: boolean;
  private readonly clock = new Clock();
  private readonly conditioned = new Set<ConditionedTransport>();
  private handle: WsServerHandle | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private simTimeMs = 0;
  private lastReal = 0;
  private reportedDrops = 0;
  /** Distinct per connection, so one client's loss pattern is its own. */
  private nextSeed = 0x5eed;

  constructor(private readonly options: SessionHostOptions) {
    this.session = new Session();
    this.log = options.log;
    this.link = options.link ?? null;
    this.now = options.now ?? (() => performance.now());
    this.autoTick = options.autoTick ?? true;
  }

  /** Open the socket and start ticking. Resolves with the bound port. */
  async start(): Promise<number> {
    this.handle = await startWsServer({
      port: this.options.port,
      onConnection: (transport) => this.accept(transport),
    });
    this.lastReal = this.now();
    if (this.autoTick) {
      /**
       * Half a tick period, as T-0.07's loop already ran. Two reasons to poll
       * faster than the tick rate: the accumulator lands nearer the tick
       * boundary, and the conditioners are pumped twice as often, so a packet
       * spends less time sitting in a queue that has already come due —
       * latency the sliders did not ask for and the tester would read as ours.
       */
      this.timer = setInterval(() => this.tickNow(), TICK_MS / 2);
    }
    return this.handle.port;
  }

  /**
   * Attach a transport to the session.
   *
   * Public because it is the seam every test uses: hand it a loopback transport
   * and the entire host — slot assignment, conditioning, heartbeat timeout,
   * shutdown — is exercised with no sockets, no ports and no timing races.
   */
  accept(transport: Transport): void {
    let attached = transport;
    if (this.link) {
      const conditioned = new ConditionedTransport(
        transport,
        this.link,
        (this.nextSeed += 977),
        this.now,
      );
      this.conditioned.add(conditioned);
      conditioned.onClose(() => this.conditioned.delete(conditioned));
      attached = conditioned;
    }
    const conn = this.session.addConnection(attached, this.simTimeMs);
    this.log.info('connection opened', { tick: this.session.tick, conditioned: this.link !== null });
    attached.onClose((reason) =>
      this.log.info('connection closed', { reason, slot: conn.slot, netId: conn.netId }),
    );
  }

  /**
   * Advance wall time: pump the wire, then run whatever ticks came due.
   *
   * Pumped on BOTH sides of the step, as the in-page harness does. Pumping only
   * before would leave every snapshot the step just produced sitting in a queue
   * until the next call — half a tick of latency, invisible, and charged to the
   * netcode rather than to this loop.
   */
  tickNow(): void {
    const real = this.now();
    for (const c of this.conditioned) c.pump(real);

    /**
     * Note what this makes the heartbeat timeout measure: SIMULATION time, not
     * wall time, because that is the clock `Session.step` hands each
     * connection. Under a stall the two diverge and clients get proportionally
     * longer to answer. That is the behaviour worth having — a host that GC'd
     * for six seconds should not come back and drop every player for going
     * quiet during it.
     */
    const steps = this.clock.advance((real - this.lastReal) / 1000);
    this.lastReal = real;
    for (let i = 0; i < steps; i++) {
      this.simTimeMs += TICK_MS;
      this.session.step(this.simTimeMs);
    }

    if (steps > 0) for (const c of this.conditioned) c.pump(real);

    if (this.clock.dropped > this.reportedDrops) {
      this.log.warn('tick backlog dropped', {
        dropped: this.clock.dropped - this.reportedDrops,
        tick: this.session.tick,
      });
      this.reportedDrops = this.clock.dropped;
    }
  }

  /** Simulation time at the newest tick, in ms. The session's own clock. */
  get serverTimeMs(): number {
    return this.simTimeMs;
  }

  get port(): number | null {
    return this.handle?.port ?? null;
  }

  /**
   * Say goodbye, then close.
   *
   * `Session.close` sends every connection a `Disconnect` carrying the reason,
   * which is the difference between a client showing "the host shut down" and a
   * client silently retrying a server that is never coming back. It happens
   * before the listening socket closes, because after that there is nothing to
   * send it down.
   */
  async stop(reason = 'host shutting down'): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.session.close(reason);
    await this.handle?.close();
    this.handle = null;
  }
}

/** One line describing what a host is serving, for the boot log. */
export function hostBanner(port: number, link: LinkConditions | null): Record<string, unknown> {
  return {
    port,
    tickHz: TICK_HZ,
    slots: MAX_SLOTS,
    link: link
      ? `${link.latencyMs}ms +/-${link.jitterMs}ms, ${(link.lossRate * 100).toFixed(0)}% loss (each way)`
      : 'raw socket',
  };
}
