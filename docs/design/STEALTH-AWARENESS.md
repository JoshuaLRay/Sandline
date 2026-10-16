# Stealth, enemy awareness and alarms

Epic: [U-204](../backlog/U-204.md). Pillar: P4 (and P7 for alarms and
reinforcements). Owner direction, 2026-10-16: "improve upon the original
Conflict games' relatively simplistic enemy detection" with graded awareness,
search, communication and alarms, no omniscience, and missions that stay
achievable after combat starts. **Status:** the states, rules and indicator
below are the approved direction and the recommended defaults; numbers are
starting points for tuning, not decisions. Conflict parity rows CP-19 and CP-42.

## 1. What exists (verified 2026-10-16)

| Piece | Today | Where |
|---|---|---|
| Sight | View cone and range per archetype; line of sight to shin, chest and head; smoke blocks it; an awareness meter 0..1 that rises with distance, stance (crouch ×0.6, prone ×0.25), movement, firing, cone position and exposure, decays when unseen; detected at 0.7 | `shared/src/ai/perception.ts`, `enemies.json` `perception` |
| Hearing | Shots (150 m), impacts, near misses, detonations, sprinting; plain radius through walls; only shots and sprints locate the source | `shared/src/ai/stimuli.ts`, `stimuli.json` |
| Memory | Last-known position per target, linear decay over 20 s | `shared/src/ai/memory.ts`, `memory.json` |
| Behaviour | Effectively two states: a threat (combat) or at ease (hold, patrol, garrison); a heard shot becomes a target to advance on; after 20 s with nothing known, back to post or patrol | `server/src/ai/posture.ts`, rifleman tree |
| Groups | Share a target only by vote among members who already know; staged reserves released only by script | `server/src/ai/group.ts`, U-131 |
| Missing | Suspicion and investigation states; enemies hearing their own side's gunfire; per-weapon noise; suppressors; alarms and alarm-driven reinforcements; communicating threats; silent takedowns; any awareness on the wire |

## 2. The five awareness states

| State | Meaning | Typical behaviour | Enters when | Leaves when |
|---|---|---|---|---|
| **Unaware** | Normal duty | Idle, guard, patrol (existing postures) | Start; after a search with nothing found (as *Wary*, below) | Any suspicion stimulus |
| **Suspicious** | Something was glimpsed or heard | Stops, turns toward it, raises weapon; may call softly to a neighbour | Sight meter passes a lower threshold (default 0.3) without reaching detection; a distant or muffled sound; a body found later (U-207) | Meter decays (back to Unaware/Wary after ~5 s); stronger evidence → Investigating or Alerted |
| **Investigating** | Checking a point | Walks (not runs) to the suspicious point or last-known position, scans, may bring one buddy | Suspicion persists or repeats; a nearby non-locating sound | Finds nothing (search timer, default 20 s) → Wary; detects a threat → Alerted |
| **Alerted** | Knows there is a hostile | Takes cover, shouts a warning to neighbours, may run to raise an alarm, readies to fight; does not yet know exactly where | Detection threshold reached; a squadmate's warning; a gunshot nearby; a body or wounded comrade; an alarm | Engages → Combat; loses all knowledge → Searching (Investigating with a wider search) |
| **Combat** | Engaging | Existing combat trees (cover, suppression, flanking, RPG, MG) | Has a target it can engage | Target lost → last-known position search (Investigating), then Wary |

**Wary** is Unaware with a memory: lower detection thresholds, faster meter
rise, patrols at a higher pace, for a configurable time (default the rest of
the mission for that group). An enemy that has seen combat never returns to
fully relaxed. Every number is data (`awareness.json`, zod-validated).

## 3. Detection inputs

- **Distance, field of view and terrain occlusion** — existing sight model.
- **Movement and stance** — existing multipliers; walking crouched or prone in
  cover is how a player stays unseen.
- **Light** — not modelled today (no night missions); add only with a night
  mission.
- **Weapon noise** — per-weapon `noiseM` replaces the single 150 m shot radius;
  a **suppressed** weapon's radius is a fraction and it does not locate the
  shooter beyond close range (U-206, suppressors U-210).
- **Sound through walls** — muffled: a sound heard through solid geometry has
  its radius reduced and only raises suspicion, never a precise location.
