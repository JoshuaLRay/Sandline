- T-2.06: replace capsule player representations with a shared humanoid grey-box soldier placeholder; move E-2.1 human sign-off to T-2.07.
# Changelog

One line per completed task, newest last. Appended by whoever completes the task
(standing rule 6 in `PLAN.md` §0.3).

Format: `T-<id> — <what changed>`

---

- T-0.13 — Wrote ADR-001 through ADR-015 plus index and template in `docs/adr/`.
- T-0.01 — pnpm workspace with shared/server/client/bot/tools; root `pnpm verify`.
- T-0.02 — Strict TS with project references; `shared` resolves to source.
- T-0.03 — ESLint flat config; bans platform imports and non-deterministic Math in `shared`.
- T-0.04 — Vitest with per-package projects.
- T-0.05 — CI running `pnpm verify`, plus a separate non-V8 parity job.
- T-0.14 — Deterministic trig (committed 1025-entry quarter table) and sfc32 PRNG.
- T-0.08 — Fixed 30 Hz timestep with spiral-of-death clamping.
- T-0.09 — bitECS world, components, and never-reused NetId allocation.
- T-0.10 — Rapier `-deterministic-compat` loads in Node; cost measured at 7% over default.
- T-0.11 — Parity harness reporting bounded divergence, replacing the golden hash.
- T-0.12 — `Simulation` class and `sim-run` CLI with a `--parity` mode.
- T-0.07 — Server bootstrap: config, JSON logging, tick loop, clean SIGTERM.
- T-0.06 — Vite + Three.js client with COOP/COEP headers set from the start.
- T-1.01 - BitStream reader/writer, bit-packed, throws on over-read.
- T-1.02 - Quantization specs with documented error bounds; clamps, never wraps.
- T-1.03 - Replication schema and full snapshot encoding in wire integers.
- T-1.04 - Delta compression with per-field masks and a bounded baseline ring.
- T-1.05 - Tagged protocol messages with handshake version rejection.
- T-1.06 - Transport interface plus a queued in-memory loopback pair.
- T-1.21 - NetSim: clock-driven latency, jitter, loss and duplication.
- T-1.07 - WebSocket server transport on `ws` (see ADR-008 addendum).
- T-1.08 - Browser WebSocket client transport with exponential backoff.
- T-1.09 - Connection lifecycle, handshake validation, heartbeat timeout.
- T-1.10 - Clock sync with median RTT and offset estimation.
- T-1.12 - Kinematic character controller, pure and table-trig driven.
- T-1.13 - Authoritative 30Hz session with six slots and per-client deltas.
- T-0.06 - Client rebuilt as a local movement QA harness with live tuning.
- T-1.11 - Keyboard and pointer-lock input producing MoveInput, edge-latched.
- T-1.14 - Client prediction: immediate input with replay history.
- T-1.15 - Reconciliation with input replay and linear correction smoothing.
- T-1.16 - Remote entity interpolation, Catmull-Rom with a capped extrapolation.
- T-1.20 - Headless bot client running the real prediction path, plus CLI.
- T-1.22 - Netcode convergence matrix: 2/6 bots x latency x loss, M1's exit gate.
- T-1.12 - Fixed inverted strafe handedness; pinned with direction tests.
- T-0.06 - Orbit camera with real pitch, asymmetric limits, FPS/TPS toggle.
- T-1.17 - Hitscan weapons: data-driven defs, deterministic seeded spread, falloff.
- T-0.06 - Client becomes the QA home: live weapon range for T-1.17, tracers, falloff.
- T-0.06 - First weapon QA pass: reload loop, semi-auto, shoulder camera, ADS cue.
- T-0.06 - Weapon and camera tuning panels; every QA window collapsible.
- T-0.06 - Pitch up raised to 89 degrees; camera orients by Euler, not lookAt.
- T-1.18 - Lag compensation: rewound hitbox history, capped at 200ms, no restore step.
- T-0.06 - Muzzle moved to the character's right hip; ADS brings it up and in.
- T-1.18 - Session wiring: Fire/HitEvent messages, server-authoritative cadence, protocol v3.
- T-0.06 - Harness connected to an in-page authoritative session; link-condition sliders.
- T-0.06 - Muzzle by view: TPS shoulder, FPS hip, FPS ADS centre; trace origin split out.
- T-0.06 - Restore inter-tick render interpolation; range targets are server-side hittable.
- T-0.06 - Build stamp in the HUD; server now decays weapon bloom (accuracy fix).
- T-1.15/T-1.18 - Smoothness pass: reconcile fixes, input redundancy, hold-not-repeat.
- T-1.17/T-1.18 - Predicted tracers (no firing delay) and rewound shooter origin.
- T-0.06 - Fix TPS shots landing down-left: one complete shootable list for aim convergence.
- T-1.19 - Damage with hit zones, death and 5s respawn; health replicated and shown.
- T-0.06 - Aim rides at 1/4096; convergence limited to server-shootable geometry; spawns off the firing line.
- T-1.23 - Netgraph overlay (G) with a second in-page client; fixed a client-killing Pong encode and continuous extrapolation.
- T-1.24 setup - Per-client link conditions: your link and the sparring partner's move apart.
- T-1.24 - M1 playtest gate: human sign-off recorded in docs/playtests/m1.md. M1 closed.
- T-2.01 - Camera solve lifted out of the render loop, into a testable module.
- T-1.5.01 - Session host process: `pnpm host` serves the real Session over a WebSocket, with per-connection link conditioning and `pnpm bot --url`.
- T-1.5.02 - Client joins a real host with `?host=ws://…`; two tabs share one session. Fixed a slot reused by a new client keeping the old occupant's input tick, which silently discarded every input from the newcomer.
- T-1.5.04 - Protocol v6: `Join` carries a room code, `JoinAck` the room landed in, `Disconnect` a typed code; `Roster` message; voice-safe room codes. A v5 client is rejected on version, not on room.
- T-1.5.05 - Room registry: one host holds many sessions, each on its own tick clock; empty rooms reclaimed after a grace; room, connection and process caps reject rather than degrade; `/healthz`.
- T-1.5.06 - Lobby: host a room or join a code from the page, six-row squad panel, leave, share link; `?host=`/`?room=` pre-fill rather than bypass; default host baked in from `SANDLINE_HOST`.
- T-1.5.07 - Host container, Fly config with TLS at the edge and auto-stop, deploy workflow, `DEPLOYING.md` deploy and teardown. The deploy itself needs an account and is documented, not run.

