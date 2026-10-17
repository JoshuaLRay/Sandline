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

## Owner direction — design alignment (2026-10-16)

The owner set new direction ([ADR-022](docs/adr/022-conflict-reference-scope.md)
reference scope, [ADR-023](docs/adr/023-flexible-mission-routes.md) flexible
maps, [ADR-024](docs/adr/024-equipment-freedom-and-loot.md) equipment freedom
and loot) and approved two changes that are now implemented (U-181 bleed-out,
#349; U-182 C4 detonators, #350). The new rows below U-117 keep the Mission 1 stream first
and add command reliability, stealth, armour and map tooling as interleaved
READY work; loot implementation waits for the owner's design session (U-184).
Decisions with defaults are in the rows; the owner can reply "agree".

## Ordered work queue

| Task | Outcome | Epic | Priority | Status | Depends / blocker | Work |
|---|---|---|---|---|---|---|
| [U-112](docs/backlog/U-112.md) | Finite projectile, health and ammunition supply caches | Map implementation | P1 | BLOCKED | Aggregate: U-132–U-134 DONE; U-145/U-148 new physical-phone acceptance remains open | — |
| [U-145](docs/backlog/U-145.md) | Use supply caches through approved mobile controls | Map implementation | P1 | BLOCKED | Aggregate: U-146/U-147 DONE; U-148 REVIEW in #321; new physical-phone mobile-use acceptance remains open | — |
| [U-148](docs/backlog/U-148.md) | Mobile commander cache choice, cancellation and authoritative progress | Map implementation | P1 | REVIEW | U-146/U-147 DONE; implementation in #321; new physical-phone presentation/play acceptance remains pending after authorized green merge | [#321](https://github.com/JoshuaLRay/Sandline/pull/321) |
| [U-113](docs/backlog/U-113.md) | Map-revision-aware checkpoint restart and restore | Map implementation | P1 | BLOCKED | Aggregate closure: U-135, U-136; split before implementation | — |
| [U-136](docs/backlog/U-136.md) | Refuse incompatible restores and offer restart or mission select | Map implementation | P1 | BLOCKED | Aggregate: U-143 DONE; U-144 current-map carried-prisoner placement remains blocked | [#312](https://github.com/JoshuaLRay/Sandline/pull/312) |
| [U-144](docs/backlog/U-144.md) | Restart incompatible saves with authored carried-prisoner placement | Map implementation | P1 | BLOCKED | U-143/U-224 DONE; production holdings and accessible rescue integration must ship with replacement activation (U-117), never on the older map | — |
| [U-114](docs/backlog/U-114.md) | Build the hidden insertion, road, ridge and tank ingress | Map implementation | P1 | REVIEW | Surface engineering U-138–U-141 complete; only batched road/ridge look/play verdicts in U-139/U-140 remain | [#341](https://github.com/JoshuaLRay/Sandline/pull/341) |
| [U-139](docs/backlog/U-139.md) | Construct the road fights and tank ingress with swept clearance | Map implementation | P1 | REVIEW | Aggregate: U-149–U-152 and U-162 DONE (first-X5 forecourt criterion met); only the batched human road look/play verdict remains | [#335](https://github.com/JoshuaLRay/Sandline/pull/335) |
| [U-140](docs/backlog/U-140.md) | Construct the continuous ridge stairs, shelves and service bridge | Map implementation | P1 | REVIEW | Aggregate: U-163/U-164/U-165 DONE; only the batched owner ridge look/play verdict remains | [#338](https://github.com/JoshuaLRay/Sandline/pull/338) |
| [U-117](docs/backlog/U-117.md) | Integrate redesigned Mission 1 combat, supplies and objectives | Map implementation | P1 | BLOCKED | U-111/U-116 DONE; U-112 (U-148 physical-phone acceptance), U-113 (U-144 current-map prisoner placement) | — |
| [U-205](docs/backlog/U-205.md) | Enemy awareness: five authoritative states | Stealth and enemy awareness | P2 | READY | — (owner direction 2026-10-16) | — |
| [U-197](docs/backlog/U-197.md) | Man a mounted gun: bots mount guns; a move order onto a gun mans it | Squad command reliability | P1 | READY | — (Conflict default; Mission 2 §9.5 precedent) | — |
| [U-213](docs/backlog/U-213.md) | Directional tank armour: weak sides and rear | Armour and vehicles | P2 | READY | — (Conflict default; CP-20) | — |
| [U-214](docs/backlog/U-214.md) | Armour hit feedback: impacts, damage stages, destruction and sound | Armour and vehicles | P2 | READY | — (look/listen verdict batched in U-119) | — |
| [U-203](docs/backlog/U-203.md) | Squad command reliability (epic and solo-play verification) | Squad command reliability | P1 | BLOCKED | Aggregate: U-196, U-174, U-197, U-198 first, then U-201, U-200, U-202; owner solo playtest | — |
| [U-198](docs/backlog/U-198.md) | Order a soldier to plant charges and to set them off | Squad command reliability | P1 | BLOCKED | Decision: how to give plant/detonate orders — default: an equipment ring on the order wheel (U-182 DONE) | — |
| [U-201](docs/backlog/U-201.md) | Friendly bots lay suppressive fire on an attack order | Squad command reliability | P2 | BLOCKED | Decision: lift U-087's deferral for suppressive fire only? — default: yes, suppression on orders only | — |
| [U-202](docs/backlog/U-202.md) | Synchronised orders: plan several moves and release them together | Squad command reliability | P2 | BLOCKED | U-196, U-197, U-198; Decision: when to build — default: after command reliability | — |
| [U-199](docs/backlog/U-199.md) | Finite reserve ammunition and giving ammo to a squadmate | Weapons and equipment | P1 | BLOCKED | Decision (L-16): reserve sizes before the loot session? — default: fixed spare magazines per family now, data-tunable | — |
| [U-200](docs/backlog/U-200.md) | Bots pick up, swap and hand over equipment on order | Squad command reliability | P2 | BLOCKED | U-188 (loot ownership), U-194, U-198 (order UI) | — |
| [U-204](docs/backlog/U-204.md) | Stealth, enemy awareness and alarms (epic) | Stealth and enemy awareness | P2 | BLOCKED | Aggregate: U-205–U-212; owner stealth playtest in U-212 | — |
| [U-206](docs/backlog/U-206.md) | Detection inputs: weapon noise, muffled sound, enemies hearing the fight | Stealth and enemy awareness | P2 | BLOCKED | U-205 | — |
| [U-207](docs/backlog/U-207.md) | Investigate, search and return to duty | Stealth and enemy awareness | P2 | BLOCKED | U-205 | — |
| [U-208](docs/backlog/U-208.md) | Warnings, alarms and reinforcements | Stealth and enemy awareness | P2 | BLOCKED | U-205 | — |
| [U-209](docs/backlog/U-209.md) | Temporary overhead awareness indicators (○ ? … ! !!) | Stealth and enemy awareness | P2 | BLOCKED | U-205 | — |
| [U-210](docs/backlog/U-210.md) | Suppressed weapons | Stealth and enemy awareness | P2 | BLOCKED | U-206; Decision: wait for attachments? — default: ship one or two suppressed variants now, convert in U-191 | — |
| [U-211](docs/backlog/U-211.md) | Silent knife takedown on unaware enemies | Stealth and enemy awareness | P3 | BLOCKED | U-205 | — |
| [U-212](docs/backlog/U-212.md) | Stealth tuning and verification | Stealth and enemy awareness | P2 | BLOCKED | U-205–U-211; owner playtest | — |
| [U-215](docs/backlog/U-215.md) | Mission 2 capability: technicals and parked vehicles (N2, N5) | Mission 2 capabilities | P2 | BLOCKED | U-127 OD-8: Mission 2 builds after Mission 1's owner playtest unless capability work is authorised in parallel | — |
| [U-216](docs/backlog/U-216.md) | Mission 2 capability: helicopter extraction | Mission 2 capabilities | P2 | BLOCKED | U-127 OD-8, as U-215 | — |
| [U-217](docs/backlog/U-217.md) | Enemy APC | Armour and vehicles | P3 | INBOX | Scope when a mission brief needs one | — |
| [U-218](docs/backlog/U-218.md) | One drivable multi-crew vehicle (future epic) | Drivable vehicles | P3 | BLOCKED | Owner: do not implement now; Decision: which vehicle and when — default: a light utility vehicle with a gunner, after Mission 2; needs an ADR reopening ADR-015 | — |
| [U-220](docs/backlog/U-220.md) | Binoculars and reconnaissance equipment | Weapons and equipment | P3 | BLOCKED | U-187 (non-projectile items) | — |
| [U-183](docs/backlog/U-183.md) | Loot, equipment freedom and progression (epic) | Loot and progression | P1 | BLOCKED | Aggregate: U-184–U-195; owner loot playtest in U-193 | — |
| [U-184](docs/backlog/U-184.md) | Loot design session with the owner | Loot and progression | P1 | BLOCKED | Decision: answer LOOT-PROGRESSION §15 (L-01–L-30) — default: reply in writing, "agree" to the recommended defaults line by line | — |
| [U-194](docs/backlog/U-194.md) | Reconcile character-exclusive equipment rules with equipment freedom | Loot and progression | P1 | BLOCKED | Decision: apply L-08–L-14 defaults before the full session? — default: yes | — |
| [U-185](docs/backlog/U-185.md) | Approved loot and progression specification | Loot and progression | P1 | BLOCKED | U-184 | — |
| [U-186](docs/backlog/U-186.md) | Inventory and persistence architecture (ADR) | Loot and progression | P1 | BLOCKED | U-185 | — |
| [U-187](docs/backlog/U-187.md) | Item data and equipment foundations | Loot and progression | P1 | BLOCKED | U-186 | — |
| [U-188](docs/backlog/U-188.md) | Multiplayer loot ownership and synchronisation | Loot and progression | P1 | BLOCKED | U-187 | — |
| [U-189](docs/backlog/U-189.md) | Loot generation and acquisition | Loot and progression | P1 | BLOCKED | U-188 | — |
| [U-190](docs/backlog/U-190.md) | Mission rewards and replay progression | Loot and progression | P1 | BLOCKED | U-189 | — |
| [U-191](docs/backlog/U-191.md) | Attachments and weapon customisation (if approved) | Loot and progression | P2 | BLOCKED | U-185 (L-17–L-19), U-187 | — |
| [U-192](docs/backlog/U-192.md) | Balancing and long-term progression (if approved) | Loot and progression | P2 | BLOCKED | U-190; L-24–L-29 | — |
| [U-195](docs/backlog/U-195.md) | Left-handed firearms across categories | Loot and progression | P1 | BLOCKED | U-185, U-187 | — |
| [U-193](docs/backlog/U-193.md) | Loot QA, playtesting and tuning (verification) | Loot and progression | P1 | BLOCKED | The built leaves; owner playtest | — |
| [U-118](docs/backlog/U-118.md) | Finish Qalat terrain, architecture, lighting and presentation | Map implementation | P1 | BLOCKED | U-117 | — |
| [U-119](docs/backlog/U-119.md) | Verify the complete replacement mission and capture review evidence | Map implementation | P1 | BLOCKED | U-118 | — |
| [U-178](docs/backlog/U-178.md) | Force Mission 1 rescue return after completion with prisoners | Campaign | P2 | INBOX | Owner decision 2026-10-15; decompose routing/persistence/rescue; coordinate U-144 placement and U-117 activation | — |
| [U-174](docs/backlog/U-174.md) | Finish crowded squad move orders after reaching the room | Squad command | P2 | INBOX | U-173 actor-proof observation; reproduce packing/avoidance independently on open floor; 2026-10-16 audit: add a general stuck-order rule (part of U-203) | — |
| [U-166](docs/backlog/U-166.md) | Open-side blast exposure at scenery impact faces | Grounded combat | P1 | INBOX | U-165 actor-proof observation; confirm ordinary Session path and scope boundary fix | — |
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
| [U-087](docs/backlog/U-087.md) | Squad tactics: bounding, focus fire and fighting as a group | Enemy AI | P3 | BLOCKED | Deferred by the owner (U-085); suppressive fire alone is proposed as U-201 | — |


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
