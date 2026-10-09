# Sandline — agent brief

The one shared instruction file for every coding agent. Codex loads it directly;
Claude Code loads it through `CLAUDE.md` (`@AGENTS.md`). Procedures are skills in
`.agents/skills/`; package rules are nested `AGENTS.md` files — read
`packages/shared/AGENTS.md` before editing anything in `packages/shared`.
This project is built entirely by AI agents; the repository is its only memory.

## What we are building

**Sandline is Conflict: Desert Storm with a squad of six.** Lead, command and
switch between six specialist soldiers, keep every one of them alive, and fight
through a linear campaign of objective missions — one to six friends online in
the browser, bots in the empty slots. Afghanistan 2001–02, original IP.

- [docs/VISION.md](docs/VISION.md) — pillars P1–P7, the six-for-four squad
  mapping, deliberate differences and anti-goals. Read it before any design,
  scoping or priority decision.
- [docs/design/CONFLICT-PARITY.md](docs/design/CONFLICT-PARITY.md) — what the
  series had, what Sandline has, and the gaps in recommended order.
- **Unspecified gameplay detail?** ([ADR-021](docs/adr/021-conflict-gameplay-reference.md))
  Owner decision → locked ADR → what Desert Storm / Desert Storm II did, adapted
  to six soldiers and online co-op (write `Conflict default: …` in the card) →
  smallest reversible proposal. Do not stop to ask when step 3 answers it.

## Route the request

| The user says | Do |
|---|---|
| "Complete the next task" (with or without the repo URL) | [.agents/skills/next-task/SKILL.md](.agents/skills/next-task/SKILL.md) |
| An explicit U-ID ("complete U-150") | the same skill for that card; its dependencies still apply |
| A bug, playtest note or suggestion (incl. repo URL + feedback) | [.agents/skills/report-feedback/SKILL.md](.agents/skills/report-feedback/SKILL.md) — record first; implement only if they said fix/build/do it now |
| "Queue / build the next Conflict feature" | report-feedback for the named or top unqueued gap in CONFLICT-PARITY.md; then next-task if they said build it |
| A context-transfer text box / new-chat handoff | [.agents/skills/next-task-context-transfer-text-box/SKILL.md](.agents/skills/next-task-context-transfer-text-box/SKILL.md) |
| An explicit legacy T-ID | `TASKS.md` → that one `PLAN.md` section → `docs/LEGACY-TASK-WORKFLOW.md` |
| A question or status check | answer from files and PRs; a repo URL alone is not a task |

## Read budget

Read only what the task needs, in this order, and stop when you have enough.

| Need | Read |
|---|---|
| Queue, blockers, claims | `BACKLOG.md` (active rows only) and open PRs |
| Exact scope | one `docs/backlog/U-NNN.md`, then only its "Read first" list |
| Where the code is | [docs/CODEMAP.md](docs/CODEMAP.md), then the source itself |
| A locked choice | the one relevant ADR in `docs/adr/` |
| A dev/QA/generator command | its row in `docs/COMMANDS.md` |
| A map or mission spec | only the § sections the card cites |

Never read end to end: `PLAN.md` (history), `docs/CHANGELOG.md` (tail it),
`docs/backlog/archive/`, `docs/design/maps/*.md`, `docs/HANDOFF-*.md`, playtest
run sheets. For any file over ~300 lines, grep or read a range.

## Delivery policy

- **Merge when green — standing owner authorization (2026-10-08).** When you
  complete a task, merge its verified head once all four required CI jobs
  (`verify`, `streaming`, `parity-non-v8`, `mission`) pass on the latest pushed
  head, respecting branch protection. It covers the task being completed, not
  another worker's PR, an intake-only PR, or anything the owner said to hold.
- **Statuses** (BACKLOG.md owns them): READY executable · IN_PROGRESS a pushed
  `task/U-NNN-*` branch or open PR · BLOCKED names the exact missing dependency,
  decision or asset · REVIEW code merged (or PR green) and waiting only on a
  human verdict · DONE merged and accepted · INBOX captured, unscoped ·
  CANCELLED closed with a reason.
- **Dependencies:** satisfied by DONE, by an archived row, or by **REVIEW whose
  code is merged on main** — unless the dependent card explicitly needs that
  verdict first. Pending human verdicts never serialize engineering work.
