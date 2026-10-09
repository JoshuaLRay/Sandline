# Driving Sandline with AI agents

This guide is for the owner. Sandline is built only by AI coding agents (Claude
Code and ChatGPT Codex), so the repository is the project's memory: agents start
every chat with no recollection of the last one and rebuild context from these
files. The structure below keeps that rebuild small and keeps every agent
pointed at the same game: **Conflict: Desert Storm, with a squad of six**.

## How the files fit together

| File | Owns | Who reads it |
|---|---|---|
| `AGENTS.md` | Goal, request routing, read budget, delivery policy, engineering rules, traps | Every agent, automatically (Claude via `CLAUDE.md`) |
| `CLAUDE.md` | `@AGENTS.md` plus a few Claude-only notes | Claude Code, automatically |
| `docs/VISION.md` | What the game is: pillars P1–P7, six-for-four mapping, deliberate differences | Agents making design or priority choices |
| `docs/design/CONFLICT-PARITY.md` | Feature-by-feature: the series vs Sandline, and the gaps in order | Agents choosing or scoping new work; you |
| `docs/adr/021-conflict-gameplay-reference.md` | The rule: unspecified detail → do what Conflict did, adapted to six | Agents settling details without asking you |
| `BACKLOG.md` | The ordered queue and every task's status (active rows only) | Every task |
| `docs/backlog/U-NNN.md` | One task's scope, acceptance and evidence | The agent doing that task |
| `docs/CODEMAP.md` | Where each system lives in the code | Agents before searching |
| `.agents/skills/*/SKILL.md` | Procedures: next task, record feedback, handoff box | Codex natively; Claude via `/next-task` etc. |
| `docs/COMMANDS.md` | Every dev/QA/generator command | On demand |
| `TASKS.md`, `PLAN.md`, `docs/BUGS.md`, `docs/backlog/archive/` | History | Only for an explicit legacy ID or a dependency check |

## Prompts

These work the same in Claude Code and Codex. The repository URL is optional
when the chat is already attached to the repository.

| You want | Say |
|---|---|
| The next task, merged when green | `Complete the next task for https://github.com/JoshuaLRay/Sandline` |
| A specific task | `Complete U-150.` |
| Several in a row (one PR each) | `Complete the next three tasks.` |
| Record a bug or idea, then decide | `https://github.com/JoshuaLRay/Sandline The AR reload goes silent after a checkpoint retry.` |
| Record and fix in one go | `… Fix that reload problem now.` |
| Move toward Conflict | `Queue the next Conflict parity gap.` or `Build the RPG enemy from the parity tracker.` |
| Decide something an agent asked about | `Decision for U-144: <your answer>. Record it and continue.` |
| Give a human verdict | `I played the road section: U-149 road layout approved.` / `…rejected because <reason>.` |
| Reorder | `Move U-142 ahead of U-150.` |
| Pause merging | `Hold merges until I say otherwise.` |
| Hand over to a fresh chat | `Give me a next task context transfer text box.` |
| Status only | `What is blocked and why?` |

Start a **new chat for each task** (or each small batch). Long chats carry stale
context and cost more per step; the handoff box makes the switch cheap.

## What still needs you

Agents can do all engineering, testing and merging. Three things they cannot
supply, and the queue says so instead of guessing:

1. **Human verdicts** on how something plays, looks or sounds. These are now
   batched on each epic's verification card (for example the mission's final
   review), so a pending verdict no longer stops the next construction task.
   When you review, tell the agent the verdict; it records it.
2. **Owner decisions** that neither an ADR nor the Conflict reference answers
   (ADR-021). Agents resolve the rest themselves and mark them
   `Conflict default: …` in the card so you can overrule them cheaply.
3. **Assets that must be real**, such as voice recordings (ADR-017) or spending
   money (regional hosting, T-4.30).

## Policies in force

- **Merge when green** (your instruction of 2026-10-08): a task's PR merges once
  all four required CI jobs pass on its latest head. Say "hold merges" to stop.
- **Dependencies on merged work don't wait for your verdict** (adopted
  2026-10-09 with this guide): a merged task awaiting review (REVIEW) satisfies
  its dependents unless a card says otherwise. If you reject it later, the fix
  is a new task. Revert this line in `AGENTS.md` if you prefer strict gating.
- **One focused task per PR**, its evidence in its card, one line in
  `docs/CHANGELOG.md`.

## Codex specifics

[docs/CODEX.md](CODEX.md) has the environment setup. Codex cloud tasks may not
be able to watch CI or merge; the agent then stops at a verified PR and says so,
and you (or a Claude session) merge it.

## References

Claude Code: [project memory and imports](https://code.claude.com/docs/en/memory),
[skills](https://code.claude.com/docs/en/skills). Codex: AGENTS.md discovery and
skills in [the openai/codex repository](https://github.com/openai/codex).
