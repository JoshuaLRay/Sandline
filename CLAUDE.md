# Sandline agent brief

## Route the request first

This repository uses an ongoing upgrade queue after the vertical slice.

- **“Complete the next task [for the repository URL]”**: follow
  `.claude/commands/next-task.md`, then `BACKLOG.md` and the one selected card.
- **A bug, playtest observation or suggestion** (including just the repository
  URL followed by feedback): follow `.claude/commands/report-feedback.md`.
  Record it first, then ask whether to implement it now. Do not begin gameplay
  changes unless the request already says to fix/build/complete it.
- **An explicit U-ID**: follow the ongoing workflow for that card; check dependencies.
- **An explicit legacy T-ID**: use `TASKS.md`, that task's section of `PLAN.md`
  and `docs/LEGACY-TASK-WORKFLOW.md`. Existing human gates remain open.
- **A status/question-only request**: answer from current files/PRs; do not invent
  a feedback task. A repo URL identifies the project, not a new task on its own.

Natural-language routing works without a slash command. `/next-task` and
`/report-feedback` are optional shortcuts. Read source files and the relevant
nested `CLAUDE.md` before editing. Instructions guide behavior; they do not
install tools, confer credentials or bypass tool/branch permissions.

## Read only what the task needs

| Need | Read |
|---|---|
| Current queue/status | `BACKLOG.md` |
| Exact upgrade scope | One `docs/backlog/U-NNN.md` card |
| Intake/delivery and examples for the owner | `docs/WORKFLOW.md` |
| Locked architecture choice | Relevant file in `docs/adr/` |
| Dev, QA, generation or scenario command | Relevant row in `docs/COMMANDS.md` |
| Legacy task status/scope | `TASKS.md` → one `PLAN.md` section |
| Historical bug/implementation evidence | One entry in `docs/BUGS.md` / `docs/CHANGELOG.md` |

Do not read `PLAN.md`, every task card, all ADRs or historical handoffs end to
end. Do not auto-import the backlog/history into this file. Handoffs such as
`docs/HANDOFF-M1.5.md`, `docs/HANDOFF-SOLDIER-LOOK.md` and
`docs/HANDOFF-T-3.05.md` are historical, not startup reading.

## Commands and standing engineering rules

Use Node >=22 and the pnpm version pinned in `package.json`.
`pnpm install --frozen-lockfile` installs; `pnpm verify` runs typecheck, lint,
and tests. `pnpm host` starts the authoritative host;
`pnpm --filter @sandline/client dev` starts the client.

1. The repo stays green. Run `pnpm verify` for implementation work and required
   CI for the actual PR head. Never weaken a gate to make a task look complete.
2. New shared logic needs unit tests; netcode changes need headless integration
   coverage. Generated assets/audio/nav must be regenerated when inputs change.
3. No new runtime dependency without a line in `docs/adr/`. Dev dependencies
   are free. Weapons, classes and AI tuning are schema-validated data.
4. `packages/shared` imports no platform libraries (`three`, `ws`, `fs`).
   Follow `packages/shared/CLAUDE.md`: seeded randomness and approved math only;
   no `Math.random` or platform transcendentals. Numeric parity is bounded
   divergence, not bit equality; integer/wire paths can use exact equality.
5. Respect locked ADRs. Record an explicit owner change in an addendum; if the
   new request does not actually decide a conflicting choice, expose that
   decision rather than silently replacing it.
6. Leave a trail: completion evidence in the selected card and a one-line
   `U-ID — change` in `docs/CHANGELOG.md`. `BACKLOG.md` owns U-ID status;
   legacy T-IDs still update `TASKS.md`/`PLAN.md` under their workflow. A green
   unmerged PR is REVIEW, not DONE. Never invent human playtest/listening verdicts.
7. One focused task per implementation PR. Check existing work before claiming;
   preserve unrelated changes and another worker's branch. Merge only with
   current or standing owner authorization, respecting branch protections.

## Known traps

- HTTPS pages require `wss://`; `ws://` is blocked by the browser.
- Slots retain position between occupants (ADR-001); joining possesses a bot's
  entity. Do not reset it as a spawn bug without checking the intended lifecycle.
- Asset generators live in `packages/tools/src/art`; processed assets are in
  `packages/client/public/assets`. Edit sources and regenerate, not just outputs.
- Audio has an existing pipeline and reload cues. Real voice sources are absent
  until supplied under ADR-017; passing fixture tests does not make voices exist.
