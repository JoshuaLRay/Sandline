# Sandline character voice-generation prompts

**Scope:** six voice identity specifications and reusable spoken-line prompts for the squad. The voice traits are proposals, not new dialogue, biography, or approved character canon.

> **Production direction:** A 2026-09-27 [ADR-017 addendum](../adr/017-in-house-audio.md) authorizes a ChatGPT text-to-speech trial for offline squad-voice candidates. Human-recorded voices remain in the eventual plan. Generated clips still need owner listening and a reviewed, reproducible path into the game before they count as production assets; the current `pnpm gen:voice` workflow expects consented human recordings.

## Source and naming

The slots, roles, and stable IDs follow the [squad roster](../design/squad-roster.md). Preach's name is approved; Brennan, Holloway, Ortiz, Marsh, and Vance remain proposed display names. The gender presentation, accent, pitch, and timbre proposed here are voice-design choices, not approved biography, ethnicity, region, or personality.

## What makes a voice stay the same

A detailed prompt is a voice specification; it cannot by itself force every text-to-speech system to reuse one exact speaker. For continuity, keep both the prompt and the generator's speaker identity fixed:

1. **Assign one persistent synthetic speaker ID per roster ID** if the generator supports it. Reuse that exact ID on every line for that character. Never ask for a “similar” replacement voice. A stable ID from the generator matters more than adding adjectives to the prompt.
2. **Lock the identity block.** Copy the character's voice block unchanged for every clip. Do not reword, shorten, reorder, or add character-specific traits between lines. Only replace the exact dialogue and the delivery tag.
3. **Lock generation settings.** Keep the same generator/model version, speaker ID, rate, pitch, stability, style, and seed where those controls exist. Record them. If the generator updates, audition the old and new outputs together before accepting the update.
4. **Keep delivery separate from identity.** “Shouted” means more projection and urgency from the same speaker. It must not change the voice's perceived age, gender presentation, pitch center, timbre, accent, or speaker identity.
5. **Use a reference only when supported.** If the tool allows an approved synthetic reference clip for continuity, keep one per character and reuse it. Do not use a real person's voice as a reference unless that person has explicitly agreed to it.
6. **Compare before accepting.** Keep a normal line as each character's voice anchor. Listen to new normal and shouted clips back-to-back with that anchor. Reject a take that sounds like another speaker, even if it has a similar accent or mood.

### Current ChatGPT generator limitation

The available ChatGPT AI Voice Generator takes the transcript and one general style preset (`normal`, `clear`, `fancy`, `deep`, `crisp`, or `delicate`). It does **not** accept the detailed identity blocks below or expose a persistent per-character speaker ID. Reusing a preset can help keep broad delivery similar, but it cannot guarantee that Preach or any other character remains the same exact voice across separate generations. Use these detailed prompts with a tool that supports fixed speaker identities; treat preset-only output as an audition until identity continuity is demonstrated. The profiles do not override this tool limitation.

## Voice continuity log

Keep a row for each character before generating a batch. Fill in values from the actual generator; do not invent a provider speaker ID if the tool has none.

| Roster ID | Prompt revision | Generator/model version | Persistent speaker ID | Fixed settings / seed | Reference clip | Continuity check |
|---|---|---|---|---|---|---|
| `preach` | `v1` | TBD | TBD | TBD | TBD | Pending |
| `brennan` | `v1` | TBD | TBD | TBD | TBD | Pending |
| `holloway` | `v1` | TBD | TBD | TBD | TBD | Pending |
| `ortiz` | `v1` | TBD | TBD | TBD | TBD | Pending |
| `marsh` | `v1` | TBD | TBD | TBD | TBD | Pending |
| `vance` | `v1` | TBD | TBD | TBD | TBD | Pending |

## Shared prompt wrapper

For a prompt-capable generator, use this same wrapper with one character identity block below. Keep the wrapper unchanged. Use one line per clip from [voice-script.md](voice-script.md), and preserve its cue ID and wording.

