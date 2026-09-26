# Observability (T-4.33)

Each host exports metrics at **`/metrics`** on its own port, in the Prometheus
text exposition, from `packages/server/src/metrics.ts`. On Fly the `[metrics]`
block in `fly.toml` has the platform scrape it into the organisation's managed
Prometheus, and the managed Grafana at <https://fly-metrics.net> reads that.
Nothing here needs an account beyond the one the host already runs on.

```bash
curl https://sandline-host.fly.dev/metrics      # or http://localhost:8080/metrics on a laptop
```

## What is exported

| Metric | Kind | What it says |
|---|---|---|
| `sandline_tick_seconds` | histogram | Wall time of one host tick: every room stepped and every snapshot sent. A 30 Hz tick has 33.3 ms; the last buckets are the overruns. |
| `sandline_tick_overruns_total` | counter | Ticks whose wall time exceeded the period. |
| `sandline_ticks_dropped_total` | counter | Ticks the host clock dropped rather than run late under a stall. |
| `sandline_ai_seconds_total` | counter | The AI's share of tick time, over every room, when profiled (`HOST_AI=1` profiles it). |
| `sandline_rooms`, `sandline_rooms_idle`, `sandline_rooms_max` | gauge | Rooms held, rooms waiting out the reclaim grace, and the cap. |
| `sandline_players`, `sandline_connections`, `sandline_connections_max` | gauge | Humans seated; sockets held; the cap. |
| `sandline_bytes_sent_total`, `sandline_snapshots_sent_total` | counter | Snapshot bytes and snapshots to clients, over every room ever, reclaimed ones included. |
| `sandline_seatings_total{resumed}` | counter | Players seated fresh (`no`) and reconnected into their own slot (`yes`, T-4.18). |
| `sandline_refusals_total{code}` | counter | Connections refused or dropped by the host, by the typed code (T-1.5.04): `room full`, `no such room`, `bad key`, `heartbeat timeout`, … |
| `sandline_process_rss_bytes` | gauge | The process's resident memory. |
| `sandline_info{protocol,draining}` | gauge | The build serving and whether it is draining. |

Room codes are never in it, as they are never in `/healthz`.

## The dashboard

`grafana-dashboard.json` is a Grafana dashboard (import it: Dashboards → New →
Import → upload the file, pick the Prometheus data source). Its rows:

1. **Ticks** — p50 / p95 / p99 tick time against the 33.3 ms period, the AI's
   share of it, overruns and dropped ticks.
2. **Players** — players, rooms (live and idle) and connections.
3. **Bytes** — bytes per second per player, against ADR-012's 18 KB/s budget.
4. **Joins** — reconnects and fresh seatings, and refusals by code.

## The alerts

`alerts.yml` is a Grafana alerting provisioning file with the rules. Managed
Grafana has no file provisioning, so create them by hand from it: Alerting →
Alert rules → New, one per rule, with the query, threshold and duration the
file gives. Two rules matter:

- **Ticks overrunning** — the p99 tick time is over the period for two
  minutes. The host is late for everyone in every room; the AI share panel
  says whether the AI is why.
- **Ticks dropped** — the host clock dropped ticks in the last five minutes.
  A stall long enough to skip simulation, not merely run late.

A third, **Refusals**, fires on a burst of `host full` or `room full`: the
signal T-4.30's addendum names for adding a machine to a region.
