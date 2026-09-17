/**
 * Network condition simulator (T-1.21, ADR-008).
 *
 * A transport decorator injecting latency, jitter, packet loss and duplication.
 *
 * Deliberately driven by an explicit clock rather than setTimeout. Timer-driven
 * simulation makes every test that uses it flaky and non-reproducible, which is
 * the last thing a netcode test suite needs; here, `pump(nowMs)` delivers
 * exactly what is due, and a seeded PRNG makes loss patterns repeatable. A test
 * that fails can be re-run and will fail the same way.
 *
 * Dev and test builds only.
 */
import { Sfc32 } from '../math/prng.ts';
import { BaseTransport, type Channel, type Transport } from './Transport.ts';

export interface NetSimOptions {
  /** One-way latency in milliseconds. */
  latencyMs?: number;
  /** Uniform +/- jitter around the latency. */
  jitterMs?: number;
  /** Fraction of packets dropped, 0..1. */
  lossRate?: number;
  /** Fraction of packets delivered twice, 0..1. */
  duplicateRate?: number;
  seed?: number;
}

interface InFlight {
  data: Uint8Array;
  dueAt: number;
  /** Monotonic, so equal due times keep a stable order. */
  seq: number;
}

export interface NetSimStats {
  sent: number;
  dropped: number;
  duplicated: number;
  delivered: number;
}

export class NetSim extends BaseTransport {
  private readonly rng: Sfc32;
  private readonly queue: InFlight[] = [];
  private seq = 0;
  private now = 0;
  readonly stats: NetSimStats = { sent: 0, dropped: 0, duplicated: 0, delivered: 0 };

  constructor(
    private readonly inner: Transport,
    private readonly options: NetSimOptions = {},
  ) {
    super();
    this.rng = new Sfc32(options.seed ?? 1);
    inner.onClose((reason) => this.close(reason));
  }

  /** Queue an outbound datagram, applying loss and duplication now. */
  send(data: Uint8Array, channel: Channel = 'reliable'): void {
    if (!this.open) return;
    this.stats.sent++;

    const { lossRate = 0, duplicateRate = 0 } = this.options;

    // Reliable traffic is not dropped: TCP would have retransmitted it.
    // Modelling loss on a reliable channel would test a network we never have.
    if (channel === 'unreliable' && lossRate > 0 && this.rng.next() < lossRate) {
      this.stats.dropped++;
      return;
    }

    this.enqueue(data, channel);
    if (duplicateRate > 0 && this.rng.next() < duplicateRate) {
      this.stats.duplicated++;
      this.enqueue(data, channel);
    }
  }

  private enqueue(data: Uint8Array, channel: Channel): void {
    const { latencyMs = 0, jitterMs = 0 } = this.options;
    const jitter = jitterMs > 0 ? (this.rng.next() * 2 - 1) * jitterMs : 0;
    const delay = Math.max(0, latencyMs + jitter);
    this.queue.push({ data, dueAt: this.now + delay, seq: this.seq++ });
    void channel;
  }

  /**
   * Advance to `nowMs` and hand everything due to the inner transport.
   * Returns how many datagrams were delivered.
   */
  pump(nowMs: number): number {
    this.now = nowMs;
    const due = this.queue.filter((p) => p.dueAt <= nowMs);
    if (due.length === 0) return 0;

    // Sort by due time, then sequence. Jitter genuinely reorders packets, which
    // is exactly the behaviour code must not assume away.
    due.sort((x, y) => x.dueAt - y.dueAt || x.seq - y.seq);
    for (const p of due) {
      const idx = this.queue.indexOf(p);
      if (idx >= 0) this.queue.splice(idx, 1);
      this.inner.send(p.data);
      this.stats.delivered++;
    }
    return due.length;
  }

  /** Datagrams still in flight. */
  get inFlight(): number {
    return this.queue.length;
  }

  override onMessage(handler: (data: Uint8Array) => void): void {
    this.inner.onMessage(handler);
  }

  override close(reason = 'closed'): void {
    if (!this.open) return;
    this.queue.length = 0;
    super.close(reason);
    if (this.inner.isOpen) this.inner.close(reason);
  }
}
