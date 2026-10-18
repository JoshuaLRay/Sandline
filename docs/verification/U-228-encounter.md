# U-228 — Isolated replacement encounter evidence

This leaf prepares Qalat revision-2 combat, not production activation. The active
`qalat-road` level, encounter, script, registered nav/cover and saves remain unchanged.
U-234 early owner playtest feedback is deferred, **not claimed performed or approved**.

## Authored data and binding

- `qalat-replacement-encounter.json`: 32 initial hostile sockets, the separate mission POW, four dormant `C1..C4` reserves and one dormant `X0-tank`; 38 total under `aliveCap: 42`. Nine individual three-point patrols have 3-second endpoint pauses.
- `qalat-replacement-encounter-mission.json`: schema-valid **authoring-only** spawn-zone and 3D floor metadata; U-230 owns final mission sequence, U-233 installs the registered mission.
- `qalatReplacementEncounter.ts`: validates candidate revision, immutable member IDs/regions/sockets and the exact U-162 full constructed tank-return route. It places `og1-mg` as an unregistered emplacement at the accepted use point. Existing mounted/dismounted fallback is unchanged.
- `qalatReplacement.ts` attaches encounter, authoring mission, emplacement and a source-checked `encounterDigest` to the **unregistered** generated bundle. U-227's original construction manifest and hash, registered world and live content remain unchanged. Candidate reload rejects modified sidecars.

## Verification recipe

```sh
pnpm exec vitest run packages/tools/src/maps/qalatReplacementEncounter.test.ts
pnpm exec vitest run packages/tools/src/maps/qalatReplacement.test.ts
pnpm gen:qalat-replacement
pnpm gen:qalat-replacement --check
pnpm verify
pnpm check:assets
pnpm check:packs
```

`qalatReplacementEncounter.test.ts` proves count/identity at one- and six-human
budgets, invariant staged activation after pre-kills, physical body support and
headroom, patrol/advance regions and the full swept vehicle route. The existing
candidate bundle suite asserts standing-nav proximity and tamper rejection.
The prior U-180 camera/LOS and emplacement tests remain the independent
construction evidence. Release timing and mission-flow testing belong to U-230/U-231.

PR: https://github.com/JoshuaLRay/Sandline/pull/376 .
CI results, actual generator/asset commands and any remaining failures must be
recorded before merging. No human verdict is inferred; U-119 remains final quality acceptance.

## Geometry-constrained authoring adjustment

The initial §9 ridge slots RL1 (76,26,164) and RL3 (78,26,178) are
not fully supported by the real, already accepted construction collision:
RL1's 0.35 m body loses its west footprint and RL3's authored y26 floor
ends before the north end of its planned z178 socket. A grouped collision
audit found the nearest safe same-floor sockets at **RL1 (76,26,164.5)**
(+0.5 m north) and **RL3 (78,26,172.5)** (5.5 m south).
These preserve the named squad groups and identities without adding any
artificial level floor or modifying U-227's construction. The alignment
variance is recorded for U-119 human review; it is not claimed owner-accepted.
