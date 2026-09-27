# Sandline character voice-generation prompts

**Scope:** six reusable prompts for exploring the squad's spoken voices. They are creative direction, not new dialogue, backstory, or approved character canon.

> **Production direction:** A 2026-09-27 [ADR-017 addendum](../adr/017-in-house-audio.md) authorizes a ChatGPT text-to-speech trial for offline squad-voice candidates. Human-recorded voices remain in the eventual plan. Generated clips still need owner listening and a reviewed, reproducible path into the game before they count as production assets; the current `pnpm gen:voice` workflow expects consented human recordings.

## Source and naming

The role and slot details below follow the [squad roster](../design/squad-roster.md). Preach's name is approved. Brennan, Holloway, Ortiz, Marsh, and Vance remain proposed display names; the stable roster IDs are the identifiers to keep in filenames and notes. These voice directions are proposals too.

The prompts use each character's role to distinguish their delivery. They do not assume the proposed skills are final or assign unapproved history, personality, or relationships.

## How to use

1. Copy one character prompt below into a voice generator that accepts voice direction.
2. Replace `{{PERFORMANCE}}` and `{{EXACT LINE}}`. Use one existing line from [voice-script.md](voice-script.md) per clip; keep its wording and cue ID unchanged.
3. Keep the voice description stable across that character's clips. Change only the performance direction: conversational/normal or projected/shouted.
4. Ask for one speaker and one clean clip. The game owns radio, distance, and shout processing, so do not bake those effects into the recording.
5. Keep generated filenames or notes tied to the stable ID: `kessler`, `brennan`, `holloway`, `ortiz`, `marsh`, or `vance`.

These templates are for spoken lines. The existing `hit-hurt` cues in [voice-script.md](voice-script.md)—grunts, breaths, the downed cry, and dying sigh—are nonverbal recordings. Do not put labels like “pain-grunt” into a spoken transcript and expect a text-to-speech tool to create the sound.

## Using ChatGPT's current AI Voice Generator

The available generator accepts the transcript and an optional general style preset (`normal`, `clear`, `fancy`, `deep`, `crisp`, or `delicate`). It does not accept the detailed voice-description prompts below or provide a persistent character-identity control. For a quick spoken-line preview, put only the exact dialogue in the transcript and use the same closest-fitting preset for every line assigned to that character. The preset alone will not guarantee six distinct, consistent character voices.

## Copy-ready prompts

### Slot 0 — Preach (`kessler`), squad leader, AR

```text
Create one clean, single-speaker spoken clip for Preach, a fictional adult U.S. squad leader in Sandline. Keep this voice identity consistent across separate clips: masculine voice, medium-low register, grounded and steady, with a light natural rasp. Use a measured pace and decisive consonants. He leads through calm control rather than constant volume. Urgent lines become projected and clipped without turning into a bark. Speak in clear, neutral U.S. English. Do not imitate any real person or actor, and do not add a regional or cultural caricature.

Performance for this clip: {{conversational/normal or projected/shouted}}.
Exact words to speak: {{EXACT LINE}}

Speak only those exact words. Do not announce the character's name or add words, breaths, call signs, or ad-libs. Output one dry voice, with no music, ambience, gunfire, radio static, reverb, or other effects. Keep every word intelligible; the game will add its own audio treatment.
```

### Slot 1 — Brennan (`brennan`), LMG

*Display name is proposed.*

```text
Create one clean, single-speaker spoken clip for Brennan, a fictional adult U.S. squad gunner in Sandline. Keep this voice identity consistent across separate clips: masculine voice, low and full register, slightly grainy, with an even, unhurried pace and weighty vowels. He sounds dependable and economical, not angry or cartoon-gruff. Urgent lines are projected clearly without strained shouting. Speak in clear, neutral U.S. English. Do not imitate any real person or actor, and do not add a regional or cultural caricature.

Performance for this clip: {{conversational/normal or projected/shouted}}.
Exact words to speak: {{EXACT LINE}}

Speak only those exact words. Do not announce the character's name or add words, breaths, call signs, or ad-libs. Output one dry voice, with no music, ambience, gunfire, radio static, reverb, or other effects. Keep every word intelligible; the game will add its own audio treatment.
```

### Slot 2 — Holloway (`holloway`), support

*Display name is proposed.*

