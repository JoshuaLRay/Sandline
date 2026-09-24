# ADR-013: Performance budget

- **Status:** Accepted
- **Date:** 2026-09-16
- **Plan reference:** §2.2

## Context

A budget agreed after content exists is not a budget. Fixing the targets now lets
the asset pipeline enforce them automatically (E-4.2) rather than discovering
violations during optimization.

The fidelity target — early-2000s console squad shooter — is modest by modern
standards, which is what makes a browser build realistic.

## Decision

Target **60 fps at 1080p on 2020-era laptop integrated graphics**.

| Budget | Target |
|---|---|
| Draw calls | <300/frame |
| Character triangles | 8–15k |
| Character bones | 45–65, GPU skinned |
| Textures | KTX2/Basis |
| Geometry | Draco/meshopt |
| Initial download | <80 MB |
| Time to playable | <30 s |

Lighting is **baked lightmaps for static geometry plus one cascaded
shadow-mapped sun**. No realtime global illumination.

## Consequences

- Baked lighting is not a compromise here — baked sun with dust haze *is* the
  target aesthetic. The cheap option and the correct-looking option coincide.
- **Baked lighting requires static geometry**, which is why ADR-002 excludes
  destructible environments. These two ADRs depend on each other; reopening
  either reopens both.
- The draw-call ceiling forces instanced props and per-family material atlases as
  a pipeline requirement, not a late optimization.
- Budgets must be enforced in CI (E-4.2). A budget checked by hand is a budget
  that is already blown.
- Integrated graphics as the target means a discrete GPU has headroom for
  supersampling or higher shadow resolution, not more geometry.

## Alternatives rejected

- **Deferred rendering with realtime lights.** Rejected: bandwidth-hungry on
  integrated GPUs, and unnecessary for a single dominant sun.
- **Targeting a discrete GPU.** Rejected: excludes a large share of laptop players
  for fidelity the art style does not need.
- **WebGPU as the baseline.** Rejected for v1: WebGL2 is the safe floor. WebGPU
  may be adopted as a progressive enhancement once the budget is being met.

## Addendum — 2026-09-24: the character ranges are ceilings (ADR-018)

ADR-018 chose art authored as code, with procedural animation on the
code-built 17-bone rig. The character rows above (8–15k triangles, 45–65
bones) were written for mocap-driven, hand-sculpted characters, whose
skeletons carry fingers and twist bones. For this project **only the top of
each range is a budget**: a character may use up to 15k triangles and 65
bones, and nothing requires it to use more. The code-built soldier has 900
triangles and 17 bones. The decision (60 fps on 2020 integrated graphics)
and every other row stand. The budgets file (`data/assets/budgets.json`,
T-4.03) already checks only ceilings.

