# Ongoing upgrades and bugs

This is the canonical queue for **“complete the next task”** after the vertical
slice, starting 2026-09-26. Read this index and exactly one task card. The queue
order below is the initial triage recommendation; the owner can reprioritize it.
[Workflow and example prompts](docs/WORKFLOW.md) · [original feedback](docs/backlog/2026-09-26-feedback.md)

`TASKS.md` / `PLAN.md` retain milestone history and outstanding legacy work;
this queue does **not** declare their human gates passed. New upgrades get `U-`
IDs; old `T-` and `B-` IDs remain stable. Do not maintain a duplicate status in a
GitHub Issue, task card or `PLAN.md`. PRs link to the canonical card.

## Selection and status

- Select the **first READY leaf in table order with all dependencies DONE**.
  Skip blocked/review/in-progress items and continue; do not stop at a human gate.
- After verifying a dependency merged/completed, promote a dependency-only BLOCKED
  row to READY when *all* its dependencies are DONE. A missing asset/decision or
  unresolved scope remains BLOCKED. Never infer completion from a PR title.
- An explicit task ID overrides queue order, but not its dependencies. Resume an
  existing task branch/PR when appropriate; never create a competing implementation.
- **INBOX** = captured, not yet scoped; **READY** = executable; **IN_PROGRESS** =
  claimed (branch/PR in Work column); **BLOCKED** = exact dependency/decision/asset
  missing; **REVIEW** = PR/owner acceptance pending; **DONE** = accepted and merged
  on the target branch with evidence. Design-only tasks still need their stated
  decision/approval. **CANCELLED** = intentionally closed with a reason, not DONE.
- P0 = prevents play/data integrity; P1 = current playability/feel; P2 = expansion.
  Priority describes impact; table order decides ties and actual execution order.
- Epics group outcomes, not work units. Oversized cards must be split before READY.
  Reproduction/fix work may stay one card when its scope is bounded; never claim an
  uncertain cause as fact.

## Ordered work queue

| Task | Outcome | Epic | Priority | Status | Depends / blocker | Work |
|---|---|---|---|---|---|---|
| [U-001](docs/backlog/U-001.md) | Restore reliable mission enemy pressure | Mission | P1 | DONE | — | [#132](https://github.com/JoshuaLRay/Sandline/pull/132) |
| [U-002](docs/backlog/U-002.md) | Correct authoritative firing origins for every stance | Weapon feel | P1 | READY | — | — |
| [U-003](docs/backlog/U-003.md) | Align AR muzzle flash and tracers with the visible gun | Weapon feel | P1 | BLOCKED | U-002 | — |
| [U-004](docs/backlog/U-004.md) | Open the AR sight picture | Weapon feel | P1 | READY | — | — |
| [U-005](docs/backlog/U-005.md) | Bind 1 to primary and 2 to pistol | Weapon feel | P1 | READY | — | — |
| [U-006](docs/backlog/U-006.md) | Keep the gun visible during a readable reload animation | Weapon feel | P1 | READY | — | — |
| [U-007](docs/backlog/U-007.md) | Make reload sounds audible and synchronized | Audio | P1 | READY | — | — |
| [U-008](docs/backlog/U-008.md) | Correct excessive right panning of the local gun | Audio | P1 | READY | — | — |
| [U-024](docs/backlog/U-024.md) | Keep grenade and rocket counts synchronized | Maintenance | P1 | READY | — | — |
| [U-009](docs/backlog/U-009.md) | Add an interaction-driven upload objective | Mission | P1 | READY | — | — |
| [U-010](docs/backlog/U-010.md) | Let enemies interrupt uploads by using the lever | Mission | P1 | BLOCKED | U-009 | — |
| [U-011](docs/backlog/U-011.md) | Replace mission-01 hold timers with active objectives | Mission | P1 | BLOCKED | U-001, U-009, U-010 | — |
| [U-012](docs/backlog/U-012.md) | Define voice cues and extend event routing | Audio | P2 | READY | — | — |
| [U-013](docs/backlog/U-013.md) | Supply and process the real voice recordings | Audio | P2 | BLOCKED | U-012; owner recordings or explicit ADR-017 change | — |
| [U-014](docs/backlog/U-014.md) | Play intelligible radio-treated squad dialogue | Audio | P2 | BLOCKED | U-012, U-013 | — |
| [U-015](docs/backlog/U-015.md) | Add friendly hit, downed and death vocal reactions | Audio | P2 | BLOCKED | U-012, U-013 | — |
| [U-016](docs/backlog/U-016.md) | Add positional enemy engagement shouts | Audio | P2 | BLOCKED | U-012, U-013 | — |
| [U-017](docs/backlog/U-017.md) | Drop enemy weapons as replicated world pickups | Loot | P2 | READY | — | — |
| [U-018](docs/backlog/U-018.md) | Equip dropped guns into the primary slot | Loot | P2 | BLOCKED | U-017 | — |
| [U-019](docs/backlog/U-019.md) | Specify the six named characters and their skills | Squad | P2 | READY | — | — |
| [U-020](docs/backlog/U-020.md) | Add the roster’s missing weapon archetypes | Squad | P2 | BLOCKED | U-019 | — |
| [U-021](docs/backlog/U-021.md) | Bind six persistent characters to the squad slots | Squad | P2 | BLOCKED | U-019, U-020 | — |
| [U-022](docs/backlog/U-022.md) | Implement the faster dual-primary support role | Squad | P2 | BLOCKED | U-018, U-021 | — |
| [U-023](docs/backlog/U-023.md) | Break approved character skills into implementation tasks | Squad | P2 | BLOCKED | U-019 | — |

## Existing work retained

- B-09 and B-18 now execute through U-002 and U-024; `docs/BUGS.md` keeps their
  report history and links. New reports go here instead of starting a second list.
- B-11 / T-5.06 (remaining squad AI close-fight/bounding work) stays in
  `TASKS.md` and `PLAN.md` §7.12. It is not automatically the cause of U-001.
- M2–M5 human playtests, lighting and deployment/cost decisions remain in
  `TASKS.md`. Request their explicit IDs to work those gates. If this queue has
  no eligible work, report remaining blockers and legacy options; don't silently
  invent a task or mark a human gate passed.

## Adding and maintaining work

Follow [.claude/commands/report-feedback.md](.claude/commands/report-feedback.md).
Use [the card template](docs/backlog/TEMPLATE.md); allocate the next unused U ID
from all active/archived cards (never renumber or reuse). Status belongs in this
index; detailed findings, reproduction and evidence belong in the card. Append a
single completion entry to `docs/CHANGELOG.md` with the U ID and PR reference.
Keep completed rows until this index becomes unwieldy; then move them to a dated
archive under `docs/backlog/archive/` with their evidence links. Selection checks
archived DONE dependencies too. Do not load archives during ordinary selection.
