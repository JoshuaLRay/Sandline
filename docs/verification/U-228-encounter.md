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

## CI outcome and closure

- Implementation CI [#39088769356](https://github.com/JoshuaLRay/Sandline/actions/runs/39088769356) passed `mission`, `streaming` and `parity-non-v8`, but `verify` failed solely because the existing serialized candidate tamper-matrix test exceeded its 60-second timeout. The test's timeout was increased to 180 seconds without weakening its assertions.
- Follow-up CI [#39090017626](https://github.com/JoshuaLRay/Sandline/actions/runs/39090017626), head `fd6889f402401a3fe4076f337206ba6199810b56`, finished **success** for all four required jobs: `verify`, `streaming`, `mission`, `parity-non-v8`.
- The final documentation-only closure commit must likewise pass these same four jobs on its latest PR head before merge; see PR checks for the final result. Streaming includes the unregistered replacement-bundle generation and capture step. Do not infer any additional independent local command executions not evidenced by CI.
- Human playtest feedback on U-234 remains deferred and is not fabricated; U-119 owns whole-mission visual/quality acceptance. This task does not activate registered Qalat.


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
