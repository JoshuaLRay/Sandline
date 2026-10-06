---
name: next-task-context-transfer-text-box
description: Create a concise, copyable prompt for a new chat to complete Sandline's next eligible task. Use when the owner requests a next task context transfer text box, a handoff prompt, or next-chat instructions, especially after a merge.
---

# Next task context transfer text box

Give the owner one fenced `text` block they can paste into a new chat. Keep it
self-contained and about 100–180 words. This skill prepares a handoff; creating
the box does not claim or implement the next task.

## Refresh the evidence

1. Read `AGENTS.md`, `CLAUDE.md`, `.claude/commands/next-task.md`, `BACKLOG.md`
   and the candidate task card. Fetch current remote state while preserving
   unrelated work; check open PRs and the repository's default branch.
2. If the owner requested a merge, finish the authorized task workflow first:
   check acceptance and every required CI job on the final head, merge that
   verified head, and confirm the merge and task status on the target branch.
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
- Delivery as a green PR in REVIEW unless the owner explicitly authorized the
  next task's merge. A request to merge the previous PR is not standing merge
  permission for future tasks.
- This skill's repository path, so the new chat can produce the next box.

Keep logs, historical summaries, credentials, session IDs and machine-specific
paths out of the prompt. If no leaf is eligible, name the actual blocker and
next action instead of inventing a task. Do not ask for confirmation merely to
generate the box. Outside it, report the completed action and link this skill.
