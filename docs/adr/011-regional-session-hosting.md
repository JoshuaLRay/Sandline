# ADR-011: Regional session-based hosting

- **Status:** Accepted
- **Date:** 2026-09-16
- **Plan reference:** §2, E-4.9

## Context

The server is authoritative (ADR-012), so every player's input round-trips
through it. Prediction hides local latency but not the latency of seeing other
players and AI. The target is under 80 ms RTT, which is a geography problem
before it is an engineering one.

Sessions are long-lived, stateful, and hold an entire simulation in memory.

## Decision

Session-based dedicated servers allocated per match, deployed to multiple
regions, with players matched into the region that minimizes worst-case RTT
across the party. Fly.io or Hathora as the initial platform.

## Consequences

- Hosting cost scales with concurrent sessions rather than players, and six
  players amortize one process. Cost must be modeled before launch (R7).
- A party spanning continents will have a bad time for at least one member. Match
  on worst-case rather than average RTT so the decision is explicit rather than
  emergent.
- Sessions are stateful and cannot be load-balanced mid-match. Session
  orchestration — allocation, health, drain, reclaim — is real work (E-4.9), not
  a deployment detail.
- Reconnect (T-1.09) must route a returning player back to their specific
  session, not merely to the service.

## Alternatives rejected

- **Peer-to-peer with host migration.** Rejected on three counts: the host gets a
  latency advantage, NAT traversal requires the TURN infrastructure ADR-008
  already declined, and a hostile host can trivially corrupt the session. Lower
  cost, but it moves the trust model the wrong way.
- **Single region.** Rejected: guarantees unacceptable latency for most of the
  world.
- **Serverless / edge functions.** Rejected: sessions are long-lived and
  stateful, which is the exact workload serverless is worst at.

---

## Addendum — 2026-09-18: one host first, and P2P is still rejected

M1.5 (PLAN.md §4.2, §6A) pulls a deployed host forward from M4 to immediately
after M1, so that two humans can play each other roughly thirty weeks earlier
than this plan originally had them doing so. Two clarifications, because the
request that prompted it used the words "peer to peer".

**The decision above is unchanged.** Authoritative dedicated hosts, allocated
per session. The rejection of peer-to-peer with host migration stands on all
three of its original counts — host latency advantage, NAT traversal requiring
TURN, and a hostile host able to corrupt the session. Two players connecting
"to each other" means connecting to each other *through* a host. That is not a
compromise made for M1.5; it is the only arrangement under which the shot
arbitration those playtests exist to judge means anything at all, since lag
compensation (T-1.18) is a server-side rewind and there is no server to rewind
in a P2P mesh.

**What M1.5 does take is a staging of this decision, not a departure from it.**
T-1.5.07 deploys *one* host in *one* region with no allocation, no orchestration
and no drain — the smallest thing that is still a dedicated authoritative
server. Multi-region placement, worst-case-RTT matching, session allocation and
reclaim remain E-4.9 and remain as specified here. The <80 ms RTT target is not
being tested by a single-region host and should not be claimed from it; what
T-1.5.08 measures is whether the netcode holds up at whatever latency two real
people happen to have between them, which is a different and, at this stage,
more urgent question.

**One thing this does raise.** A host process that any player can run now exists
as a by-product (T-1.5.01), and the in-page session already is a listen server
in all but name. Whether a player-run host is ever a *supported* mode — LAN
play, community servers — is not something this ADR ruled on, and it is now
PLAN.md §9 Q7, to be answered before E-4.9 rather than drifted into.

---

## Addendum — 2026-09-26: regions, allocation, naming and cost (T-4.30)

The decision stands: authoritative dedicated hosts, allocated per session,
placed in regions. This addendum is the design E-4.9 builds to, written so
that T-4.20 (region selection), T-4.31 (the allocator) and T-4.32 (drain) can
be implemented without reopening anything, and so that the owner can agree the
cost before any of them starts. Where a choice below could have gone another
way, the alternative is named and the reason it lost is given.

