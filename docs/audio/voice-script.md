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
  - **Hurt** (only the "Hit and down" section, and only its body sounds,
    line 5): File name `hit-hurt`.
  - The enemy section is **shouted only**: `enemy-shout`.
- Don't worry about mistakes. Leave a pause and say it again; the extra
  takes get trimmed.

Total time: about fifteen minutes a speaker.

---

## The lines

Each line's ID is in `code`: it is the name the game and
[voice-cues.md](voice-cues.md) (which lists every clip still missing) use.

### Contact (`contact-…`)
1. Contact! `contact`
2. Contact front! `contact-front`
3. Contact left! `contact-left`
4. Contact right! `contact-right`
5. Enemy spotted! `enemy-spotted`
6. Machine gun! `machine-gun`

### Firing (`firing-…`)
1. Covering fire! `covering-fire`
2. Suppressing! `suppressing`
3. Keep their heads down! `heads-down`

### Moving (`moving-…`)
1. Moving! `moving`
2. Moving up! `moving-up`
3. On me! `on-me`
4. Go, go, go! `go-go-go`
5. Taking cover! `taking-cover`
6. Get down! `get-down`

### Reloading (`reload-…`)
1. Reloading! `reloading`
2. Changing mag! `changing-mag`
3. Cover me, reloading! `cover-me-reloading`

### Grenades (`grenade-…`)
1. Frag out! `frag-out`
2. Grenade! `grenade`
3. Grenade — get back! `grenade-get-back`

### Hit and down (`hit-…`)
1. I'm hit! `im-hit`
2. Man down! `man-down`
3. I'm down! `im-down`
4. I need help here! `need-help`
5. The body's sounds, in the **hurt** pass and only there (`hit-hurt`), each
   three times like any line:
   1. a grunt, as a round hits: `pain-grunt`
   2. a sharp breath in: `pain-breath`
   3. a groan: `pain-groan`
   4. a cry, going down hurt: `downed-cry`
   5. a last, long, fading breath out — dying, not hurt: `dying-sigh`

   The normal and shouted passes of this section are lines 1–4.

### Reviving (`revive-…`)
1. I've got you! `got-you`
2. Hang on! `hang-on`
3. You're up! `youre-up`

### Kills (`kills-…`)
1. Enemy down! `enemy-down`
2. Got him! `got-him`
3. Target down! `target-down`

### Orders (`orders-…`)
These are a bot answering your order wheel.
1. Copy! `copy`
2. Roger! `roger`
3. On it! `on-it`
4. Moving to position! `moving-to-position`
5. Holding here! `holding-here`
6. Regrouping! `regrouping`
7. Negative, can't get there! `cant-get-there`

### Objective (`objective-…`)
1. Compound clear! `compound-clear`
2. Holding the objective! `holding-objective`
3. Objective secure! `objective-secure`

### The enemy (`enemy-…`, shouted only)
These are the other side shouting as it opens fire. They are heard in the
enemy's voices (three profiles of their own), where the enemy stands. A
different speaker from the squad's is best, if you have one. Record only the
**shouted** pass: `enemy-shout`.
1. Open fire! `open-fire`
2. There they are! `there-they-are`
3. Flank them! `flank-them`
4. Push forward! `push-forward`

---

## Recording directly in the game (preferred)

Open the game's **Contribute a voice recording** link (or `?record-voice`). Enter a name or nickname and the invitation code `JRay` (capitalization does not matter). Read and check the consent terms. The list shows every line, its delivery, and your saved recording count. Tap a line to see the quoted prompt and parenthetical direction. Tap **Record**, say that line once, then tap **Stop**. Listen by tapping a recording in the scrollable list; listening is disabled while recording. Tap **Submit** to save the take immediately on the host for owner review. There is no second Upload or Finish action. Record more takes or choose another line; repeats are retained separately. If several takes for a line are ready, Submit sends all of them. A failed save remains visibly unsubmitted and can be retried.

Returning on the same browser restores your contribution, saved counts and audio using a stored submission credential. Counts increase only after the server confirms a save. Unsubmitted takes remain on the page while you change lines; submit them before leaving or reloading. A different browser starts a separate contribution; names are labels, not credentials. You can contribute any subset of the lines. The page sends the recordings privately for owner review; submitting them does not put your voice into a live game. The original section-recording instructions above still apply to manual uploads.

The owner's host needs a persistent `VOICE_INTAKE_DIR` and `VOICE_SITE_ORIGIN` set to the deployed site's exact origin. The Fly deployment config supplies both. On the host, inspect the completed submission under that private directory and import an approved ID with `pnpm import:voice <intake-dir> <submission-id>`. Then run `pnpm gen:voice`, check its report and listen on `?sounds` before committing any rendered audio. Raw submissions remain private until explicitly imported. The owner can delete an unprocessed submission directory on request.

## Uploading manually, with nothing local (fallback)

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
