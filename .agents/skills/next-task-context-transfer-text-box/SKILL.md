---
name: next-task-context-transfer-text-box
description: Create a compact copyable Sandline new-chat pointer after a merge or an exact resumption pointer for unfinished pushed work.
---

# Context handoffs: fresh vs interrupted

Give the owner **one fenced `text` block**. Never copy chat history, huge
diffs, logs, credentials or machine paths. The repository/card stores durable
context. Always distinguish the two cases.

## Completed and merged: a 30–60-word pointer

First verify the previous PR actually merged if reporting that outcome.
**Do not preselect the next task**, read a new task card or do separate
discovery just to create a handoff. The new agent rechecks main, claims and
eligibility. Example (replace only verified placeholders):

```text
Continue Sandline at https://github.com/JoshuaLRay/Sandline.
Previous: [U-ID or task], merged PR [URL] at [main commit SHA].
Read AGENTS.md and .agents/skills/next-task/SKILL.md. Select an eligible
unclaimed task afresh from current main, implement and verify it, then merge
its latest verified head only when all four required CI jobs are green.
```

If the previous outcome is unverified, omit the merge claim; do not guess.

## Interrupted: card handoff of at most 15 lines

Push a labelled WIP checkpoint **before** handing off. Update the current
`docs/backlog/U-NNN.md` **Handoff / evidence** section, including precise
pass/fail/unrun values; these are the required fields:

```text
Task: U-NNN — [objective]
Branch: task/U-NNN-...; PR: [URL or none]; head: [full SHA]
Files changed: [relevant paths]
Completed: [implemented work and evidence]
Tests: [focused/pnpm verify/affected commands: pass/fail/unrun]
CI: verify=[status]; streaming=[status]; parity-non-v8=[status]; mission=[status]
Blockers: [specifics or none]; human verdict: [pending/not applicable]
Next action: [exact command, file edit or verification]
```

The copyable box names the repo URL, U-ID, pushed branch, PR, full head SHA
and card path; tells the next agent to verify current remote main/branch/PR
and resume that exact state; and points to `AGENTS.md` and
`.agents/skills/next-task/SKILL.md`. The *card* is authoritative for files,
progress, checks, blockers and next action. Do not duplicate its narrative
in the box. If no checkpoint is pushed, say the missing work is not resumable
from GitHub. Never call stale/pending/unrun CI passing, invent a human verdict,
or claim another worker's task. If blocked by an owner decision, name the
question, options and recommended default.

This handoff procedure does not itself claim, implement or authorize merging
an unrelated task.
