# Soldier look sign-off — T-2.39

## Status: NOT YET RUN

This file is the run sheet for the sign-off, written before the session so
that the judgements get recorded while they are fresh. **Until the Verdict
section at the bottom is filled in by a person, this task is open and the
soldier's look is not signed off.** Nothing in this file is a result.

- **Date:**
- **Build:** (the commit shown top-left of the HUD)
- **Played by:**
- **Setup:** (an in-page session gives you one soldier and one bot; a room on
  the host with a second person is what puts a human-coloured squadmate and a
  bot on screen at the same time, which is the only way to judge section 4)

## What this is judging

T-2.35 through T-2.38 gave the soldier the art *treatment* the locked
direction always implied — `PLAN.md` line 5's "early-2000s console squad
tactics games", ADR-013's "early-2000s console squad shooter" — and which had
never existed. Before this, the soldier was untextured primitives under a PBR
material, and read as exactly that.

**The question is whether it reads as 2002, not whether it is pretty.** A
soldier that looks like a modern indie game has failed this gate just as
surely as one that still looks like programmer art.

**PS2, not PS1.** If anything in here reads as wobbling vertices or swimming,
warping textures, that is a *bug* and not the style — say so plainly rather
than filing it as a look note. Neither is implemented and neither should be.

## Before you start

- `WASD` move, `Shift` sprint, `Ctrl` or `C` crouch, `Space` jump, `V` swaps
  shoulder (and exits first person), `RMB` aims into first person, `E` held
  revives. `H` hides the HUD.
- **`?greybox` on the URL draws the grey-box fixture instead.** It is not part
  of the look; section 7 asks only that it still renders.
- The soldier is 980 triangles on one 256×256 generated texture, one draw
  call for the body and one for the rifle. There is no image file anywhere in
  the client and nothing is downloaded: the texture is painted from
  arithmetic at startup. If it looks like an asset failed to load, that is a
  real bug, because there is no asset to fail.
- **Colours are data.** `packages/client/src/character/soldierPalette.json` is
  a `base` palette plus one override block per name (`local`, `bot`,
  `slot-1`…`slot-6`). Changing a colour is an edit and a reload, not a
  slider. Record anything you change in Tuning.

## The questions

A line each is enough; "fine" is a valid answer, "did not try" is a required
one.

### 1. Does it read as the era at all (T-2.35, T-2.37)

Stand still in third person and look at your own soldier.

- Does it read as a low-poly character with a painted texture, the way a 2002
  console soldier did — or does it still read as untextured geometry?
- Can you see the painted detail: pouches, webbing, the placket and chest
  pockets, boot laces and soles, a face under the helmet?
- Does anything read as *modern* — a soft shadow edge, a sheen or highlight
  on the uniform, a material that looks physically simulated?
- Does anything read as PS1 rather than PS2 — texture swimming or warping as
  you move, vertices wobbling? (There should be none. Both would be bugs.)

### 2. The silhouette (T-2.36)

Walk a full circle around a bot at spawn.

- Is the outline chunky and era-correct — big boots, a helmet with a brim,
  gear that breaks the line — or is it a smooth mannequin?
- Does the helmet read as a helmet from behind and from the side?
- Are the proportions stocky enough, or does it still look like a realistic
  figure that happens to be low-poly?
- Any place the body visibly comes apart: a gap at the ankle, shoulder or
  neck; a limb through the torso; the pack clipping the arms?

### 3. Through the E-2.3 layers

The point of doing this after E-2.3 is that the texture and the silhouette
have to survive everything that moves.

- Walk, sprint, crouch-walk, jump, vault, go down and get revived. Does the
  silhouette still read through all of it?
- Aim up and down. Does the texture stay put on the body, or does anything
  slide, stretch or swim across a joint?
- Fire a burst and reload. Does the rifle read as a weapon with furniture — a
  stock, a handguard, a magazine — rather than as a box?

### 4. Telling six soldiers apart (T-2.38)

**Needs a second person on the host**, or you are judging bots against bots.

- Line up with the squad. Can you tell the six slots apart at conversational
  range? At the far end of the range?
- **Walk out to roughly 40 m and look back.** Can you still tell which is
  which? The helmet band is meant to be what carries it at that distance.
- Is a bot obviously a bot, and are you obviously you?
- From the side, with no helmet band in view, does the shoulder marking do
  the job?
- Is the marking too loud — does it read as a video-game team colour rather
  than as a unit marking?

### 5. In a firefight, not a showroom

- Shoot at each other. Does the body stay readable while it is moving,
  reacting and being shot at?
- Does the coloured marking ever make it *harder* to read what the soldier is
  doing, or pull the eye away from the weapon and the hands?
- Downed on the ground: does the body still read as a soldier, or as a pile?

### 6. The resolution question — the one open decision

**This is the deliberate open item, and it is yours to settle, not an
agent's.** T-2.37 did not implement a fixed low-resolution render target
(rendering at, say, 640×448 and upscaling with point filtering). It is the
strongest era cue still available and it is the only one with a real cost:
it would also soften the crosshair, the tracers and the hit markers, and
T-2.24 and T-2.29 — both still open — are judged on exactly those.

- With the look as it stands, is the era read good enough without it?
- If not, is the legibility worth trading? Say which way and why; if yes,
  it becomes a task.

### 7. The grey box still works

- Load `?greybox`. Does the fixture still render and still move?
- (Only that. It is a diagnostic, not art, and is not being judged as art.)

### 8. Performance

- Does the frame rate differ from before this change? The soldier got
  *cheaper* — fewer triangles, a lighter material, a cheaper shadow filter —
  so a drop is a surprise worth writing down.
- Read `tick … fps … dropped …` off the HUD with six soldiers on screen and
  paste it below.

```
```

## Tuning

Palette colours you changed, if any:

| palette | key | old | new | why |
|---|---|---|---|---|
| | | | | |

Anything else you changed (file, what, why):

## Verdict

**PASS / FAIL:**

One paragraph, in your own words: does the soldier read as an early-2000s
console squad shooter character, is the squad legible at the ranges the game
is actually played at, and does the look survive everything E-2.2 and E-2.3
make the body do?

### What this establishes

### What it does not establish

(Which sections were skipped; whether a second person was there and whether
the host was used, without which section 4 is bots against bots; whether 40 m
was actually walked or estimated; what the range cannot show — no interiors,
no night, no weather, one ground colour and one sun angle, so how the soldier
reads against anything but sunlit sand is untested; and the resolution
question in section 6 if it was left open.)
