# Sandline — Codex instructions

Read `CLAUDE.md` for this repository's task routing and engineering rules.
For task work, read `BACKLOG.md`, the selected card, and relevant source files.
Follow nested `CLAUDE.md` instructions when editing their packages, especially
`packages/shared/CLAUDE.md` for cross-engine determinism.

Use Node >=22 and the pnpm version pinned in `package.json`. Install with
`pnpm install --frozen-lockfile`; run `pnpm verify` for implementation changes.
See `docs/CODEX.md` for cloud environment setup and example prompts.

The backlog owns status. Preserve existing branches and unrelated work. Deliver
one focused implementation PR per task, with evidence in its card and
`docs/CHANGELOG.md`. Do not mark pending playtests passed or merge without owner
authorization. A request to implement a task already authorizes its work; do not
repeat the intake implementation question.
