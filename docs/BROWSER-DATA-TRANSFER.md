# Transferring saved player/voice credentials to the new game website

This is an **optional**, offline step for existing playtesters migrating from GitHub Pages to Cloudflare Pages. It must be done **before** the old site goes away. New users and users without campaign/voice history can skip it.

1. Visit `https://joshualray.github.io/Sandline/?transfer-data` on the **same browser/device** you originally used for Sandline. Select **Download private transfer file**. This downloads `sandline-private-transfer.json`; it contains your host-signed anonymous player identity and/or voice submission access token, if present.
2. Keep this file **private**. Anyone who obtains it could act as your existing player identity and/or access unfinished voice recordings. Never attach it to GitHub issues, PRs, Discord chats or CI logs.
3. Open the **confirmed production Cloudflare game URL** with `?transfer-data` appended, on the target browser/device. Select **Import the transfer file** and choose the JSON file you downloaded.
4. Return to the game normally, join the **same** Fly multiplayer host (`wss://sandline-host.fly.dev`) and confirm that your campaign/player identity is recognized. If you contributed a voice recording, use `?record-voice` and verify existing takes are visible and can be restored.
5. Delete your copy of the transfer file when no longer needed, including copies in Downloads/Files or shared backups.

## Privacy and technical guarantees

- No token appears in the URL, app logs, telemetry or network requests during transfer; the file remains on the user's device. Tokens are only used in the original game/voice APIs when the user plays or opens the recorder.
- The export includes only one configured WebSocket host's *validated* player token and recorded voice-submission credential. It never exports a lobby join key, other site storage, or unrelated host credentials.
- Import validates the file version, host, identity token shape and voice token shape before writing. The Fly.io server remains the authority: malformed, forged or expired tokens are not granted access.
- Files are plaintext because the user must manually move them between isolated browser origins. They are bearer secrets; treat them as highly sensitive and never ask contributors to send the files to the owner.
- If no credentials exist on the old site, the export will say so. If the host has changed or player data was already lost, this feature cannot recreate it.
- The file does not contain recordings, campaign saves, or any server-side SQLite contents. Those remain on the Fly persistent volume.
- Installed web apps and bookmarks tied to `joshualray.github.io` must be replaced; browser localStorage cannot be transferred automatically.

## Acceptance

- Export/import roundtrip preserves player identity and the voice credential on the same host.
- File cannot be imported into another configured host, and unrelated storage is never exported.
- Invalid JSON, oversized files and malformed tokens are refused.
- Manual desktop and iOS browser tests verify download, selection/import and subsequent identity/voice restoration on the *actual* new Pages URL.

For cutover sequence see [PRIVATE-REPO-MIGRATION.md](PRIVATE-REPO-MIGRATION.md).
