# Voice script — what to record

Record these once and the game has its squad callouts (E-2.7, T-2.48 and
T-2.49; decision in `docs/adr/017-in-house-audio.md`). The processing makes
the voice deeper or rougher, turns one voice into several soldiers, adds the
radio and the shout, and makes variations. So you don't need to act, or to
sound like anyone. Say the lines clearly, in two ways, and the rest is code.

**Only record yourself, or people who have agreed to their voice being in the
game.** Every speaker's folder needs a one-line note saying they agreed (see
Uploading).

---

## How to record

- **Anything works.** A phone's voice-memo app is fine. WAV is best; M4A or
  MP3 is fine too.
- **Where:** a quiet room with soft things in it (a bedroom or a car beats a
  kitchen or a bathroom). Phone about a hand's width from your mouth,
  slightly to the side so the "p"s don't pop.
- **One file per section below.** Read the lines in order, and say **each
  line three times**, with **a full second of silence** between every take.
  The silence is how the tool finds each take.
- **Two passes of each section, and a third for the pain sounds:**
  - **Normal:** clear, firm, a radio voice. File name ends `-normal`.
  - **Shouted:** as if over gunfire; loud, but don't strain. File name ends `-shout`.
  - **Hurt** (only the "Hit and down" section, and only its pain sounds,
    line 5): File name `hit-hurt`.
- Don't worry about mistakes. Leave a pause and say it again; the extra
  takes get trimmed.

Total time: about fifteen minutes a speaker.

---

## The lines

### Contact (`contact-…`)
1. Contact!
2. Contact front!
3. Contact left!
4. Contact right!
5. Enemy spotted!
6. Machine gun!

### Firing (`firing-…`)
1. Covering fire!
2. Suppressing!
3. Keep their heads down!

### Moving (`moving-…`)
1. Moving!
2. Moving up!
3. On me!
4. Go, go, go!
5. Taking cover!
6. Get down!

### Reloading (`reload-…`)
1. Reloading!
2. Changing mag!
3. Cover me, reloading!

### Grenades (`grenade-…`)
1. Frag out!
2. Grenade!
3. Grenade — get back!

### Hit and down (`hit-…`)
1. I'm hit!
2. Man down!
3. I'm down!
4. I need help here!
5. Three short pain sounds: a grunt, a sharp breath in, and a groan. Do these in the **hurt** pass,
   and only these: `hit-hurt` is the grunt three times, the breath three times, the groan three
   times. The normal and shouted passes of this section are lines 1–4.

### Reviving (`revive-…`)
1. I've got you!
2. Hang on!
3. You're up!

### Kills (`kills-…`)
1. Enemy down!
2. Got him!
3. Target down!

### Orders (`orders-…`)
These are a bot answering your order wheel.
1. Copy!
2. Roger!
3. On it!
4. Moving to position!
5. Holding here!
6. Regrouping!
7. Negative, can't get there!

### Objective (`objective-…`)
1. Compound clear!
2. Holding the objective!
3. Objective secure!

---

## Uploading, with nothing local

1. Open the repository on GitHub and go to `assets/voice/raw/`. If the
   folder isn't there yet, typing the path into the file name in step 2
   makes it.
2. Choose **Add file → Upload files**, and put each speaker's files in a
   folder of their own: `assets/voice/raw/<name>/contact-normal.wav`,
   `assets/voice/raw/<name>/contact-shout.wav`, and so on.
3. Add a file `assets/voice/raw/<name>/CONSENT.md` with one line: "I agree to
   my voice being used in Sandline", with the name and date.
4. Commit it, straight to a new branch, then tell Claude. From there the
   pipeline does the rest, and you listen on the deployed site's sound board
   (`?sounds`).

**If a pass has a false start** (a take cut off and said again), you don't
need to record it again: `pnpm gen:voice` says how many takes it found and
where each starts, and a line in `assets/voice/raw/<name>/edits.json` —
`{ "contact-shout": { "drop": [4] } }` — leaves the fifth take out. Claude
can write that for you from the tool's report.

Two or three different speakers go further than any processing: each slot
can then sound like a different person, not one person in six profiles.
