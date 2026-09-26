Complete one eligible task for Sandline. An explicit ID in $ARGUMENTS selects
that task; otherwise use the first eligible row in `BACKLOG.md`.

## Select and claim

1. Confirm the checkout is `JoshuaLRay/Sandline`; fetch current remote state.
   Preserve dirty work. Start from the repository default branch unless resuming
   an existing task branch. Read `BACKLOG.md` before task implementation files.
2. Check open PRs and task work links, including pending feedback/documentation
   PRs, so captured reports and existing implementations are not overlooked.
   If requested feedback exists only in an unmerged PR, use that branch as an
   explicit documented dependency or finish its authorized merge first; do not
   silently pretend its rows are already on main. Refresh stale REVIEW entries
   from actual merge/acceptance evidence before selecting dependent work.
3. Select the first READY leaf in table order with all dependencies DONE. Promote
   dependency-only BLOCKED rows when their dependencies have actually completed;
   skip owner/asset/scope blockers, REVIEW and another worker's IN_PROGRESS rows.
   Resume a branch only when this request owns/continues that task. If the owner
   specifies a blocked task, explain its exact blocker; do not implement a guess.
4. Read just that card, applicable nested instructions and relevant ADRs/code.
   State the selected ID/outcome. Create `task/U-NNN-short-name`; mark IN_PROGRESS
   with the branch in the Work column. Recheck remote work before publishing the
   claim. If a task exceeds a focused PR, split it into linked leaves first.
   A shared GitHub issue assignee can be used as a coordination lock if multiple
   workers are active; it does not become a second backlog.

## Implement and verify

5. For a reported bug, inspect existing fixes and reproduce on current code.
   Record observations separately from hypotheses. Add a targeted failing
   regression where possible, then fix the cause. If not reproducible, record
   exact attempts and missing evidence; do not claim it fixed or add speculative
   behavior. Move genuinely blocked work to BLOCKED with a next action.
6. Implement only the selected scope, following its acceptance criteria. Resolve
   routine details locally; stop only for a real missing product decision, asset,
   permission or inaccessible dependency. Record adjacent issues as new cards;
   do not absorb them into the current task.
7. Run focused verification first, then `pnpm verify`. Run additional commands
   required by affected generators/protocol/CI; use `docs/COMMANDS.md` on demand.
   Walk every criterion and record actual evidence. For pure documentation work,
   validate links, dependency order and instruction consistency; repository CI
   still applies. Never describe an unrun check as passed.
8. Visual/audio work includes reproducible captures or listening steps and a
   clearly pending owner quality verdict wherever required. An actual source
   asset is an acceptance requirement when delivering voices; fixtures and
   fallback chirps only prove infrastructure. Design approval is also evidence,
   not something the agent invents.

## Deliver

9. Update the card with commands/results, criteria checked, unresolved review
   points and next action. Append a completion/change line to `docs/CHANGELOG.md`.
   Mark REVIEW when implementation is ready for review; maintain any linked B-ID
   history without prematurely marking it fixed. Commit as `U-NNN: description`,
   push and open/update one PR linking the card and evidence. Report the PR URL.
10. Watch all required CI checks for the **latest pushed head SHA**. Inspect
    failures, fix causes within scope, commit/push and repeat. Report real run
    numbers and head SHAs; a run's database ID is not its displayed run number.
    A skipped/missing/pending/cancelled check is not a successful run. Do not rely
    on a green result from an older commit. Surface infrastructure/access blockers.
11. With no merge authorization, leave the green PR in REVIEW and say exactly
    what remains. With current/standing merge authorization, resolve conflicts,
    verify acceptance/reviews and checks, then merge only the verified head.
    Where every criterion is met, a final PR commit may propose DONE in the index
    and close linked B-ID rows; that status becomes true only when that commit
    lands on the target branch. Wait for CI again after that final edit. If merged
    before acceptance is complete, retain REVIEW until acceptance is recorded.
12. Verify the merge on the target branch. Refresh status/evidence as needed in a
    small documentation follow-up, and unlock dependents only from actual DONE
    evidence. Report ID, outcome, PR, checks and remaining human review. Stop after
    this task; “next task” does not authorize draining the whole queue.

## Legacy and human gates

An explicit `T-` request follows `docs/LEGACY-TASK-WORKFLOW.md`. Old M2–M5
sign-offs do not block independent U-ID work. No procedure may fabricate a
playtest, fill in a human verdict or silently change a locked product decision.
If no U-ID is eligible, report its blockers and available legacy options.
