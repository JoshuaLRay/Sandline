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