- **Human verdicts are batched** on the epic's verification card (e.g. the
  mission's final review), not on every leaf. Never invent a verdict, playtest
  or listening result; a green test is not one.
- **One task per PR, one task per request.** "Next task" means one; do more only
  when asked ("the next three tasks").
- Cannot watch CI or merge from your environment (e.g. Codex cloud)? Stop at an
  open PR with local evidence and state exactly what remains.

## Engineering rules

1. **Stay green.** `pnpm verify` (typecheck, lint, tests) for every change; all
   four CI jobs on the actual PR head. Never skip, weaken or re-baseline a gate
   to make a task look complete.
2. **Tests ship with code.** New shared logic gets unit tests; netcode changes
   get headless integration coverage. When generator inputs change, regenerate
   (`pnpm gen:art`/`gen:assets`/`gen:audio`/`gen:nav`); tests fail if you don't.
3. **Data over code.** Weapons, characters, enemies, AI and director tuning are
   zod-validated JSON in `packages/shared/src/data`. No new runtime dependency
   without an ADR line; dev dependencies are free.
4. **`packages/shared` is platform-free and deterministic** — no `three`, `ws`,
   `fs`, wall clock, `Math.random` or `Math.sin`-family. Parity is bounded
   divergence, never bit equality. Details: `packages/shared/AGENTS.md`.
5. **Bots and humans share one path** (ADR-001). Any slot may be a bot, so a new
   soldier ability or interaction needs its bot/order path, or a recorded reason
   why bots never use it.
6. **Respect locked ADRs.** An owner change becomes an addendum or a new ADR; if
   a request doesn't actually decide a conflicting choice, surface the conflict.
7. **Leave a short trail** in the same PR: the card's handoff (≤15 lines), one
   `docs/CHANGELOG.md` line `- U-NNN — change ([#PR](url))`, the BACKLOG row.
   Legacy T-IDs also update `TASKS.md` under their workflow.
8. **Preserve other work.** Check open PRs and `task/*` branches before
   claiming; never push to another worker's branch; keep unrelated changes.

## Commands

Node >=22; pnpm 10.33.0 via `corepack enable`. `pnpm install --frozen-lockfile`
installs, `pnpm verify` is the gate, `pnpm host` runs the authoritative host
(ws://localhost:8080), `pnpm --filter @sandline/client dev` serves the client
(localhost:5173), `pnpm sim-run --scenario mission --all-missions --seeds 3`
plays every mission headless. Everything else: `docs/COMMANDS.md`.

## Known traps

- HTTPS pages need `wss://`; a blocked `ws://` looks exactly like a dead host.
- A slot keeps its soldier's position between occupants (ADR-001): joining
  possesses a bot's entity. That is design, not a spawn bug. Per-client state
  (camera, HUD, input) must reset on join and on switch.
- Art is code: generators in `packages/tools/src/art`, outputs in
  `packages/client/public/assets`. Edit the generator and regenerate.
- The audio pipeline exists but real voice recordings do not (ADR-017); fixture
  tests passing does not mean voices exist.
- The game is `packages/server/src/session/Session.ts` (~7,000 lines; grep for
  the method, never read it whole). `shared/src/sim/Simulation.ts` is only a
  bootstrap, and `data/regions.json` means hosting regions. See CODEMAP.
- Wire changes bump `PROTOCOL_VERSION` in `packages/shared/src/net/protocol.ts`
  and the tests pinning it (`grep -rn "PROTOCOL_VERSION).toBe" packages`).

## Glossary

**Slot** one of six squad positions (0–5), each bound to one **character**
(Preach, Brennan, Holloway, Ortiz, Marsh, Vance). **Possession** a human taking
a slot's soldier; leaving hands it back to a bot. **Commander** the human a bot
answers to; a player may **switch** into a bot they command. **Fireteams** slots
0–2 (assault) and 3–5 (overwatch). **Escorted character** a non-slot friendly
such as a rescued POW. **World / level / mission** registry entry / geometry /
objectives (`campaignRegistry.ts`). **Director budget** encounter scaling by
human count. **Campaign run / replay run** newest mission vs an already-beaten
one, with separate prisoner pools.
