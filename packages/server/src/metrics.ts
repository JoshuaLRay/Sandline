/**
 * Host metrics (T-4.33): what each host exports for a dashboard to draw and
 * an alert to watch — tick time and the AI's share of it, players, rooms
 * and bytes, reconnects and refusals by code — in the Prometheus text
 * exposition, hand-rolled. Three metric kinds are enough: a counter, a
 * gauge and one histogram. No dependency, because the whole of what a
 * scraper needs is a few hundred bytes of text, and a library would be
 * the only reason to think about it again.
 *
 * `HostMetrics` keeps what only the host can count as it happens — every
 * tick's wall time, every refusal — and is HANDED the rest at render time:
 * the registry's gauges and every live room's `SessionStats`. Counters
 * that live on a room (bytes sent, seatings, the AI's time) are summed over
 * the live rooms plus a running total of the rooms already reclaimed
 * (`retire`), so a counter never goes down when a room does. Room codes
 * never appear: neither as a label nor in a value.
 *
 * The endpoint is `/metrics` on the host's port (`SessionHost.serveHttp`);
 * Fly scrapes it into its managed Prometheus (`[metrics]` in `fly.toml`) and
 * `docs/observability/` holds the dashboard and the alert rules.
 */
import { type DisconnectCode, PROTOCOL_VERSION, TICK_SECONDS } from '@sandline/shared';
import type { SessionStats } from './session/Session.ts';

/** Tick wall-time histogram buckets, seconds: a 30 Hz tick has 33.3 ms, and the last buckets are the overruns. */
export const TICK_BUCKETS_SECONDS: readonly number[] = [0.001, 0.002, 0.005, 0.01, 0.016, 0.025, TICK_SECONDS, 0.05, 0.1, 0.25];

/** What the registry and the process know at scrape time. */
export interface HostGauges {
  rooms: number;
  maxRooms: number;
  /** Rooms with nobody in them, waiting out the grace. */
  idleRooms: number;
  players: number;
  connections: number;
  maxConnections: number;
  /** Ticks the host's clock dropped under a stall (`Clock.dropped`). */
  droppedTicks: number;
  rssBytes: number;
  draining: boolean;
}

/** The counters a room carries, as they are folded into the host's totals. */
interface RoomTotals {
  bytesSent: number;
  snapshotsSent: number;
  joins: number;
  resumes: number;
  aiMs: number;
}

const ZERO: RoomTotals = { bytesSent: 0, snapshotsSent: 0, joins: 0, resumes: 0, aiMs: 0 };

function totalsOf(stats: readonly SessionStats[], base: RoomTotals): RoomTotals {
  const out = { ...base };
  for (const s of stats) {
    out.bytesSent += s.bytesSent;
    out.snapshotsSent += s.snapshotsSent;
    out.joins += s.joins;
    out.resumes += s.resumes;
    out.aiMs += s.aiMs;
  }
  return out;
}

/** A label value as the exposition wants it: backslash, quote and newline escaped. */
function labelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** A number as Prometheus reads it: finite decimal, `+Inf` for the histogram's last bucket. */
function num(v: number): string {
  if (v === Number.POSITIVE_INFINITY) return '+Inf';
  if (!Number.isFinite(v)) return '0';
  return Number.isInteger(v) ? String(v) : v.toPrecision(12).replace(/\.?0+$/, '');
}

export class HostMetrics {
  private readonly tickBucketCounts: number[] = TICK_BUCKETS_SECONDS.map(() => 0);
  private tickCount = 0;
  private tickSumSeconds = 0;
  private tickOverruns = 0;
  private readonly refusals = new Map<DisconnectCode, number>();
  private retired: RoomTotals = { ...ZERO };

  /** One host tick: how long the step took on the wall clock, in ms. Over a tick period is an overrun. */
  observeTick(wallMs: number): void {
    const seconds = Math.max(0, wallMs) / 1000;
    this.tickCount += 1;
    this.tickSumSeconds += seconds;
    TICK_BUCKETS_SECONDS.forEach((edge, i) => {
      if (seconds <= edge) this.tickBucketCounts[i] = (this.tickBucketCounts[i] ?? 0) + 1;
    });
    if (seconds > TICK_SECONDS) this.tickOverruns += 1;
  }

