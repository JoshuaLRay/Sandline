# Proposal: Token-efficient agent workflow

**Status:** Proposed — implementation not yet started  
**Date:** 2026-10-16  
**Scope:** Agent orchestration, backlog maintenance, documentation retrieval and handoffs; no gameplay or CI-gate changes.

## Why this exists

Sandline's repository is the durable memory for Claude Code, Codex and other agents. That is the right design, but as the project grows, agents spend increasing context and tool calls locating the next task, rereading broad documentation, reconstructing completed work and writing handoffs that the next chat will revalidate.

**Principle: comprehensive documentation, minimal context consumption.** Preserve design detail and proof; make routine reads narrower, deterministic and on demand.

### Baseline snapshot (2026-10-16)

| Item | Approximate size / state | Observation |
| --- | ---: | --- |
| `PLAN.md` | 435 KB | Legacy milestone history; should not be read end to end |
| `docs/CHANGELOG.md` | 170 KB | Append-only history; task lookup should not require it |
| `docs/COMMANDS.md` | 65 KB | Reference commands; select relevant rows |
| `BACKLOG.md` | 28 KB | 98 task rows, including 32 marked DONE and 7 READY |
| `AGENTS.md` | 11 KB | Shared auto-loaded briefing and policies |

These are file-size and backlog snapshots, **not measured input-token costs**. Recheck the counts before implementing cleanup.

### Existing safeguards to retain

- `AGENTS.md` already defines a read budget, one task per request, shared policies and a 15-line task-card handoff.
- `CLAUDE.md` imports `AGENTS.md`; the `.agents/skills/` procedures are canonical and Claude's slash commands are wrappers.
- `BACKLOG.md` is the sole authority for active task state and order; individual `docs/backlog/U-NNN.md` cards own scope and acceptance.
- `docs/WORKFLOW.md` recommends fresh chats for successive tasks. PR branches are work claims, and a green local test does not replace latest-head CI.

The proposal improves these practices rather than creating competing indexes or a second source of truth.

## Goals and non-goals

**Goals**

1. Select the next eligible task without an AI scanning and reasoning over the full backlog.
2. Load only the chosen task card and relevant source, ADR or specification sections.
3. Make completed-task handoffs very short; persist interrupted-task state in the repository.
4. Reduce repeated history, oversized tool responses and irrelevant successful-test logs.
5. Measure actual effect before declaring token savings, while preserving task-selection correctness.

**Non-goals**

- Deleting or aggressively summarizing canonical design decisions, original feedback, acceptance criteria or verification evidence.
- Relaxing `pnpm verify`, affected generators, the four latest-head CI jobs, human verdicts, dependency checks or the owner's merge policy.
- Introducing an external issue tracker, vector database, memory service or paid dependency.
- Automatically implementing additional tasks or rewriting old `PLAN.md` sections.

## Proposed operating model

### 1. Deterministic, read-only next-task selector

Add a small Node-based command, exposed as **`pnpm task:next`** (final file location should follow existing tools conventions). Its normal output is a **small human-readable or JSON result**, not a dump of the queue.

Example shape, illustrative only:

```json
{
  "task_id": "U-177",
  "card": "docs/backlog/U-177.md",
  "status": "READY",
  "dependencies": "satisfied",
  "claim": "unclaimed (remote checked)"
}
```

Rules:

1. Parse the ordered active rows in `BACKLOG.md` once. Preserve table order, not a new priority algorithm. Omit aggregate closure rows from executable selection.
2. For each READY leaf, verify dependencies exactly as `AGENTS.md` specifies: DONE, archived DONE, or REVIEW whose code is merged on main, except when the dependent card explicitly requires the human verdict. Archived CANCELLED does **not** satisfy a dependency.
3. Check fresh open PRs **and** remote `task/U-NNN-*` branches for claims. If an existing task is in progress, resume or skip it according to the existing skill; never create a competing branch.
4. Select the first eligible unclaimed task. An explicit `--id U-NNN` overrides order but **not** blockers or claims. Do not silently convert BLOCKED to READY; report candidates to promote separately for a deliberate canonical backlog update.
5. If GitHub is unreachable, a remote claim check is incomplete or the backlog format is invalid, report `unknown`/an actionable error rather than claiming the task is free. Allow an agent/manual fallback; do not fabricate certainty.
6. Return concise context: U-ID, outcome, card path, dependency result, claim result and (when known) PR/branch reference. Provide a verbose `--explain` option for troubleshooting only.

The selector should not read `PLAN.md`, changelogs, unrelated cards or source files; it should not mutate the backlog. Keep remote queries bounded and revalidate claims immediately before pushing a task branch, to minimize races. A deterministic selector cannot make concurrent work claims atomic; branch/PR creation remains the coordination point.

**Integration:** Update `.agents/skills/next-task/SKILL.md` to invoke this selector first, with the current manual selection rules as the fallback. Keep the same merge authorization and verification gates.

### 2. Actually archive completed backlog rows

`BACKLOG.md` says it holds only active work, but DONE rows still appear there. Move completed **rows** to `docs/backlog/archive/` in a controlled, link-preserving migration:

- Retain stable `docs/backlog/U-NNN.md` card paths and their original evidence/handoffs; do not move or delete cards merely to shrink the active index.
- Preserve task ID, outcome, status, dependencies, PR, date and provenance in the archive. Existing archive data remains authoritative where present; detect duplicates or contradictions before editing.
- Keep active INBOX, READY, IN_PROGRESS, BLOCKED and REVIEW rows in their original relative order.
- Do not remove a row that is marked DONE if its documentation or merged state is contradictory; flag it for review.
- Add a light validation test to prevent new DONE rows lingering in the active table and ensure every referenced dependency still resolves to an active or archived record.

