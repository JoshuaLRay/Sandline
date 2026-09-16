# ADR-015: Estimates are a floor; vertical slice scope cut

- **Status:** Accepted
- **Date:** 2026-09-16
- **Plan reference:** §4.1

## Context

The milestone estimates in `PLAN.md` §4 sum to roughly 50 weeks of solo
part-time work for a vertical slice. External review flagged this as optimistic
by a factor of three to five, which matches the well-documented overrun rate for
solo part-time game projects.

The per-milestone figures exclude integration, debugging, and — most
significantly — the gap between "the asset pipeline works" and "the art exists."
As originally specced, the slice required six classes, five enemy archetypes,
80–120 animation clips, and a 60-piece modular kit. That is approximately a
team-year of art before anyone plays a mission.

## Decision

### Estimates

The §4 table is a **floor**. Plan for 3–5×. The honest range for the originally
specced vertical slice is **two to four years part-time**.

Re-estimate at every milestone gate from **measured velocity**, never from the
original table.

### Scope cut

| Originally specced | Vertical slice ships |
|---|---|
| 6 classes | **2** — Team Leader, Marksman |
| 5 enemy archetypes | **2** — rifleman, MG |
| 80–120 animation clips | **~35** |
| 60-piece modular kit | **~25** |
| Driveable vehicles | **Mounted MG only** |

### What is not cut

**The six-slot squad architecture (ADR-001) ships whole.** Six slots filled from
a two-class pool costs nothing extra.

The cut removes **variety**, not **structure**. That distinction is the whole
decision: a slice with two classes and six working slots demonstrates the thesis.
A slice with six classes and four slots does not, at four times the art cost.

## Consequences

- The vertical slice stops being an art project and becomes what it should be: a
  demonstration that browser-based six-player co-op netcode works.
- Class pairing is deliberate. Team Leader and Marksman demonstrate the
  overwatch/assault fireteam split that the entire mission template rests on. A
  pair that did not split that way would prove less.
- Revive still ships despite the Medic being cut — every class can revive and the
  Medic is merely faster, so the downed/revive mechanic is demonstrated without
  the class existing.
- M5 shrinks from 8–10 to 6–8 weeks. M2–M4 are unchanged: they are systems work,
  which the cut does not touch. The 3–5× multiplier applies to all of them.
- The cut content is deferred, not deleted. Adding a class post-slice is
  incremental once the systems exist.

## Alternatives rejected

- **Keep the full scope and extend the timeline.** Rejected: a two-to-four-year
  solo slice has a low probability of ever being finished, and it front-loads the
  highest-cost, lowest-information work.
- **Cut the squad size to four to reduce encounter design cost.** Rejected: six
  players is the product requirement and the architectural thesis (ADR-001).
  Cutting it would make the slice prove nothing worth proving.
- **Ship a netcode tech demo with no content at all.** Rejected: M1 already is
  that. The slice's job is to show the netcode holds up *with* real content, AI,
  and objectives — just not with breadth.
