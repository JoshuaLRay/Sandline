# QA backlog — newest first

Everything worth a person's eyes that has landed and not been signed off,
newest task first. M3 (T-3.35 back to T-3.01) is covered task by task. The
still-open M2 sign-offs come after it and point at their existing run sheets.
Older work that has been through a gate ends in a short regression sweep.

This is a checklist, not a verdict. Tick what you tried and write down what
you saw. Anything wrong goes in `docs/BUGS.md` as a new B-number, with the
URL flags you used and roughly where you were standing.

---

## Before you start

**Everything here runs on the deployed QA site: no terminal, nothing
local.** The site is **https://joshualray.github.io/Sandline/**. It rebuilds a few minutes after anything merges
to `main`. The lobby's corner shows the build's commit, so check it matches
the latest merge before a session.

**Two ways in:**
- **Solo** — click a link below. It opens the page with the right flags. Then press **Practise here — you and a bot, no host**. The whole session, AI and all, runs in your browser.
- **With other people** — on the plain site, set **Map** in the lobby (Mission or Range), press **Host a room**, and give the others the room code (or the **Copy link** button's link). Everyone else opens the site, types the code, and presses **Join**.
  - The host field is filled in for you. The host runs the same AI as the page: bots that follow and fight, and the mission on the Mission map. B works there too.
  - The host sleeps when nobody is on it, so the first join can take a few seconds.
  - If it asks for a key, it's the join key set on the host.

**Solo links:**

| Link | Gives you |
|---|---|
| [Mission with squad](https://joshualray.github.io/Sandline/?mission&squad) | the grey-box mission with bots that fight beside you: map, encounter, director, objective and HUD line |
| [Mission alone](https://joshualray.github.io/Sandline/?mission) | the same, with the bots standing still |
| [Squad + range enemies](https://joshualray.github.io/Sandline/?squad&enemies) | bots that follow and take orders, and three riflemen on the range (one standing, two patrolling, respawned) |
| [Squad + suppressor](https://joshualray.github.io/Sandline/?squad&suppress) | bots, and one rifleman firing past you at the squadmate beside you |
| [Range enemies](https://joshualray.github.io/Sandline/?enemies) | the three riflemen, no bot AI |
| [Suppressor](https://joshualray.github.io/Sandline/?suppress) | the suppression look on its own |
| [Squad only](https://joshualray.github.io/Sandline/?squad) | formation following with nobody to fight |
| [Mission map, empty](https://joshualray.github.io/Sandline/?world=greybox-01) | the map with no mission on it |
| [Grey-box soldiers](https://joshualray.github.io/Sandline/?greybox) | grey-box soldiers instead of the skinned ones |

**Keys:**

| Key | Does |
|---|---|
| WASD, Shift | move, sprint |
| C / Z / Space | crouch / prone (toggles) / jump or stand |
| V | shoulder swap, or out of first person |
| RMB / LMB | aim down sights / fire |
| 1–4 / 5–6 | guns / grenade and rocket |
| G | quick throw |
| R | reload |
| E | interact (revive) |
| Q (hold) / F | order wheel / mark |
| P | restart the mission once it's over |
| B | AI debug overlay |
| N / H / T | netgraph / hide HUD / reset stats |
| Esc | release the mouse |

**Know before you judge:**
- **The page counts two humans.** Practise here puts a scripted sparring partner in slot 2 as a *human*, so the director uses the two-human budget. On the host, the budget is the people actually in the room.
- **The bots are expected to lose.** They lose most firefights today: about 30% completion at one human in the headless run. This is logged as B-11. Note how they lose; don't file "the bots lost" on its own.
- **Your eyes are the evidence.** Every item below already has headless tests, and CI runs them on every change. What's asked here is what tests can't answer: does it look right, read right, feel right.

---

## M3 — newest first

### T-3.35 — The mission, headless
Nothing to play. Read the numbers once, in GitHub.
- [ ] **Where:** repo → Actions → the latest **CI** run on `main` → the **mission** job → its last step. It plays three seeds at each budget, then prints completion, "enemies under fire in cover", "suppression episodes per engagement" and "AI cost at 40 enemies and 5 bots", and ends `OK: every threshold met`. Note the numbers.
- [ ] **Twenty seeds:** the full 20-seed run that asserts completion is the same scenario with more seeds. Ask for it to be run if you want the rates rather than three samples.

### T-3.34 — The objective (`?mission&squad`)
- [ ] **HUD line:** on joining, the top-centre line reads "Objective: clear the compound · held 0/30 s".
- [ ] **Clear, then hold:** fight into the compound (the walled box at the far end, doors in its east and west walls).
  - [ ] While any enemy is alive inside, the line says *clear* and the count stays at 0.
  - [ ] Once it's empty, the line says *hold* and counts up with someone inside.
  - [ ] Step outside with it still empty: the count **pauses** rather than resetting.
  - [ ] Let an enemy walk back in: the count **resets to 0**.
- [ ] **Complete:** at 30 s held, the line reads "mission complete · P to play again".
- [ ] **Fail:** let the whole squad die (all six). Nobody should respawn: this is deliberate, respawn is off during a mission. The line reads "mission failed · P to try again".
- [ ] **Restart, refused:** pressing P mid-mission does nothing.
- [ ] **Restart, after:** pressing P after a win or a loss brings everyone back on the spawn line at full health, clears enemies, grenades and orders, respawns the enemies, and the line shows "attempt 2".
- [ ] **Judgement:** is 30 s of hold right? Is no-respawn the right call, or does it make a wipe feel cheap? (`data/mission.json` has `holdSeconds` and `respawn`.)
- [ ] **With people:** host a room with **Map: Mission**, and have one or two others join.
  - [ ] Everyone sees the same HUD line and count.
  - [ ] The enemies come in bigger waves than solo, because the budget follows the people in the room.
  - [ ] A restart (P) from anyone, once it's over, resets it for everyone.

### T-3.33 — The director (`?mission`, then again with `&squad`)
Hard to see directly. Watch for the effects.
- [ ] **Counterattack pacing:** once the garrison is dead, a counterattack comes in three waves.
  - [ ] Keep up a heavy fight (lots of shooting, taking damage): the next wave should hang back, up to 45 s.
  - [ ] Keep it quiet: it should come sooner, about 15 s.
- [ ] **Budgets:** solo is the two-human budget; a room is the budget of its people. Six people is the full encounter, and the headless run covers it. Note whether each budget feels like too many enemies or too few.
- [ ] **Judgement:** does the pressure rise and fall, or is it flat?

### T-3.32 — Encounters and spawning (`?mission`)
- [ ] **Never in view:** no enemy ever appears in front of you. Stand looking at a spawn area (behind the compound, the west lane around its far end, the east lane half-way up) and wait for a spawn: it should come from a spot you can't see.
- [ ] **Postures:**
  - [ ] The garrison takes cover inside the compound.
  - [ ] A two-man patrol walks the west lane.
  - [ ] Two riflemen appear on the east lane when you walk into its mouth, and **stand facing it**.
  - [ ] At 5 minutes, two more appear on the west lane.
- [ ] **Stacking:** no enemy spawns on top of another.
- [ ] **Alive cap:** never more than a handful alive at once (6 at the page's two-human budget).
- [ ] **Leaving the fight:** a garrison enemy that has lost you goes back into cover inside the compound, not out into the open.

### T-3.31 — The grey-box mission map (`?world=greybox-01`, no enemies)
- [ ] **Overwatch lane:** walk the west lane end to end. It should feel open, with long sight lines and a few low walls to drop behind.
- [ ] **Assault lane:** walk the east lane end to end. It should zigzag round four long walls, with crates and low walls: close cover, never a long clear view up it.
- [ ] **Traversal:** you never get stuck on geometry, and every low wall on the routes can be vaulted or walked round.
- [ ] **Compound doors:** both side doors fit a soldier easily.
- [ ] **Judgement:**
  - [ ] Are the two routes genuinely different choices?
  - [ ] Is 100 m from the start to the objective the right size for six people?
  - [ ] Is anything on it ugly, confusing, or a snag?

### T-3.29 — Order wheel and marking (`?squad&enemies` or `?squad&suppress`)
- [ ] **Opening the wheel:** hold Q. Five labels appear round the centre and **the view stops turning**. Moving the mouse lights a sector: move (up), attack (upper right), hold (lower right), regroup (lower left), revive (upper left). The centre says who hears it.
- [ ] **Addressing:** with Q held, 3 → "slot 3", 7 → "fireteam 1", 0 → "everyone". Your weapon must **not** change while choosing.
- [ ] **Cancelling:** release in the middle (no sector lit): nothing is sent.
- [ ] **Move:** look at the ground ahead and order slot 3 to move. A ring and pole labelled "3 · move" appear there, and the bot goes and takes cover near it.
- [ ] **Hold:** order a hold at a point. The bot stands there under fire and doesn't wander.
- [ ] **Regroup:** send a bot away, then regroup it. The marker shows while it walks back, then disappears.
- [ ] **Attack:** with the crosshair on an enemy (it turns **red**), order an attack. The bot engages that enemy, and the marker follows the target until it dies.
- [ ] **Revive:** get a bot downed (shooting it yourself works). With the crosshair on it (it turns **pink**), order a revive: another bot goes and picks it up.
- [ ] **Mark:** tap F with the crosshair on an enemy. A "mark · 1" marker stands on it for about 20 s. Tap F at bare ground: it marks the point.
- [ ] **Flicks:** a fast Q-tap-flick-release still gives its order.
- [ ] **Lost focus:** alt-tab with Q held: no stray order.
- [ ] **Judgement:** is Q the right key? Is the wheel quick enough mid-fight? Are the markers readable at range?

### T-3.28 — Bots carry out orders
Covered by T-3.29's checks. Add these:
- [ ] **Unreachable move:** order a move to somewhere unreachable (on top of a tall wall). The bot should give up at once, not stand there silently forever.
- [ ] **Hold under fire:** a bot on hold does not run for cover or chase.
- [ ] **Marks take priority:** mark a far enemy with a closer one also visible. The bots should go for the marked one first.

### T-3.27 — Orders on the wire
No direct QA. Covered by T-3.29.
- [ ] **With people:** host a room, and have someone join. Orders one person gives, the other sees drawn too. Neither of you can order the other's slot: the order simply isn't given.

### T-3.26 — Friendly bots fight and revive (`?squad&enemies`)
- [ ] **Fighting:** bots see, fire at and kill riflemen, and use cover near their formation places.
- [ ] **Friendly fire:** bots never shoot through you or each other. If they seem to hold fire a lot, note it: that's B-11's suspected cause.
- [ ] **Grenades:** bots throw at enemies sitting in cover.
- [ ] **Revives:** a downed bot or human gets revived by a nearby bot, uninstructed.
- [ ] **Judgement:** do they feel like squadmates or turrets?

### T-3.25 — Formation following (`?squad`, no enemies)
- [ ] **Fireteam 1** (slots 2–3) walks in a wedge behind you; **fireteam 2** (4–6) in file.
- [ ] **Pace:** they walk when you walk and sprint when you sprint. Stop, and they close up and settle.
- [ ] **Corners:** sharp corners and doorways (the range's west walls, the mission compound) don't make them swing wide, collide or get stuck.
- [ ] **Judgement:** is the spacing right? Do they crowd you or lag?

### T-3.24 — 🧍 Combat AI sign-off (gate; run sheet `e3-5.md` not written yet)
T-3.13 to T-3.23 below are its inputs. Treat them as the draft run sheet.

### T-3.23 — Rifleman and MG (`?mission`: the garrison has an MG)
- [ ] **MG deploy:** the MG gunner doesn't fire while moving, and settles (about 1.5 s) before it opens up.
- [ ] **MG fire:** it fires long bursts and relocates rarely.
- [ ] **Riflemen:** they fire shorter bursts.
- [ ] **Readability:** can you tell the MG from a rifleman by its behaviour alone?

### T-3.22 — AI grenades (`?enemies`, hide behind the low wall)
- [ ] **When:** sit still in cover for a few seconds at 8–35 m from a rifleman who knows where you are. It should throw a grenade.
- [ ] **Where:** the grenade lands near you, not on its own feet.
- [ ] **Retrying:** it doesn't spam throws. It waits before trying again, and doesn't keep throwing at a downed target.
- [ ] **Judgement:** is the frequency fair?

### T-3.21 — Suppress and flank (`?enemies`: pin yourself behind cover)
- [ ] **Pinned:** once you're out of their sight behind cover, two riflemen in a group split up: one keeps firing at your position (the rounds go over and near you), and one walks round to your side.
- [ ] **Flank route:** the flanker takes a covered way round rather than walking straight across your view.
- [ ] **Judgement:** does being pinned and flanked feel like a threat you can read and answer?

### T-3.20 — The rifleman's fight (`?enemies`)
- [ ] **Taking cover:** a rifleman under fire goes to cover facing you.
- [ ] **From cover:** it peeks and fires bursts, reloads in cover, and pushes up when you stop shooting.
- [ ] **Flanked:** if you get round it, it relocates.
- [ ] **Readability:** can you read what it's doing and why? (B shows its branch.)

### T-3.19 / T-3.18 — Cover points and the cover query (B overlay)
- [ ] **Placement:** with B on, the cover a bot chooses is on the side of the box away from you, not on your side.
- [ ] **Sharing:** two enemies never pick the same cover point.

### T-3.17 — Suppression in the page (`?suppress`)
- [ ] **The look:** as rounds crack past, the screen edges darken (vignette), colour drains, the camera jolts once per near miss, and the crosshair spreads.
- [ ] **Recovery:** it all recovers when the fire stops.
- [ ] **Judgement:** is it strong enough to feel, without blinding you? Hurt versus merely shot-at should feel different.

### T-3.16 — Suppression in the sim
- [ ] Covered by T-3.17. While suppressed, your own shots should spread wider: the crosshair gap grows.

### T-3.15 — AI fire (`?enemies`)
- [ ] **Hits and misses:** enemy shots draw tracers, hit you with hit reactions and damage, and miss plausibly: more at range, more while you move, more when they're suppressed.
- [ ] **No shooting through cover:** they never shoot you through a wall.
- [ ] **Judgement:** is their accuracy fair at 20 m and at 60 m?

### T-3.14 — Hearing, memory, target choice (`?enemies`)
- [ ] **Hearing:** fire from out of sight. A rifleman turns toward the sound.
- [ ] **Memory:** break line of sight and move. It goes looking where it last saw or heard you, not where you actually are.

### T-3.13 — Vision and awareness (`?enemies`, B overlay shows cones)
- [ ] **Stance:** crouching or going prone at range delays being noticed. Sprinting across its view gets you noticed faster.
- [ ] **No wallhacks:** it doesn't notice you through walls.

### T-3.12 — Interest management (host a room: Map: Mission, with one other person)
- [ ] Nothing to see solo. On the host with two people 120 m+ apart, the netgraph's bandwidth drops. Coming back into range, the other soldier reappears **in the right place, with no pop from the old position**.

### T-3.11 — Enemies in the page (`?enemies`)
- [ ] **Palette:** enemies are cool slate, clearly different from the squad's olive at range.
- [ ] **Animation:** same animation quality as squadmates (gait, aim, hit reactions, feet on the ground).
- [ ] **Bodies:** corpses lie still and vanish after about 10 s.

### T-3.10 — Enemy entities
- [ ] Covered by T-3.11.

### T-3.09 — AI debug overlay (B)
- [ ] **Contents:** each brain shows its path, its intent post, vision cones, known targets, chosen cover, and a label with its running branch.
- [ ] **Toggling:** B again hides it all.
- [ ] **With people:** B works in a hosted room too; the QA host allows it.

### T-3.08 / T-3.07 — Brains on the session / behaviour-tree runtime
- [ ] No direct QA. Everything above exercises them.

### T-3.06 — Local avoidance (`?squad`, walk through a doorway with bots following)
- [ ] **Doorways:** bots and enemies squeeze past each other and you, instead of shoving or freezing.
- [ ] **Deadlocks:** no two-bot standoffs in doorways.

### T-3.05 — Path following
- [ ] **Walking:** bots walk paths smoothly, turn corners without jittering, and vault low walls rather than hopping.
- [ ] **Stuck:** watch for a bot stuck against a wall that never recovers.

### T-3.04 / T-3.03 / T-3.02 / T-3.01 — Vault links, the baked navmesh, named worlds, Recast
- [ ] **Vaulting:** bots use the range's low wall to vault (B shows the corridor crossing it).
- [ ] **Unreachable ground:** they never try to walk through a box or into a gap narrower than a soldier.
- [ ] **Map choice:** host a room with **Map: Mission** and the page draws the mission map. Host one with **Map: Range** and it draws the range. Anyone joining by code gets the host's choice, whatever their own lobby says.

---

## M2 — sign-offs still open (run sheets exist or are named)

These are gates: follow the run sheet, then fill in its verdict section. Where
a run sheet is missing, the bullets are what it should cover.

### 🧍 T-2.43 — Prone (`docs/playtests/e2-8.md`, prepared, not run)
Getting down and up; prone vs crouch vs downed; the crawl; cover; firing from prone; the other person over the host.
- Known issue B-09: firing from **crouched** still traces from standing eye height, so crouched behind low cover you shoot over it with your body hidden. Note whether it's noticeable.

### 🧍 T-2.39 — Soldier's look (`docs/playtests/soldier-look.md`, prepared, not run)
Does it read as 2002 rather than untextured geometry? The silhouette from every side; telling six slots apart at 40 m; a firefight, not a showroom.
- Add: enemies versus squad at 40 m (T-3.11's palette).

### 🧍 T-2.34 — Projectiles (run sheet `e2-5.md` **missing**)
- **The arc:** hold G to show the arc, release to throw; the grenade lands where the arc said.
- **Rockets:** 6 then click fires one. Both bounce, skid and detonate believably.
- **Blasts:** fireball, light, debris and a scorch mark; camera shake scaled by distance and cover.
- **Pouch:** counts go down; T resets them.
- **Judgement:** does the grenade distance feel right (B-03 / B-07 history)? Is the rocket satisfying?

### 🧍 T-2.29 — Animation layers (run sheet `e2-3.md` **missing**)
- **Aim offsets:** the upper body and rifle pitch with your aim, locally and on remotes.
- **Firing and reloading:** fire kick; the reload animation on R.
- **Hit reactions:** the chest turns away from the shooter, and the head snaps on headshots.
- **Feet:** feet plant on slabs, blocks and steps without floating or sinking; hips settle.
- **Judgement:** does it all read at 20 m?

### 🧍 T-2.24 — Locomotion (`docs/playtests/e2-2.md`, prepared, not run)
Figure at rest; eight-way gait; crouch; jump; vault; crawl; revive; the other person over the host; the grey-box fixture (`?greybox`).

---

## Regression sweep — older, already gated work

Ten minutes. Only confirm nothing has broken since its sign-off.

- [ ] **Movement (M1):** walk, sprint, crouch, jump, step onto slabs, vault the low wall. Collisions: nothing walks through a post or wall, and nor do your shots.
- [ ] **Weapons (M2):** all four guns fire at their cadence, bloom and recoil recover, reload works, tracers run along the shot, and there's no strobing while firing on the move (B-02).
- [ ] **Health (M2):** downed on damage (no crawling, forced third person, B-05), revive with E, bleed-out. Death respawns you **outside a mission only**.
- [ ] **Netcode (M1/M1.5), with people:** two people join by room code. Set Poor or Awful in the link panel: you feel correction on yourself, while the other person just looks late. Firing at a moving target under latency still registers.
- [ ] **Lobby (M1.5):** name and room fields, typing in them doesn't move you, and a bad room code gives a clear error ("no such room").
- [ ] **Camera:** shoulder swap (V), ADS into first person, and the camera never clips through walls.
- [ ] **Input:** Esc frees the mouse on one press, F11 leaves fullscreen, and Ctrl combos don't fire browser shortcuts (B-06).
