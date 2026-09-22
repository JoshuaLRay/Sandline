# Handoff — the soldier's look: PS2-era, Desert Storm-ish

> **Superseded 2026-09-21, the same day.** §6's proposal was agreed and is now
> `PLAN.md` §7.5; T-2.30 through T-2.33 are built and T-2.34's run sheet is
> `docs/playtests/soldier-look.md`. **`PLAN.md` is authoritative** — this file
> is kept for §1–§5, which is the reasoning the tasks rest on: why the era is
> already the locked direction, what the soldier was made of, what PS2 means
> that PS1 does not, and what must not move. Three things it predicted are
> worth checking against what happened: the `DataTexture` decision was right
> and was the whole job's hinge; `weld()` throwing UVs away was the change it
> said it was; and the triangle count went *down*, not up.

**Written 2026-09-21, after T-2.28 closed E-2.3's build work. Nothing here was
built at the time of writing.** This is a context transfer for whoever picks the work up next,
agent or person: what the soldier is made of today, what "PS2 era" actually
means in renderer terms, what must not move while it changes, and a proposed
task breakdown in `PLAN.md`'s format.

`PLAN.md` is the specification and stays authoritative. This document is the
state of play around one request that `PLAN.md` does not yet carry:

> *"I'd like to update how the player models look. I'd like them to look like
> the player models from PS2 era like Desert Storm."*

Where the two disagree, `PLAN.md` wins and this file is stale — fix it.

---

## 1. The request is already the locked art direction

This is not a change of direction, which is worth knowing before anyone
worries about ADR-002 or re-litigating a 🔒 decision:

- `PLAN.md` line 5: *"in the spirit of early-2000s console squad tactics
  games."*
- ADR-013's own context: *"The fidelity target — **early-2000s console squad
  shooter** — is modest by modern standards, which is what makes a browser
  build realistic."*

So the era is already the target. What does not exist yet is any of the art
*treatment* that would make it read that way: the soldier is untextured
primitives under a PBR material. The ask is to close that gap now, in code,
rather than waiting for M4's asset pipeline.

**One hard constraint from the same line of `PLAN.md`: "Original IP — no
licensed names, characters, or assets."** Conflict: Desert Storm is a
*reference for the era's rendering constraints and silhouette language* — low
triangle counts, one small hand-painted diffuse texture, vertex lighting,
chunky gear. Do not copy its models, textures, characters, names, insignia, or
likenesses, and do not source assets ripped from it. Everything below is about
rebuilding the *technique*, which is not anyone's IP.

---

## 2. What the soldier is made of today

`packages/client/src/character/humanoidSoldier.ts` (T-2.22), measured on the
current `main`:

| | |
|---|---|
| Triangles | **1,446** |
| Vertices | 1,146 |
| Bones | **17** (`HUMANOID_BONES`) |
| Geometry attributes | `position`, `normal`, `color`, `skinIndex`, `skinWeight` — **no `uv`** |
| Material | `MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })` |
| Textures | **none. Not one, anywhere in the client.** |
| Draw calls per soldier | 2 visible (skin + rifle) under an invisible capsule root |
| Skin weights | rigid — every vertex belongs wholly to one bone |

It is built by welding Three.js primitives (`BoxGeometry`, `CapsuleGeometry`,
`SphereGeometry`, `CylinderGeometry`) into one geometry, each segment tinted
with a flat vertex colour: skin `0xc99572`, uniform `0x5f6748` local /
`0x6f7458` remote, cloth, gear `0x2f3329`. The rifle is a single box.

The scene it stands in (`main.ts` §Scene):

```
WebGLRenderer({ antialias: true }), pixelRatio ≤ 2, PCFSoftShadowMap
scene.background / fog        0x1a1408, fog 45..130 m
DirectionalLight 0xffe9c4 @ 2.6, 2048² shadow map   ← ADR-013's one sun
HemisphereLight 0xa9c0ff / 0x6b5a3a @ 0.75
ground: MeshStandardMaterial roughness 1 + GridHelper
```