- T-2.02 - Frame-rate-independent asymmetric spring arm: snap inward, exponentially ease outward, with derived settle-time tests.
- T-2.03 - Camera arm collision against static scenery, isolated from the server-authoritative shootable set.

- T-2.04 — Eased Q-key shoulder swap with mirrored camera/muzzle offsets and 10/95 m aim-convergence coverage.
- T-1.5.03 — Human-to-human LAN gate: owner playtest sign-off recorded; two-human combat feel accepted.
- T-1.5.08 — M1.5 internet gate: owner completed the two-human real-host playtest and reported it looks great; M1.5 closed.
- T-2.05 — ADS transition: arm length, shoulder offset and FOV now share one frame-rate-independent normalized transition.
- Reticle: fixed at the centre again, with a gap that follows the weapon's cone — wide in hip fire, wider under bloom, tight when aiming; the moving third-person reticle (which lagged the view by a frame) is gone and camera-to-eye aim convergence is back so the centre is where shots land. Aiming still enters first person until V.
- Review of E-2.1 (T-2.02..T-2.06): the humanoid's hit root is now the server's hitbox capsule rather than the torso box, so the harness hits what the server hits; V no longer flips the shoulder on key auto-repeat; camera collider stops allocating per frame; stale HUD key hint; leftover debug logging removed from CombatQA; Host workflow fails early without GH_PAT and the docs name both secrets.
- T-1.12 — World collision: one shared box world (posts, rails, figure, cover from `data/world.json`) that the controller collides with (slide, step, land, head room), the server stops shots on, and the client renders and raycasts; parity over 500 ticks is exactly 0 on every engine. Firing-lane posts removed so the range stays shootable from every slot.
- T-2.08 — Recoil patterns: per-weapon kick, seeded drift, cap and recovery in `weapons.json`; a view offset laid over the mouse so recovery never eats the player's compensation; frame-rate-independent recovery; sliders in the weapon panel.
- T-2.09 — Camera shake: a decaying positional and roll impulse per shot, summing across a burst and bounded by its own decay; composed after the arm into separate solve fields so the aim never reads it; per-weapon magnitudes in data and a shake slider (0 = off).
- T-2.10 — Muzzle flash and shell ejection: an additive sprite and a point light at the visual muzzle for two frames, and a box shell thrown right and back on a closed-form arc that lands, rests and fades; both pooled once and capped, so a held trigger never allocates; live counts on the HUD.
\n- T-2.11 — Impacts: a scenery stop (hit event on netId 0 whose point lies on a face of the shared world) leaves a dark mark on that face and throws sparks from the server's point; a soldier hit flinches; max-range misses and the ground, which the server has no box for, draw nothing. Pooled and capped with the other effects.\n
- M1.5 verdicts written down: `docs/playtests/m1.5-lan.md` (T-1.5.03) and `m1.5.md` (T-1.5.08), after the fact from the record, stating what each gate does and does not establish; ADR-012 addendum closes the two-human re-gate; §10 item 1 done except the netgraph numbers, still owed.
- T-2.12 prep — `docs/playtests/e2-4.md` run sheet (not a verdict; says so); weapon panel gains shake sliders and its paste-back block now carries the recoil and shake fields it was dropping, held to the type by a test.
- E-2.6 broken out (T-2.13..T-2.16). T-2.13 — Downed state: zero health downs rather than kills; a bleed-out timer in `damage.json` that damage cuts in proportion; crawl speed and a `downed` gait the server imposes and the predictor mirrors; downed and dead cannot fire; vitality and its countdown replicated in `Health` (protocol v7); HUD shows DOWNED / DEAD with the server's timer.
- T-2.14 — Downed presentation: the humanoid's parts lie down on the hit capsule, which does not move; the camera pivot eases to a crawl height; remote downed soldiers are posed from replicated vitality; the reticle hides and a DOWNED banner counts the server's timer.

