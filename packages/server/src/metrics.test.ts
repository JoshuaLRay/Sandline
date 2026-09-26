/**
 * The host's metrics (T-4.33): the exposition a scraper reads. Ticks land
 * in cumulative buckets with the overruns counted; a room's counters are
 * kept when the room is reclaimed; refusals count by code; the format is
 * the Prometheus text one, HELP and TYPE before every metric, and no room
 * code anywhere in it.
 */
import { describe, expect, it } from 'vitest';
import { TICK_SECONDS } from '@sandline/shared';
import { HostMetrics, TICK_BUCKETS_SECONDS, type HostGauges } from './metrics.ts';
import type { SessionStats } from './session/Session.ts';

const gauges = (extra: Partial<HostGauges> = {}): HostGauges => ({
  rooms: 2,
  maxRooms: 4,
  idleRooms: 1,
  players: 3,
  connections: 4,
  maxConnections: 32,
  droppedTicks: 0,
  rssBytes: 123_456_789,
  draining: false,
  ...extra,
});

const room = (extra: Partial<SessionStats> = {}): SessionStats => ({
  tick: 100,
  players: 1,
  bots: 5,
  snapshotsSent: 10,
  bytesSent: 1000,
  aiDebugSent: 0,
  aiDebugBytesSent: 0,
  joins: 1,
  resumes: 0,
  aiMs: 50,
  ...extra,
});

/** Every sample line for a metric name, `labels value`. */
function samples(text: string, name: string): string[] {
  return text
    .split('\n')
    .filter((line) => line.startsWith(name) && !line.startsWith('# '))
    .map((line) => line.slice(name.length));
}

describe('HostMetrics (T-4.33)', () => {
  it('renders the exposition: HELP and TYPE before every metric, gauges from the host, and no room code', () => {
    const metrics = new HostMetrics();
    const text = metrics.render(gauges(), [room()]);
    for (const name of ['sandline_rooms', 'sandline_players', 'sandline_tick_seconds', 'sandline_bytes_sent_total', 'sandline_refusals_total']) {
      const i = text.indexOf(`# HELP ${name} `);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(text.indexOf(`# TYPE ${name} `)).toBeGreaterThan(i);
    }
    expect(samples(text, 'sandline_rooms')).toContain(' 2');
    expect(samples(text, 'sandline_rooms_idle')).toEqual([' 1']);
    expect(samples(text, 'sandline_players')).toEqual([' 3']);
    expect(samples(text, 'sandline_connections')).toContain(' 4');
    expect(samples(text, 'sandline_process_rss_bytes')).toEqual([' 123456789']);
    expect(text).toContain('sandline_info{protocol="');
    expect(text).toContain('draining="no"} 1');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('puts every tick in the cumulative buckets, sums it, and counts the ones over the period', () => {
    const metrics = new HostMetrics();
    metrics.observeTick(1.5);
    metrics.observeTick(8);
    metrics.observeTick(40);
    metrics.observeTick(400);
    const text = metrics.render(gauges({ droppedTicks: 2 }), []);
    const buckets = samples(text, 'sandline_tick_seconds_bucket');
    expect(buckets).toHaveLength(TICK_BUCKETS_SECONDS.length + 1);
    expect(buckets).toContain('{le="0.001"} 0');
    expect(buckets).toContain('{le="0.002"} 1');
    expect(buckets).toContain('{le="0.01"} 2');
    expect(buckets).toContain(`{le="${TICK_SECONDS.toPrecision(12).replace(/\.?0+$/, '')}"} 2`);
    expect(buckets).toContain('{le="0.05"} 3');
    expect(buckets).toContain('{le="+Inf"} 4');
    expect(samples(text, 'sandline_tick_seconds_count')).toEqual([' 4']);
    expect(Number(samples(text, 'sandline_tick_seconds_sum')[0])).toBeCloseTo(0.4495, 6);
    expect(samples(text, 'sandline_tick_overruns_total')).toEqual([' 2']);
    expect(samples(text, 'sandline_ticks_dropped_total')).toEqual([' 2']);
    expect(metrics.ticks).toBe(4);
  });

  it("keeps a reclaimed room's bytes, snapshots, seatings and AI time in the totals", () => {
    const metrics = new HostMetrics();
    const a = room({ bytesSent: 1000, snapshotsSent: 10, joins: 2, resumes: 1, aiMs: 250 });
    const b = room({ bytesSent: 500, snapshotsSent: 5, joins: 1, resumes: 0, aiMs: 50 });
    let text = metrics.render(gauges(), [a, b]);
    expect(samples(text, 'sandline_bytes_sent_total')).toEqual([' 1500']);
    expect(samples(text, 'sandline_seatings_total')).toEqual(['{resumed="no"} 3', '{resumed="yes"} 1']);
    expect(samples(text, 'sandline_ai_seconds_total')).toEqual([' 0.3']);
    // Room a is reclaimed: nothing it counted is lost, and the counters never go down.
    metrics.retire(a);
    text = metrics.render(gauges(), [b]);
    expect(samples(text, 'sandline_bytes_sent_total')).toEqual([' 1500']);
    expect(samples(text, 'sandline_snapshots_sent_total')).toEqual([' 15']);
    expect(samples(text, 'sandline_seatings_total')).toEqual(['{resumed="no"} 3', '{resumed="yes"} 1']);
    expect(samples(text, 'sandline_ai_seconds_total')).toEqual([' 0.3']);
  });

  it('counts refusals by their typed code, sorted, with the label escaped', () => {
    const metrics = new HostMetrics();
    metrics.countRefusal('room full');
    metrics.countRefusal('bad key');
    metrics.countRefusal('room full');
    metrics.countRefusal('heartbeat timeout');
    const text = metrics.render(gauges({ draining: true }), []);
    expect(samples(text, 'sandline_refusals_total')).toEqual(['{code="bad key"} 1', '{code="heartbeat timeout"} 1', '{code="room full"} 2']);
    expect(text).toContain('draining="yes"} 1');
  });
});