  /** A connection refused or dropped with a typed code (T-1.5.04). */
  countRefusal(code: DisconnectCode): void {
    this.refusals.set(code, (this.refusals.get(code) ?? 0) + 1);
  }

  /** A room reclaimed: what it counted stays counted. */
  retire(stats: SessionStats): void {
    this.retired = totalsOf([stats], this.retired);
  }

  /** How many ticks have been observed, for tests. */
  get ticks(): number {
    return this.tickCount;
  }

  /** The exposition: every metric, HELP and TYPE lines first, as a scraper expects. */
  render(gauges: HostGauges, rooms: readonly SessionStats[]): string {
    const totals = totalsOf(rooms, this.retired);
    const lines: string[] = [];
    const metric = (name: string, help: string, type: 'counter' | 'gauge' | 'histogram', samples: readonly [string, number][]): void => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
      for (const [labels, value] of samples) lines.push(`${name}${labels} ${num(value)}`);
    };
    metric('sandline_info', 'The build serving: protocol version, and whether the host is draining.', 'gauge', [[`{protocol="${PROTOCOL_VERSION}",draining="${gauges.draining ? 'yes' : 'no'}"}`, 1]]);
    metric('sandline_rooms', 'Rooms this host holds right now.', 'gauge', [['', gauges.rooms]]);
    metric('sandline_rooms_max', 'Rooms this host will hold at once.', 'gauge', [['', gauges.maxRooms]]);
    metric('sandline_rooms_idle', 'Rooms with nobody in them, waiting out the reclaim grace.', 'gauge', [['', gauges.idleRooms]]);
    metric('sandline_players', 'Humans seated, over every room.', 'gauge', [['', gauges.players]]);
    metric('sandline_connections', 'Sockets held, seated or handshaking.', 'gauge', [['', gauges.connections]]);
    metric('sandline_connections_max', 'Sockets this host will hold at once.', 'gauge', [['', gauges.maxConnections]]);
    metric('sandline_process_rss_bytes', 'Resident memory of the host process.', 'gauge', [['', gauges.rssBytes]]);

    const buckets: [string, number][] = TICK_BUCKETS_SECONDS.map((edge, i) => [`{le="${num(edge)}"}`, this.tickBucketCounts[i] ?? 0] as [string, number]);
    buckets.push(['{le="+Inf"}', this.tickCount]);
    lines.push('# HELP sandline_tick_seconds Wall time of one host tick: every room stepped and every snapshot sent.', '# TYPE sandline_tick_seconds histogram');
    for (const [labels, value] of buckets) lines.push(`sandline_tick_seconds_bucket${labels} ${num(value)}`);
    lines.push(`sandline_tick_seconds_sum ${num(this.tickSumSeconds)}`, `sandline_tick_seconds_count ${num(this.tickCount)}`);
    metric('sandline_tick_overruns_total', `Ticks whose wall time exceeded the tick period (${num(TICK_SECONDS)} s).`, 'counter', [['', this.tickOverruns]]);
    metric('sandline_ticks_dropped_total', 'Ticks the host clock dropped rather than run late under a stall.', 'counter', [['', gauges.droppedTicks]]);
    metric('sandline_ai_seconds_total', "The AI's share of tick time over every room, when profiled (T-3.35).", 'counter', [['', totals.aiMs / 1000]]);
    metric('sandline_bytes_sent_total', 'Snapshot bytes sent to clients, over every room ever.', 'counter', [['', totals.bytesSent]]);
    metric('sandline_snapshots_sent_total', 'Snapshots sent to clients, over every room ever.', 'counter', [['', totals.snapshotsSent]]);
    metric('sandline_seatings_total', 'Players seated: fresh joins, and reconnects into their own slot (T-4.18).', 'counter', [
      ['{resumed="no"}', totals.joins],
      ['{resumed="yes"}', totals.resumes],
    ]);
    const refused: [string, number][] = [...this.refusals.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([code, n]) => [`{code="${labelValue(code)}"}`, n]);
    metric('sandline_refusals_total', 'Connections refused or dropped by the host, by typed code (T-1.5.04).', 'counter', refused);
    return `${lines.join('\n')}\n`;
  }
}
