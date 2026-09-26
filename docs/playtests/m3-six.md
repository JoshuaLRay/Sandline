# M3 exit gate, six players — T-3.37

## Status: NOT YET RUN

This file is the run sheet for the second half of M3's exit gate, written
before the session so that the judgements get recorded while they are
fresh. **Until the Verdict section at the bottom is filled in by a person,
this task is open and M3 is not closed** (it closes when this and T-3.36,
`m3-solo.md`, both have verdicts). Nothing in this file is a result.

- **Date:**
- **Build:** (the commit in the HUD's title bar, also the browser tab's title
  `SANDLINE <sha>` — **all six must show the same one**; the host refuses
  only a different protocol version, not a merely different commit)
- **Played by:** (six names, with the slot each ended up in)
- **Setup:** (the deployed host, `wss://sandline-host.fly.dev`, one room on
  the **Grey box** map, six humans seated before the start, no bots; how the
  six talked to each other — the game has no voice or text chat in M3; where
  each person was, roughly, and their connection)
- **Scribe:** (one person who is not also the squad's lead reads `/healthz`
  and `/metrics` and fills sections 1 and 6; everyone reads their own netgraph)
- **Solo half:** say whether T-3.36 had a verdict first — PLAN calls it the
  cheaper session to reschedule, so it should come first.

## What this is judging

M3's exit gate (PLAN.md §7, M3): *"A solo player with 5 bots and 6 human
players both complete the same grey-box mission. Enemies demonstrably take
cover and suppress."* This sheet is the six-human half. T-3.37 asks six
people on the deployed host to play the same mission, same encounter file,
no bots, and answer:

1. Does it **hold up at the six-human budget**?
2. Does the **two-fireteam split happen on its own**?
3. Does the **host hold its tick and bandwidth** with six real sockets and a
   full encounter (netgraph and `/healthz` recorded)?

And, because the gate's sentence is the same for both halves: do the six
**complete** it, and do the enemies **demonstrably take cover and suppress**?

## Before you start

