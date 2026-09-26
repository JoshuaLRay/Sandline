# Voice uploads

One folder per person who recorded the lines in
[`docs/audio/voice-script.md`](../../../docs/audio/voice-script.md), each with
its `CONSENT.md`. `pnpm gen:voice` turns them into the game's lines under
`packages/client/public/audio/voice/`; a test fails until it has been run
after an upload.

```
assets/voice/raw/<name>/CONSENT.md          "I agree to my voice being used in Sandline" — name, date
assets/voice/raw/<name>/contact-normal.wav  one file per pass: <section>-normal, -shout, and hit-hurt
assets/voice/raw/<name>/edits.json          optional: { "contact-shout": { "drop": [4] } } drops a false start
```

A folder without `CONSENT.md` is refused, whole. This README is not an input.
