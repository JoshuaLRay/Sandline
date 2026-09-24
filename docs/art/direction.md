# Art direction

The brief every art generator in `packages/tools/src/art/` works to
(ADR-018: art authored as code). The setting is ADR-020: Afghanistan,
winter 2001–2002, US infantry in desert camouflage. The owner judges every
piece on the deployed site against this page.

## The target

A 2002 console squad shooter at its best. The fidelity reference is
*Conflict: Desert Storm* (2002). Nothing of it is copied; it is the bar.
That game's characters were:
- **modelled, not assembled:** limbs with muscle and taper, a torso with a
  waist, shoulders and a chest, a head with a jaw, a nose and ears;
- **dressed in modelled gear:** the vest, the pouches, the pack and the
  helmet stand off the body and break the silhouette;
- **textured with a painted, smoothly filtered diffuse** carrying camouflage,
  folds, seams, straps and a face;
- **lit simply:** diffuse lighting, smooth (Gouraud) normals, one sun, dust
  in the air (ADR-013).

**What the look is not.** It is not Roblox or Minecraft: no boxes for
bodies, no mitten-block hands, no hard-edged pixelated textures. It is not
PS1: no jitter, no warping, no 320×240. It is not modern either: no
physically based shine, no screen-space effects.

## Characters

| | Target | Why |
|---|---|---|
| Triangles | 3,000–6,000 (budget ceiling 15k) | Enough for forms and gear; the silhouette carries the era |
| Bones | the rig's 17 (`HUMANOID_BONES`) | One skeleton for everyone (§4.1); animation is code (ADR-018) |
| Texture | one 1024² diffuse a character, smooth filtering, mipmaps | Detail lives in the texture |
| Materials | the atlas and the squad marking (2) | One draw call a part (ADR-013) |
| Weights | blended across knees, elbows, shoulders, hips, waist and neck | Bodies bend; they do not crack at joints |
| Size | inside the server's hit capsule (radius 0.35 m) | Seen kit must be hittable kit (T-2.31) |

### The US soldier (`soldier-dcu`, T-4.08)

- **Uniform:** DCU three-colour desert: a tan field, large khaki
  (green-brown) blotches, brown blotches over both. Collar up, cuffs over
  the gloves, cargo pockets on the thighs, trousers bloused into the boots.
- **Helmet:** PASGT, with a desert cover and the skirt lower at the sides
  and back. Goggles on the front, on their strap round the helmet.
- **Vest:** Interceptor, in desert tan, with a collar and rows of MOLLE
  webbing. Three magazine pouches across the belly, a radio pouch high on
  the left, grenade pouches on the right.
- **Pack:** a tan three-day pack.
- **Belt:** a web belt, with a canteen on the right hip.
- **Hands and feet:** tan gloves; rough-out tan boots on dark soles.
- **Face:** weathered, stubbled, short dark hair, the chinstrap on the
  cheeks. Small eyes under a shadowed brow, a real nose. Not a doll.
- **Squad marking:** an armband on the left arm and a band on the helmet's
  back, in the slot's colour (`soldierPalette.json`, `accent`).

### The enemy fighter (`fighter`, T-4.35)

- **Dress:**
  - shalwar kameez: a long shirt over loose trousers, in earth colours;
  - a waistcoat, or a field jacket over it;
  - a pakol cap or a turban, and a scarf;
  - sandals or worn boots.
- **Gear:** a chest rig of magazine pouches; a bandolier for the MG
  gunner.
- **Silhouette:** distinct from the squad's at 40 m. It is loose cloth, not
  a vest and helmet; which side a figure is on must read before its
  colour does.

### Weapons (T-4.36)

- M4 carbine, M249, and the M203 under an M4, for the squad.
- AK-pattern rifle, PKM and RPG-7, for the enemy.
- Modelled parts: magazine, stock, sights, rail, bipod on the machine
  guns.
- Budget: 1–3k triangles each, textured from one weapons atlas.

## Environment (T-4.10 onward)

- **Compounds:** mud-brick qalats, plastered and weathered, with timber
  lintels and blue or green painted doors as accents.
- **Terrain:** rock, scree and dust.
- **Village clutter:** carts, sacks, drums, crates, rubble.
- **Palette:** ochre, dust, stone grey. The only strong colours are painted
  doors, cloth and the squad's markings.
- **Light:** one low winter sun, long shadows, haze with distance
  (ADR-013's baked lighting, T-4.12).

## How a piece is judged

1. It passes its budget and its tests: collision matches the mesh, it sits
   inside the capsule, and it is committed exactly as its generator writes
   it.
2. The owner looks at it on the deployed site (`?kit`, `?assets`, or in
   play). The question is: "does it read as 2002 at its best?"
3. The answer is a list of what's wrong. The generator changes and CI
   rebuilds.
