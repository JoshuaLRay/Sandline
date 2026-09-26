# M3 exit gate, one player and five bots — T-3.36

## Status: NOT YET RUN

This file is the run sheet for the first half of M3's exit gate, written
before the session so that the judgements get recorded while they are
fresh. **Until the Verdict section at the bottom is filled in by a person,
this task is open and M3 is not closed** (it closes when this and T-3.37,
`m3-six.md`, both have verdicts). Nothing in this file is a result.

- **Date:**
- **Build:** (the commit in the HUD's title bar, also the browser tab's title: `SANDLINE <sha>`)
- **Played by:**
- **Setup:** (which host — the deployed one or a local `HOST_AI=1 pnpm host` —
  and confirm you were alone in the room: the room screen should list you in
  slot 1 and five bots. **Not** the in-page "Practise here" session: it adds a
  scripted second client that the session counts as a human, so the director
  plays the two-human budget with four bots, not the gate's one and five)
- **Gates before this one:** 🧍 T-3.24 (combat AI, `e3-5.md`) and 🧍 T-3.30
  (squad command, `e3-8.md`) are this task's dependencies. Say here whether
  they had verdicts when this was played.

## What this is judging

M3's exit gate (PLAN.md §7, M3): *"A solo player with 5 bots and 6 human
players both complete the same grey-box mission. Enemies demonstrably take
cover and suppress."* This sheet is the solo half. T-3.36 asks one person to
play greybox-01 with five bots, start to finish, **at least twice — once by
each route**, and answer:

1. Do enemies **demonstrably take cover and suppress**?
2. Is the mission **completable**?
3. Do the bots **pull their weight without being ordered every ten seconds**?

## Before you start

- **Add `?qa` to every URL in this sheet** (T-5.07): since the demo face, the QA layer — the readout, the tuning panels and the netgraph — is out of sight without it (H also brings it back).
- **Getting in.** Deployed: open https://joshualray.github.io/Sandline/, go to
  the lobby (the menu's **Play** tab), set **Map** to **Grey box — mission
  layout fixture** (the default is Mission 01, which is M4's level and not this
  gate's map), press **Host a room**. Do not use **Quick join this mission** —
  it can put you in someone else's room. The **Squad room** screen lists the
  six slots; press **Ready up** (or **Start mission now**) and the encounter
  starts. Local alternative: `HOST_AI=1 AI_DEBUG=1 pnpm host`, then
  `pnpm --filter @sandline/client dev`, and host a room on
  `ws://localhost:8080` the same way. `curl …/healthz` should say `"players":1`.
- **Keys.** WASD move, `Shift` sprint, `C` crouch, `Z` prone, `Space` jump or
  stand. `RMB` aims, `LMB` fires, `R` reloads, `V` swaps shoulder. `1`–`4`
  equip a gun your class carries (carbine, marksman, breacher, sidearm), `5`
  frag, `6` rocket, `G` held is the quick throw. `E` held revives. **Hold `Q`**
  for the order wheel — mouse direction picks the order (move, attack, hold,
  regroup, revive, clockwise from the top); while it is open `1`–`6` address a
  slot, `7`/`8` a fireteam, `0` everyone (the default); release sends it at the
  point under the crosshair, and releasing without moving cancels. Tap `F` to
  mark. **Hold `Tab`** for the scoreboard (K, D, REV, GAVE, DID per slot, and
  the mission clock). `B` the AI debug overlay (paths, perception cones, chosen
  cover, each brain's running branch). `N` netgraph, `H` hides the HUD, `P`
  asks for a restart — honoured only once the mission is complete or failed.
  `Esc` pauses; the session runs on.
- **The HUD line is this sheet's scorekeeper** (top centre): `Objective: clear
  the compound · held 0/30 s` while an enemy is inside; `hold the compound`
  once it is empty; `Mission complete · P to play again`; `Squad wiped —
  mission failed · P to try again`; `attempt n` after a restart.
- **The map** (`data/levels/greybox-01.json`). You start on the spawn line
  (z −6) facing up-range (+z). A 6 m wide, 4 m high spine (x −3..3, z 8..58)
  splits two lanes walled at x ±32. **Left (west) is the overwatch route**:
  open, three low walls, a 75 m clear line along it; about 100 m to the
  objective. **Right (east) is the assault route**: four walls 17 m long and
  2.4 m high from alternate sides at z 13, 25, 38, 50, crates and 1 m low
  walls between, no clear line longer than 34 m; about 130 m. Two 1 m low
  walls by the start (x ±7, z −4.5) cover both first legs. Both lanes open
  behind the spine onto the **compound** (x −8..8, z 64..76, 2.4 m walls, a
  door in each side wall, one crate inside); the objective is the 4 m circle
  at its centre (0, 70).
- **The numbers you are judging** (all data). The encounter is
  `data/encounters/greybox-01.json`; the director scales every group and the
  alive cap by the humans seated (`data/director.json`, `budget`), so one
  human is the **0.5 row**, rounded, never below one:

  | group | appears | posture | file (six humans) | **you (one human)** |
  |---|---|---|---|---|
  | garrison | at the start, behind the compound (0, 86) | takes cover inside the objective | 3 riflemen + 1 MG | **2 riflemen + 1 MG** |
  | overwatch-patrol | at the start, at (−6, 68)¹ | walks (−24, 22) ↔ (−26, 50) on the west lane | 2 | **1** |
  | assault-hold | when a squad soldier enters the east lane's mouth (22, 12, r 7 m) | stands at (28, 34) facing the mouth | 2 | **1** |
  | counterattack | once the garrison is dead; 3 waves | garrisons the objective | 3 a wave | **2 a wave** |
  | late | 300 s after the start, at (−6, 68)¹ | holds, facing the west lane's middle | 2 | **1** |
  | alive at once (cap) | | | 10 | **5** |

  ¹ PLAN's T-3.31 note puts this zone at (−26, 42); the level check fix
  (commit 70165db) moved it to the compound's west side. The patrol walks out.

  | | value | file |
  |---|---|---|
  | hold to complete | 30 s, with no living enemy inside and a living squad soldier inside | `data/missions/greybox-01.json` |
  | respawn in the mission | **off** — downed and revived is the only way back; all six dead fails it | same |
  | counterattack spacing | never sooner than 15 s, always by 45 s, 25 s otherwise | the encounter |
  | director | holds a wave above intensity 0.6, sends early below 0.2; intensity is damage (0.5), enemies in contact (0.3), squad suppression (0.2) over 8 s | `data/director.json` |
  | downed | bleed out 30 s; revive is 3 s of `E` within 1.5 m, back at 40 % health | `data/damage.json` |
  | enemy | rifleman 100 hp, carbine, 6-round bursts, sees 80 m in 120°; MG 120 hp, 1.5 s to deploy before it fires, 45-round bursts, the group's preferred suppressor | `data/enemies.json` |
  | enemy in cover | stays down when suppression ≥ 0.35 or hurt in the last 1.5 s; peeks for 1 s bursts; reloads at ≤ 30 %; advances after 5 s unopposed | `data/trees/rifleman.json` |
  | pin, flank, grenade | pinned after 1 s unseen with 2+ alive, then one suppresses and one flanks (6–30 m); a grenade at a target still in cover 3 s, 8–35 m away | `server/src/ai/group.json`, `throw.json` |
  | your squad | slots 1–3 fireteam 1 (wedge), 4–6 fireteam 2 (file); unordered, **all five follow you**; a bot holds fire while a squadmate grown by 0.5 m is in its line; seeks a downed squadmate within 30 m | `data/squad.json` |
  | classes | slots 1–3 Team Leader (carbine, sidearm, 2 frag, 1 rocket; orders reach the squad), 4–6 Marksman (DMR, sidearm, 1 frag; orders reach its own fireteam) — you are slot 1 unless you pick otherwise in the room | `data/classes.json` |

- **What the headless run says.** T-3.35's baseline (2026-09-23, 20 seeds):
  30 % completion at one human, 15 % at six; enemies under fire in cover 32 %;
  7.39 suppression episodes per engagement. **B-11** (`docs/BUGS.md`) records
  it getting worse since B-15's pose-matched hitboxes: 0 % / 0 % over 10
  seeds. Note that CI's `mission` job now plays the default mission
  (mission-01), not this map; for this map run
  `pnpm sim-run --scenario mission --mission packages/shared/src/data/missions/greybox-01.json --seeds 3`
  and paste its last line: ______________________. Those runs have a scripted
  bot leader; you are a person, which is the thing this gate adds.
- **Known, not for this gate:** **B-11** — the bots lose most firefights,
  largely because they hold fire for squadmates in their line. Record *how*
  they lose; "the bots lost" alone is already logged. **B-09** — a crouched
  soldier's shots and every throw still leave from standing eye height. The
  assets (Mission 01, the detailed soldier) and M4's classes are not judged
  here beyond noting if they got in the way.

## The questions

A line each is enough; "fine" is a valid answer, "did not try" is a
required one.

### 1. Getting in, and the budget

- Did the room screen show you and five bots, and did the mission start on
  Ready? Time from Host a room to first tick: ______ s (a cold host takes a
  few seconds).
- `B` on, at the start: can you count the garrison (2 riflemen + 1 MG) and the
  one patrol? Anything that contradicts the one-human column above is a
  finding, not a feel note.
- Before moving: does the HUD line read `Objective: clear the compound · held
  0/30 s`?

### 2. The runs

Play at least one run up each route. Unordered, the whole squad follows you;
say whether you split it (e.g. `Q` + `8` + move to send fireteam 2 up the
other lane) or kept it together. Read the scoreboard (`Tab`) at the end of
each run before pressing `P`.

| # | route you took | squad split? | outcome (HUD) | mission clock | enemies killed (K sum) | squad deaths | revives | your GAVE | attempt |
|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | |
| 2 | | | | | | | | | |
| 3 | | | | | | | | | |
| 4 | | | | | | | | | |

- For each failed run: where did it go wrong, and when (approach, the
  compound, the counterattack, the hold)?
- For each completed run: how close was it — how many of the six were
  standing at the end?

### 3. Enemies take cover (gate claim 1a)

- The garrison: do they settle into cover inside the compound before you
  arrive, and fight from it? With `B`, does the cover segment point at a
  wall between them and you?
- Under your fire: does a rifleman go to cover, stay down while you keep him
  pressed, then peek and burst? Does it read as a decision or a coincidence?
- Flank one in cover (get to his open side): does he relocate?
- Does any enemy reload in the open with cover in reach, stand still in the
  open, or walk out of the compound for no reason you can see?
- The assault-hold rifleman on the east lane (stands facing the mouth): does
  he go to cover once you engage, or stay standing?

### 4. Enemies suppress (gate claim 1b)

- The MG: can you see it deploy before it fires? Does its fire pin you — do
  you stop wanting to stand up? Where were you when it happened?
- Your suppression: the vignette, desaturation and wider crosshair. Did it
  come from rounds going past you, and did it change what you did?
- Pinned in cover for a few seconds: does one enemy keep firing at your
  cover while another moves round you? Did you notice the flanker before he
  shot you?
- Stay still in cover for a while: does a grenade come? From how far?
- **Demonstrably?** Could you point at a moment in each run and say "that
  was an enemy taking cover" and "that was an enemy suppressing"? Write the
  moments down.

### 5. Is it completable (gate question 2)

- The hold: once the compound is empty, does 30 s feel like a hold or a
  wait? Did the counterattack arrive during it, and from where?
- Counterattack pacing (2 a wave, 15–45 s apart): did the waves feel like
  they came at a sensible moment — held while you were in trouble, sooner
  when it was quiet — or like a flat timer?
- The 300 s group: did any run last long enough to see it?
- Which route made it more completable, and why — the long lines on the
  west, or the close cover on the east?
- No respawn: did a wipe feel earned, or cheap?

### 6. The bots (gate question 3)

- Count your orders: GAVE ______ over ______ minutes of play, per run. Is
  that "every ten seconds" or well short of it?
- Unordered, do they follow sensibly, return fire, take cover near you, and
  shoot the enemies you are fighting? What fraction of the kills were theirs
  (scoreboard K per slot)?
- Revives: when you went down with bots alive, did one come? How long did it
  take? Did they revive each other?
- Orders you did give: did each get done the way you meant it? Which ones
  did you need, and why?
- B-11: did you see a bot not firing with a clear shot because a squadmate
  was near its line? How often?
- Any bot stuck, walking into fire, or blocking your shot or a door?

### 7. Restart and failure

- After a win or a wipe, `P`: does everyone come back on the spawn line at
  full health, enemies cleared, orders cleared, `attempt 2` on the line?
- `P` mid-mission: it should do nothing. Does it?

## Tuning

Paste any panel block you changed and say what for. (On the host only your
own prediction moves with a slider; AI and encounter numbers are data and
change only by edit.)

```
```

Constants you changed by edit, if any (name, old → new, why):

| constant | old | new | why |
|---|---|---|---|
| | | | |

## Netgraph

Read it (`N`) once mid-run and paste the footer. One person on a host is
still a real socket.

```
rtt                ms  (jitter      ms)
snapshot gaps       %
corrections         %
interp ahead     ticks
tick drift
draw calls         / 300
triangles
```

## Verdict

**PASS / FAIL:**

One paragraph, in your own words: with five bots, do enemies demonstrably
take cover and suppress, is the mission completable, and do the bots pull
their weight without being ordered every ten seconds?

### What this establishes

### What it does not establish

(How many runs, by which routes, and how many completed; whether you split
the squad; whether it was the deployed host or a local one; whether T-3.24
and T-3.30 had verdicts first; whether you were Team Leader or Marksman;
that one human is the 0.5 budget, not the full encounter — six humans is
T-3.37; and whether the headless completion number on this build agreed
with what you saw.)
