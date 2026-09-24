# ADR-018: Where the art comes from — meshes, textures and animation

- **Status:** Accepted — option A, chosen by the owner 2026-09-24 (T-4.01)
- **Date:** 2026-09-24
- **Plan reference:** §4.1, §7.11 (T-4.01), §9 Q2, R1; ADR-013, ADR-017

## Context

R1 is the project's largest cost: "art sinks more of these projects than
code". §4.1 has already cut the slice's art to what the thesis needs:

| Line item | Slice amount |
|---|---|
| Characters | one shared humanoid rig; a soldier and an enemy on it, in two or three looks |
| Animation | **~35 clips** (one weapon class per soldier class, 2 deaths, no vault) |
| Kit | **~25 modular pieces** for one compact level |
| Props | a handful: crates, sandbags, barrels, a mounted MG |
| Weapons | rifle, MG, marksman rifle, launcher, grenade (code-built today) |

ADR-013's budgets apply whatever the source: 8–15k triangles and 45–65 GPU
bones a character, KTX2/Basis textures, Draco or meshopt geometry, fewer
than 300 draw calls (so per-family atlases and instancing), an initial
download under 80 MB, and baked lighting on static geometry. §7.11's rule 1
adds that collision stays axis-aligned boxes, placed at 90° turns only,
whatever the mesh looks like.

Audio was decided on 2026-09-23 (ADR-017): made in-house, by AI. This ADR
asks the same question of everything the camera sees.

**What already exists, and so what each option starts from.**
- The soldier is built in code: one skinned mesh on a 17-bone rig, welded
  primitives with a generated texture atlas, one draw call (T-2.22, T-2.35).
  Its bones carry `HUMANOID_BONES` names, the contract any replacement
  must meet (`humanoidRig.ts`).
- **The soldier has no animation clips.** Every motion is a procedural pose:
  the gait from the move state and phase, the aim, the crouch and prone,
  hit reactions, the downed crawl, the vault, the weapon hold solved by IK,
  foot placement (T-2.17–T-2.28, T-2.40–T-2.42). About twenty of §4.1's
  ~35 clips already exist in this form (locomotion in four directions at
  three speeds, crouch, prone, aim, reload, hit, downed and revive), judged
  by the owner at the E-2.2 and E-2.3 gates, which are not yet run.
- The world is grey boxes from JSON (T-3.02), which the navmesh, cover and
  collision all bake from.
- The rig is 17 bones, not 45–65. That is under ADR-013's floor, which was
  set for mocap-driven skeletons with fingers and twist bones. A procedural
  rig does not need them. Whichever option is chosen, T-4.03 records the
  bone floor for that source.

## Options

Each option is scored on five things: **cost** in money; **quality
ceiling**, meaning the best it can look against the early-2000s
console-shooter target; **iteration speed**, meaning how long from "that
wall looks wrong" to a fixed build on the deployed site; how it **meets
ADR-013**; and how it gets **the animation**, which §7.11 names as the
hardest line item in every option.

### A. In-house, authored as code (the ADR-017 approach, for meshes)

Claude writes generators: TypeScript in `packages/tools/src/art/`. They
build meshes from primitives, bevels, extrusions and lofts, UV-unwrap them
onto per-family atlases, paint textures from arithmetic and noise (as
`soldierTexture.ts` does), and write glTF. The generators take a seed. The
pipeline (T-4.02) processes their output like any other glTF, and the
committed output is checked for staleness, as `gen:nav` is. The owner judges
on the deployed site: say what's wrong, the generator changes, CI rebuilds.