Long historical documents remain available for explicit legacy work and targeted search; do not rewrite or load them routinely.

### 3. Thin agent bootstrap; progressive disclosure

Keep `AGENTS.md` as the sole shared universal entry point. Retain mission identity, route-to-skill mapping, important safety/engineering constraints, owner authority and merge/test policy. Move repetitive examples and detailed procedures behind the existing skills or reference documents, without changing their meaning.

Use a strict read ladder:

1. Selector output (or the first eligible row using the fallback).
2. Exactly one `docs/backlog/U-NNN.md` task card.
3. Only that card's `Read first` paths and sections; use `docs/CODEMAP.md` to find unknown entry points.
4. The relevant source functions, relevant ADR sections and commands, as needed.
5. History/archives only when validating a dependency, investigating a regression, or resolving a real conflict.

Search first, then open bounded ranges. For files above roughly 300 lines, use targeted symbols/sections rather than full-file retrieval. Never preload `PLAN.md`, `docs/CHANGELOG.md`, every ADR, every map spec or the entire archive.

### 4. Persist state once; simplify context handoffs

**Completed and merged task:** The next chat should select afresh from main. Do **not** spend a separate pass identifying the next task and reading its card just to compose a handoff, because the next agent must verify freshness anyway. A roughly 30–60-word pointer suffices:

```text
Continue Sandline at https://github.com/JoshuaLRay/Sandline/.
Read AGENTS.md and follow .agents/skills/next-task/SKILL.md.
Select the next eligible unclaimed task from current main, implement it,
run required verification, and merge its verified head when green.
```

**Interrupted task:** Keep its canonical `Handoff / evidence` section to 15 lines or fewer, with U-ID, pushed branch, PR, head SHA, completed work, exact pass/fail/unrun checks, blockers and next action. The copyable handoff points there and says **resume and revalidate**; it does not repeat logs or recreate a parallel session history.

Update `.agents/skills/next-task-context-transfer-text-box/SKILL.md` and its Claude wrapper only as required. Preserve the owner's explicit "merge when green" authorization in the canonical policy and do not misreport pending or failed CI as green.

### 5. Bound tool and test output, not necessary checks

- Use `rg`/symbol search and line-bounded reads; avoid full module dumps, especially large session or map-generation files.
- Send successful test output to a local log and surface a short command, result, duration and relevant counters. On failure, show the actionable failing section and retain the full log locally for targeted inspection.
- Summarize a diff by changed paths and substantive changes before opening the entire patch. For CI, report job name, status, run, SHA and relevant failure details.
- Generated files, snapshots and proof artifacts remain committed wherever the existing workflow requires them; this policy only reduces redundant *context output*.
- Do not truncate diagnostics so aggressively that a fix becomes speculative. The agent must still run and check every required gate.

## Rollout: small, independently reviewable PRs

| Order | Deliverable | Definition of done |
| --- | --- | --- |
| 1 | Read-only selector + fixture tests | Respects ordering, READY/dependency policy, merged REVIEW, CANCELLED archive, active claims, explicit U-ID and unavailable remote evidence |
| 2 | Backlog archive cleanup + consistency check | Historical rows and links preserved; active index contains no completed rows; no state or priority drift |
| 3 | Agent/skill/handoff adjustments | Existing Claude and Codex routing preserved; fresh next-task and interrupted-resume flows documented and tested |
| 4 | Optional output conventions and measurement | Logs/diffs are bounded where safe; before/after context data and failure cases recorded |

Prefer a single small PR per stage; do not bundle backlog reshuffling with unrelated gameplay implementation. If validation reveals hidden coupling, stop and address it explicitly rather than weakening checks.

## Acceptance tests and guardrails

- **Selection fixtures:** first READY; blocked dependency; archived DONE vs CANCELLED; REVIEW merged vs unmerged; manual-verdict requirement; aggregate row; claimed branch; open PR; explicit ID; invalid row; network outage.
- **Concurrency:** two simultaneous agents must not both confidently claim the same known branch/PR; acknowledge the unavoidable race before branch creation and verify again when creating it.
- **Documentation:** original task cards, ADRs, archive records, source links and human evidence remain accessible; no new competing status field or authority.
- **Handoff:** a clean new chat can identify work from the repo alone; an interrupted new chat can resume the exact pushed commit without copying the prior conversation.
- **Delivery:** relevant automated tests plus required project verification pass for implementation PRs; no skipped CI job is described as passing.

## Measure effectiveness honestly

Record a representative sample of task starts **before and after** rollout (simple feature, bug, complex map or multiplayer task), using comparable agents/configurations where practical:

| Metric | Why |
| --- | --- |
| Input tokens used before editing | Direct proxy for context-reconstruction overhead, if available |
| Number/size of files retrieved | Tracks unnecessary full-document reads |
| Tool calls and elapsed time to select a task | Shows discovery overhead |
| Handoff tokens | Detects repeated narrative history |
| Wrong claims, missed blockers, incorrect task choice | Correctness guardrail; must not regress |
| Total task tokens, rework and test failures | Ensures local savings do not shift costs downstream |

Record measurements and method; do not promise a token-saving percentage from byte counts or anecdotal runs. Favor a reversible rollout if the selector or abbreviated handoffs cause ambiguity.

## First implementation instruction

Implement **stage 1 only** first. Add the selector and test fixtures, wire it into the next-task skill with a fail-closed manual fallback, and demonstrate a correct result against current main. Then propose the archive migration as its own PR. **This document is a proposal, not authorization to merge future implementation PRs or change Sandline's existing tests, owner decisions or gameplay.**
