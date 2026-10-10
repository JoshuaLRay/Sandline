# Ongoing upgrades and bugs

The canonical queue for **“complete the next task”**. Read this index and exactly
one card. Status meanings, the dependency rule and the merge policy are in
[AGENTS.md](AGENTS.md#delivery-policy); the procedure is
[the next-task skill](.agents/skills/next-task/SKILL.md). Direction comes from
[docs/VISION.md](docs/VISION.md); unqueued gaps are in
[the Conflict parity tracker](docs/design/CONFLICT-PARITY.md).
[Owner workflow guide](docs/WORKFLOW.md) · [original feedback](docs/backlog/2026-09-26-feedback.md)

**Only active rows are listed.** Completed rows are moved verbatim to
[docs/backlog/archive/](docs/backlog/archive/): an ID that is not in this table is
DONE there (or CANCELLED with a reason). `TASKS.md` / `PLAN.md` keep legacy `T-`
history and gates, `docs/BUGS.md` keeps `B-` history. Do not keep a second status
in an Issue, card or `PLAN.md`; PRs link to the card.

## Selection and status

- Take the **first READY row in table order whose dependencies are satisfied**:
  DONE, archived, or REVIEW with its code merged on main (unless the dependent
  card needs that verdict first). Skip rows another worker's branch or PR holds.
- Promote a BLOCKED row to READY when its only blockers were dependencies that are
  now satisfied. A missing asset, decision or scope stays BLOCKED; a decision
  blocker states its recommended default (`Decision: … — default: …`) so the
  owner can answer "agree". Never infer
  completion from a PR title — check the merge.
- An explicit task ID overrides order, not dependencies. Resume an existing task
  branch/PR when appropriate; never create a competing implementation.
- **INBOX** captured, not scoped · **READY** executable · **IN_PROGRESS** a pushed
  `task/U-NNN-*` branch or open PR · **BLOCKED** exact dependency/decision/asset
  missing · **REVIEW** merged or green, only a human verdict pending · **DONE**
  merged and accepted · **CANCELLED** closed with a reason, not DONE.
- **Aggregate** rows are closure records; claim their leaves. An aggregate closes
  when its leaves are DONE and its batched human verdict is given.
- P0 prevents play or loses data · P1 core loop and feel · P2 expansion · P3 nice
  to have. Priority describes impact; table order decides execution.
- Nothing eligible: report the blockers and propose up to three parity gaps or
  scoping steps (next-task skill, step 1.3) for the owner to queue.

## Owner direction — interleave parity work (2026-10-09)

The owner agreed to mix small Conflict-parity tasks into the Mission 1
construction stream so the queue never waits on one line of work. Parity rows
(U-153–U-155) sit between the map leaves; keep alternating when adding work.

## Owner acceptance — 2026-10-09

The owner instructed: “Mark all human reviews as approved and mark appropriate
tasks as ready,” then “Merge when green and create context transfer for the next
task.” This supplies acceptance for existing delivered human review items,
including desktop/mobile play, visual, listening and proposed design reviews.
Cards and legacy gate records retain that provenance; no new manual run is
claimed. Missing implementation, source recordings, runtime activation, concrete
placement decisions and deferred work remain explicit blockers. Future reviews
of work not yet delivered are not pre-approved. DONE/READY changes below become
canonical when this documentation PR merges.

## Ordered work queue

| Task | Outcome | Epic | Priority | Status | Depends / blocker | Work |
|---|---|---|---|---|---|---|
| [U-156](docs/backlog/U-156.md) | Qalat Road first playable frame back inside the 30 s budget | Streaming and load time | P1 | DONE | — | [#325](https://github.com/JoshuaLRay/Sandline/pull/325) |
| [U-112](docs/backlog/U-112.md) | Finite projectile, health and ammunition supply caches | Map implementation | P1 | BLOCKED | Aggregate: U-132–U-134 DONE; U-145/U-148 new physical-phone acceptance remains open | — |
| [U-145](docs/backlog/U-145.md) | Use supply caches through approved mobile controls | Map implementation | P1 | BLOCKED | Aggregate: U-146/U-147 DONE; U-148 REVIEW in #321; new physical-phone mobile-use acceptance remains open | — |
| [U-148](docs/backlog/U-148.md) | Mobile commander cache choice, cancellation and authoritative progress | Map implementation | P1 | REVIEW | U-146/U-147 DONE; implementation in #321; new physical-phone presentation/play acceptance remains pending after authorized green merge | [#321](https://github.com/JoshuaLRay/Sandline/pull/321) |
| [U-113](docs/backlog/U-113.md) | Map-revision-aware checkpoint restart and restore | Map implementation | P1 | BLOCKED | Aggregate closure: U-135, U-136; split before implementation | — |
| [U-136](docs/backlog/U-136.md) | Refuse incompatible restores and offer restart or mission select | Map implementation | P1 | BLOCKED | Aggregate: U-143 DONE; U-144 current-map carried-prisoner placement remains blocked | [#312](https://github.com/JoshuaLRay/Sandline/pull/312) |
| [U-144](docs/backlog/U-144.md) | Restart incompatible saves with authored carried-prisoner placement | Map implementation | P1 | BLOCKED | U-143; approved current-map holding sockets/lifecycle for carried squad prisoners | — |
| [U-114](docs/backlog/U-114.md) | Build the hidden insertion, road, ridge and tank ingress | Map implementation | P1 | BLOCKED | Aggregate: U-138–U-141; retain full surface acceptance before closure | [#310](https://github.com/JoshuaLRay/Sandline/pull/310) |
| [U-139](docs/backlog/U-139.md) | Construct the road fights and tank ingress with swept clearance | Map implementation | P1 | BLOCKED | Aggregate: U-149–U-152; retain new map/play acceptance and full swept-clearance contract | — |
| [U-149](docs/backlog/U-149.md) | Construct continuous y8 road supports, shoulders and turning aprons | Map implementation | P1 | REVIEW | U-138 (DONE); implementation in #322; new road map/play acceptance remains pending after authorized green merge | [#322](https://github.com/JoshuaLRay/Sandline/pull/322) |
| [U-150](docs/backlog/U-150.md) | Build and screen the three road fights with fixed cover and landmarks | Map implementation | P1 | BLOCKED | U-149 — Decision: accept U-149 as the road foundation now and judge the road's look and play once its fights exist (U-139)? — default: agree | — |
| [U-153](docs/backlog/U-153.md) | Squad stance orders: stay low and hit the dirt | Squad command (Conflict parity) | P1 | DONE | — | [#324](https://github.com/JoshuaLRay/Sandline/pull/324) |
| [U-151](docs/backlog/U-151.md) | Construct screened X ingress and prove the rotating tank sweep | Map implementation | P1 | BLOCKED | U-150 | — |
| [U-154](docs/backlog/U-154.md) | Move and hold orders keep a facing | Squad command (Conflict parity) | P2 | DONE | — | [#326](https://github.com/JoshuaLRay/Sandline/pull/326) |
| [U-152](docs/backlog/U-152.md) | Build return shelters and prove rocket clearance and blast protection | Map implementation | P1 | BLOCKED | U-150, U-151 | — |
| [U-155](docs/backlog/U-155.md) | RPG gunner enemy | Enemy AI (Conflict parity) | P2 | READY | — | — |
| [U-140](docs/backlog/U-140.md) | Construct the continuous ridge stairs, shelves and service bridge | Map implementation | P1 | BLOCKED | U-139 | — |
| [U-141](docs/backlog/U-141.md) | Construct support bays/C12 links and verify surface isolation | Map implementation | P1 | BLOCKED | U-139, U-140 | — |
| [U-115](docs/backlog/U-115.md) | Build the continuous underground depot and its stairs | Map implementation | P1 | BLOCKED | U-109, U-114 | — |
| [U-116](docs/backlog/U-116.md) | Build the prisoner outpost and reserve annex | Map implementation | P1 | BLOCKED | U-114, U-115 | — |
| [U-117](docs/backlog/U-117.md) | Integrate redesigned Mission 1 combat, supplies and objectives | Map implementation | P1 | BLOCKED | U-111, U-112, U-113, U-116 | — |
| [U-118](docs/backlog/U-118.md) | Finish Qalat terrain, architecture, lighting and presentation | Map implementation | P1 | BLOCKED | U-117 | — |
| [U-119](docs/backlog/U-119.md) | Verify the complete replacement mission and capture review evidence | Map implementation | P1 | BLOCKED | U-118 | — |
| [U-142](docs/backlog/U-142.md) | Profile Qalat cold-start load-time overruns | Maintenance | P2 | INBOX | U-138 observation: local/CI exceed 30 s; same-head retry passes; measure bottleneck before scoping | — |
| [U-013](docs/backlog/U-013.md) | Supply and process the real voice recordings | Audio | P2 | BLOCKED | U-012; owner recordings or explicit ADR-017 change | — |
| [U-128](docs/backlog/U-128.md) | Review private saved voice recordings in the browser | Audio | P2 | BLOCKED | Owner listening/UI review approved 2026-10-09; live OAuth/Fly activation remains missing | [#299](https://github.com/JoshuaLRay/Sandline/pull/299) |
| [U-014](docs/backlog/U-014.md) | Play intelligible radio-treated squad dialogue | Audio | P2 | BLOCKED | U-012, U-013 | — |
| [U-015](docs/backlog/U-015.md) | Add friendly hit, downed and death vocal reactions | Audio | P2 | BLOCKED | U-012, U-013 | — |
| [U-016](docs/backlog/U-016.md) | Add positional enemy engagement shouts | Audio | P2 | BLOCKED | U-012, U-013 | — |
| [U-023](docs/backlog/U-023.md) | Break approved character skills into implementation tasks | Squad | P2 | BLOCKED | Owner deferred skills to a later version (2026-09-29); needs a new go-ahead | — |
| [U-032](docs/backlog/U-032.md) | Capture downed characters as prisoners for next-mission rescue | Campaign | P2 | BLOCKED | U-061, U-062, U-063, U-064, U-065 (umbrella) | — |
| [U-065](docs/backlog/U-065.md) | Campaign mission 1: rescue, escort and the armoured ambush | Campaign design | P2 | BLOCKED | Existing owner playtest approved 2026-10-09; full headless completion and U-107 replacement integration remain open | [#277](https://github.com/JoshuaLRay/Sandline/pull/277); replacement implementation remains U-108–U-119 |
| [U-080](docs/backlog/U-080.md) | Realistic character models: a more grounded look | Art | P2 | BLOCKED | Delivered soldier/enemy art approved 2026-10-09; scope remaining POW-specific procedural model before claim | — |
| [U-087](docs/backlog/U-087.md) | Squad tactics: bounding, focus fire and fighting as a group | Enemy AI | P3 | BLOCKED | Deferred by the owner (U-085) | — |


## Existing work retained

- B-09 and B-18 now execute through U-002 and U-024; `docs/BUGS.md` keeps their
  report history and links. New reports go here instead of starting a second list.
- B-11 / T-5.06 (remaining squad AI close-fight/bounding work) stays in
  `TASKS.md` and `PLAN.md` §7.12. It is not automatically the cause of U-001.
- Existing M2–M5 human reviews were approved on 2026-10-09 in `TASKS.md`;
  unfinished engineering, lighting and deployment/cost decisions remain there.
  Request their explicit IDs to work those blockers. If this queue has
  no eligible work, report remaining blockers and legacy options; don't silently
  invent a task or mark a human gate passed.

## Adding and maintaining work

Follow [the report-feedback skill](.agents/skills/report-feedback/SKILL.md).
Use [the card template](docs/backlog/TEMPLATE.md); allocate the next unused U ID
across this table, the archive, `docs/backlog/U-*.md` and open PRs (never renumber
or reuse). Status belongs in this index; scope, reproduction and evidence belong
in the card; one completion line per task goes in `docs/CHANGELOG.md`. When about
fifteen DONE rows accumulate here, move them verbatim to a new dated file in
`docs/backlog/archive/` (rewriting only link paths). Selection treats archived
IDs as DONE; do not load archives during ordinary selection.
