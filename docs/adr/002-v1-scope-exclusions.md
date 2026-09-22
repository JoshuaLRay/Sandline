# ADR-002: v1 scope exclusions

- **Status:** Accepted
- **Date:** 2026-09-16
- **Plan reference:** §1.5

## Context

Scope creep is the most reliable cause of death for projects of this shape. A
decision recording what is *excluded* is more useful than one recording what is
included, because it gives a concrete answer to "should we add X?" without
reopening a design discussion.

## Decision

The following are out of scope for v1:

| Excluded | Reason |
|---|---|
| Mobile and tablet | Touch controls for a TPS are a separate design problem; mobile GPU budget is a fraction of the desktop target |
| PvP | See consequences — this is the highest-value exclusion on the list |
| ~~Prone stance~~ | Superseded by [ADR-016](./016-prone-stance.md) 2026-09-22 — back in scope as E-2.8. Original reasoning: ~15 animation clips and an additional locomotion state for marginal tactical depth. |
| Destructible environments | Incompatible with baked lighting (ADR-013) |
| Voice chat | Ping and order wheel cover the tactical need; players use Discord |
| Modding / UGC | Requires a stable, documented data format we do not have yet |
| Full controller support | Basic gamepad mapping only; no console-grade aim assist or UI |

## Consequences

- **Excluding PvP removes anti-cheat from the critical path.** This is the single
  largest saving in the list. Browser clients are fundamentally untrusted and
  unprotectable; in co-op PvE a cheater harms only their own session. Had PvP
  been in scope, the authoritative server would need to defend against a hostile
  client rather than merely arbitrate between cooperating ones.
- Desktop-only lets us assume keyboard and mouse, a real GPU, and a viewport
  large enough for the HUD design.
- No destructibles means level geometry is static, which is what makes baked
  lightmaps viable (ADR-013). These two decisions are load-bearing for each
  other — reopening either means reopening both.
- Anything on this list that is later wanted goes to a backlog file, not into a
  milestone. Adding one back is a new ADR superseding this one.
- **Prone stance did exactly that** on 2026-09-22 — see ADR-016. It is
  scoped in now as E-2.8, on the back of groundwork (crouch's authoritative
  height/hit-volume, the crawl gait built for downed) that did not exist
  when this ADR was written and that changes the cost side of the
  trade-off recorded above.

## Alternatives rejected

- **Ship PvP as a stretch mode.** Rejected: "stretch" is not a real category. It
  would drag anti-cheat, balance, and matchmaking complexity into v1 on the
  chance it gets cut later.
- **Mobile as a later port.** Not rejected — deferred. The engine choices here do
  not preclude it, but nothing in v1 will be compromised to keep it possible.
