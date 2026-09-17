/**
 * Clock synchronisation (T-1.10, ADR-012).
 *
 * The client renders remote entities ~100 ms behind server time, so it needs to
 * know what server time *is*. Ping/pong gives round-trip time; half of that,
 * applied to the server's stamp, gives the offset.
 *
 * Uses a rolling MEDIAN, not a mean. A single packet delayed by a burst of
 * jitter skews a mean permanently; the median ignores it. That matters because
 * this offset feeds the interpolation delay, and a bad offset shows up as
 * remote players stuttering.
 */

export interface ClockSample {
  rtt: number;
  offset: number;
}

const DEFAULT_WINDOW = 16;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export class ClockSync {
  private readonly samples: ClockSample[] = [];
  private nextId = 1;
  private readonly pending = new Map<number, number>();

  constructor(private readonly window = DEFAULT_WINDOW) {}

  /** Allocate a ping id and record when it left. */
  beginPing(clientNow: number): { id: number; clientTime: number } {
    const id = this.nextId++;
    this.pending.set(id, clientNow);
    return { id, clientTime: clientNow };
  }

  /**
   * Fold a pong into the estimate. Returns the sample, or null if the id is
   * unknown — a duplicated or very late pong must not be counted twice.
   */
  acceptPong(id: number, serverTime: number, clientNow: number): ClockSample | null {
    const sentAt = this.pending.get(id);
    if (sentAt === undefined) return null;
    this.pending.delete(id);

    const rtt = clientNow - sentAt;
    // Server stamped its time mid-flight, so it is one-way-latency old now.
    const offset = serverTime + rtt / 2 - clientNow;

    const sample = { rtt, offset };
    this.samples.push(sample);
    if (this.samples.length > this.window) this.samples.shift();
    return sample;
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  /** Median round-trip time in ms. */
  get rtt(): number {
    return median(this.samples.map((s) => s.rtt));
  }

  /** Median offset: serverTime ~= clientTime + offset. */
  get offset(): number {
    return median(this.samples.map((s) => s.offset));
  }

  /** Spread of RTT around its median — how unstable the link is. */
  get jitter(): number {
    if (this.samples.length < 2) return 0;
    const m = this.rtt;
    return median(this.samples.map((s) => Math.abs(s.rtt - m)));
  }

  /** Best estimate of server time right now. */
  serverTime(clientNow: number): number {
    return clientNow + this.offset;
  }

  /** Server time to render at, per ADR-012's ~100 ms interpolation delay. */
  renderTime(clientNow: number, interpolationDelayMs = 100): number {
    return this.serverTime(clientNow) - interpolationDelayMs;
  }

  reset(): void {
    this.samples.length = 0;
    this.pending.clear();
  }
}
