# Ongoing upgrades and bugs

This is the canonical queue for **“complete the next task”** after the vertical
slice, starting 2026-09-26. Read this index and exactly one task card. The queue
order below is the initial triage recommendation; the owner can reprioritize it.
[Workflow and example prompts](docs/WORKFLOW.md) · [original feedback](docs/backlog/2026-09-26-feedback.md)

`TASKS.md` / `PLAN.md` retain milestone history and outstanding legacy work;
this queue does **not** declare their human gates passed. New upgrades get `U-`
IDs; old `T-` and `B-` IDs remain stable. Do not maintain a duplicate status in a
GitHub Issue, task card or `PLAN.md`. PRs link to the canonical card.

## Selection and status

- Select the **first READY leaf in table order with all dependencies DONE**.
  Skip blocked/review/in-progress items and continue; do not stop at a human gate.
- After verifying a dependency merged/completed, promote a dependency-only BLOCKED
  row to READY when *all* its dependencies are DONE. A missing asset/decision or
  unresolved scope remains BLOCKED. Never infer completion from a PR title.
- An explicit task ID overrides queue order, but not its dependencies. Resume an
  existing task branch/PR when appropriate; never create a competing implementation.
- **INBOX** = captured, not yet scoped; **READY** = executable; **IN_PROGRESS** =
  claimed (branch/PR in Work column); **BLOCKED** = exact dependency/decision/asset
  missing; **REVIEW** = PR/owner acceptance pending; **DONE** = accepted and merged
  on the target branch with evidence. Design-only tasks still need their stated
  decision/approval. **CANCELLED** = intentionally closed with a reason, not DONE.
- P0 = prevents play/data integrity; P1 = current playability/feel; P2 = expansion.
  Priority describes impact; table order decides ties and actual execution order.
- Epics group outcomes, not work units. Oversized cards must be split before READY.
  Reproduction/fix work may stay one card when its scope is bounded; never claim an
  uncertain cause as fact.

## Ordered work queue

