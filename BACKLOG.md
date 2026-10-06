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
| [U-120](docs/backlog/U-120.md) | Bake solid overhead undersides and enforce basement headroom | Map implementation | P1 | DONE | Owner-authorized merge; CI #1691 passed all four jobs | [#294](https://github.com/JoshuaLRay/Sandline/pull/294) |
| [U-121](docs/backlog/U-121.md) | Preserve floors in nav projection, blockers and traversal links | Map implementation | P1 | DONE | Owner-authorized merge; all four CI #1694 jobs passed | [#295](https://github.com/JoshuaLRay/Sandline/pull/295) |
| [U-122](docs/backlog/U-122.md) | Select and bake cover on the intended floor | Map implementation | P1 | DONE | Proposed on authorized green merge; verification in PR | [#296](https://github.com/JoshuaLRay/Sandline/pull/296) |
| [U-123](docs/backlog/U-123.md) | Preserve 3D squad/POW command goals and retry positions | Map implementation | P1 | DONE | Owner-authorized merge 2026-10-05 (`63efd0c`); CI #1704 passed all four jobs on merged head `c1497c0`; owner gameplay review steps in card | [#297](https://github.com/JoshuaLRay/Sandline/pull/297) |
| [U-125](docs/backlog/U-125.md) | Remove walkable nav islands baked inside solid boxes | Map implementation | P1 | DONE | Owner-authorized merge on green 2026-10-05; local verify and sims passed; final-head CI in PR | [#298](https://github.com/JoshuaLRay/Sandline/pull/298) |
| [U-108](docs/backlog/U-108.md) | Height-aware mission areas and enemy spawn zones | Map implementation | P1 | DONE | Merged with owner authorization; all four CI jobs passed | [#293](https://github.com/JoshuaLRay/Sandline/pull/293) |
| [U-109](docs/backlog/U-109.md) | Stacked-floor navigation, cover and command targets | Map implementation | P1 | DONE | Merged #302 (`c426734`); all criteria checked and final-head CI #1721 green; human map-quality review separate | [#302](https://github.com/JoshuaLRay/Sandline/pull/302) |
| [U-110](docs/backlog/U-110.md) | Authored squad starts and elevated vehicle paths | Map implementation | P1 | DONE | Owner-authorized merge #303 (`1ae7e82`); final-head CI #1726 all four jobs passed | [#303](https://github.com/JoshuaLRay/Sandline/pull/303) |
| [U-111](docs/backlog/U-111.md) | Fixed guard sockets, patrol bounds and staged reserves | Map implementation | P1 | BLOCKED | U-129, U-130, U-131 (implementation split) | — |
| [U-129](docs/backlog/U-129.md) | Persistent authored 3D enemy sockets and facing | Map implementation | P1 | REVIEW | U-108, U-109 (DONE); local verify 279 files / 2,928 tests; final-head CI in PR | [#304](https://github.com/JoshuaLRay/Sandline/pull/304) |
| [U-130](docs/backlog/U-130.md) | Individual reversible patrols and bounded combat movement | Map implementation | P1 | BLOCKED | U-129 | — |
| [U-131](docs/backlog/U-131.md) | Pre-place inactive reserves and activate surviving entities | Map implementation | P1 | BLOCKED | U-129, U-130, U-110 | — |
| [U-112](docs/backlog/U-112.md) | Finite projectile, health and ammunition supply caches | Map implementation | P1 | READY | U-107 | — |
| [U-113](docs/backlog/U-113.md) | Map-revision-aware checkpoint restart and restore | Map implementation | P1 | READY | U-107 | — |
| [U-114](docs/backlog/U-114.md) | Build the hidden insertion, road, ridge and tank ingress | Map implementation | P1 | READY | U-109, U-110 (DONE) | — |
| [U-115](docs/backlog/U-115.md) | Build the continuous underground depot and its stairs | Map implementation | P1 | BLOCKED | U-109, U-114 | — |
| [U-116](docs/backlog/U-116.md) | Build the prisoner outpost and reserve annex | Map implementation | P1 | BLOCKED | U-114, U-115 | — |
| [U-117](docs/backlog/U-117.md) | Integrate redesigned Mission 1 combat, supplies and objectives | Map implementation | P1 | BLOCKED | U-111, U-112, U-113, U-116 | — |
| [U-118](docs/backlog/U-118.md) | Finish Qalat terrain, architecture, lighting and presentation | Map implementation | P1 | BLOCKED | U-117 | — |
| [U-119](docs/backlog/U-119.md) | Verify the complete replacement mission and capture review evidence | Map implementation | P1 | BLOCKED | U-118 | — |
| [U-124](docs/backlog/U-124.md) | Bake the kit gallery’s house and roof stair into its navmesh | Map implementation | P2 | READY | Found during U-123; none | — |
| [U-127](docs/backlog/U-127.md) | Specify Mission 2, The Kestrel Dam: full map and mission construction design | Map design | P2 | REVIEW | Owner authorized merge on green 2026-10-05 (CI #1713 green); owner design decisions OD-1–OD-9 still open | [#301](https://github.com/JoshuaLRay/Sandline/pull/301) |
| [U-107](docs/backlog/U-107.md) | Specify full Mission 1 replacement: hidden spawn, ridge and underground depot | Map design | P1 | DONE | Owner authorized merge/start; merged 2026-10-04 | [#292](https://github.com/JoshuaLRay/Sandline/pull/292) |
| [U-106](docs/backlog/U-106.md) | Implement Qalat’s distinct assault, support and isolated flank routes | Map design | P1 | REVIEW | U-105; merged blockout superseded by U-107 redesign; no owner quality verdict | [#291](https://github.com/JoshuaLRay/Sandline/pull/291) |
| [U-105](docs/backlog/U-105.md) | Define distinct campaign lanes and per-map creation records | Map design | P1 | DONE | Accepted and merged 2026-10-04; implementation tracked by U-106 | [#290](https://github.com/JoshuaLRay/Sandline/pull/290) |
| [U-104](docs/backlog/U-104.md) | Hold Tab to access the mouse | Controls / UI | P1 | REVIEW | Automated checks passed; owner gameplay review pending | [#289](https://github.com/JoshuaLRay/Sandline/pull/289) |
| [U-099](docs/backlog/U-099.md) | Keep characters from occupying the same space | Squad command | P1 | REVIEW | Automated verification passed; manual bottleneck review pending | [#284](https://github.com/JoshuaLRay/Sandline/pull/284) |
| [U-100](docs/backlog/U-100.md) | Adjustable Tight / Standard / Wide squad spread | Squad command | P2 | REVIEW | U-099; automated checks passed; manual UI review pending | [#285](https://github.com/JoshuaLRay/Sandline/pull/285) |
| [U-101](docs/backlog/U-101.md) | Per-character Hold fire / Defensive / Aggressive settings | Squad command | P2 | REVIEW | U-100; automated checks passed; owner playtest pending | [#286](https://github.com/JoshuaLRay/Sandline/pull/286) |
| [U-103](docs/backlog/U-103.md) | Make aggression commands available on mobile | Mobile / Squad command | P1 | REVIEW | Automated verification passed; physical phone review pending | [#288](https://github.com/JoshuaLRay/Sandline/pull/288) |
| [U-102](docs/backlog/U-102.md) | Direct mobile commands and a framed orbit camera | Mobile | P1 | REVIEW | — | [#287](https://github.com/JoshuaLRay/Sandline/pull/287) |
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
| [U-128](docs/backlog/U-128.md) | Review private saved voice recordings in the browser | Audio | P2 | REVIEW | U-036; OAuth activation and live owner listening pending | [#299](https://github.com/JoshuaLRay/Sandline/pull/299) |
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
| [U-065](docs/backlog/U-065.md) | Campaign mission 1: rescue, escort and the armoured ambush | Campaign design | P2 | REVIEW | Mission 1 brief (approved 2026-10-02); U-092, U-093, U-094, U-095 (umbrella) | Technical implementation complete on U-095 green merge; owner playtest and headless completion remain open |
| [U-066](docs/backlog/U-066.md) | Tank entity: hull, turret, hitbox, armour and health | Mission / vehicle combat | P2 | DONE | — | [#235](https://github.com/JoshuaLRay/Sandline/pull/235) |
| [U-067](docs/backlog/U-067.md) | Tank movement: follow a path, stop at a firing position | Mission / vehicle combat | P2 | DONE | U-066 | [#236](https://github.com/JoshuaLRay/Sandline/pull/236) |
| [U-068](docs/backlog/U-068.md) | Tank weapons: cannon and coaxial machine gun | Mission / vehicle combat | P2 | DONE | U-066 | [#237](https://github.com/JoshuaLRay/Sandline/pull/237) |
| [U-069](docs/backlog/U-069.md) | Mission-01 integration: the upload trigger, retry and the survivor | Mission / vehicle combat | P2 | DONE | U-067, U-068 | [#238](https://github.com/JoshuaLRay/Sandline/pull/238) |
| [U-070](docs/backlog/U-070.md) | Tank look and HUD: placeholder mesh, tell and arrival warning | Mission / vehicle combat | P2 | DONE | U-066 | [#239](https://github.com/JoshuaLRay/Sandline/pull/239) |
| [U-126](docs/backlog/U-126.md) | Give the tank a modelled, painted look instead of stacked boxes | Mission / vehicle combat | P1 | REVIEW | U-070 (DONE); owner-authorized merge 2026-10-05; CI #1714 passed all four jobs; owner visual verdict pending | [#300](https://github.com/JoshuaLRay/Sandline/pull/300) |
| [U-071](docs/backlog/U-071.md) | Campaign design: premise, structure and the mission list (umbrella; [design doc](docs/design/CAMPAIGN.md)) | Campaign design | P2 | DONE | Q1–Q4 accepted 2026-10-01; mission 1 brief approved 2026-10-02 | [#278](https://github.com/JoshuaLRay/Sandline/pull/278); completion becomes effective on green merge |
| [U-072](docs/backlog/U-072.md) | Campaign flow: campaign and replay runs, mission select and the debrief | Campaign design | P2 | DONE | U-088, U-089, U-090 (the split; umbrella) | — |
| [U-073](docs/backlog/U-073.md) | Register a mission in one place; checks and the mission sim cover every mission | Campaign design | P2 | DONE | — | [#243](https://github.com/JoshuaLRay/Sandline/pull/243) |
| [U-074](docs/backlog/U-074.md) | Objectives in any order: parallel objectives and optional enemies | Campaign design | P2 | DONE | — | [#244](https://github.com/JoshuaLRay/Sandline/pull/244) |
| [U-075](docs/backlog/U-075.md) | Escort: the POW as an unarmed seventh friendly, commandable and spectatable | Campaign design | P2 | DONE | — | [#262](https://github.com/JoshuaLRay/Sandline/pull/262) |
| [U-076](docs/backlog/U-076.md) | Spike: feasibility of a three-lane map about ten times mission-01's area | Campaign design | P2 | DONE | — | [#245](https://github.com/JoshuaLRay/Sandline/pull/245) |
| [U-077](docs/backlog/U-077.md) | Carry weapons, ammo and gear to the next mission; pickups replace the slot | Campaign design | P2 | DONE | U-090 | [#263](https://github.com/JoshuaLRay/Sandline/pull/263) |
| [U-078](docs/backlog/U-078.md) | In-mission menu: restart from checkpoint, restart mission, return to mission select | Campaign design | P2 | DONE | U-090 | [#264](https://github.com/JoshuaLRay/Sandline/pull/264) |
| [U-079](docs/backlog/U-079.md) | Bots fight armour: help destroy a tank | Enemy AI | P2 | DONE | — | [#250](https://github.com/JoshuaLRay/Sandline/pull/250) |
| [U-080](docs/backlog/U-080.md) | Realistic character models: a more grounded look | Art | P2 | REVIEW | — | — |
| [U-081](docs/backlog/U-081.md) | The cover search must not scale with the whole map | Enemy AI | P1 | DONE | — | [#246](https://github.com/JoshuaLRay/Sandline/pull/246) |
| [U-082](docs/backlog/U-082.md) | Rectangular floors: bake, collide and draw only where the map is | Campaign design | P2 | DONE | — | [#247](https://github.com/JoshuaLRay/Sandline/pull/247) |
| [U-083](docs/backlog/U-083.md) | Flank assignment must be bounded (a ray broad phase was tried and did not help) | Campaign design | P2 | DONE | — | [#249](https://github.com/JoshuaLRay/Sandline/pull/249) |
| [U-084](docs/backlog/U-084.md) | Mission-01: the squad dies in the garrison fight before the upload | Enemy AI | P2 | DONE | — | [#252](https://github.com/JoshuaLRay/Sandline/pull/252) |
| [U-085](docs/backlog/U-085.md) | Mission-01 at six humans: the squad is lost before the upload | Enemy AI | P2 | DONE | — | [#258](https://github.com/JoshuaLRay/Sandline/pull/258); merged; CI #1594 green |
| [U-086](docs/backlog/U-086.md) | Attack orders fight from cover instead of standing in the open | Enemy AI | P2 | DONE | — | [#255](https://github.com/JoshuaLRay/Sandline/pull/255) |
| [U-087](docs/backlog/U-087.md) | Squad tactics: bounding, focus fire and fighting as a group | Enemy AI | P3 | BLOCKED | Deferred by the owner (U-085) | — |
| [U-088](docs/backlog/U-088.md) | The campaign as data: order, titles, briefings and debriefs | Campaign design | P2 | DONE | — | [#259](https://github.com/JoshuaLRay/Sandline/pull/259) |
| [U-089](docs/backlog/U-089.md) | Run kinds in the campaign file, and separate prisoner pools | Campaign design | P2 | DONE | — | [#260](https://github.com/JoshuaLRay/Sandline/pull/260) |
| [U-090](docs/backlog/U-090.md) | The host chooses the next run; briefing, debrief and the handoff | Campaign design | P2 | DONE | U-089 | [#261](https://github.com/JoshuaLRay/Sandline/pull/261) |
| [U-091](docs/backlog/U-091.md) | Spectate the escorted character | Campaign design | P3 | DONE | U-075 | [#267](https://github.com/JoshuaLRay/Sandline/pull/267) |
| [U-092](docs/backlog/U-092.md) | Mission 1 level: the three-lane valley and the compound | Campaign design | P2 | DONE | — | [#274](https://github.com/JoshuaLRay/Sandline/pull/274); owner authorized assumed approval through U-095 |
| [U-093](docs/backlog/U-093.md) | Mission 1 encounter: the garrison, the patrols and the tank's arrival | Campaign design | P2 | DONE | U-092 | [#275](https://github.com/JoshuaLRay/Sandline/pull/275); CI #1634 green |
| [U-094](docs/backlog/U-094.md) | Mission 1 mission file and script: staged objectives, rescue and extraction | Campaign design | P2 | DONE | U-093 | [#276](https://github.com/JoshuaLRay/Sandline/pull/276); CI #1636 green |
| [U-095](docs/backlog/U-095.md) | Mission 1 verification: the headless run and its completion baseline | Campaign design | P2 | DONE | U-094 | [#277](https://github.com/JoshuaLRay/Sandline/pull/277); merged; CI #1641 green; owner playtest owed |

| [U-097](docs/backlog/U-097.md) | Give the Qalat valley connected, playable elevation | Map design | P1 | REVIEW | U-092 | `task/U-097-connected-elevation`; technical verification, owner terrain review pending |
| [U-096](docs/backlog/U-096.md) | Give the Qalat map an authored art pass and remove its grid feel | Map art | P1 | REVIEW | U-097 terrain merged (#281); owner requested continuation on 2026-10-03; visual acceptance pending | [#282](https://github.com/JoshuaLRay/Sandline/pull/282); technical checks green, owner art review pending |
| [U-098](docs/backlog/U-098.md) | Release the mouse when the mission ends so the end-of-mission buttons can be clicked | Controls / UI | P1 | REVIEW | — | `task/U-098-mission-end-cursor` |

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
