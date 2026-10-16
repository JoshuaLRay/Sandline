# U-180 — Outpost V3 gun line and tactical clearances

PR [#348](https://github.com/JoshuaLRay/Sandline/pull/348), second engineering leaf
of U-176. Real captive/escort tank-shell, blast and seven-actor proofs stay in
U-177; activation stays in U-117 and whole-mission human quality in U-119.

## Decisions within the delegated contract

**V3 gun line.** The original target (38,8,360) sat behind the solid south wall.
A ray scan over the complete outpost (sandbags and crew re-placed every 0.5 m)
found one strip, around x31–33 and z360–362 in the 8 m arch's centre, where V3's
standing eye reaches the crew and the gun still fires at A8 through the arch.
O-C01 moves to (29,8,359), x26..32 across the south throat's west half. The
`mg-nest` gun stands at (31.2,8,360.4) facing A8; its use point and OG1 socket
is (31.5,8,361), 0.7 m behind by the real `gunnerPlace`. The east half x32..36
stays a 4 m lane. §6.2's V3 target, the view fan input, §8.2, §9.1, the
observer probes and all fixtures/tests change together; terrain regenerates
(94,342 → 94,215 boxes) as the fan follows the new ray.

**West reveal.** The west door's south jamb (8,372) and the refuge's south-west
corner (9.4,375.4) are 3.68 m apart, so no 4 m band could turn from the door into
the court lane. The south infill is recessed at x7.2..8, z371.4..372, y8..11
behind a 0.2 m outer jamb. The 4×3 m door, its centre, the 8 m arch, 1 m wall and
both rooms are unchanged. The pinch becomes 4.05 m (a jamb deeper than 0.29 m
cannot reach 4 m). Both decisions are recorded in the specification as §15 table
updates. ADR-023's approved three-route geometry, separators and crossing
registers are unchanged.

## Independent engineering evidence

All proofs use the complete furnished outpost world (road, ridge, depot, outpost).

- **Gun line:** real `mg-nest` placement; V3 reaches the crouched crew (chest,
  eye, top) and the 1.2 m muzzle; the gun's own sandbags end its feet ray, as
  U-167 allows a target's own cover. Rounds reach A8 shins/chest/eye within the
  ±60° traverse and elevation limits. At the facing point (32,8,350), 10 m out,
  the sandbags leave the shins in dead ground; chest and eye are hit. From A8,
  O-C01 covers the crouched body and leaves the head exposed.
- **Support rays and blind spots:** all eight V1–V3 rays are clear in the
  complete scene. 11,800 body rays confirm V1→A4, V2→A2, V2→compound and V3→
  prisoner/radio rooms, west service gate/reveal and all nine basement rooms.
- **West turn:** 116,739 samples of a swept 4 m band from the pad into the court
  lane, with bevel joins, are clear and supported; restoring the cut masonry blocks
  237. Two soldiers 3.2 m apart walk it both ways (577 ticks, ≤0.084 m off lane).
  120 sprint-jump/crouch/prone pushes from the recess and both jamb faces reach
  no raised surface (peak feet y9.02).
- **Sockets and patrol:** OG1–OG6, OR1, C1–C4 and the four release targets stand
  clear and supported on y8, outside the cell and refuge. OG6's patrol, sampled at
  ≤0.5 m (45 samples), stays on the court floor, clear of cover. The observer
  probes carry the same sockets and routes.
- **P-OUTPOST:** a 1×1×1.2 m cache volume at (14,8,380) and four use stands 1.6 m
  out sit inside the refuge, in reach and in sight.
- **Live nav/controller:** on the actual tiled bake, the controller walks the
  court to all seven garrison/radio sockets and back (2,041 ticks); each reserve
  through the annex bends to its release target (1,855); OG6's legs both ways
  (297); and P-OUTPOST's use stand from all three approaches and back (1,635).
  No vaults; no step into the cell or refuge.
- **Production cameras:** 37 observers, 5,550 desktop spring-arm and mobile-orbit
  (3/9/18 m) solves plus weapon eyes, 109,350 rays: no line to any staged reserve
  body from the road, gate, bays, ridge route, side pads, B10, tank road, basement,
  court or north gate. The POW and four captives stay hidden from all §8.2 sources.
- **Observation for U-177:** captive holding carry-1 (12,8,400) is on the line
  through the aligned antechamber east door and cell south door. A raised camera
  sees it over the y14 east wall from X4 (mobile, 9 m), R8 (desktop, steep pitch)
  and the east pad (9 camera views from the §8.2 tank-road source). Weapon eyes are
  blocked. It is recorded in U-177; this leaf does not move approved holdings.
- Retained: U-179's 23 circulation lanes (south lane now x32..36), six holdings,
  the cell landing and 192 controller escape attempts; U-175's shell, aperture,
  reserve and prisoner-ray proofs.

## Reproduction and results

- `pnpm gen:qalat-road-supports`, `pnpm gen:qalat-depot`, `pnpm gen:qalat-outpost`:
  pass. Road terrain 94,342 → 94,215 boxes; outpost 110,505 collision boxes.
- `pnpm gen:nav`: pass for all five registered worlds; production bakes unchanged.
- Captures with `CHROMIUM_PATH=/opt/pw-browsers/chromium` (the installed Playwright
  expects a newer headless shell; the road capture now honours this option like
  its siblings): road-support, 26 depot and 16 outpost views pass, each outpost
  view two draws. `south-gate-court` moved to (34,·,359) because its old anchor
  is now inside O-C01.
- `pnpm exec vitest run packages/tools/src/maps/qalatOutpostTactical.test.ts`:
  10/10. `qalatOutpostNav.test.ts`: 15/15 (5 new). `qalatOutpostFurniture`,
  `qalatOutpost`, `qalatDepot`, `qalatRoadSupports`, `qalatInsertion`,
  `qalatRidgeBays`, `qalatRoadTerrain` and `qalatSurfaceContract`: pass.
- `pnpm check:assets`, `pnpm check:packs`, `pnpm typecheck`, `pnpm lint`: pass.
- CI [38922573359](https://github.com/JoshuaLRay/Sandline/actions/runs/38922573359) on
  implementation head `e4524d4f8cdfa85422754468d6476a7bf23fb219` (main merged):
  verify **357 files, 3,563 tests pass**; streaming, parity-non-v8 and mission
  (all-mission diagnostics and the Qalat baseline) pass. The final documentation
  head must separately pass all four jobs before the authorized merge.
- Local `pnpm verify` on the same merged head: typecheck, lint and **357 files,
  3,563 tests** pass.

## Review

Regenerate as above, then `pnpm exec tsx packages/tools/src/capture-qalat-outpost.ts`.
`v3-gun` looks from the V3 bay toward the gun line; `west-turn` looks from the
west pad into the recessed reveal and the court lane. Pictures are construction
evidence, not a quality verdict; whole-mission acceptance remains U-119.
