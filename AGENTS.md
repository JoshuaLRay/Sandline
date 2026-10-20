# Sandline — agent entry point

Shared brief for Codex (direct) and Claude Code (`CLAUDE.md` imports this).
The repository is the durable project memory. Procedures are in
`.agents/skills/`; nested `AGENTS.md` files apply per package (especially
`packages/shared/AGENTS.md`). Do not reload old chat history.

## Identity and design authority

**Sandline is Conflict: Desert Storm with a squad of six.** Original-IP browser
co-op in Afghanistan 2001–02: 1–6 humans command/switch among six soldiers,
bots fill empty slots, loot persists across objective missions, and all six
must survive. Read relevant [vision](docs/VISION.md) sections for design work.
References: Desert Storm II primary, Desert Storm and selectively Global Storm
([ADR-022](docs/adr/022-conflict-reference-scope.md)); maps vary their tactical
approaches ([ADR-023](docs/adr/023-flexible-mission-routes.md)); any soldier may
use any equipment, with Marsh left-handed ([ADR-024](docs/adr/024-equipment-freedom-and-loot.md)).
Do not add character-exclusive loadouts. Loot rules await the owner's U-184
design session. Unspecified gameplay: owner decision → locked ADR → Conflict
default adapted to six/co-op ([ADR-021](docs/adr/021-conflict-gameplay-reference.md))
→ smallest reversible proposal. Record `Conflict default: …` in the card.

## Request routing (load only the applicable skill)

- Next eligible task or explicit U-ID → [next-task](.agents/skills/next-task/SKILL.md).
- Bug/playtest/idea → [report-feedback](.agents/skills/report-feedback/SKILL.md);
  record first and implement only on request.
- Queue/build Conflict gap → [parity tracker](docs/design/CONFLICT-PARITY.md),
  report-feedback, then next-task only if asked to build.
- New-chat handoff → [handoff](.agents/skills/next-task-context-transfer-text-box/SKILL.md).
- Loot decision L-NN → [U-184](docs/backlog/U-184.md) and
  [loot §15](docs/design/LOOT-PROGRESSION.md); update blocked rows.
- Legacy T-ID → `TASKS.md`, relevant `PLAN.md` section and
  `docs/LEGACY-TASK-WORKFLOW.md`. Status/question → relevant files/PRs.
  A repository URL alone does not authorize implementation.

## Minimal read ladder

1. Select via `pnpm task:next` (explicit ID: `--id U-NNN`); it examines
   active/archived dependencies and remote claims. If unavailable or UNKNOWN,
   manually check current main, queue, applicable archive entries, PRs and task
   branches. **Unknown claim status is never "unclaimed."**
2. Read only the chosen `docs/backlog/U-NNN.md` and its `Read first` paths.
3. For unknown source locations use [CODEMAP](docs/CODEMAP.md); read relevant
   functions, ADR sections, and affected [commands](docs/COMMANDS.md).
4. Use history only for an explicit legacy task, dependency or regression.

Search before opening. Read bounded ranges of files over ~300 lines. Never
preload `PLAN.md`, full `docs/CHANGELOG.md`, all ADRs, archive, map specs
or playtest sheets. For uncommon traps/terms see the optional
[agent reference](docs/AGENT-REFERENCE.md).

## Delivery and safety — mandatory

- `BACKLOG.md` owns the active queue (INBOX, READY, IN_PROGRESS, BLOCKED,
  REVIEW). DONE/CANCELLED rows live only in dated `docs/backlog/archive/`;
  task-card paths remain stable. Dependencies: DONE (including archived) or
  **REVIEW whose code is merged on main** (unless the dependent card requires
  its human verdict); CANCELLED never satisfies a dependency. Check for
  another worker's branch/PR claim before starting.
- One task per request/PR unless explicitly batched. Push small meaningful
  checkpoints within 15 minutes of active edits and before long checks or
  handoffs. Interrupted work gets a pushed labelled WIP commit and the card's
  ≤15-line handoff (task, branch, PR, SHA, changed files, completed work,
  pass/fail/unrun tests and CI, blockers, exact next action). WIP does not
  waive final gates. Preserve other workers' work.
- **Standing owner authorization (2026-10-08): merge this task's PR when green.**
  Require all four jobs — `verify`, `streaming`, `parity-non-v8`,
  `mission` — successful on its **latest head SHA**, with a mergeable PR.
  Active results must come from owner-only GitHub App **5384278**
  (`joshualray-private-ci-checks`), backed by manually reviewed exact-SHA runs
  in `JoshuaLRay/Private-CI-Controller`. Use its owner-side evidence/merge gate;
  same-name checks from another App are not equivalent. The full source hosted
  workflow is manual rollback/deployment only. Never register a source runner
  or let source events dispatch work on the home PC.
  Pending, failed, skipped, missing, cancelled or stale checks are NOT green.
  If main advances, synchronize safely and rerun checks. Merge with an
  expected-head-SHA guard and verify the new main commit. Do not merge an
  intake-only PR, someone else's PR or an owner-held PR.
- Run focused tests, `pnpm verify` and task-affected generators, mission
  simulations or budgets; never call an unrun test passed or weaken a gate.
  New shared logic needs unit tests; netcode changes need headless integration
  tests. Keep a concise task-card evidence handoff, one CHANGELOG line and
  canonical backlog status in the same PR; archive DONE, leave unfinished
  human signoff as REVIEW. Verdicts on playing, visuals or real voices remain
  the owner's; never fabricate them. Batch human reviews on the epic card.
- Real owner-only decisions need 2–3 choices with player-facing tradeoffs,
  a **recommended default** and a recorded blocker in card/backlog; await
  owner choice, work on other READY tasks. Preserve locked ADRs; owner changes
  need an explicit addendum or superseding ADR. If CI/merge access is lacking,
  stop at the PR and report exactly what remains.

## Engineering invariants

- `packages/shared` is platform-free and cross-engine deterministic: no
  `three`, `ws`, `fs`, wall clock, `Math.random` or non-deterministic
  trig. Use seeded math, bounded parity (not bit equality). Read
  [shared rules](packages/shared/AGENTS.md) before editing it.
- Bot and human slots share their entity path (ADR-001); new actions need a
  bot/order path or a documented exception.
- Tuning is zod-validated JSON in `packages/shared/src/data`. No new
  runtime dependency without an ADR; update generated assets with generators.
- Wire changes bump `PROTOCOL_VERSION` and its tests.

Node ≥22, pnpm 10.33.0. `pnpm verify` is mandatory. Commands and special
QA steps are in [COMMANDS](docs/COMMANDS.md), read on demand.
For bounded log/diff/CI output and honest context measurement, consult
[agent output guidance](docs/AGENT-OUTPUT.md) when executing or reporting work.
