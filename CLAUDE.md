@AGENTS.md

## Claude Code specifics

- Everything shared lives in `AGENTS.md` (imported above) so Claude Code and
  Codex follow one set of rules. Edit rules there, not here.
- Slash commands `/next-task`, `/report-feedback` and
  `/next-task-context-transfer-text-box` are thin wrappers in `.claude/commands/`
  around the canonical skills in `.agents/skills/` (Claude Code does not read
  `.agents/` on its own). Natural-language requests route the same way.
- Nested `CLAUDE.md` files import their sibling `AGENTS.md` and load when you
  touch files in that directory.
- Hosted sessions without the `gh` CLI use the GitHub integration tools for PRs,
  checks and merges; the delivery policy in `AGENTS.md` is unchanged.
