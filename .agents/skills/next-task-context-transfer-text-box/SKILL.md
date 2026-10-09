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
   unmerged PR as merged. If blocked, make the box about resuming it.
2. Fetch main and list open PRs. Pick the next eligible row with the next-task
   skill's selection rules (`.agents/skills/next-task/SKILL.md` step 1). Read
   only that card.

## Write the box

Include:

- The repository URL and the previous task's verified outcome and PR link.
- The expected next ID and its plain-language outcome, marked as a snapshot:
  the new chat rechecks main, dependencies and open PRs before claiming.
- "Follow AGENTS.md and `.agents/skills/next-task/SKILL.md`." Those files carry
  the gates and the four CI jobs, so the box does not repeat them.
- The owner's sentence (2026-10-08), verbatim: "Complete the selected task and
  merge its verified head when all four required latest-head CI jobs are green."
- Any task-specific human verdict, asset or generator the card names.
- This skill's path, so the new chat can produce the next box.

Keep logs, history, credentials, session IDs and machine paths out. If nothing
is eligible, name the real blocker and the owner decision that would unblock
it, instead of inventing a task.