What exists today (T-1.5.07, T-4.23): one Fly app, `sandline-host`, one
`shared-cpu-1x` / 512 MB machine in `iad`, a 1 GB volume for campaigns, four
rooms of six, TLS at Fly's edge, a machine that stops itself when no socket is
open and starts on the next connection. The published client learns the host's
address from one repository variable. Everything below is a widening of that,
not a replacement: a laptop `pnpm host` reached by `?host=` stays exactly what
it is.

### 1. Which regions

A **region** is an entry in `packages/shared/src/data/regions.json`:

```json
{ "id": "na-east", "fly": "iad", "name": "North America (East)", "tag": "A",
  "host": "wss://sandline-iad.fly.dev" }
```

`id` is what code and settings name; `fly` is Fly's three-letter region;
`name` is what the lobby shows; `tag` is the one voice-safe letter room codes
carry (§3); `host` is the region's public address. The file is validated as
every data file is (unknown keys refused by name, tags unique, addresses
`wss://`), and the client ships it, so the lobby needs no request to know
where it can go.

**The launch set is the one region that exists, plus one more when a
playtest party needs it.** Concretely:

| When | Region | Why then |
|---|---|---|
| Now | `iad` (North America, East) | Deployed 2026-09-19; every playtest so far ran on it. |
| The first playtest with a European member | `lhr` (Europe, West) | London to US East is typically ~75 ms — over the target once the last mile is added; a party split across the Atlantic cannot get under 80 ms *anywhere*, and this is where the European half plays well. |
| On demand | `syd` or `sin` (Oceania / Asia) | Only when someone there is playing. Not before: an empty region costs little (§5) but nothing. |

The rule for adding a region: **a person who will play regularly measures over
80 ms worst-case RTT to every region that exists.** The netgraph already shows
the RTT; no new instrument is needed to decide. Regions are never removed
while a campaign (§3) lives on their volume.

Rejected: a five-region launch (`iad`, `lax`, `lhr`, `sin`, `syd`) on the
grounds that a vertical slice with a six-player squad has nobody in most of
them, and each is a volume, an address and a machine to deploy and watch.
Rejected: a US West region now — `iad` from the West Coast is typically ~60–70 ms,
inside the target, and the second region's money and attention are better
spent where the target is actually missed.

### 2. How a client is handed a host and a room

Three ways were on the table:

- **(a) An allocator service** — a small always-on process that hosts register
  with, and that answers "give me a host in this region" and "which host has
  this code". It is the textbook shape, and it is a machine per region that
  never stops, a registration that can go stale, and a second binary to deploy
  and watch. At the slice's scale — one machine per region — it would answer
  every question with the only possible answer.
- **(b) Fly's own regional routing, unaided** — one app, machines in several
  regions, Fly's anycast proxy sends each connection to the nearest machine.
  Free and zero-code, and wrong for us on its own: a joiner's code names a room
  that lives in *one* process, and "nearest machine to the joiner" is not
  "the machine that holds the room" the moment a region has two machines or
  a party spans two regions.
- **(c) Codes carry their region; the client goes straight to the region; the
  hosts of a region find each other.** This is the decision.

**The client's side.** The lobby (T-4.20) pings every region's `/healthz` once
on open, shows the round trips, and connects to the lowest, or to the region a
setting remembers. **A code names its region** (§3), so a joiner connects to
the code's region whatever their own; the lobby says so ("room is in Europe
(West), 140 ms from you") rather than hiding it. A player's own region is only
ever used to *create* a room; joining goes where the room is.