- **Getting in.** Everyone opens https://joshualray.github.io/Sandline/ and
  goes to the lobby (the menu's **Play** tab). **One** person sets **Map** to
  **Grey box — mission layout fixture** (the default is Mission 01, M4's
  level, not this gate's map) and presses **Host a room**; the map only
  matters to whoever creates the room. They read the code off the **Squad
  room** screen or press **Copy invite link**. The other five type the code
  and press **Join**. Nobody uses **Quick join this mission**. If the host
  asks for a key, it is the `JOIN_KEY` secret. The host sleeps when idle, so
  the first join can take a few seconds.
- **Start only when all six are in.** The Squad room lists slots 1–6 in join
  order (the creator is slot 1); every row should read a name, not `bot`. The
  encounter starts when every human has pressed **Ready up**, or when the
  creator presses **Start mission now** — don't use the second with fewer
  than six. The director sizes each wave when it is sent, so someone arriving
  late changes the *next* wave, not the ones already out.
- **Classes.** Slots 1–3 default to **Team Leader** (carbine, sidearm, 2 frag,
  1 rocket; orders reach the squad), slots 4–6 to **Marksman** (DMR, sidearm,
  1 frag; orders reach its own fireteam) — `data/classes.json`. Keep the
  defaults unless there is a reason, and write down any change. With no bots
  the order wheel commands nobody; `F` marks are still drawn for everyone
  (20 s each, 3 per player, `data/orders.json`).
- **Keys.** WASD move, `Shift` sprint, `C` crouch, `Z` prone, `Space` jump or
  stand. `RMB` aims, `LMB` fires, `R` reloads, `V` swaps shoulder. `1`–`4`
  equip a gun your class carries, `5` frag, `6` rocket, `G` held is the quick
  throw. **`E` held revives** (3 s within 1.5 m). `F` marks what is under the
  crosshair. **Hold `Tab`** for the scoreboard (K, D, REV per slot and the
  mission clock). `B` the AI debug overlay (the deployed host allows it). `N`
  netgraph, `H` hides the HUD, `P` asks for a restart once the mission is
  over (from anyone; mid-mission it is refused). `Esc` pauses your view; the
  session runs on.
- **The HUD line** (top centre): `Objective: clear the compound · held 0/30 s`,
  then `hold the compound`, then `Mission complete · P to play again` or
  `Squad wiped — mission failed · P to try again`, and `attempt n` after a
  restart. All six should see the same line and count.
- **The map** (`data/levels/greybox-01.json`): spawn line at z −6 facing
  up-range. A 6 m wide, 4 m high spine (x −3..3, z 8..58) splits two lanes.
  **Left (west), overwatch**: open, three 1 m low walls, a 75 m clear line,
  about 100 m to the objective. **Right (east), assault**: four 17 m long,
  2.4 m walls from alternate sides at z 13, 25, 38, 50 with crates and low
  walls between, no clear line over 34 m, about 130 m. Both come round the
  spine to the **compound** (x −8..8, z 64..76, 2.4 m walls, a door in each
  side wall — west for overwatch, east for assault); the objective is the
  4 m circle at (0, 70).
- **The numbers you are judging** — the encounter as written
  (`data/encounters/greybox-01.json`), which is the six-human row of
  `data/director.json` (factor 1.0 on sizes and cap):

  | group | appears | posture | enemies |
  |---|---|---|---|
  | garrison | at the start, behind the compound (0, 86) | takes cover inside the objective | 3 riflemen + 1 MG |
  | overwatch-patrol | at the start, at (−6, 68)¹ | walks (−24, 22) ↔ (−26, 50) on the west lane | 2 |
  | assault-hold | when anyone enters the east lane's mouth (22, 12, r 7 m) | stands at (28, 34) facing the mouth | 2 |
  | counterattack | once the garrison is dead | garrisons the objective | 3 waves of 3, 15–45 s apart (25 s at middling intensity) |
  | late | 300 s after the start, at (−6, 68)¹ | holds, facing the west lane's middle | 2 |
  | **in all / alive at once** | | | **19 / cap 10** |

  ¹ PLAN's T-3.31 note says (−26, 42); commit 70165db (the T-4.11 level
  checks) moved the zone to the compound's west side.

  | | value | file |
  |---|---|---|
  | hold | 30 s, no living enemy inside and a living squad soldier inside; an enemy inside resets it, everyone stepping out pauses it | `data/missions/greybox-01.json` |
  | respawn | **off** for the mission: down and revived is the way back; all six dead fails it; a restart brings everyone back | same |
  | downed | bleed out 30 s, revived at 40 % health | `data/damage.json` |
  | enemies | rifleman 100 hp, 6-round bursts, 80 m / 120° vision; MG 120 hp, deploys 1.5 s before firing, 45-round bursts | `data/enemies.json` |
  | fireteams | slots 1–3 fireteam 1, slots 4–6 fireteam 2 | `data/squad.json` |
  | tick | 30 Hz, 33.3 ms | ADR-012 |
  | bandwidth | ~18 KB/s down per player; a design over 40 KB/s needs an ADR | ADR-012 |
  | AI CPU (proposed) | ≤ 25 % of the tick; T-3.35 measured 12.5–13 % at 40 enemies and 5 bots | PLAN §7.9, T-3.35 |
  | the machine | one Fly `shared-cpu-1x`, 512 MB, `iad`; 4 rooms max; drops a player idle 10 min or connected 4 h | `fly.toml` |

- **Instruments for the scribe.** Before anyone joins, and again mid-mission
  and at the end:

  ```bash
  curl -s https://sandline-host.fly.dev/healthz
  curl -s https://sandline-host.fly.dev/metrics | grep -E '^sandline_(tick_seconds_(sum|count)|tick_overruns_total|ticks_dropped_total|ai_seconds_total|bytes_sent_total|snapshots_sent_total|players|rooms|connections|process_rss_bytes|refusals_total)'
  ```

  `/metrics` sums every room on the machine, so check `/healthz` says
  `"rooms":1` — if not, someone else is on the host and the numbers are
  shared. Two reads *t* seconds apart give: mean tick = Δ`tick_seconds_sum` /
  Δ`tick_seconds_count`; overruns and dropped ticks = their Δ; AI share of the tick =
  Δ`ai_seconds_total` / (Δ`tick_seconds_count` × 0.0333); bytes per player per second =
  Δ`bytes_sent_total` / *t* / 6.
- **Known, not for this gate:** **B-11** — in the headless run the squad is
  usually wiped (bots, not people; 0 % over 10 seeds since B-15). It says
  nothing about six people, which is why this gate exists; note if the fight
  is lost the same way. **B-09** — crouched shots and every throw leave from
  standing eye height. **B-17** — a dropped socket reconnects silently, and
  within 60 s takes back its own soldier (T-4.18); a banner says so. A drop
  that does not come back leaves a **bot** in that slot, which breaks "no
  bots": record it.

## The questions

A line each is enough; "fine" is a valid answer, "did not try" is a
required one.

### 1. Six in one room (scribe)

- `/healthz` before joining: ______________________________________
- Did all six get in on the first try? Any refusal sentence (room full, no
  such room, bad key, older build)? Who, and what did it say?
- Squad room with six names and no `bot`: yes / no. `/healthz` `players`:
  ______ `connections`: ______
- Time from the first Join to the mission starting: ______ min.

### 2. The six-human budget (gate question 1)

- `B` on, at the start: garrison of 3 riflemen + 1 MG, a patrol of 2? Any
  count that contradicts the table is a finding, not a feel note.
- Does 19 enemies with 10 alive at once feel like a fight for six, or too
  thin / too thick? Where did the pressure peak?
- The counterattack (3 waves of 3): did the waves arrive while you were
  holding, and did their timing feel paced — later while the fight was hot,
  sooner when it was quiet — or flat?
- Did any spawn happen in view of anyone? (It should never.)
- The 300 s group: did any run last long enough to see it?

### 3. The two-fireteam split (gate question 2)

Do **not** assign routes before the start. Say only which slots are
fireteam 1 (1–3) and fireteam 2 (4–6). Then watch what happens.

| run | who went west (overwatch) | who went east (assault) | did it split by fireteam? | who decided, and when | time to the first split |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |

- Did the map's two routes pull people apart on their own, or did someone
  have to call it? Did anyone end up alone on a lane?
- Did the west group actually overwatch — shoot from the long lines into
  the compound while the east group closed — or did both just walk up?
- Did the two groups arrive at the compound at about the same time, or one
  far ahead of the other? Did it matter?

### 4. Cover and suppression against people (gate claim)

- Did the garrison fight from cover inside the compound? Did enemies go to
  cover when shot at, peek and burst, relocate when someone got round them?
- Did the MG pin anyone? Who, where, for how long?
- Did the enemies pin one person while another flanked — and with six
  players, did anyone notice a flanker before being shot?
- Grenades at people who camped in cover: seen? How many?
- **Demonstrably?** Write down one moment of an enemy taking cover and one
  of an enemy suppressing that more than one of you saw.

### 5. The runs (is it completable?)

Read the scoreboard (`Tab`) at the end of each run before pressing `P`.

| # | outcome (HUD) | mission clock | enemies killed (K sum) | deaths | revives | alive at end | attempt | anyone dropped? |
|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | |
| 2 | | | | | | | | |
| 3 | | | | | | | | |

- For each failed run: what went wrong, and when (approach, compound,
  counterattack, hold)?
- Revives: did people revive each other under fire, or did the downed bleed
  out? Is 30 s enough?
- No respawn with six people: did the dead stay interested, or check out?
- `P` after the end, from one person: did it reset for all six at once
  (everyone on the spawn line, `attempt 2` on every screen)?

### 6. Does the host hold (gate question 3, scribe)

Paste `/healthz` once mid-mission, and fill the table from two `/metrics`
reads about a minute apart in the thick of it (counterattack, all six
firing).

```
/healthz mid-mission:
```

| | read 1 | read 2 | Δ | derived |
|---|---|---|---|---|
| time (s) | | | *t* = | |
| `tick_seconds_sum` | | | | mean tick = ____ ms of 33.3 |
| `tick_seconds_count` | | | | |
| `tick_overruns_total` | | | | |
| `ticks_dropped_total` | | | | |
| `ai_seconds_total` | | | | AI share = ____ % |
| `bytes_sent_total` | | | | ____ KB/s per player (budget ~18) |
| `process_rss_bytes` | | | | ____ MB of 512 |
| `refusals_total` | | | | which codes? |

- Did anyone feel the host hitch — everyone rubber-banding at once, enemies
  freezing and jumping? When, and did it line up with an overrun?
- Did anyone's socket drop? Did they come back into their own soldier?

## Tuning

Nothing on the host is tuned from a client slider except your own
prediction. If an encounter, director or archetype number looks wrong, write
it down here rather than changing it mid-session.

| constant (file) | now | suggested | why |
|---|---|---|---|
| | | | |

## Netgraph

Each player reads their own (`N`) once mid-mission, in the fight, and reads
the footer out to the scribe.

| slot | name | rtt ms | jitter ms | snapshot gaps % | corrections % | interp ahead | tick drift | draw calls |
|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | |
| 2 | | | | | | | | |
| 3 | | | | | | | | |
| 4 | | | | | | | | |
| 5 | | | | | | | | |
| 6 | | | | | | | | |

## Verdict

**PASS / FAIL:**

One paragraph, in your own words: did six people complete the grey-box
mission; did enemies demonstrably take cover and suppress; did it hold up
at the six-human budget; did the fireteams split on their own; and did the
host hold its tick and bandwidth with six sockets and the full encounter?

### What this establishes

### What it does not establish

(How many runs and how many completed; whether all six were human for the
whole of every run or a bot filled a dropped slot; whether anyone else was
on the host; which classes were played; how the six talked; the players'
spread of round trips; that one host in one region was tested, not
several; and whether T-3.36 had a verdict first.)
