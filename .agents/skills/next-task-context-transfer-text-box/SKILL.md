---
name: next-task-context-transfer-text-box
description: Create a concise, copyable prompt for a new chat (Claude Code or Codex) to complete Sandline's next eligible task. Use when the owner asks for a next task context transfer text box, a handoff prompt, or next-chat instructions, especially after a merge.
---

# Next task context transfer text box

Give the owner one fenced `text` block to paste into a new chat. Keep it
self-contained and about 80–150 words. Producing the box does not claim or
implement the next task, and needs no confirmation.

## Refresh the evidence

1. If a task is in flight in this chat, finish it first under the delivery
   policy in `AGENTS.md` (merge its verified head when all four required CI jobs
   are green; keep REVIEW where a human verdict is pending). Never report an
   unmerged PR as merged. If blocked or the owner is handing off unfinished work
   because of usage limits, push a checkpoint with the current card handoff and
   make the box about resuming that task instead of selecting another.
2. Fetch main and list open PRs. For a resumption, also fetch the task branch
   and check its current claim and card. Otherwise pick the next eligible row
   with the next-task skill's selection rules
   (`.agents/skills/next-task/SKILL.md` step 1). Read only that card.

## Write the box

Include:

- The repository URL and the previous task's verified outcome and PR link.
- For unfinished work: the pushed branch and head SHA, PR link if any, current
  progress, checks passed/failed/unrun, and the concrete next action. Tell the
  new chat to resume that branch after checking its remote state and claims.
- The expected task ID (current task for a resumption, next task after a merge)
  and its plain-language outcome, marked as a snapshot: the new chat rechecks
  main, dependencies and open PRs before claiming or resuming.
- "Follow AGENTS.md and `.agents/skills/next-task/SKILL.md`." Those files carry
  the gates and the four CI jobs, so the box does not repeat them.
- The owner's sentence (2026-10-08), verbatim: "Complete the selected task and
  merge its verified head when all four required latest-head CI jobs are green."
- Any task-specific human verdict, asset or generator the card names.
- This skill's path, so the new chat can produce the next box.

Keep logs, history, credentials, session IDs and machine paths out. If nothing
is eligible, name the real blocker and the owner decision that would unblock
it, with a recommended default, instead of inventing a task.
