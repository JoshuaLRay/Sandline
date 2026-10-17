# U-225 — Isolated replacement captive holdings

The declaration is `packages/tools/src/maps/qalat-outpost-mission.json` and its
composer is `qalatOutpostCaptives.ts`. They use the actual U-223 furnished outpost
over the composed depot/surface. Neither is imported by the campaign registry.
The sole survive objective satisfies the mission parser for an isolated fixture;
U-226 supplies its own rescue/restart scenarios. It is not the production script.

The original POW retains its independently authored `(16,8,402)` socket. Ascending
captured squad slots map to `carry-1..5`: `(12,8,400)`, `(20,8,400)`, `(12,8,404)`,
`(20,8,404)`, `(12,8,408)`. All coordinates are feet. The composer checks all six
standing bodies on the complete collision world before returning even for an
empty carried pool. U-224 supplies parsing, support/headroom/separation checks and
the deterministic mapping; no saved coordinates or squad starts determine holds.

The declaration suite checks all 63 possible captured-slot subsets of size zero
through five, reversed input order, independent POW capacity and copy safety.
Negative controls refuse absent, insufficient, malformed, duplicate, wrong-world,
unsupported, wrong-floor, obstructed and overlapping holdings (including POW
overlap). Removing real floor support and adding a low ceiling also fail closed.

The traversal suite consumes this declaration for occupancies 0..5. It sends real
wire move orders to a Session soldier from the antechamber through the cell door
and back before each approach, using the full composed standing nav bake. Every
tick checks y8 support, standing clearance, no vault or stance change and physical
separation from all held captives. The arrived eye-to-target distance is under
the ordinary 2 m rescue reach with real collision LOS. Captives remain held;
actual hold-to-free, escort and checkpoint lifecycle evidence belongs to U-226.

`pnpm gen:qalat-outpost` writes the parsed `mission.json` plus `captives.json`
with geometry/declaration SHA-256 hashes. Geometry, render union and prior capture
inputs are unchanged; existing camera captures retain their construction meaning.

| Check | Result |
|---|---|
| Generator and declaration validation | PASS; six-body capacity, unchanged collision/render hashes |
| Focused declaration/traversal tests | Pending final run |
| Outpost captures, asset and pack budgets | Pending final run |
| Full `pnpm verify` | Pending final run |
| Latest-head CI | Required: verify, streaming, parity-non-v8, mission; PR #368 |

Reproduce with `pnpm gen:qalat-outpost`, `pnpm exec vitest run
packages/tools/src/maps/qalatOutpostCaptives.test.ts
packages/tools/src/maps/qalatOutpostTraversal.test.ts`, the outpost capture runner,
`pnpm check:assets`, `pnpm check:packs`, and `pnpm verify`.

The active Qalat mission/map, campaign registry, deployment, mission selection
and checkpoint semantics are unchanged. U-226 is next after this PR merges.
Split U-117 before implementation/activation, install all production integration
atomically there, then U-118; prepare the handoff after activation. U-119 remains
the separate owner playtest and has no inferred verdict. U-144/U-136/U-113 remain
blocked on actual activation evidence; U-178 routing remains separate.