```text
Create one clean spoken clip in an ongoing series for the same fictional Sandline squad. The character voice identity below is locked. Reuse the exact same synthetic speaker identity used for every other clip for this roster ID; do not create a new speaker who merely sounds similar. Do not imitate or clone a real person.

Keep the voice's perceived age range, gender presentation, pitch center, pitch range, timbre, resonance, accent, articulation, and habitual cadence fixed. Respect the differences in this character block; do not flatten the squad into six nearly identical synthetic voices. Keep the timing natural rather than robotic, monotone, mechanical, or metronomic. Only the delivery tag may change energy and projection. A shout remains the same voice, just louder and more urgent; it does not become a different person.

Use clear, neutral, rhotic U.S. English. Speak the supplied line exactly as written. Do not invent dialogue, say the character's name unless it appears in the line, add ad-libs, or add another speaker. Output one dry voice with no music, ambience, weapon sounds, radio static, reverb, or other effects; the game adds its own treatment.

Character identity block:
{{PASTE THIS CHARACTER'S LOCKED IDENTITY BLOCK UNCHANGED}}

Delivery: {{NORMAL or SHOUTED}}
Cue ID: {{CUE ID — metadata only; do not speak it}}
Exact line: {{PASTE ONE EXACT LINE FROM voice-script.md}}
```

**Normal:** conversational but concise, radio intelligible, and not whispered.  
**Shouted:** project clearly over imagined combat without straining; preserve the normal voice's pitch center, timbre, accent, and identity.  
**Nonverbal cues:** grunts, breaths, downed cries, and the dying sigh are not spoken lines. Use a tool capable of producing nonverbal vocalizations or the human recording plan; do not put a cue label into the transcript.

## Voice identity blocks

The roster supplies roles and stable IDs. Preach's name is approved. Brennan, Holloway, Ortiz, Marsh, and Vance remain proposed display names. The gender presentation, pitch, accent, and delivery details below are creative proposals and can be revised; they do not establish a character's ethnicity, region, age, biography, or personality beyond the voice direction.

### Slot 0 — Preach (`preach`), squad leader, AR

**Identity anchor:** The squad's compact, steady command voice. Masculine presentation; adult baritone centered in the medium-low range, never a bass growl. Use a dry-warm tone with focused chest resonance and a small, natural grain at the edges of consonants. Keep the resonance centered and contained rather than broad or booming. Pitch movement is narrow to moderate: start level, emphasize key tactical words cleanly, and let the ends of statements settle downward. Use deliberate, even phrasing with short purposeful pauses between thought groups. Consonants are firm and exact; vowels stay natural and unforced. His neutral General American accent is rhotic and has no strong regional markers. The baseline is controlled authority and contained urgency, not anger or theatrical command.

**Keep distinct:** Preach is firmer and more compact than Brennan, warmer and heavier than Ortiz, and lower and less buoyant than Holloway or Vance. He has more chest presence than Marsh without Brennan's depth or grain.

```text
LOCKED IDENTITY — PREACH / preach. Use one fixed synthetic speaker identity for every clip. Adult masculine baritone centered in the medium-low range, firm but never bass-deep. The timbre is dry-warm with compact, centered chest resonance and a faint grain at consonant edges; no rumble, fry, or rasp. Keep pitch movement narrow to moderate, with level starts, deliberate stress on tactical words, and settled falling statement endings. Use even, deliberate phrasing with short purposeful pauses. Consonants are firm and exact; vowels remain natural and unforced. Accent: neutral, rhotic General American with no strong regional markers. Baseline: calm authority and contained urgency, never anger or theatrical command. Relative anchor: firmer and more compact than Brennan, warmer and heavier than Ortiz, lower and less buoyant than Holloway or Vance, and more chest-present than Marsh. Preserve all of these traits unchanged across every line and performance. Do not make Preach booming, growling, theatrical, or constantly loud.
```

### Slot 1 — Brennan (`brennan`), LMG

*Display name is proposed.*

**Identity anchor:** The squad's lowest and fullest voice, with weight but no menace. Masculine presentation; adult low baritone, clearly lower and rounder than Preach but not sub-bass. Give it broad, warm chest resonance and a mild, even grain through the middle of the voice. Keep the tone rounded and grounded, not breathy, sharp, or rasped. Use the slowest-feeling vowel shapes after Marsh's pauses: connected short phrases, steady pace, deliberate but not over-enunciated consonants. Let statements land softly downward. His neutral rhotic General American accent has no regional coloring. The baseline is patient and dependable. Carry weight through resonance and pacing, not volume; the LMG role does not mean constant shouting.

