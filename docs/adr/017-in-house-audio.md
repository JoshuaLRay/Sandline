# ADR-017: Combat audio made in-house — synthesised effects, processed recorded voices

- **Status:** Accepted
- **Date:** 2026-09-23
- **Plan reference:** §7 (M2 epic table, E-2.7), §7.10, §9 Q2, R1
- **Current voice-source direction (2026-09-27):** trial ChatGPT text-to-speech for offline squad clips, while keeping human-recorded voices in the eventual plan; see the owner addendum below.
- **Voice intake (2026-09-28):** owner chose in-game recording and click-through consent for friends; see addendum below.

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
2. **Human voices are recorded by people and processed by code.** The
   eventual human-voice plan is to record callouts — by the owner, or anyone
   who has agreed to their voice being used — and upload them to the
   repository (`assets/voice/raw/`). A processing tool (`pnpm gen:voice`)
   trims, splits, normalises loudness, shifts pitch **and formants**
   (deeper without sounding slowed), applies per-soldier voice profiles
   (so one recorded voice can give several soldiers), adds radio, shout
   and distance treatment, and makes variants of each line. Its output is
   committed like the effects. The 2026-09-27 addendum below also authorizes
   a limited ChatGPT text-to-speech trial for offline squad clips; it
   supplements, rather than replaces, the human-recording plan.
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
   owner makes or has the rights to. If human recordings are slow to arrive,
   the ChatGPT trial can test candidate squad clips; cues without a source
   that passes review still use the existing placeholder.

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
- **Consent is a hard rule for recordings.** Only recordings of the owner or
  of people who agreed are processed. The text-to-speech trial must use an
  original generated voice and must not imitate or clone a real person's
  voice.
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
- **Text-to-speech voices (original decision, 2026-09-23).** The original
  decision rejected TTS because the available option seemed to require an
  outside service and the speech might sound synthetic under fire. The
  2026-09-27 addendum authorizes a limited trial of ChatGPT's available
  text-to-speech generator; it does not approve runtime TTS or another
  provider.
- **Other third-party AI audio or voice-cloning services.** Still not
  approved by this decision. The ChatGPT trial is for offline candidate
  clips only; it does not authorize another provider or voice cloning.

## Owner addendum — ChatGPT text-to-speech trial (2026-09-27)

The owner notes that ChatGPT can generate speech from text and directs the project to try that capability when usable audio can be produced, because it may be faster and easier to audition than waiting for a full set of human recordings.

1. **Try offline squad clips.** Use ChatGPT's available AI Voice Generator to create separate spoken-line candidates for the six named squad characters, guided by [the character voice prompts](../audio/character-voice-prompts.md). This is an offline source trial; the game continues to play audio clips and gains no runtime TTS dependency.
2. **Keep human voices in the plan.** Consented human-recorded voices remain part of the eventual plan. This trial supplements that plan and does not decide the final mix or replace future recordings.
3. **Review before production use.** Generated clips remain candidates until the owner has listened to them and their intelligibility, repeatable character identity, export/use terms, browser format, and fit with a reproducible pipeline have been checked. No separate provider, purchase, or subscription is approved by this addendum; if the available ChatGPT capability cannot supply usable output within current access, pause and revisit the source decision.
4. **Do not bypass the current pipeline.** `pnpm gen:voice` still expects consented human recordings. Do not put generated output in `assets/voice/raw/` or call it a processed production asset until a reviewed pipeline change defines its source metadata, validation, and regeneration path.
5. **Keep voices original.** Do not imitate or clone a real person or an unconsenting speaker. This addendum authorizes a ChatGPT trial only; it does not authorize other TTS providers.

## Owner addendum — in-game human voice contributions (2026-09-28)

The owner wants to share the game with friends, let them record there, and capture consent with a click. The prior GitHub-upload instructions are no longer the preferred collection path.

The game offers a `?record-voice` page with the exact voice script, microphone capture, playback, a name or nickname, an invitation code, and an unchecked consent box. The intake host stores the consent text and timestamp with the raw section recordings on a private persistent volume. Audio is never served by the public API. This is a contribution to the game's authored voice assets, **not** a personal voice chat feature or a replacement for the game's fixed squad characters.

The owner reviews a submission and explicitly imports it with `pnpm import:voice`, then runs the existing offline `pnpm gen:voice`. Only reviewed outputs become game assets in a later commit/deployment. A submitted recording is not played in a live game automatically. The consent text explicitly discloses that accepted source recordings and the chosen name can enter the public source repository, and that prior copies may persist after a future removal. Keep a way to delete unprocessed submissions on request; remove already published audio in a subsequent asset release when appropriate.

The intake is disabled without `VOICE_INTAKE_DIR` and `VOICE_SITE_ORIGIN`. The Fly deployment config uses its persistent volume for `VOICE_INTAKE_DIR` and the exact deployed game origin for CORS. The owner chose `JRay` as the case-insensitive invitation code; the code is public and short, so the existing request and storage limits matter. It is distinct from the multiplayer join key.