### Why it reads as programmer art rather than as 2002

Triangle count is **not** the problem — 1,446 tris is already squarely in the
era's range (a Desert Storm-era soldier was roughly 1–2k). Four other things
are doing the damage:

1. **No texture at all.** The era's characters carried their entire detail
   budget in one small hand-painted diffuse map: webbing, pouches, seams,
   boot laces, a painted face, unit patches, baked-in shading. Flat per-segment
   vertex colours cannot express any of that, so the body reads as untextured
   geometry — which is exactly what it is.
2. **A PBR material under soft shadows.** `MeshStandardMaterial` + PCF-soft
   shadows + a hemisphere fill is a *modern* smooth look. The era was vertex
   or simple per-pixel Lambert, hard shadow edges, and shading largely painted
   into the texture.
3. **Round primitives.** Capsules and spheres give smooth, blobby silhouettes.
   Era models were faceted, with hard edges, chunky boots, a distinct helmet
   brim, and gear modelled as separate slabs.
4. **Realistic proportions.** The soldier is a correct 1.8 m figure with thin
   limbs. Era characters were stockier, ~6 heads tall, with oversized boots,
   gloves, helmet and webbing — read at distance on a CRT.

---

## 3. PS2, not PS1 — the distinction matters

If a successor reaches for the usual "retro 3D" shader kit, half of it is the
wrong console and will look like a mistake rather than a style:

| | PS1 (**do not**) | PS2 (**the target**) |
|---|---|---|
| Texture mapping | Affine — textures visibly swim and warp | Perspective-correct. No warping |
| Vertex precision | Integer snapping, the famous wobble | Floating point. **No jitter** |
| Resolution | 320×240 | 480p-ish, often 640×448 |
| Lighting | Mostly painted into the texture | Per-vertex hardware lighting, some per-pixel |
| Characters | 300–800 tris, 64–128 px textures | **1–3k tris, one 256² or 512² diffuse** |

So: **no vertex jitter, no texture warping.** The PS2 look is low-poly
silhouettes, one small point-filtered diffuse texture doing all the detail
work, simple vertex-ish lighting, hard shadow edges, a limited palette, and —
for a desert setting — the strong warm key, dust haze and crushed shadows the
fog already gestures at.

---

## 4. What must not move

This is the part that turns a two-day job into a two-week one if it is missed.
The soldier is load-bearing for five layers built on top of it in E-2.2 and
E-2.3, and for the authoritative hit resolution.

**Never:**

- **The root capsule.** `HUMANOID_HIT_RADIUS` 0.35 and
  `HUMANOID_HIT_HALF_HEIGHT` 0.55 (1.8 m total, centre 0.9 above the feet)
  are pinned by test to the server's `DEFAULT_HITBOX`. The harness raycasts
  this object non-recursively; the server resolves hits against the same
  shape. A chunkier *skin* is fine. A different hit capsule is a netcode
  change, not an art change.
- **The aim attachment's world place.** `AIM_IN_CHEST = [-0.3, 0.15, 0.05]`
  puts the rifle at `DEFAULT_MUZZLE_RIG`'s third-person shoulder
  (`shoulderRight` 0.3, `shoulderHeight` 1.42), where tracers start. Pinned by
  test. The trace origin itself is `eyePosition` at 1.55 m and is the server's
  — nothing the model does may move it.
- **Bone names.** `HUMANOID_BONES` is the contract a future glTF soldier must
  satisfy; the gait, vault, aim, hit-reaction and foot-placement layers all
  ask for bones by name.
- **The bind pose is the identity.** Every pose and layer in E-2.2/E-2.3 is
  plain Euler offsets from zero because of it, and `twoBoneIk.ts` returns
  local rotations that assume it.
