---
name: next-task-context-transfer-text-box
description: Create a concise, copyable prompt for a new chat to complete Sandline's next eligible task. Use when the owner requests a next task context transfer text box, a handoff prompt, or next-chat instructions, especially after a merge.
---

# Next task context transfer text box

Give the owner one fenced `text` block they can paste into a new chat. Keep it
self-contained and about 100–180 words. This skill prepares a handoff; creating
the box does not claim or implement the next task.

## Merge when green

The owner's standing instruction (2026-10-08) is to merge the task being
completed when green. Carry that authorization into every generated text box
for the one task the next chat completes. Include this sentence verbatim:

"Complete the selected task and merge its verified head when all four required latest-head CI jobs are green."

Respect branch protections and explicit pre-merge gates. Record remaining human
acceptance honestly: a task merged before its owner quality verdict stays in
REVIEW until that verdict is supplied; only accepted and merged work is DONE.
Follow any later explicit owner instruction that changes this delivery policy.

## Refresh the evidence

1. Read `AGENTS.md`, `CLAUDE.md`, `.claude/commands/next-task.md`, `BACKLOG.md`
   and the candidate task card. Fetch current remote state while preserving
   unrelated work; check open PRs and the repository's default branch.
2. Finish the task being completed under the merge-when-green instruction:
   check applicable acceptance gates and every required CI job on the final
   head, merge that verified head, and confirm the merge and task status on the
   target branch. Preserve any remaining human acceptance as REVIEW.
   Do not report an unmerged PR as merged. If blocked, state the real blocker
   and make the handoff about resuming it, rather than starting dependent work.
3. Select the first eligible READY **leaf** in backlog order with dependencies
   DONE, following the next-task workflow's status-refresh rules. Skip aggregate
   parent cards, human/asset/scope blockers and another worker's active task.
   Read only the selected card and evidence needed to support the handoff.

## Write the box

Include:

- Repository URL, the previous task's verified outcome and PR link.
- The expected next ID and a plain-language outcome. Tell the new chat to
  recheck fresh main, dependencies and open PRs before claiming it; this ID is a
  snapshot, not authority to bypass a changed queue.
- The instruction paths and a request to complete one focused task, splitting
  oversized scope as the card requires.
- Node >=22, pinned pnpm, `pnpm verify`, applicable budgets/generators and all
  four required latest-head CI jobs (`verify`, `streaming`, `parity-non-v8`,
  `mission`). Preserve any task-specific human acceptance gates.
- The explicit merge-when-green sentence above in every text box. It authorizes
  the one task being completed; verify its merge on the default branch and
  retain REVIEW wherever human acceptance remains pending.
- This skill's repository path, so the new chat can produce the next box.

Keep logs, historical summaries, credentials, session IDs and machine-specific
paths out of the prompt. If no leaf is eligible, name the actual blocker and
next action instead of inventing a task. Do not ask for confirmation merely to
generate the box. Outside it, report the completed action and link this skill.