- **Nearby combat** — enemies now hear their own side's gunfire and blasts as
  "combat nearby" (today they hear only squad sounds), so a fight spreads
  believably instead of map-wide.
- **Previous knowledge** — memory of last-known positions; Wary groups.
- **No omniscience** — an enemy knows only what it saw, heard or was told by a
  neighbour in voice range; reinforcements arrive at the alarm point or the last
  reported position, not at the squad's true position.

## 4. Communication, alarms and reinforcements

- **Shouted warnings:** an Alerted enemy warns comrades within a voice radius
  (default 25 m, reduced through walls) — they become Alerted with the
  shouter's information, not the truth.
- **Alarms:** missions may place alarm points (a radio, a siren, a bell). An
  Alerted enemy may run to one if no comrade is already doing so; a squad member
  can stop it. A raised alarm sets the mission's `alarm` state: all groups in
  the alarm's area go Alerted, and the mission script can release staged
  reserves (U-131) — a new `alarm` event trigger.
- **Reinforcements** use existing waves and reserves, scaled by the director's
  human-count budget (ADR-001).
- **Missions stay achievable after combat begins:** stealth gives an advantage
  (fewer enemies alert at once, first shots on unaware targets, bonus loot
  conditions such as "no alarm" — LOOT-PROGRESSION.md L-01), but no objective
  requires it unless a mission says so and provides a fallback.

## 5. Bots and humans share the path

Friendly bots do not need awareness states, but they must use stealth when the
squad does: under **Hold fire** (U-101) and a crouch or prone stance order
(U-153) bots already move quietly; investigation must treat a bot like a human.
A future "stealth" fire-discipline setting (hold fire until detected, then
engage) is a candidate order for U-203's command epic.

## 6. Temporary overhead awareness indicators

Voices are not available (ADR-017; U-013 is blocked on recordings), so the
squad needs a reliable way to read and debug enemy awareness now. Indicators
are **temporary development and training UI**, not the final presentation;
eventually voice, animation, movement and behaviour communicate the same
thing. They are separate from the AI work: the AI is testable headless without
them, and they can be switched off without touching the AI.

| State | Glyph | Rendering notes |
|---|---|---|
| Unaware | ○ | Hollow circle, low opacity |
| Suspicious | ? | |
| Investigating | … | Single ellipsis glyph (U+2026), or three dots drawn as shapes where the font lacks it |
| Alerted | ! | |
| Combat | !! | |

Requirements (U-209):
- **Authoritative:** the host replicates each enemy's state (3 bits on the
  wire's Enemy component, with a protocol bump); the client shows exactly that
  and changes on the same snapshot.
- **No x-ray:** an indicator is drawn only while its enemy's body is drawn and
  visible from the viewer's camera (depth-tested against the world, not on
  top); enemies outside snapshot relevance are not shown; no indicator through
  walls or on the compass.
- **Readable everywhere:** drawn as text sprites or DOM labels (as
  `OrderMarkers` already projects), sized by screen not world, legible on a
  phone in the mobile spectator view; glyphs available in the system font or
  drawn as shapes.
- **Configurable and removable:** a settings toggle (default on while the
  feature is new), a per-room host override for playtests, and a single module
  so removing it later deletes one file and one wire field.
- **Multiplayer-correct:** every client sees the same state for the same enemy;
  spectators and switched players see it from their current view.

## 7. Implementation order (cards)

1. [U-205](../backlog/U-205.md) — authoritative five-state model with data and tests.
2. [U-206](../backlog/U-206.md) — detection inputs: per-weapon noise, muffling, enemies hearing combat.
3. [U-207](../backlog/U-207.md) — investigate, search, return to post, Wary.
4. [U-208](../backlog/U-208.md) — warnings, alarms, reinforcements.
5. [U-209](../backlog/U-209.md) — temporary overhead indicators (after U-205; independent of 2–4).
6. [U-210](../backlog/U-210.md) — suppressors (with the attachment decision).
7. [U-211](../backlog/U-211.md) — silent knife takedown on unaware enemies.
8. [U-212](../backlog/U-212.md) — tuning and verification, including "missions stay achievable once loud".