- **The grey box.** `humanoidPlaceholder.ts` behind `?greybox` stays as the
  fallback and diagnostic fixture, and keeps passing its own tests.

**Handle with care (changing them is allowed, but these tests will need
updating in the same commit, deliberately):**

- `humanoidSoldier.test.ts` pins absolute geometry: head at y 1.58, foot at
  0.06, the 1.8 m stance, hands within 0.3/0.5 m of the aim attachment, a
  crouch dropping the head ≥0.35 m, the downed body's height, and
  **triangles < 4000**. If proportions change, these are the assertions to
  move — and the tri-count ceiling is the budget guard; keep one.
- `JOINTS`, `UPPER_ARM_M` (0.3) and `LOWER_ARM_M` (0.28) feed the arm IK;
  `GRIP_LEFT/RIGHT`, the elbow hints and `MAG_WELL` are in aim space and will
  need re-tuning if the arms change length.
- Leg segment lengths are *derived* from the bone table by
  `footPlacement.ts`, so T-2.28 adapts to new proportions on its own. Its
  tests assume the slab fixture, not the body.
- The layer tests (`aimPose`, `weaponHold`, `hitPose`, `vaultPose`,
  `footPlacement`, `locomotionPose`) are self-referential — they compare the
  rig against itself — so they survive proportion changes. They will *not*
  survive renaming bones or breaking bind-pose-is-identity.

---

## 5. Three findings that will otherwise cost a day

**1. Client tests run in Node, with no DOM.** `vitest.config.ts` sets
`environment: 'node'` for the client project. `document.createElement('canvas')`
and therefore `THREE.CanvasTexture` **throw** there, and every existing soldier
test constructs a soldier. Build the atlas as a **`THREE.DataTexture` from a
`Uint8Array` written by pure arithmetic**: it needs no DOM, no asset, no
loader, no new dependency, it works in the harness and in tests alike, and a
test can assert individual pixels. This is the single most important technical
decision in the whole job, and the cheap path and the testable path coincide.

**2. `weld()` throws the source UVs away.** It copies `position` and `normal`
only, then synthesises `color`/`skinIndex`/`skinWeight`. Three's primitives all
carry a `uv` attribute already, so texturing means keeping it and remapping
each segment's UVs into its own cell of the atlas — a change inside `weld()`
and its `Segment` record, not a rewrite.

**3. There is no asset infrastructure to hang a texture on.** No
`TextureLoader`, no `public/`, no image anywhere in the client, and §0.3 rule 3
forbids a new runtime dependency without an ADR. A generated `DataTexture`
keeps all of that true and adds nothing to the <80 MB download budget. If
someone instead brings in an image file, that is the M4 asset pipeline (E-4.1)
arriving early, and it needs a plan/ADR conversation first, plus a licence for
the file.

---

## 6. Proposed task breakdown

`T-2.01` … `T-2.29` are taken; `T-2.30` onward is free. These are drafted in
`PLAN.md` §0.1's shape so they can be pasted into a new §7.5 once the owner
agrees the scope. **Nothing here is agreed yet** — it is a proposal, and the
sequence matters more than the numbering: texture first, because it is where
the look actually lives.

#### T-2.30 — One diffuse atlas, procedurally generated
- **Depends:** —
- **Files:** `packages/client/src/character/soldierTexture.ts` (new), `humanoidSoldier.ts`, `packages/shared/src/data/` or a client-side palette JSON, tests
- **Do:** A 256×256 `DataTexture` built from arithmetic — no DOM, no asset — with `NearestFilter` magnification and the era's cell layout: one region per body part (torso front/back, arms, legs, boots, head/face, helmet, webbing, rifle). Paint the detail the geometry no longer has to carry: pouches, straps, seams, boot cuffs, a helmet band, a plain face. Keep `weld()`'s UVs and remap each segment into its cell. Palette in data, not in code (§0.3 rule 4).
- **Done when:** the soldier renders textured with one draw call and one material; the atlas builds in Node with no DOM; a test asserts the atlas's size, filtering and a few known pixels; triangle count unchanged; `pnpm verify` green.
- **Size:** M

