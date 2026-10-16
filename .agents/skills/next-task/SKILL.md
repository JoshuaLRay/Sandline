---
name: next-task
description: Complete one Sandline task — select a READY leaf or requested U-ID, implement, verify and merge when the current PR head is green under AGENTS.md.
---

# Complete one task

`AGENTS.md` owns the shared rules and delivery policy. This skill is the
task-specific **procedure**; read only the one card and its relevant references.

1. **Select:** refresh main; use `pnpm task:next` (explicit U-ID:
   `pnpm task:next --id U-NNN`). It inspects canonical active/archive
   statuses and remote branch/PR claims, read-only; requires authenticated
   `gh`. On parser/network/claim UNKNOWN or missing `gh`, inspect live
   `BACKLOG.md`, relevant archived dependencies, open PRs and remote
   `task/*` branches through available integrations. Unknown is not free.
   Recheck just before branching. First eligible unclaimed READY leaf wins;
   an explicit ID overrides order but never blockers. Update an actually
   unblocked BLOCKED row to READY in the canonical queue.
2. **If none:** report actual blockers; suggest at most three next scope
   choices from [parity tracker](../../../docs/design/CONFLICT-PARITY.md)
   or INBOX. Owner decision questions include options and one recommended
   default. Do not invent readiness or override a human acceptance gate.
3. **Scope:** read exactly one `docs/backlog/U-NNN.md` card and its
   `Read first` list. Refer to the relevant VISION/ADR sections when
   making a design decision; use CODEMAP only for unknown source locations.
   Write `Conflict default: …` in the card when ADR-021 settles a gap.
   Split work above ~800 changed non-generated lines or unrelated systems
   into linked leaves; leave human approval on the epic verification card.
4. **Claim:** branch `task/U-NNN-short-name` from current main, push meaningful
   work, and open a PR promptly (draft acceptable). The branch/PR is the claim.
5. **Build:** bugs need a reproduced symptom and failing regression test
   first; if not reproducible, record attempts and stop. Keep scope narrow.
   Push checkpoints within 15 minutes of active edits. On interruption,
   follow [handoff skill](../next-task-context-transfer-text-box/SKILL.md)
   for a pushed WIP state and a compact task-card handoff.
6. **Verify:** run focused tests, `pnpm verify`, and affected generators,
   simulations, asset checks or browser checks from `docs/COMMANDS.md`.
   Visual/audio acceptance needs a reproducible artifact and an honest
   pending owner verdict, never a fabricated sign-off.
7. **Deliver:** one PR includes ≤15-line card handoff, one CHANGELOG entry
   and canonical status (DONE archived; REVIEW remains active if human
   verdict pending). Preserve stable links/evidence. Check all four required
   CI jobs on the latest PR head; sync and rerun if main advanced. Merge only
   as allowed by `AGENTS.md` and verify resulting main. Report task ID,
   PR, merge SHA, checks and any remaining verdict. Stop after this task
   unless the owner asked for multiple.

For an explicit legacy T-ID use `docs/LEGACY-TASK-WORKFLOW.md`. Never
fabricate a playtest or silently modify a locked ADR.