**Keep distinct:** Brennan is deeper, rounder, and more textured than Preach. Preach is tighter and crisper. Brennan is not a whispered sniper voice like Marsh and not an angry, gravelly “tough guy.”

```text
LOCKED IDENTITY — BRENNAN / brennan. Use one fixed synthetic speaker identity for every clip. Adult masculine low baritone: the squad's lowest and fullest voice, lower and rounder than Preach but never sub-bass. Timbre is broad, warm, dark, and gently textured through the middle of the voice; keep the texture even, not a growl or heavy rasp. Use rounded vowels, connected short phrases, a steady unhurried pace, and deliberate but natural consonants. Phrase endings settle softly downward. Accent: neutral, rhotic General American with no strong regional markers. Baseline: patient, grounded, dependable. Carry weight through resonance and pacing, not volume; the LMG role does not mean constant shouting. Relative anchor: deeper, broader, and slightly more textured than Preach, with softer edges; fuller than Marsh and less bright than Holloway. Preserve these traits unchanged on every line and in every delivery mode. Do not make Brennan angry, menacing, breathy, or cartoon-gruff.
```

### Slot 2 — Holloway (`holloway`), support

*Display name is proposed.*

**Identity anchor:** The squad's quickest and brightest masculine voice, lively without sounding young, comic, or nervous. Use an adult upper-middle tenor, higher and lighter than Preach, Brennan, and Vance. Place the sound forward with clean brightness and a little natural edge, but avoid a strongly nasal or pinched tone. Keep pitch flexible within a moderate range; brief acknowledgments may lift slightly, then resolve rather than turning singsong. Use the briskest conversational rhythm: fast pickups, clear word boundaries, and crisp consonants without swallowing syllables. His neutral rhotic General American accent has no strong regional markers. The baseline is alert, responsive, and helpful. Keep him energetic but grounded; do not add jokes or extra breaths to signal personality.

**Keep distinct:** Holloway is brighter, quicker, and more buoyant than Vance. Vance stays centered and measured. Holloway has more forward sparkle than Ortiz, but does not become high-pitched or nasal.

```text
LOCKED IDENTITY — HOLLOWAY / holloway. Use one fixed synthetic speaker identity for every clip. Adult masculine upper-middle tenor: the squad's brightest and lightest masculine voice, higher than Preach, Brennan, and Vance. Place the sound forward with clean brightness and a slight natural edge, never pinched or strongly nasal. Keep pitch flexible within a moderate range; brief acknowledgments may lift a little, then resolve rather than becoming singsong. Use brisk phrasing, quick pickups, crisp word boundaries, and clear consonants without swallowing syllables. Accent: neutral, rhotic General American with no strong regional markers. Baseline: alert, responsive, and helpful; energetic but grounded. Relative anchor: quicker, higher, and more buoyant than Vance; more forward and lively than Ortiz, but not squeaky or juvenile. Preserve these traits unchanged on every line and in every delivery mode. Do not make Holloway comic, nervous, breathless, or overly high-pitched.
```

### Slot 3 — Ortiz (`ortiz`), scoped-AR fireteam lead

*Display name is proposed.*

**Identity anchor:** A measured, precise feminine command voice whose clarity comes from placement and articulation, not sharpness. Use an adult feminine presentation in a medium-to-low mezzo range. Keep the tone smooth and centered-forward, with moderate resonance and minimal grain; do not push it into an unusually low register. Use crisp, evenly spaced consonants, balanced vowels, and a steady middle pace. Put light emphasis on the actionable word in a line, then finish with a composed falling or level ending. Avoid a repeated upward “question” lilt. Her neutral rhotic General American accent has no strong regional markers. The baseline is focused confidence and quiet decisiveness. Urgent lines gain projection and firmness, not coldness or anger.

**Keep distinct:** Ortiz shares Preach's controlled authority but has a cleaner, smoother, less chest-heavy voice and more even pacing. She is lower and less buoyant than Holloway; she is not a second Preach with a different pitch.

