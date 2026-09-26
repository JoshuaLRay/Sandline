# Working with Claude Code on Sandline

The repository is the durable project memory. Keep the short routing rules in
`CLAUDE.md`, the ordered queue in `BACKLOG.md`, and each task's scope/evidence in
one `docs/backlog/U-NNN.md` file. Claude reads one card and the relevant code;
it does not need the full historical `PLAN.md` or every past conversation.

## One-time setup

1. Use a current clone of `https://github.com/JoshuaLRay/Sandline/` with these
   workflow files merged, then launch Claude Code in that checkout (or select this
   repository in a hosted Claude Code session). A URL alone in an unrelated
   working directory does not automatically load this repository's instructions.
2. Give that environment normal GitHub read/write/PR access; use GitHub CLI (`gh`)
   or an available GitHub integration for PRs/checks. Install Node >=22 and use
   the pnpm version pinned in `package.json`; run `pnpm install --frozen-lockfile`.
3. Confirm Claude sees the root `CLAUDE.md` using its context display or by asking
   it to state this repo's task-routing rules. Follow normal tool permissions;
   this setup requires no permission bypass or external issue-tracking service.

These are repository instructions, not a background service or a guarantee that
an agent cannot make a mistake. Evidence, checks and explicit statuses make its
work reviewable. No custom plugin is required for either natural-language prompt.

## Prompts

| You say | Claude should do |
|---|---|
| `Complete the next task for https://github.com/JoshuaLRay/Sandline/` | Refresh work/PR state, select the first eligible READY leaf, implement, test, create a PR and follow its latest CI to green. |
| `https://github.com/JoshuaLRay/Sandline/ The AR reload goes silent after retrying a checkpoint.` | Save/extend a task and its acceptance criteria first, then ask whether you want it completed now. |
| `https://github.com/JoshuaLRay/Sandline/ Fix that reload problem now.` | Record the report, then implement its task without a redundant confirmation. |
| `Complete U-005 and merge when all checks pass.` | Execute that unblocked task, verify current checks/acceptance, then merge; never merge a stale head. |
| `Move U-019 ahead of the audio work.` | Reorder the queue; preserve task IDs and dependencies. |
| `Work on T-5.06.` | Use the legacy milestone task and its existing acceptance criteria. |

Default delivery is a verified PR in REVIEW. If you want “complete the next
task” to include merging every time, explicitly give Claude that standing
instruction. Once given, it persists for that session; to make it apply across
fresh sessions, record the approved policy here/`CLAUDE.md`. This setup does not
assume an approval that was not given. A merge never substitutes for a pending
human quality or design verdict.

## Why this structure

| File | Owns |
|---|---|
| `CLAUDE.md` | Short routing, engineering rules, where to read next |
| `BACKLOG.md` | One authoritative priority/order/status/dependency index |
| `docs/backlog/U-NNN.md` | Problem, focused scope, verified code entry points, acceptance, tests and handoff |
| `.claude/commands/next-task.md` | Selection, implementation, CI, PR and completion procedure |
| `.claude/commands/report-feedback.md` | Record-first intake and the implementation question |
| `docs/COMMANDS.md` | Detailed commands loaded only as needed |
| `TASKS.md`, `PLAN.md`, `docs/BUGS.md` | Preserved legacy milestone/bug history; explicit links to ongoing work |

Issues/Projects can be added later for multi-person assignment and dashboards.
Do not mirror the entire backlog into another editable system: duplicate statuses
cost context and drift. Use PRs for implementation evidence and review now.

## Initial triage

First: U-001, the intermittent mission enemy-spawn/pressure failure. Then firing
origins, tracer/flash alignment, AR sights, direct weapon keys, reload animation,
reload sound and local gun panning. Interaction-driven missions, loot and the
six-character squad are split into dependent tasks. The order is a recommendation,
not a claim about defects already reproduced.

Two real content/design constraints are visible in the queue:

- ADR-017's current voice approach needs actual recordings. Claude can extend and
  run the processing/routing code, but this setup does not promise usable voices
  from the existing empty voice library. Supply recordings or explicitly change
  the sourcing decision; radio chirps are not completed dialogue.
- The six roles are specified; names and individual skills are not. U-019 asks
  Claude to produce a concrete proposal for approval, then U-023 breaks those
  skills into focused implementation tasks. Support's speed amount and secondary
  weapon/control details stay explicit rather than becoming accidental defaults.

Visual/audio work keeps objective engineering checks separate from your judgement
of the result. Pending feedback never blocks unrelated READY tasks. Existing
milestone gates remain honest; having a playable slice is not a fabricated sign-off.

## References

Claude Code's official documentation describes [project instructions and their
loading](https://code.claude.com/docs/en/memory) and recommends [concise instructions
and explicit verification](https://code.claude.com/docs/en/best-practices).
