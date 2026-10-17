# U-226 — isolated replacement Session rescue and restart

Engineering proof for [U-226](../backlog/U-226.md), delivered in
[PR #371](https://github.com/JoshuaLRay/Sandline/pull/371).
This is an unregistered construction fixture, not a full mission completion or
owner playtest verdict. Production activation remains the atomic U-233 leaf.

## Reproduction

```sh
pnpm exec vitest run packages/tools/src/maps/qalatOutpostSession.test.ts packages/tools/src/maps/qalatOutpostRestore.test.ts
pnpm exec vitest run packages/tools/src/maps/qalatOutpostCaptives.test.ts packages/tools/src/maps/qalatOutpostTraversal.test.ts packages/server/src/session/incompatibleRestore.test.ts packages/server/src/session/rescue.test.ts
pnpm gen:qalat-outpost
pnpm check:assets
pnpm check:packs
pnpm verify
```

## Matrix and limits

| Proof | Coverage |
|---|---|
| Real rescue and return (12 scenarios) | Campaign/replay × 0/1/5 carried captives × fresh/explicit changed-map restart. The independent POW uses its actual captive encounter socket. Each squad captive uses ascending slot placement and a separate timed rescue objective. |
| Ordinary movement and interaction | Full composed standing-nav bake; human wire inputs walk nav corners to every rescue stand and hold/release E. Freed soldiers receive ordinary move/hold orders; the real escort AI exits the cell and makes a court/refuge round trip. All seven actors must return, alive, supported and outside solids; held squad bodies remain collision obstacles. |
| Persistence and authority (31 scenarios) | Exact elevated 3D restore, later prisoner coordinates distinct from authored holdings, spent inventory and an actually exhausted cache, real mission failure/retry, mismatched/unknown revisions, original versus later captures, legacy inventory, both separate pools, progression and unrelated checkpoints. |
| Fail closed | Missing/insufficient holdings retain quarantine without prisoner coordinates or enemy spawns. Guest restart/select and ready-up cannot bypass the gate. Host migration/reconnect, explicit restart, lobby reload, repeated restart and authorized mission selection preserve the proper state. |
| Rescue persistence | Reload and checkpoint retry keep the POW freed and squad captives rescued, with exactly six soldiers and one POW. |

The Session collision broadphase retains every solid/elevation touching the
tested court/cell/return region plus four metres. Nav uses the **complete**
unchanged construction. Test-only encounter metadata, revision 2, local starts,
one cache and rescue/survive objectives are harness inputs, not campaign content.
The terminal survive objective intentionally prevents a full mission claim.

The outpost generator reproduces existing artifacts; no geometry, render input,
registered nav input, live Qalat data, registry or protocol changes are required.
Existing U-225 access/capacity tests and live-map rescue/restore regressions remain
part of verification. Required CI results are in the
[PR checks](https://github.com/JoshuaLRay/Sandline/pull/371/checks); merge requires
`verify`, `streaming`, `parity-non-v8` and `mission` green on the latest head.

## Deployment observation — 2026-10-17

GitHub Pages reports successful deployment of main `cfc3057c0deab961e568e30b3f55b9dc86c7c5fe`
and serves HTTP 200 at <https://joshualray.github.io/Sandline/>. The Fly
`/healthz` endpoint reports healthy, protocol 74. This verifies availability of
the existing deployment, not replacement mission activation.
Cloudflare's main Workers build is failed; the initial U-226 PR preview explicitly
reports rate limiting. No successful Cloudflare replacement preview is verified.
Keep the U-227–U-232 preparation/proof sequence, U-233 atomic activation, then
U-118 polish and U-119 owner playtest. No owner verdict is inferred.