| Task | Outcome | Epic | Priority | Status | Depends / blocker | Work |
|---|---|---|---|---|---|---|
| [U-001](docs/backlog/U-001.md) | Restore reliable mission enemy pressure | Mission | P1 | DONE | — | [#132](https://github.com/JoshuaLRay/Sandline/pull/132) |
| [U-002](docs/backlog/U-002.md) | Correct authoritative firing origins for every stance | Weapon feel | P1 | DONE | — | [#133](https://github.com/JoshuaLRay/Sandline/pull/133) |
| [U-025](docs/backlog/U-025.md) | Assign every bot to a human commander and allow reassignment | Squad command | P1 | DONE | — | [#137](https://github.com/JoshuaLRay/Sandline/pull/137) |
| [U-026](docs/backlog/U-026.md) | Switch control to a bot the player commands | Squad command | P1 | DONE | U-025 | [#138](https://github.com/JoshuaLRay/Sandline/pull/138) |
| [U-027](docs/backlog/U-027.md) | Keep bots responsive after traversing large rubble | Bot navigation | P1 | DONE | — | [#139](https://github.com/JoshuaLRay/Sandline/pull/139) |
| [U-003](docs/backlog/U-003.md) | Align AR muzzle flash and tracers with the visible gun | Weapon feel | P1 | DONE | U-002 | [#140](https://github.com/JoshuaLRay/Sandline/pull/140) |
| [U-004](docs/backlog/U-004.md) | Open the AR sight picture | Weapon feel | P1 | DONE | — | [#141](https://github.com/JoshuaLRay/Sandline/pull/141) |
| [U-005](docs/backlog/U-005.md) | Bind 1 to primary and 2 to pistol | Weapon feel | P1 | DONE | — | [#134](https://github.com/JoshuaLRay/Sandline/pull/134) |
| [U-006](docs/backlog/U-006.md) | Keep the gun visible during a readable reload animation | Weapon feel | P1 | DONE | — | [#142](https://github.com/JoshuaLRay/Sandline/pull/142) |
| [U-007](docs/backlog/U-007.md) | Make reload sounds audible and synchronized | Audio | P1 | DONE | — | [#143](https://github.com/JoshuaLRay/Sandline/pull/143) |
| [U-008](docs/backlog/U-008.md) | Correct excessive right panning of the local gun | Audio | P1 | DONE | — | [#144](https://github.com/JoshuaLRay/Sandline/pull/144) |
| [U-024](docs/backlog/U-024.md) | Keep grenade and rocket counts synchronized | Maintenance | P1 | DONE | — | [#145](https://github.com/JoshuaLRay/Sandline/pull/145) |
| [U-028](docs/backlog/U-028.md) | Make manual reloads server-authoritative | Maintenance | P1 | DONE | — | [#146](https://github.com/JoshuaLRay/Sandline/pull/146) |
| [U-009](docs/backlog/U-009.md) | Add an interaction-driven upload objective | Mission | P1 | DONE | — | [#147](https://github.com/JoshuaLRay/Sandline/pull/147) |
| [U-010](docs/backlog/U-010.md) | Let enemies interrupt uploads by using the lever | Mission | P1 | DONE | U-009 | [#149](https://github.com/JoshuaLRay/Sandline/pull/149) |
| [U-011](docs/backlog/U-011.md) | Replace mission-01 hold timers with active objectives | Mission | P1 | DONE | U-001, U-009, U-010 | [#150](https://github.com/JoshuaLRay/Sandline/pull/150) |
| [U-030](docs/backlog/U-030.md) | Keep downed and dead characters facing the same direction | Character state | P1 | DONE | — | [#186](https://github.com/JoshuaLRay/Sandline/pull/186) |
| [U-031](docs/backlog/U-031.md) | Exclude downed characters from enemy gunfire targets | Enemy AI | P1 | DONE | — | [#188](https://github.com/JoshuaLRay/Sandline/pull/188) |
| [U-033](docs/backlog/U-033.md) | End the mission when a squad character dies | Mission | P1 | DONE | — | [#189](https://github.com/JoshuaLRay/Sandline/pull/189) |
| [U-034](docs/backlog/U-034.md) | Restore player and enemy use of mounted MGs | Emplacements | P1 | DONE | — | [#159](https://github.com/JoshuaLRay/Sandline/pull/159) |
| [U-012](docs/backlog/U-012.md) | Define voice cues and extend event routing | Audio | P2 | DONE | — | [#148](https://github.com/JoshuaLRay/Sandline/pull/148) |
| [U-013](docs/backlog/U-013.md) | Supply and process the real voice recordings | Audio | P2 | BLOCKED | U-012; owner recordings or explicit ADR-017 change | — |
| [U-036](docs/backlog/U-036.md) | Collect friend voice recordings and consent in the game | Audio | P2 | DONE | U-012; deployed private intake configuration | [#163](https://github.com/JoshuaLRay/Sandline/pull/163) |
| [U-014](docs/backlog/U-014.md) | Play intelligible radio-treated squad dialogue | Audio | P2 | BLOCKED | U-012, U-013 | — |
| [U-015](docs/backlog/U-015.md) | Add friendly hit, downed and death vocal reactions | Audio | P2 | BLOCKED | U-012, U-013 | — |
| [U-016](docs/backlog/U-016.md) | Add positional enemy engagement shouts | Audio | P2 | BLOCKED | U-012, U-013 | — |
| [U-017](docs/backlog/U-017.md) | Drop enemy weapons as replicated world pickups | Loot | P2 | DONE | — | [#151](https://github.com/JoshuaLRay/Sandline/pull/151) |
| [U-018](docs/backlog/U-018.md) | Equip dropped guns into the primary slot | Loot | P2 | DONE | U-017 | [#152](https://github.com/JoshuaLRay/Sandline/pull/152) |
| [U-019](docs/backlog/U-019.md) | Specify the six named characters and their skills | Squad | P2 | DONE | — | [#153](https://github.com/JoshuaLRay/Sandline/pull/153) (initial proposal); [#154](https://github.com/JoshuaLRay/Sandline/pull/154) (owner decisions; remainder open); [#156](https://github.com/JoshuaLRay/Sandline/pull/156) (U-019 name correction) |
| [U-020](docs/backlog/U-020.md) | Add the roster’s missing weapon archetypes (umbrella) | Squad | P2 | DONE | U-040, U-041, U-042, U-043 | [#193](https://github.com/JoshuaLRay/Sandline/pull/193), [#198](https://github.com/JoshuaLRay/Sandline/pull/198), [#199](https://github.com/JoshuaLRay/Sandline/pull/199), [#200](https://github.com/JoshuaLRay/Sandline/pull/200) |
| [U-040](docs/backlog/U-040.md) | Weapon data contract and the roster's firearm definitions | Squad | P2 | DONE | U-019 | [#193](https://github.com/JoshuaLRay/Sandline/pull/193) |
| [U-041](docs/backlog/U-041.md) | Carry the roster weapons on the wire | Squad | P2 | DONE | U-040 | [#198](https://github.com/JoshuaLRay/Sandline/pull/198) |
| [U-042](docs/backlog/U-042.md) | Distinct models for the roster weapons, and the left-handed rifle | Squad | P2 | DONE | U-040 | [#199](https://github.com/JoshuaLRay/Sandline/pull/199) |
| [U-043](docs/backlog/U-043.md) | Distinct report and handling sounds for the roster weapons | Audio | P2 | DONE | U-040 | [#200](https://github.com/JoshuaLRay/Sandline/pull/200) |
| [U-021](docs/backlog/U-021.md) | Bind six persistent characters to the squad slots | Squad | P2 | DONE | U-019, U-020 | [#202](https://github.com/JoshuaLRay/Sandline/pull/202) |
| [U-022](docs/backlog/U-022.md) | Implement dual-primary rules for Preach and Support | Squad | P2 | DONE | U-018, U-020, U-021 | [#204](https://github.com/JoshuaLRay/Sandline/pull/204) |
| [U-029](docs/backlog/U-029.md) | Enforce squad weapon exchanges and left-handed loot access | Squad | P2 | DONE | U-018, U-020, U-021 | [#207](https://github.com/JoshuaLRay/Sandline/pull/207) |
| [U-023](docs/backlog/U-023.md) | Break approved character skills into implementation tasks | Squad | P2 | BLOCKED | Owner deferred skills to a later version (2026-09-29); needs a new go-ahead | — |
| [U-032](docs/backlog/U-032.md) | Capture downed characters as prisoners for next-mission rescue | Campaign | P2 | BLOCKED | U-061, U-062, U-063, U-064, U-065 (umbrella) | — |
| [U-035](docs/backlog/U-035.md) | Add an enemy tank that attacks during mission-01's upload | Mission / vehicle combat | P2 | DONE | U-066, U-067, U-068, U-069, U-070 (umbrella) | [#239](https://github.com/JoshuaLRay/Sandline/pull/239) |
| [U-037](docs/backlog/U-037.md) | Keep mobile controls and layout when the phone is rotated | Mobile | P1 | DONE | — | [#182](https://github.com/JoshuaLRay/Sandline/pull/182) |
| [U-038](docs/backlog/U-038.md) | Mobile zoom-out limit: 6x portrait, 3x landscape | Mobile | P1 | DONE | U-037 | [#183](https://github.com/JoshuaLRay/Sandline/pull/183) |
| [U-039](docs/backlog/U-039.md) | Never show the crosshair on mobile | Mobile | P1 | DONE | — | [#184](https://github.com/JoshuaLRay/Sandline/pull/184) |
| [U-044](docs/backlog/U-044.md) | Long-term control scheme: slots 1–6, swap to use, right-click aim, left-click use (umbrella) | Controls | P2 | DONE | U-046, U-047, U-048, U-049 | — |
| [U-045](docs/backlog/U-045.md) | Weapon and device slots 1–6 with swap-to-use | Controls | P2 | DONE | — | [#195](https://github.com/JoshuaLRay/Sandline/pull/195) |
| [U-046](docs/backlog/U-046.md) | Right click aims, left click uses | Controls | P2 | DONE | U-045 | [#209](https://github.com/JoshuaLRay/Sandline/pull/209) |
| [U-047](docs/backlog/U-047.md) | Health kits | Controls | P2 | DONE | U-045 (the Support's 8 s waits on U-049) | [#211](https://github.com/JoshuaLRay/Sandline/pull/211) |
| [U-048](docs/backlog/U-048.md) | Equipment foundation: per-character slot 5, Brennan's launcher, droppable equipment | Controls | P2 | DONE | U-021, U-045, U-029 | [#218](https://github.com/JoshuaLRay/Sandline/pull/218) |
| [U-049](docs/backlog/U-049.md) | Per-character interaction-speed multiplier (the Support's 20% discount) | Squad | P2 | DONE | U-021 | [#212](https://github.com/JoshuaLRay/Sandline/pull/212) |
| [U-050](docs/backlog/U-050.md) | The support runs 10% faster | Squad | P2 | DONE | U-021 | [#213](https://github.com/JoshuaLRay/Sandline/pull/213) |
| [U-051](docs/backlog/U-051.md) | A joining player may take any free slot | Squad | P2 | DONE | U-021 | [#214](https://github.com/JoshuaLRay/Sandline/pull/214) |
| [U-052](docs/backlog/U-052.md) | Authored loot: a mission places a left-handed gun for the sniper | Squad | P3 | DONE | U-029 | [#225](https://github.com/JoshuaLRay/Sandline/pull/225) |
| [U-053](docs/backlog/U-053.md) | Bots use health kits on downed or hurt mates | Controls | P3 | DONE | U-047 | [#215](https://github.com/JoshuaLRay/Sandline/pull/215) |
| [U-054](docs/backlog/U-054.md) | C4 for the Support: throw it, place it, detonate it | Controls | P2 | DONE | U-048 | [#219](https://github.com/JoshuaLRay/Sandline/pull/219) |
| [U-055](docs/backlog/U-055.md) | Claymore for the left-handed sniper | Controls | P3 | DONE | U-054 | [#221](https://github.com/JoshuaLRay/Sandline/pull/221) |
| [U-056](docs/backlog/U-056.md) | Concussion grenades for Preach | Controls | P2 | DONE | U-048 | [#220](https://github.com/JoshuaLRay/Sandline/pull/220) |
| [U-057](docs/backlog/U-057.md) | Motion sensor for the right-handed sniper | Controls | P3 | DONE | U-054 | [#222](https://github.com/JoshuaLRay/Sandline/pull/222) |
| [U-058](docs/backlog/U-058.md) | Smoke grenades for Ortiz | Controls | P3 | DONE | U-048 | [#223](https://github.com/JoshuaLRay/Sandline/pull/223) |
| [U-059](docs/backlog/U-059.md) | Checkpoints restore the whole world: living enemies, positions, health | Campaign | P2 | DONE | U-052 | [#227](https://github.com/JoshuaLRay/Sandline/pull/227) |
| [U-060](docs/backlog/U-060.md) | Save the checkpoint's world in the campaign file | Campaign | P2 | DONE | U-059 | [#228](https://github.com/JoshuaLRay/Sandline/pull/228) |
| [U-061](docs/backlog/U-061.md) | Captured state: persistence, slot rules, retry behaviour | Campaign | P2 | DONE | U-060 | #230 |
| [U-062](docs/backlog/U-062.md) | Enemy capture behaviour: 2 s rule, 5 s channel, interruption | Campaign | P2 | DONE | U-061 | [#231](https://github.com/JoshuaLRay/Sandline/pull/231) |
| [U-063](docs/backlog/U-063.md) | The `rescue` objective type | Campaign | P2 | DONE | U-061 | [#232](https://github.com/JoshuaLRay/Sandline/pull/232) |
| [U-064](docs/backlog/U-064.md) | Captured characters in the slot picker, HUD and messages | Campaign | P2 | DONE | U-061 | [#233](https://github.com/JoshuaLRay/Sandline/pull/233) |
| [U-065](docs/backlog/U-065.md) | Campaign mission 1: rescue, escort and the armoured ambush | Campaign design | P2 | BLOCKED | Mission 1 brief (drafted for approval); U-072, U-075 | — |
| [U-066](docs/backlog/U-066.md) | Tank entity: hull, turret, hitbox, armour and health | Mission / vehicle combat | P2 | DONE | — | [#235](https://github.com/JoshuaLRay/Sandline/pull/235) |
| [U-067](docs/backlog/U-067.md) | Tank movement: follow a path, stop at a firing position | Mission / vehicle combat | P2 | DONE | U-066 | [#236](https://github.com/JoshuaLRay/Sandline/pull/236) |
| [U-068](docs/backlog/U-068.md) | Tank weapons: cannon and coaxial machine gun | Mission / vehicle combat | P2 | DONE | U-066 | [#237](https://github.com/JoshuaLRay/Sandline/pull/237) |
| [U-069](docs/backlog/U-069.md) | Mission-01 integration: the upload trigger, retry and the survivor | Mission / vehicle combat | P2 | DONE | U-067, U-068 | [#238](https://github.com/JoshuaLRay/Sandline/pull/238) |
| [U-070](docs/backlog/U-070.md) | Tank look and HUD: placeholder mesh, tell and arrival warning | Mission / vehicle combat | P2 | DONE | U-066 | [#239](https://github.com/JoshuaLRay/Sandline/pull/239) |
| [U-071](docs/backlog/U-071.md) | Campaign design: premise, structure and the mission list (umbrella; [design doc](docs/design/CAMPAIGN.md)) | Campaign design | P2 | BLOCKED | Owner answers to Q1–Q4 in the design doc (D1–D10 answered 2026-10-01); a mission 1 brief | — |
| [U-072](docs/backlog/U-072.md) | Campaign flow: campaign and replay runs, mission select and the debrief | Campaign design | P2 | BLOCKED | U-088, U-089, U-090 (the split; umbrella) | — |
| [U-073](docs/backlog/U-073.md) | Register a mission in one place; checks and the mission sim cover every mission | Campaign design | P2 | DONE | — | [#243](https://github.com/JoshuaLRay/Sandline/pull/243) |
| [U-074](docs/backlog/U-074.md) | Objectives in any order: parallel objectives and optional enemies | Campaign design | P2 | DONE | — | [#244](https://github.com/JoshuaLRay/Sandline/pull/244) |
| [U-075](docs/backlog/U-075.md) | Escort: the POW as an unarmed seventh friendly, commandable and spectatable | Campaign design | P2 | REVIEW | — | — |
| [U-076](docs/backlog/U-076.md) | Spike: feasibility of a three-lane map about ten times mission-01's area | Campaign design | P2 | DONE | — | [#245](https://github.com/JoshuaLRay/Sandline/pull/245) |
| [U-077](docs/backlog/U-077.md) | Carry weapons, ammo and gear to the next mission; pickups replace the slot | Campaign design | P2 | BLOCKED | U-090 | — |
| [U-078](docs/backlog/U-078.md) | In-mission menu: restart from checkpoint, restart mission, return to mission select | Campaign design | P2 | BLOCKED | U-090 | — |
| [U-079](docs/backlog/U-079.md) | Bots fight armour: help destroy a tank | Enemy AI | P2 | DONE | — | [#250](https://github.com/JoshuaLRay/Sandline/pull/250) |
| [U-080](docs/backlog/U-080.md) | Realistic character models: a more grounded look | Art | P2 | READY | — | — |
| [U-081](docs/backlog/U-081.md) | The cover search must not scale with the whole map | Enemy AI | P1 | DONE | — | [#246](https://github.com/JoshuaLRay/Sandline/pull/246) |
| [U-082](docs/backlog/U-082.md) | Rectangular floors: bake, collide and draw only where the map is | Campaign design | P2 | DONE | — | [#247](https://github.com/JoshuaLRay/Sandline/pull/247) |
| [U-083](docs/backlog/U-083.md) | Flank assignment must be bounded (a ray broad phase was tried and did not help) | Campaign design | P2 | DONE | — | [#249](https://github.com/JoshuaLRay/Sandline/pull/249) |
| [U-084](docs/backlog/U-084.md) | Mission-01: the squad dies in the garrison fight before the upload | Enemy AI | P2 | DONE | — | [#252](https://github.com/JoshuaLRay/Sandline/pull/252) |
| [U-085](docs/backlog/U-085.md) | Mission-01 at six humans: the squad is lost before the upload | Enemy AI | P2 | REVIEW | — | `task/U-085-floors` |
| [U-086](docs/backlog/U-086.md) | Attack orders fight from cover instead of standing in the open | Enemy AI | P2 | DONE | — | [#255](https://github.com/JoshuaLRay/Sandline/pull/255) |
| [U-087](docs/backlog/U-087.md) | Squad tactics: bounding, focus fire and fighting as a group | Enemy AI | P3 | BLOCKED | Deferred by the owner (U-085) | — |
| [U-088](docs/backlog/U-088.md) | The campaign as data: order, titles, briefings and debriefs | Campaign design | P2 | DONE | — | [#259](https://github.com/JoshuaLRay/Sandline/pull/259) |
| [U-089](docs/backlog/U-089.md) | Run kinds in the campaign file, and separate prisoner pools | Campaign design | P2 | DONE | — | [#260](https://github.com/JoshuaLRay/Sandline/pull/260) |
| [U-090](docs/backlog/U-090.md) | The host chooses the next run; briefing, debrief and the handoff | Campaign design | P2 | DONE | U-089 | [#261](https://github.com/JoshuaLRay/Sandline/pull/261) |
| [U-091](docs/backlog/U-091.md) | Spectate the escorted character | Campaign design | P3 | READY | U-075 | — |

## Existing work retained

- B-09 and B-18 now execute through U-002 and U-024; `docs/BUGS.md` keeps their
  report history and links. New reports go here instead of starting a second list.
- B-11 / T-5.06 (remaining squad AI close-fight/bounding work) stays in
  `TASKS.md` and `PLAN.md` §7.12. It is not automatically the cause of U-001.
- M2–M5 human playtests, lighting and deployment/cost decisions remain in
  `TASKS.md`. Request their explicit IDs to work those gates. If this queue has
  no eligible work, report remaining blockers and legacy options; don't silently
  invent a task or mark a human gate passed.

## Adding and maintaining work

Follow [.claude/commands/report-feedback.md](.claude/commands/report-feedback.md).
Use [the card template](docs/backlog/TEMPLATE.md); allocate the next unused U ID
from all active/archived cards (never renumber or reuse). Status belongs in this
index; detailed findings, reproduction and evidence belong in the card. Append a
single completion entry to `docs/CHANGELOG.md` with the U ID and PR reference.
Keep completed rows until this index becomes unwieldy; then move them to a dated
archive under `docs/backlog/archive/` with their evidence links. Selection checks
archived DONE dependencies too. Do not load archives during ordinary selection.