```text
Create one clean, single-speaker spoken clip for Holloway, a fictional adult U.S. squad support soldier in Sandline. Keep this voice identity consistent across separate clips: masculine voice, middle register with a brighter, lighter resonance. Use a quick, agile rhythm and clean consonants. The energy should feel ready and helpful, never jokey, juvenile, or breathless. Urgent lines are short and clear. Speak in neutral U.S. English. Do not imitate any real person or actor, and do not add a regional or cultural caricature.

Performance for this clip: {{conversational/normal or projected/shouted}}.
Exact words to speak: {{EXACT LINE}}

Speak only those exact words. Do not announce the character's name or add words, breaths, call signs, or ad-libs. Output one dry voice, with no music, ambience, gunfire, radio static, reverb, or other effects. Keep every word intelligible; the game will add its own audio treatment.
```

### Slot 3 — Ortiz (`ortiz`), scoped-AR fireteam lead

*Display name is proposed.*

```text
Create one clean, single-speaker spoken clip for Ortiz, a fictional adult U.S. squad leader in Sandline. Keep this voice identity consistent across separate clips: feminine voice in a medium register leaning slightly low, with focused, forward resonance. Use precise consonants and an even, measured cadence. The authority is quiet and decisive, not cold or theatrical. Urgent lines are projected cleanly, with no strain. Speak in clear, neutral U.S. English. Do not imitate any real person or actor, and do not add a regional or cultural caricature.

Performance for this clip: {{conversational/normal or projected/shouted}}.
Exact words to speak: {{EXACT LINE}}

Speak only those exact words. Do not announce the character's name or add words, breaths, call signs, or ad-libs. Output one dry voice, with no music, ambience, gunfire, radio static, reverb, or other effects. Keep every word intelligible; the game will add its own audio treatment.
```

### Slot 4 — Marsh (`marsh`), left-handed bolt-action sniper

*Display name is proposed. The left-handed weapon restriction is a gameplay rule, not a vocal trait.*

```text
Create one clean, single-speaker spoken clip for Marsh, a fictional adult U.S. squad sniper in Sandline. Keep this voice identity consistent across separate clips: masculine voice in a low-to-middle register, lightly husky but not heavily gravelly. Use deliberate pacing, controlled breath, and restrained intensity. Leave small pauses between thoughts without whispering; the words must remain easy to understand. Urgent lines are concise and audible, not panicked. Speak in neutral U.S. English. Do not imitate any real person or actor, and do not add a regional or cultural caricature.

Performance for this clip: {{conversational/normal or projected/shouted}}.
Exact words to speak: {{EXACT LINE}}

Speak only those exact words. Do not announce the character's name or add words, breaths, call signs, or ad-libs. Output one dry voice, with no music, ambience, gunfire, radio static, reverb, or other effects. Keep every word intelligible; the game will add its own audio treatment.
```

### Slot 5 — Vance (`vance`), semi-automatic sniper

*Display name and exact rifle model are proposed/open.*

```text
Create one clean, single-speaker spoken clip for Vance, a fictional adult U.S. squad sniper in Sandline. Keep this voice identity consistent across separate clips: masculine voice in a middle register, clean and slightly brighter than Marsh's, with a light natural grain. Use a measured but slightly quicker pace and factual, observant delivery. Keep emotion controlled without sounding detached or swaggering. Urgent lines stay precise and direct. Speak in clear, neutral U.S. English. Do not imitate any real person or actor, and do not add a regional or cultural caricature.

Performance for this clip: {{conversational/normal or projected/shouted}}.
Exact words to speak: {{EXACT LINE}}

Speak only those exact words. Do not announce the character's name or add words, breaths, call signs, or ad-libs. Output one dry voice, with no music, ambience, gunfire, radio static, reverb, or other effects. Keep every word intelligible; the game will add its own audio treatment.
```

## Before generated audio ships

The ADR-017 addendum allows a limited ChatGPT text-to-speech trial alongside the eventual human-recording plan. The current `pnpm gen:voice` workflow still expects consented human recordings, so do not place generated clips in `assets/voice/raw/` or bypass its checks. Before generated clips become production assets, confirm the owner accepts their sound, the output can be used and exported, the six speaker identities remain intelligible and distinct enough, and the project has a reproducible import/validation path. No audio has been generated, reviewed, or approved by this prompt document.