- **Cost:** none beyond agent time.
- **Quality ceiling:** good for hard-surface work, which is where most of
  the kit, props and weapons are: walls, doorways, sandbags, crates,
  barrels, the MG. It is weaker on anything organic or hand-painted, such
  as faces, cloth folds, rubble and foliage. The soldier stays where
  T-2.35 took it: readable, stylised, a step below a hand-sculpted
  character. Claude can see a render (T-4.11's review renders) but has no
  artist's eye. Expect more rounds than a person with Blender would need.
- **Iteration speed:** the fastest of all five. A change is a commit, and
  every piece is rebuilt the same way from its recipe.
- **ADR-013:** the easiest to meet, because the budget is a parameter. A
  generator can be written to stay under a triangle count, share one atlas
  per family and emit exact collision boxes from the same numbers it builds
  the mesh from.
- **Animation:** stays procedural, the way it is now. The remaining ~15
  motions are code in the same pose driver: two deaths, the grenade throw,
  the launcher, weapon swap, mounting the MG, the marksman's bolt, the
  Team Leader's hand signal, and idle variety. No mocap and no clips. The
  ceiling is lower than mocap: it reads as game animation from the target
  era, not as captured human motion. The risk is that feel tuning happens at
  the owner's gates, not in a clip editor.

### B. In-house, by hand in Blender

Someone models, UVs, textures and animates in Blender and exports glTF under
T-4.04's conventions. Claude writes the conventions, the validator and the
import side, but does not make the art.

- **Cost:** that person's time. If it is the owner, it is time in Blender
  and locally, which the owner has said they do not want to spend.
- **Quality ceiling:** as high as the artist, and the only in-house route
  to good organic work and good hand-keyed animation.
- **Iteration speed:** slow unless the artist is on hand. Every change is
  a person in Blender, an export and an upload.
- **ADR-013:** met by discipline and checked by the validator (T-4.03).
  Over-budget exports fail CI and go back to the artist.
- **Animation:** hand-keyed clips on the shared rig, which becomes a 45–65
  bone skeleton. This is the most labour: ~35 clips is weeks of an
  animator's time. The procedural pose driver would be replaced, or kept as
  the layer on top (aim, IK and foot placement stay code either way).

### C. Purchased packs

Buy a modular military kit, a character pack on a standard rig and a mocap
pack. Claude retargets and processes them through the pipeline, and writes
the licence log.

- **Cost:** money, roughly low hundreds to low thousands of dollars for
  a kit, a character pack and a mocap pack together. Each pack's licence has
  to allow web distribution of the extracted meshes, and some do not.
- **Quality ceiling:** high for what the packs contain, and the best
  animation per dollar (mocap). But the look is whatever the packs share. It
  is rarely one coherent style across vendors, and it is the same art other
  games use.
- **Iteration speed:** fast to start. It stalls when the pack lacks the
  piece the level needs, because a missing piece means another purchase, or
  option A or B for that one piece.
- **ADR-013:** often not met as bought. Packs are authored for desktop
  engines: more triangles, separate materials per piece, 4K textures. They
  need decimation, re-atlasing and LODs in the pipeline, and every piece
  must be given collision boxes by hand, because rule 1 means their own
  mesh colliders are useless.
- **Animation:** mocap clips retargeted onto the shared rig. This is the
  plan R1's mitigation originally assumed. The rig grows to the pack's
  skeleton, within 45–65 bones.

### D. Commissioned

Pay an artist or studio for a kit, characters and animation to spec.

- **Cost:** the highest by far: thousands to tens of thousands of dollars
  for the slice's list, most of it for animation.
- **Quality ceiling:** the highest, and coherent, because one hand does
  it all.
- **Iteration speed:** the slowest. Each round goes through a contract and
  someone else's schedule.
- **ADR-013:** written into the brief, validated on delivery.
- **Animation:** keyed or captured by the vendor, to the list.
- **Against the owner's stated direction:** ADR-017 rejected this for audio
  as "not made in-house".

### E. A mix

Each part from where it is cheapest to make well. The two mixes that fit
this project:

- **E1: code-built world, purchased motion.** Kit, props and weapons as in
  A; characters as in A; ~35 mocap clips from a pack, retargeted onto a
  grown rig, with the procedural layer kept on top for aim, IK and foot
  placement. It puts money where A is weakest (human motion) and nowhere
  else.
- **E2: code-built world, purchased characters and motion.** As E1, plus a
  bought character pack in place of the code-built soldier. It fixes A's
  second weakness, organic detail, at the cost of pack-style mismatch
  against a code-built world.

## Comparison

| | Cost | Ceiling | Iteration | ADR-013 | ~35 clips |
|---|---|---|---|---|---|
| A. Code-authored | none | good hard-surface; stylised characters | fastest | easiest | procedural, ~20 exist |
| B. Blender by hand | a person's time, local work | artist's | slow | by discipline | hand-keyed, the most labour |
| C. Purchased | money, licences | pack's; mixed style | fast, then stalls | needs processing | mocap, retargeted |
| D. Commissioned | the most money | highest | slowest | in the brief | vendor's |
| E1. Code world, bought motion | a mocap pack | A's world, mocap bodies | fast | easy | mocap + procedural layer |
| E2. Code world, bought characters and motion | two packs | better characters, style mismatch risk | fast | mixed | mocap |

## For the owner's decision

The agent does not decide. The facts that matter most:

1. **Your standing direction** for audio was in-house, made by AI, with
   nothing done locally. Only A meets that fully. E1 meets it for
   everything except one purchase.
2. **The animation is mostly already in A's form.** The soldier moves by
   procedural poses today, and about twenty of the ~35 motions exist. A
   extends that rather than starting over. B, C and D would replace it.
3. **A is reversible toward E1.** If the procedural motion fails the E-2.2
   and E-2.3 gates, or the M4 gate, mocap can be bought later and retargeted.
   The pipeline, the loader and the kit do not change. The reverse, from
   packs to code, throws away the processing work.
4. **The 17-bone rig** sits below ADR-013's 45–65 floor. A keeps it and
   would amend ADR-013's bone line to say the floor applies to mocap rigs.
   Every other option grows it.

Whatever is chosen, T-4.04 turns it into a concrete, checked source path, and
T-4.03's budgets apply to its output.

## Decision

**Option A: in-house, authored as code**, the way the soldier (T-2.22,
T-2.35) and the audio (ADR-017) are. The owner chose it on 2026-09-24.

1. **Meshes are generators.** Claude writes TypeScript in
   `packages/tools/src/art/`. Each generator builds a kit piece, prop,
   weapon or character from primitives, bevels, extrusions and lofts,
   unwraps it onto its family's atlas, paints the atlas from arithmetic and
   seeded noise, and writes a glTF source into `assets/src/`. The generators
   take a seed. `pnpm gen:assets` (T-4.02) processes the output like any
   other source, the budgets (T-4.03) check it, and a test fails when a
   generator changes without a re-run. T-4.04 makes this concrete.
2. **Collision comes from the same numbers as the mesh.** A generator
   declares its piece's axis-aligned collision boxes (`sandline.collision`)
   from the dimensions it builds with, so the visual and the physical never
   disagree (§7.11 rule 1).
3. **Animation stays procedural.** The ~35 motions are poses in the page's
   pose driver, as the existing ~20 are. That means no clips, no mocap and
   no retargeting. The remaining ones (two deaths, the grenade throw, the
   launcher, weapon swap, mounting the MG, the marksman's bolt, the Team
   Leader's hand signal, idle variety) are code in the same place.
4. **The rig stays the code-built 17 bones.** ADR-013's 45–65 bone line was
   written for mocap skeletons. Its addendum of this date says it is a
   ceiling for this project, not a floor, and the triangle range likewise.
   The budgets (T-4.03) already check only ceilings.
5. **The owner's eye is the gate.** Claude checks what can be measured
   (budgets, collision against mesh, texel density). Whether it looks right
   is the owner's call, on the deployed site (`?assets`, and the level
   itself once T-4.13 lands): "say what's wrong, the generator changes, CI
   rebuilds".
6. **Nothing is bought, and nothing is done locally.** E1 stays the named
   way out: if procedural motion fails the E-2.2, E-2.3 or M4 gates, mocap
   can be bought and retargeted onto a grown rig without touching the
   pipeline, loader or kit. That would be a new ADR, not a quiet change.

§9 Q2 is answered for art as it was for audio. R1's "purchased mocap"
mitigation is replaced by procedural animation.

## Consequences

- **The quality ceiling is stylised.** Hard-surface work (the kit, props and
  weapons) can look right for the target era. Characters stay where T-2.35
  took them: readable, stylised, a step below a hand-sculpted model. Organic
  detail (rubble, foliage, cloth) is the weakest area and should be kept
  scarce in level design.
- **Iteration costs the owner's attention.** Claude can see renders but has
  no artist's eye, so expect several rounds a piece. The review renders
  (T-4.11) and `?assets` exist to make each round short.
- **The cheapest option to keep within budget.** A generator's triangle
  count and atlas are parameters, so ADR-013 is met by construction and CI
  proves it.
- **Everything is reproducible and diffable.** A piece is its recipe, so a
  change is a reviewable diff and every build makes the same bytes.
- **No licences to track.** Nothing is bought, so no licence log.
- **T-4.04, T-4.08, T-4.10 and T-4.12 are unblocked.** T-4.04 is the
  generator library and its first kit piece. T-4.08 puts the characters on
  the loader, from generated sources.
