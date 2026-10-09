---
name: next-task
description: Complete one Sandline backlog task end to end — select the first eligible READY leaf (or the U-ID the user named), implement it, verify, open the PR and merge on green under the standing owner authorization. Use for "complete the next task", "do U-NNN", or the repo URL plus "next task".
---

# Complete one task

The task is the U-ID the user named (Claude passes it as `$ARGUMENTS`);
otherwise the first eligible row in `BACKLOG.md`. Rules and the delivery policy
are in `AGENTS.md`; this is the procedure. Keep moving: stop only for a real
missing owner decision, asset, permission or inaccessible dependency — and a
decision always comes with options and a recommended default.

## 1. Select (≈5 minutes, not an investigation)

1. Fetch `origin/main`; preserve any dirty work. Read `BACKLOG.md` and list open
   PRs and remote `task/*` branches — they are the claims.
2. Take the first **READY** row in table order whose dependencies are satisfied
   (DONE, archived in `docs/backlog/archive/`, or REVIEW with code merged on main
   unless the card needs that verdict). Skip rows another worker's PR/branch
   holds. Promote a BLOCKED row to READY when its only blockers were
   dependencies that are now satisfied; a missing decision or asset stays
   BLOCKED. An explicit ID overrides order, not dependencies: if it is blocked,
   say exactly by what and stop; if the blocker is an owner decision, present
   it with options and a recommended default (`AGENTS.md`, delivery policy).
3. **Nothing eligible?** Say so in one line, list each blocker in a short table,
   and propose at most three next steps — the top unqueued gaps in
   `docs/design/CONFLICT-PARITY.md`, or scoping an INBOX/BLOCKED row — and ask
   which to queue, with your recommended default. Do not invent work or mark a
   human gate passed.

## 2. Scope

4. Read the card, its "Read first" list, the ADRs it names and the code it
   points to (`docs/CODEMAP.md` for anything it doesn't). Check the card's
   pillar against `docs/VISION.md` when making design choices; settle open
   details with ADR-021's order and write `Conflict default: …` in the card.
5. If the card is bigger than one PR (size L ≈ 800 changed non-generated lines,
   or it mixes unrelated subsystems), split it into linked leaves first, in the
   same PR as the first leaf. Never split only to isolate a human review; put
   the verdict on the epic's verification card instead.
6. Branch `task/U-NNN-short-name` from main and push it; open the PR (draft is
   fine) as soon as there is a meaningful commit. The branch/PR is the claim —
   no separate claim-only commit.

## 3. Implement and verify

7. Bugs: reproduce on current code first, record observation separately from
   hypothesis, add a failing regression test, then fix the cause. If it won't
   reproduce, record the attempts and stop; never ship a speculative fix.
8. Implement only the card's scope. Record adjacent problems as new cards
   (report-feedback), don't absorb them.
9. Run focused tests, then `pnpm verify`, then whatever the change affects:
   generators (`pnpm gen:*`), `pnpm gen:nav` for world edits,
   `pnpm sim-run --scenario mission --all-missions --seeds 3` for AI/mission
   changes, budgets for assets (`docs/COMMANDS.md`). Never call an unrun check
   passed.
10. Visual/audio/feel work: give reproducible capture or listening steps and
    leave the verdict pending for the owner. Fixtures and fallback chirps prove
    infrastructure, not content.

## 4. Deliver (one PR, one final docs commit)

11. Final commit in the PR, together: the card's handoff (≤15 lines — PR,
    commands with pass/fail, criteria checked, pending verdict and where it is
    batched, follow-up IDs), one CHANGELOG line, and the BACKLOG row → **DONE**
    if every criterion is met, or **REVIEW** if only a human verdict remains.
    Close any linked legacy B-IDs only when the criteria are met. Commit messages
    are `U-NNN: description`.
12. Watch all four required CI jobs on the **latest pushed head SHA**. Fix
    failures within scope and push again. Skipped, cancelled, pending or
    older-head runs are not green. Report real run numbers and the head SHA.
13. Merge that verified head under the standing authorization (`AGENTS.md`),
    after merging main in and re-running CI if main moved. Confirm the merge on
    main. No follow-up documentation PR unless main's state differs from what
    the PR recorded. Without CI/merge access, stop at the green-locally PR and
    say what remains.
14. Report in a few lines: ID, outcome, PR, merge SHA, checks, pending human
    verdict. Stop — one task per request unless the user asked for more.

## Legacy and human gates

An explicit `T-` request follows `docs/LEGACY-TASK-WORKFLOW.md`. No procedure
may fabricate a playtest, fill in a human verdict or silently change a locked
decision. Old M2–M5 sign-offs do not block U-ID work.
