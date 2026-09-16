# ADR-004: Three.js for rendering

- **Status:** Accepted
- **Date:** 2026-09-16
- **Plan reference:** §2

## Context

The renderer must run in a browser, hit the ADR-013 performance budget, and —
critically — stay out of the way of the simulation. The simulation is
authoritative and shared (ADR-003); the renderer is a view onto replicated state
and must not own game state.

## Decision

Three.js, used as a library rather than a framework. It renders; it does not
drive the game loop, own entities, or step physics.

## Consequences

- Full control over the render loop, which the fixed-timestep simulation (T-0.08)
  requires — the simulation ticks at 30 Hz independent of frame rate.
- No editor. Level authoring goes through Blender and a custom level format
  (E-4.3), which is more upfront work than an engine with a built-in editor.
- Largest ecosystem of the options, which matters for loaders, post-processing,
  and the long tail of problems someone has already solved.
- We own more of the rendering stack: batching, instancing, and LOD are our
  problem, and ADR-013's draw-call budget will require explicit work.

## Alternatives rejected

- **PlayCanvas.** Strong WebGL performance and a real editor. Rejected on
  editor lock-in: scene data lives in their format and tooling, which conflicts
  with a custom level pipeline and with keeping the simulation authoritative and
  engine-independent.
- **Babylon.js.** Capable and more batteries-included. Rejected as more
  opinionated about owning the loop and scene graph, for no advantage that
  matters at this fidelity target.
- **Godot 4 web export.** Rejected on three counts: SharedArrayBuffer/COOP-COEP
  deployment friction, bundle size against the <80 MB budget, and — decisive —
  the server could not share simulation code with the client.
- **Unity WebGL.** Rejected on load times, which are incompatible with the
  "playable in <30 s" requirement.
