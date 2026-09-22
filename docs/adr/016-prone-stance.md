# ADR-016: Prone stance and voluntary crawl

- **Status:** Accepted
- **Date:** 2026-09-22
- **Supersedes:** ADR-002, the "Prone stance" row only — every other exclusion
  in that table stands
- **Plan reference:** §7 (M2 epic table), new epic E-2.8

## Context

ADR-002 excluded prone stance from v1: "~15 animation clips and an
additional locomotion state for marginal tactical depth." That estimate
assumed prone would be built from scratch — its own clip set, its own
locomotion state, on top of a character presentation stack that did not
exist yet.

Two things have changed since:

1. **Crouch (T-2.20) already built the pattern prone needs.** Authoritative
   standing/crouched heights and clearance, a crouched hit volume distinct
   from standing, and a body pose the presentation layer blends to from
   replicated state. Prone is another rung on the same ladder, not a new
   mechanism.
2. **E-2.6 already shipped a crawl gait** for the downed state (T-2.13/T-2.14,
   human-signed-off 2026-09-20) — a low, prone-adjacent locomotion the
   character controller, predictor and pose driver all already drove. B-05
   (2026-09-22) deliberately removed it, because a downed soldier crawling
   under their own power undercut the incapacitation the down state is
   supposed to represent, and the fix was scoped to "no movement while
   downed," not "no prone stance ever." That fix is correct and stands: it
   is not reopened here.

What's actually being added is a **voluntary** prone stance available to a
standing, alive soldier — go prone on command, crawl at reduced speed, stand
back up — reusing the crouch and crawl-gait groundwork rather than the
~15-clip animation build the original estimate priced in. This project has
no clip budget in the first place (PLAN.md's soldier is a coded skinned
mesh with a procedural pose driver, not a mocap library, per T-2.06/T-2.35),
so the concrete cost that justified the exclusion no longer applies to how
this codebase actually builds movement.

## Decision

Prone is back in scope, as **E-2.8** in the M2 epic table, built the same
way crouch and downed were: an authoritative server-owned stance with a
matching client-predicted state, not a cosmetic pose.

- A new `prone` locomotion state, entered/exited voluntarily (bound key,
  server-authoritative like crouch), with its own controller height,
  clearance and hit volume — distinct from both standing/crouch and from
  the existing downed pose.
- A prone crawl speed in movement data (`data/*.json`), not hardcoded,
  slower than crouch-walk.
- Reuses the existing pose-driver and hit-capsule contracts (T-2.06,
  T-2.20, T-2.14) rather than introducing a second movement or hitbox
  system.
- Entry/exit is blocked in the same states vaulting already is (downed,
  dead, mid-vault) plus while sprinting; firing while prone is in scope for
  the same reason firing while crouched is — a stance nobody can fight from
  is not worth building.
- No new runtime dependency and no mocap/clip asset: same procedural pose
  approach as every other stance (rule 4/5 in `/CLAUDE.md` still apply).

## Consequences

- ADR-002's table is corrected: the "Prone stance" row is struck through
  and points here. Every other row in that ADR (PvP, destructibles, voice,
  modding, mobile, full controller support) is untouched — this ADR
  supersedes exactly one line, not the document.
- E-2.8 is scoped in PLAN.md §7 like every other M2 epic (coarse now, leaf
  tasks broken out at its planning gate) and tracked in TASKS.md. It does
  not skip the existing gate: `pnpm verify` green, shared tests for the new
  state and hit volume, and a human sign-off before it's called done, same
  as crouch and downed both required.
- Because it rides the crouch/crawl pattern instead of a bespoke animation
  build, the original "marginal tactical depth for the cost" argument no
  longer holds — the marginal cost is now one more state on an existing
  ladder, not a new one.

## Alternatives rejected

- **Reuse the downed crawl pose/speed for voluntary prone.** Rejected: they
  are different mechanics wearing similar poses. Downed is an
  incapacitated, server-forced state with no weapon and no player agency
  beyond crawling toward help; prone is a voluntary combat stance with full
  weapon use. Conflating them is exactly what made B-05 necessary — a
  crawl speed that leaked into the downed state. They get separate config,
  separate state names, and separate entry/exit rules.
- **Leave it in the backlog per ADR-002's own consequence note.** Not
  rejected outright — the note is right that "anything on this list that
  is later wanted goes to a backlog file... adding one back is a new ADR
  superseding this one." This document is that new ADR: the owner asked
  for it now rather than deferring it further, and the groundwork (crouch,
  crawl gait, hit-volume-by-stance) already exists to build it cheaply.
