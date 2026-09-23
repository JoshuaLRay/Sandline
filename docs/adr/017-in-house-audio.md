# ADR-017: Combat audio made in-house — synthesised effects, processed recorded voices

- **Status:** Accepted
- **Date:** 2026-09-23
- **Plan reference:** §7 (M2 epic table, E-2.7), §7.10, §9 Q2, R1

## Context

E-2.7 (combat audio) has waited since M2 was broken out on one question:
where the sounds come from (R1, §9 Q2 — purchased, commissioned or
in-house). Nothing else blocks it: Web Audio is in every browser the game
targets, and the shared world, the shot and blast events, near-miss
geometry (T-3.16) and the gait phase that audio hangs off already exist.

The owner's decision (2026-09-23): **all of it in-house, made by AI —
preferably Claude.** That sets a hard constraint. Claude writes text and
code; it does not produce audio the way an image model produces pictures,
and it cannot hear what it makes. So "made by Claude" has to mean sound that
is **written as code** or **processed by code**, judged by a human ear.

The project already works this way everywhere else it has needed
content: the soldier's texture is painted from arithmetic (T-2.35), the
soldier is built in code (T-2.22), the trig table and the navmesh bakes are
generated and committed with a staleness check (T-0.14, T-3.03). Audio can
follow the same pattern.

## Decision

1. **Effects are synthesised from code.** Gunshots, impacts, cracks and
   whizzes, grenades and rockets, explosions, footsteps, reloads and bodies
   are recipes in data (`data/audio/*.json`, validated like every other data
   file) rendered by a small DSP library Claude writes: oscillators,
   seeded noise, filters, envelopes, distortion, and a generated reverb.
   A tool (`pnpm gen:audio`) renders them **offline, seeded**, into
   committed files, and a test fails when a recipe changes without a
   re-render, as with `gen:nav`. The page does only placement at runtime.
2. **Voices are recorded by people and processed by code.** Synthesised
   speech does not convince, so callouts are recorded — by the owner, or
   anyone who has agreed to their voice being used — and uploaded to the
   repository (`assets/voice/raw/`). A processing tool (`pnpm gen:voice`)
   trims, splits, normalises loudness, shifts pitch **and formants**
   (deeper without sounding slowed), applies per-soldier voice profiles
   (so one recorded voice can give several soldiers), adds radio, shout
   and distance treatment, and makes variants of each line. Its output is
   committed like the effects.
3. **Positional playback is the page's**, on Web Audio: a listener on the
   camera, per-source panning, distance falloff and an occlusion
   approximation (a muffled, quieter sound when the world's boxes stand
   between source and ear, using `rayWorld`), a voice limit with priority,
   and the speed of sound for distant cracks and blasts. Every tuning
   number is data.
4. **A human ear is the gate.** Claude checks what can be measured (peak,
   loudness, length, clipping, broad spectral shape) in tests. Whether it
   sounds right is the owner's call, on a **sound board on the deployed
   site** (`?sounds`) that plays every sound and line: the loop is "listen,
   say what's wrong, the recipe changes, CI re-renders".
5. **Either half covers for the other.** If a synthesised effect will not
   come right, the voice pipeline's processing applies to any recording the
   owner makes or has the rights to; if recordings are slow to arrive, the
   callouts ship with synthesised radio chirps until they do.

No runtime dependency is added (rule 3): the page uses the browser's Web
Audio. Development tools the pipelines need — an encoder, and for the voice
pipeline possibly a Python DSP library for formant-preserving pitch shift —
are dev-only, chosen in T-2.44 and T-2.48, and run in an agent's session or
in CI, never on the owner's machine.

## Consequences

- **The quality ceiling is lower than recorded foley** for the effects. Good
  procedural gunshots are convincing — and the era the game looks like was
  largely synthesised and processed sound anyway — but they will not match
  the best recorded libraries. Accepted; decision 5 is the way out if it
  matters.
- **Iteration costs the owner's attention.** Claude cannot hear, so every
  sound needs at least one listen, and weapons likely several rounds. The
  sound board exists to make each round a minute, not a session.
- **Voices sound like whoever recorded them.** Profiles make one voice into
  several soldiers, but they share delivery and accent; two or three
  recorded voices go further than any processing.
- **Consent is a hard rule.** Only recordings of the owner or of people who
  agreed are processed. Nothing is cloned from a voice whose owner did not.
- **Committed audio has a size.** One-shots are small (tens of kilobytes
  each, compressed); the whole set should be a few megabytes. The encoder
  and format are chosen in T-2.44 against what every target browser plays.
- R1 and §9 Q2 are **answered for audio only**. Art sourcing for M4 is
  still open.

## Alternatives rejected

- **Purchased sound libraries.** The owner wants it made in-house. Kept as
  the fallback decision 5 describes, not the plan.
- **Commissioned audio.** Same reason, and the most expensive option.
- **Runtime synthesis in the page for everything.** Zero bytes, but it
  spends CPU per shot (an MG at 900 rpm with six players firing) and makes
  every machine render its own version. Rendering offline once, seeded, and
  playing buffers costs nothing at runtime and sounds the same everywhere.
- **Text-to-speech voices.** An outside service, a dependency, and speech
  that still sounds synthesised under fire. Recorded voices, processed, are
  both in-house and better.
- **A third-party AI audio or voice-cloning service.** Not "made by
  Claude", an outside dependency and cost, and — for cloning — a consent
  question this project does not want to own.
