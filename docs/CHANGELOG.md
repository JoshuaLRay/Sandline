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
