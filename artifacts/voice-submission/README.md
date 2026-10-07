# U-137 contribution browser evidence

Generated locally with Chromium's synthetic microphone, the real `MediaRecorder`, the actual contribution UI and a temporary private `VoiceIntake`. No contributor audio, invitation secret or submission credential is retained in these artifacts. This is engineering evidence, not an owner listening or visual verdict.

Reproduce from the repository root:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm exec playwright install chromium
corepack pnpm exec tsx packages/tools/src/check-voice-submission.ts
```

On a machine with system Chromium, set `CHROMIUM_PATH` to its executable for the last command. The check uses loopback HTTP (a browser secure context), records four separate takes, submits to a temporary host, reloads and plays a saved clip, verifies that recording pauses and disables listening, and checks the mobile layout for horizontal overflow. The temporary source audio is removed afterwards.

`desktop-lines.png` / `mobile-lines.png` show the line list. `desktop-detail.png` / `mobile-detail.png` show the quoted prompt, direction, Record/Submit and saved playback list. `results.json` records the assertions. The separate browser regression suite verifies twenty-four takes, failures/retries, multiple pending takes, permission denial and late microphone cleanup.