- T-2.07 / T-2.12 / T-2.16 — Human sign-offs passed for E-2.1 camera, E-2.4 weapon feel, and E-2.6 downed/revive; M2 moves to E-2.2.
- Planning: broke E-2.2 into T-2.17 through T-2.23, covering locomotion state, eight-way gait, remote playback, crouch height/hit volume, authoritative vaulting, vault presentation, and human sign-off.

- T-2.17 — Added a pure rendered-velocity locomotion classifier with idle/walk/sprint/crouch-walk/crawl states, eight-way direction, normalized gait inputs, and QA HUD integration.
- Planning update 2026-09-20 — E-2.2 now explicitly includes T-2.22, a reusable humanoid character model/rig integration before the human gate; the grey-box remains only as a fallback/diagnostic fixture, and the E-2.2 sign-off moves to T-2.24.
- T-2.19: integrate local predicted and remote interpolated locomotion playback through the shared pose driver.
- T-2.20 — Added authoritative crouch height/clearance, crouched humanoid presentation, and crouch-aware lag-compensated hit volumes.
- T-2.15 fix — a revive hold survives idle ticks: the interact button is latched from the newest real input instead of read off the tick's input, so gaps in a bursty input stream pause the hold rather than resetting it; silence past the repeat window still releases it. Tests: inputs every third tick complete on time; a silent reviver drops the lock.
- T-2.21 — Authoritative vault: obstacles taller than a step and no taller than 1.25 m are vaulted on forward intent; a closed-form traversal in movement config (distance, seconds, lip), server-owned and mirrored exactly by the predictor from the replicated `Vault` component (protocol v10); no vault while downed, crouched, firing, jumping or airborne, and no Fire mid-vault; the parity harness vaults a hurdle.
- T-2.22 — Skinned humanoid soldier built in code (one `SkinnedMesh`, seventeen bones, one draw call) replaces the grey box as the local and remote presentation, behind a rig contract (`humanoidRig.ts`: named bones, chest-mounted aim attachment carrying the rifle, per-pose base transforms, gait style) that the grey box also implements (`?greybox`); the pose driver now layers the gait on the pose, with knees, hip bob and chest twist on the skinned rig; the hit root is unchanged.
- T-2.23 — Vault presentation: a `vault` locomotion state driven by the authoritative progress (local prediction and remote interpolation alike; the interpolation buffer now carries `vaultElapsed`), a vault pose curve on any rig with lead/trailing legs and a chest lean, gait crossfaded in and out and a landing dip, and a per-frame joint-step readout in the HUD that proves no snap.
- Review fixes (T-2.15, T-2.20) — a reviver holds one revive at a time: with two downed teammates in reach, one held E no longer brings both back in a single hold; and standing up while jumping under a ceiling clamps the feet to the standing height instead of lifting them 0.6 m for a tick.
- T-2.24 prep — `docs/playtests/e2-2.md` run sheet (not a verdict; says so) for the E-2.2 sign-off on the skinned soldier: figure at rest, eight-way gait, crouch, jump, vault, crawl and revive, the other person over the host, and the grey-box fixture; the movement panel gains crawl speed and the vault's seconds, distance and maximum height.
- Planning: broke E-2.3 into T-2.25 through T-2.29 (aim offsets, fire and reload layers, hit reactions on the rig, foot placement, sign-off), each a procedural layer on the rig contract; refreshed §10.
- T-2.25 — Aim offsets: the rig contract's `aimAt(pitch, weight)` layer pitches the spine, neck and rifle to the aim and re-solves the hands onto the grips every frame, bit-exact at level; locally from the view pitch (recoil included), for remotes from the replicated `Transform.pitch`, now carried through the interpolation buffer; fades through a vault, off while downed.
- T-2.26 — Fire and reload layers: `hold(state)` on the rig contract takes aim, kick and reload in one pass; the kick (`weaponKick.ts`) drives the rifle back and up by the weapon's kick in data and recovers frame-rate independently, locally from the predicted shot and for remotes from the server's shot event; the reload is a curve of the weapon's clock with the left hand to the magazine well and back; a `Weapon` component (index, reload percentage) rides the snapshot (protocol v11).
- T-2.27 — Hit reactions on the rig: `react(reaction)` on the rig contract turns the chest away from the shooter and tilts it along the shot, with a head snap on a head-zone hit, scaled by damage and recovered on the T-2.02 curve as a closed form of the age; direction and zone come from state every client already has (`hitReaction.ts`, the shot's shooter and the impact's height against `damage.json`'s fractions), `effects.flinch` becomes the entry point that asks the rig, and the grey box keeps the T-2.11 translation flinch; a downed soldier does not react.
- T-2.28 — Foot placement: each foot reads `supportUnder` at its own x/z in the shared world and a two-bone leg IK plants it, bounded, with the hips settling to the lower foot and the other knee taking up the difference; the gait stays on top (its knee is the pole hint, and a foot it has lifted is not planted), the settle is a critically damped spring so no joint moves faster than the walk already does, and flat ground is the pose driver's own bits. The arms' and legs' IK is now one solver (`twoBoneIk.ts`). Off while airborne, vaulting or downed; the root is never touched. The harness HUD gains a feet readout (where you stand, each foot's support, the hips' settle).
- Planning: broke the soldier's look into T-2.30 through T-2.34 (§7.5) from `docs/HANDOFF-SOLDIER-LOOK.md` — one generated diffuse atlas, the silhouette, the era's shading, squad colours, and a human sign-off. The era was already the locked art direction (PLAN.md line 5, ADR-013's context); what never existed was any of the treatment. PS2 and not PS1: no vertex jitter, no affine warping. Nothing authoritative moves.
- T-2.30 — One generated diffuse atlas: `soldierTexture.ts` paints a 256² `DataTexture` from arithmetic alone as a 4×4 grid of 64px cells (face, helmet, torso front/back, vest, belt, sleeve, glove, trouser, boot, neck, rifle, pack, two plain), point-magnified and sRGB, with the palette in `soldierPalette.json` (rule 4). A `DataTexture` and not a canvas because client tests run in Node where a canvas throws; not an image because this client has no loader, no `public/` and no asset pipeline until E-4.1. `remapGeometryUv` moves each primitive's UVs into its cell and takes an array to give a box a cell per face, so one torso box carries a placket and pockets on the front and a plain yoke on the back; `weld()` carries `uv` across and the flat per-segment vertex colour is gone. Two measured findings are pinned by test: Three's spheres and capsules emit `u` outside [0,1] (-0.0625..1.0625 on an eight-segment capsule) so `cellUv` clamps, and the remap insets by half a texel or a primitive's last column reads the next cell. Geometry, bones, bind pose, hit capsule and aim attachment untouched; the rifle shares the atlas and stays the second draw.
- T-2.31 — The silhouette: era-correct proportions inside the same 1.8 m capsule. A helmet with a BRIM (one disc at the dome's rim — the single strongest era cue the model has; without it a helmet reads as a swimming cap), oversized boots with an upper on the shin that wears them so the ankle is attached to something, bigger gloves, thicker limbs on six radial segments instead of eight, shoulder slabs instead of balls, and a collar and five pouches as geometry, because gear that breaks the outline is most of what tells a 2002 soldier from a mannequin. **Triangles went DOWN, 1,446 to 980**: faceting the limbs bought more than the gear cost. Every joint position in the bone table is unchanged, so the arms' IK, the legs' derived lengths and every pinned assertion hold as they were, and all of E-2.2's and E-2.3's layer tests pass untouched. New guard: every skin vertex stays within `HUMANOID_HIT_RADIUS` of the root axis and fills at least 80% of it — a shoulder or pack outside the capsule is a netcode bug wearing art's clothes, since you would watch rounds pass through visible kit.
- T-2.32 — The era's shading: the characters drop PBR for `MeshLambertMaterial` (diffuse and nothing else, which is what hardware lighting in 2002 was, and cheaper besides) and the shadow filter hardens from `PCFSoftShadowMap` to `PCFShadowMap` — a soft penumbra under a soldier and a roughness response are the two things that read as modern however the character is textured. The grey box takes the same material so the fixture is lit like the thing it stands in for. **Smooth normals on purpose:** `flatShading` is the reflex and it is the wrong console — the PS2 interpolated per-vertex lighting across a triangle, so curved surfaces read smooth and only the silhouette gave the polygon count away; faceted shading is a 2015 indie look. No vertex jitter and no affine warping, both of which are PS1. ADR-013's one sun and the dust haze are untouched. The low-resolution render target the handoff floated is NOT done and is deferred to T-2.34: it trades crosshair, tracer and hit-marker legibility that the two open feel-gates are judged on, and that is an owner's call.
- T-2.33 — Squad colours: the palette data becomes a `base` plus per-name overrides, so a squad of six is one set of colours wearing six markings rather than six unrelated schemes — and a slot colour is one line of data. `paletteFor({local, human, slot})` reads the palette off the roster; `setSoldierPalette(root, name)` repaints a LIVE soldier by swapping the atlas only — same geometry, skeleton, material and draw call — so a slot flipping between bot and human changes colour on the entity already standing there, which is ADR-001's swap made visible. `main.ts` re-asks every frame and the call skips when nothing changed. The marking moved twice for a reason worth recording: the slot's colour is now the HELMET BAND, because a patch does not survive forty metres, and the band sits a third of the way UP the dome rather than at the rim, where T-2.31's new brim occludes it exactly — the first version was painted correctly and invisible. Shoulder patches carry it too, since the helmet mark and vest patch both face front and a squad seen from the side shows neither. `remote` stays as the fallback before the roster arrives.