```text
LOCKED IDENTITY — ORTIZ / ortiz. Use one fixed synthetic speaker identity for every clip. Adult feminine presentation in a medium-to-low mezzo range, with smooth, centered-forward resonance, moderate weight, and minimal grain. Do not push the voice unusually low. Use a steady middle pace, precise and evenly spaced consonants, balanced vowels, and a small emphasis on the actionable word in a line. Finish level or gently downward; avoid a habitual question lilt. Accent: neutral, rhotic General American with no strong regional markers. Baseline: focused confidence and quiet decisiveness. Urgent lines gain firmness and projection, not coldness or anger. Relative anchor: shares Preach's controlled authority but has a cleaner, smoother, less chest-heavy voice and more even pacing; lower and less buoyant than Holloway. Preserve these traits unchanged on every line and in every delivery mode. Do not make Ortiz sharp, icy, theatrical, or sing-song.
```

### Slot 4 — Marsh (`marsh`), left-handed bolt-action sniper

*Display name is proposed. The left-handed weapon restriction is a gameplay rule, not a vocal trait.*

**Identity anchor:** A low-mid masculine voice with a lighter physical weight than Brennan's. Keep an adult masculine presentation in the low-to-middle range, lower than Vance but not as deep or rounded as Brennan. Use a soft, dry tone with a trace of airy texture at the start of phrases; keep the words fully voiced and intelligible, never whispered. Resonance stays light and close rather than chest-heavy. Use the most spacious phrasing in the squad: measured pace, brief quiet gaps between thought groups, little pitch travel, and restrained falling endings. Breathing remains controlled and should not become sighs or audible panting. His neutral rhotic General American accent has no strong regional markers. The baseline is reserved focus, not mystery or menace.

**Keep distinct:** Marsh is quieter, airier, and lighter than Brennan despite a similar low range. He is lower and slower than Vance, with less centered brightness. Do not use breathiness to imply injury.

```text
LOCKED IDENTITY — MARSH / marsh. Use one fixed synthetic speaker identity for every clip. Adult masculine low-to-middle register, lower than Vance but not as deep or rounded as Brennan. Timbre is soft, dry, and lightly airy at phrase onsets, with light resonance rather than chest-heavy weight. Keep every word fully voiced and intelligible; do not whisper. Use the squad's most spacious phrasing: measured pace, brief quiet gaps between thought groups, little pitch travel, and restrained falling endings. Breathing stays controlled and should not become sighs or audible panting. Accent: neutral, rhotic General American with no strong regional markers. Baseline: reserved focus, not mystery or menace. Relative anchor: quieter, airier, and lighter than Brennan despite the low range; lower, slower, and less bright than Vance. Preserve these traits unchanged on every line and in every delivery mode. Do not add injury, whispering, growling, or theatrical secrecy.
```

### Slot 5 — Vance (`vance`), semi-automatic sniper

*Display name and exact rifle model are proposed/open.*

**Identity anchor:** The squad's clear, centered masculine middle voice: observant and exact without sounding detached. Use an adult masculine presentation in the middle register, above Marsh and Brennan but below Holloway's brightest range. Keep the tone clean, dry, and lightly textured, with forward clarity but less sparkle than Holloway and less chest weight than Preach. Use a medium, even pace, slightly quicker than Marsh. Link short phrases naturally, articulate consonants precisely, and give factual words clean stress without overemphasis. Let statement endings settle level or gently downward; avoid a habitual upward lilt. His neutral rhotic General American accent has no strong regional markers. The baseline is practical, attentive restraint, with urgency expressed through firmer timing rather than swagger.

**Keep distinct:** Vance is more centered and restrained than Holloway, brighter and quicker than Marsh, and lighter and cleaner than Preach or Brennan. Keep a small but reliable gap between these voices.

```text
LOCKED IDENTITY — VANCE / vance. Use one fixed synthetic speaker identity for every clip. Adult masculine middle register, above Marsh and Brennan but below Holloway's brightest range. Timbre is clean, dry, and lightly textured, with forward clarity, less sparkle than Holloway, and less chest weight than Preach. Use a medium, even pace, slightly quicker than Marsh; connect short phrases naturally, articulate consonants precisely, and stress factual words without overemphasis. Statement endings settle level or gently downward, never with a repeated upward lilt. Accent: neutral, rhotic General American with no strong regional markers. Baseline: practical, attentive restraint. Relative anchor: more centered and restrained than Holloway, brighter and quicker than Marsh, lighter and cleaner than Preach or Brennan. Preserve these traits unchanged on every line and in every delivery mode. Do not make Vance detached, swaggering, gravelly, or buoyant.
```

