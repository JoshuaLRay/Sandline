# Architecture Decision Records

One file per significant decision. Each records the context that forced it, the
decision, the consequences accepted, and the alternatives rejected.

**These are append-only.** To change a decision, write a new ADR that supersedes
the old one and mark the old one `Superseded by ADR-NNN`. Never edit a decision
in place — the reasoning history is the point.

An **addendum** is the other legal edit: the decision stands, but what we have
since measured or hit changes the reasoning behind it. The Status column counts
them, so a reader can tell at a glance which decisions have been revisited
without opening all fifteen files.

**If you are an agent working a task from `PLAN.md`:** read the ADRs your task
touches before you start. A decision marked 🔒 in the plan is not yours to
re-open. If one looks wrong, stop and say so — do not silently substitute a
different choice.

| ADR | Decision | Status |
|---|---|---|
| [001](001-six-slot-squad.md) | Six-slot squad with AI backfill | Accepted |
| [002](002-v1-scope-exclusions.md) | v1 scope exclusions | Accepted |
| [003](003-typescript-end-to-end.md) | TypeScript end to end | Accepted |
| [004](004-threejs-renderer.md) | Three.js for rendering | Accepted |
| [005](005-rapier-deterministic-build.md) | Rapier deterministic build | Accepted · 2 addenda |
| [006](006-recast-navigation.md) | recast-navigation-js for pathfinding | Accepted · 1 addendum |
| [007](007-bitecs.md) | bitECS for entity storage | Accepted |
| [008](008-websocket-behind-interface.md) | WebSocket behind a transport interface | Accepted · 1 addendum |
| [009](009-bitpacked-wire-format.md) | Hand-rolled bit-packed wire format | Accepted |
| [010](010-vite-pnpm.md) | Vite + pnpm workspaces | Accepted |
| [011](011-regional-session-hosting.md) | Regional session-based hosting | Accepted |
| [012](012-netcode-shape.md) | Authoritative server netcode shape | Accepted · 3 addenda |
| [013](013-performance-budget.md) | Performance budget | Accepted |
| [014](014-determinism-policy.md) | Determinism policy | Accepted |
| [015](015-estimate-reality.md) | Estimates as floor; slice scope cut | Accepted |

## Template

```markdown
# ADR-NNN: Title

- **Status:** Proposed | Accepted | Superseded by ADR-NNN
- **Date:** YYYY-MM-DD
- **Plan reference:** §N

## Context
What forced a decision. Constraints, not preferences.

## Decision
What we are doing, stated so an implementer cannot misread it.

## Consequences
What we accept as a result — including the bad parts.

## Alternatives rejected
Each option considered and the specific reason it lost.
```