**Worst-case RTT across the party** (the ADR's matching rule) is made explicit
rather than computed: a room is created in its creator's region; the room
lobby (T-4.19) shows every seated player their own RTT to it; a party that sees
one member at 180 ms re-creates the room in the region that is fair to all,
which is one click and a new code. A matchmaker that solved the assignment for
them would be solving a problem six friends on voice chat do not have.

**The hosts' side, within a region.** One Fly app per region
(`sandline-iad`, `sandline-lhr`, …), each with its own anycast address, so a
region is addressable without any routing header. Within an app, Fly's proxy
hands a new connection to whichever of the region's machines it likes. While a
region has one machine — the whole slice — that is the right machine and
nothing else happens.

When a region has a second machine (§4), each host finds its peers itself
through Fly's private network: `<app>.internal` resolves to every running
machine's private address. **T-4.31 builds this, not a service**:

- On a **Join with a code** the host does not hold, it asks each peer
  `GET /internal/room/<code>` (answered only for callers on the private
  network, never over the public address, so codes stay unlisted as `/healthz`
  keeps them). The peer that holds it is named in the upgrade response with
  `fly-replay: instance=<machine id>`, and Fly's proxy re-sends the upgrade
  there; the client sees one connection, to the right process. No peer holds
  it: `no such room`, as today.
- On a **Join with no code** (create) or a **quick-join**, the host compares its
  own `/healthz` with its peers' and replays to the least-loaded machine when
  that is not itself; a stopped machine is not a peer until Fly has started it,
  which `auto_start_machines` does on the connection that arrives when every
  running one is full.
- The first step of T-4.31 is a spike proving `fly-replay` on a WebSocket
  upgrade end to end, because that is the one part of this that is Fly's
  behaviour rather than ours. **If it does not hold, the portable fallback is
  a `redirect` disconnect code carrying the peer's address**, which needs each
  machine to be publicly addressable — on Fly, one app per machine. The rest
  of the design is unchanged either way, and the fallback is also what a
  non-Fly host would use.

"Least loaded" is rooms held, then players, from `/healthz`, which is what
T-4.31's task line already names as the health source. There is no
registration to go stale: a peer that is gone does not resolve, and the room
directory *is* the set of processes holding rooms. The allocator T-4.31
builds is therefore a library in the host (`packages/server/src/allocator/`,
as the task suggests) with fake peers in its tests, and no new machine.

**Q7 (a player-run host) is not decided here.** A player's own host fits this
shape as a region with one machine and an address typed into the lobby, which
is what `?host=` already does; whether that is ever a *supported* mode is still
§9 Q7's, and nothing in this addendum makes it harder or easier.

### 3. How rooms are named across hosts

A room code today is four voice-safe characters, unique within one process.
Across regions it becomes **one region tag and the four characters**,
displayed with a hyphen and read aloud as such: `A-KM7X` is room `KM7X` in
the region whose tag is `A`. The tag is from the same voice-safe alphabet, so
`normalizeRoomCode` needs no new rule beyond stripping the hyphen it already
strips; `isJoinCode` grows to accept the tagged forms and the untagged ones a
laptop host still makes. A code with a tag the client's `regions.json` does
not know is refused in the lobby with the tag named, before any socket opens.

Uniqueness across the machines of one region: a host creating a room asks its
peers whether they hold the code it drew (§2's `/internal/room/<code>`) and
draws again on a collision. Two machines of four rooms each against 331,776
codes makes a collision rare; the check makes it impossible rather than rare,
and it is the same request the join path already needs.

**Campaign codes** (T-4.23, eight characters, durable) carry the tag the same
way: `A-KM7XRT34`. A campaign lives on its region's volume and is joined in
its region; **it does not move between regions**. That is a real consequence
and it is accepted: the alternative is a database shared across regions, which
is a network hop on every save and a second system to run. A campaign export
and import, if a party ever emigrates, is a task for later and is not owed by
the slice.

The published client's single `SANDLINE_HOST` variable is retired when
`regions.json` lands in T-4.20: the addresses are deterministic
(`sandline-<fly>.fly.dev`) and committed. The variable survives as an
*override* for a laptop host or a staging deploy, which is the only thing it
was ever needed for.

### 4. How many machines per region, and when they start

**One machine per region, stopped whenever nobody is connected.** Exactly
today's arrangement, per region: `min_machines_running = 0`,
`auto_stop_machines = "stop"`, `auto_start_machines = true`, four rooms of six
per machine. A cold start costs the first player in a region a few seconds, which the
lobby's reconnect backoff (T-1.08) already covers, and costs the project
nothing while nobody is playing. Nothing is kept warm.

**A second machine in a region** is added by hand — `fly scale count 2
--region <fly>` — when the region's `host full` refusals (a T-4.33 metric)
appear on a playtest evening, and §2 makes it work with no other change. It is
not added before: a full machine is 24 players, four squads, and the slice has
one.

**A machine is never kept running for latency.** The one-off cold start is
paid once per playtest, by the person who opens the room, and is the entire
price of §5's idle cost being almost nothing. If the project ever has players
at all hours, `min_machines_running = 1` in the region that does is one line;
it is not set now.

**Deploys** roll per app — Fly replaces the machine — which today kills a
mission in progress. T-4.32 (drain and reclaim) fixes that within this shape:
the old machine stops taking rooms (`host draining`, which already exists),
the new one takes them, and the old one leaves when empty or at a cap. With
one machine per region, a deploy during a playtest is the one thing to avoid
until T-4.32 lands, and the Host workflow is on demand for that reason.

### 5. Owner-visible cost

Fly's list prices at the time of writing, in US dollars, for the resources
above. **They are quoted to be checked against fly.io/pricing when this is
agreed, not to be relied on**; the shape of the bill matters more than the
digits.

| Item | Price | Notes |
|---|---|---|
| `shared-cpu-1x`, 512 MB, running | ≈ $3.19 / month, billed by the second | ≈ $0.0044 / hour. A three-hour playtest ≈ $0.013. |
| The same machine, stopped | its root filesystem only, ≈ $0.15 / GB / month | Well under $0.50 / month per region. |
| Volume, 1 GB (campaigns) | ≈ $0.15 / month | One per region. |
| Outbound bandwidth | ≈ $0.02 / GB (North America, Europe); ≈ $0.04 / GB (Asia, Oceania) | ADR-012's budget is 18 KB/s down per player: a full room of six is ≈ 390 MB / hour ≈ $0.008 / hour. |
| Dedicated IPv4 | ≈ $2 / month per app | **Not needed**: `wss://<app>.fly.dev` is served on Fly's shared address. Do not allocate one. |
| An allocator machine per region | ≈ $2 / month per region, always on | **Avoided** by §2's design. |

Put together, for the shapes this addendum allows:

| Shape | Idle, per month | Plus, per playtest hour, per region in use |
|---|---|---|
| Today: one region | ≈ $0.50 | ≈ $0.01 compute + ≈ $0.01 bandwidth per full room |
| Two regions, one machine each (the slice) | ≈ $1 | same |
| Three regions | ≈ $1.50 | same |
| A second machine in one region | + ≈ $0.50 idle | + ≈ $0.01 / hour when it runs |
| A region kept warm (`min_machines_running = 1`) | + ≈ $3.19 per region | — |

**The order of magnitude the owner is agreeing to is a few dollars a month
for two regions and a playtest a week; ten dollars a month would mean either
a region kept warm or a great deal more play than the slice expects.** Fly's
plans have carried a monthly minimum at some points and not at others; whether
the org's plan has one is part of what to check on fly.io before agreeing,
because on a plan with a $5 minimum the minimum *is* the bill.

The two things that would change this cost, and who decides them:

- **Keeping a machine warm** (§4): the owner's, when there are players to
  justify it; never set by a task.
- **A region added** (§1): the owner's, when a regular player measures over
  the target everywhere that exists. Each region is ≈ $0.50 / month idle and
  a volume of campaigns that cannot leave it.

What this addendum asks the owner to agree: **the launch set in §1 (one
region now, a second when a European party needs it), one stopped-when-idle
machine per region, no allocator machine, campaigns bound to their region, and
the cost table above.** T-4.20, T-4.31 and T-4.32 then build to this without
coming back for a decision; only "keep a region warm" and "add a region" ever
do, and both are one line and one deploy.