#### T-2.31 — The silhouette
- **Depends:** T-2.30
- **Files:** `humanoidSoldier.ts`, tests
- **Do:** Chunkier, flatter, era-correct proportions inside the same 1.8 m capsule: bigger boots, gloves, helmet with a brim, a collar, webbing and pouches as geometry slabs, squarer limbs (fewer radial segments, flat-shaded where the era was). Keep the bone table's joint *positions* wherever possible; where they move, move the pinned assertions with them in the same commit.
- **Done when:** the root capsule, the aim attachment's world place, the bone names and the bind pose are all unchanged; triangles stay under the guard and inside ADR-013; every E-2.2/E-2.3 layer test still passes; `pnpm verify` green.
- **Size:** M

#### T-2.32 — The era's shading
- **Depends:** T-2.30
- **Files:** `main.ts`, `humanoidSoldier.ts`, `humanoidPlaceholder.ts`, tests
- **Do:** Drop PBR for the characters (`MeshLambertMaterial`, or Standard pinned to roughness 1 with no environment contribution), harden the shadow filter, and consider a fixed low-resolution render target upscaled with point filtering for the whole frame. Keep ADR-013's one shadow-mapped sun; keep the dust haze. **No vertex jitter and no affine texture warping** (§3).
- **Done when:** a human says it reads as the era; frame time no worse than before; the grey box still renders; `pnpm verify` green.
- **Size:** S–M

#### T-2.33 — Squad colours from the atlas
- **Depends:** T-2.30
- **Files:** `soldierTexture.ts`, `humanoidSoldier.ts`, palette data, tests
- **Do:** Per-slot variation — local, squadmate, bot — as palette swaps of the same atlas rather than new materials or new geometry, so six soldiers stay six draw calls' worth of the same one. Keep the local/remote distinction the harness already relies on.
- **Done when:** six soldiers on screen with distinguishable kit; no extra draw call per variant; `pnpm verify` green.
- **Size:** S

#### T-2.34 — 🧍 Look sign-off
- **Depends:** T-2.30 … T-2.33
- **Files:** `docs/playtests/soldier-look.md`
- **Do:** Two people on the host, at the ranges the game is actually played at — across the range, in cover, downed, at a sprint. Judge whether it reads as 2002 rather than as untextured geometry, whether soldiers are distinguishable at 40 m, and whether the silhouette still reads through the E-2.3 layers.
- **Done when:** a written verdict on a run sheet prepared before the session, naming what it does and does not establish.
- **Size:** S

**Where this sits against the plan.** E-2.3's build work is done and only its
human gate (T-2.29) is open; E-2.2's gate (T-2.24) is also still open. This
work is not on M2's critical path — M2's exit gate is whether third-person
combat *feels* good, not how it looks — so the honest options are: run it now
because the look affects every remaining playtest, or park it behind the two
open gates. That is an owner's call, not an agent's.

---

## 7. Standing rules, unchanged

From `PLAN.md` §0.3, all of which apply to this work:

1. `pnpm verify` — typecheck, lint, test — must pass. No task lands red.
2. Tests ship with the code.
3. **No new runtime dependency without an ADR.** A generated `DataTexture`
   needs none. An image file, a loader, or a post-processing library does.
4. **Data over code** — the palette is data, not literals in a system.
5. `packages/shared` imports nothing platform-specific. None of this work
   belongs in `shared`; it is all client presentation.
6. One line in `docs/CHANGELOG.md` per task.

And the one that is specific to this job: **the model is presentation, and
presentation never moves authority.** The hit capsule, the trace origin, the
replicated state and the wire format are untouched by everything above. If a
change to how a soldier looks makes a test about where a bullet goes fail,
the change is wrong — not the test.
