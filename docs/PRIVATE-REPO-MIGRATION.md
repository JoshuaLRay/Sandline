# Sandline: Private GitHub + Cloudflare Pages migration

> **Status:** Planned; not started. This document is a migration runbook, not permission to change repository visibility.  
> **Decision (2026-10-16):** Remain on GitHub Free, make `JoshuaLRay/Sandline` private, publish the playable browser client via Cloudflare Pages Free, and retain the existing Fly.io host and its persistent data.  
> **Owner-controlled cutover:** Change GitHub visibility **only after** the replacement site and all integrations pass live verification.

## Goals and non-goals

- Keep the **same GitHub repository**, complete Git history, branches, issues, PRs, docs, AI-agent conventions and CI gates.
- Restrict access to source, docs, backlog, private PRs and future development via GitHub repository permissions.
- Keep Sandline publicly playable over HTTPS, with multiplayer via `wss://sandline-host.fly.dev`, mobile spectator features, and working voice contribution/review.
- Preserve the Fly.io app, its `sandline_data` persistent volume, `/data/sandline.sqlite` campaign/player records and `/data/voice-submissions` recordings.
- Continue automatic builds/deployments **only after required checks pass**, with safe manual re-deploy and rollback paths.
- Do **not** rewrite Git history, recreate Fly.io, move the database, expose private audio, automatically make the repo private in a PR, or assume the published browser bundle is secret.
- Private GitHub visibility does **not** hide JavaScript, WebAssembly, JSON, maps or assets shipped to players. Sandline includes shared client/server logic and an in-page simulation; anything bundled into `packages/client/dist` is inspectable. Review third-party licenses and pre-existing public copies separately.

## Target architecture and addresses

| Component | Target | Notes |
| --- | --- | --- |
| Source / issues / PRs / backlog | Private `github.com/JoshuaLRay/Sandline` (GitHub Free) | Existing repository, no relocation |
| Public game | `https://sandline.pages.dev/` **proposed** | Must confirm that Pages project name is available; record the actual URL before changing configuration |
| Static client deployment | GitHub Actions -> Cloudflare Pages **Direct Upload** | Builds from private checkout; only `packages/client/dist` is uploaded |
| Multiplayer/WebSocket | `wss://sandline-host.fly.dev` | Existing Fly.io app remains |
| Voice upload API | `https://sandline-host.fly.dev/voice-submissions` | Existing host and persistent volume remain |
| Owner voice review | `https://sandline-host.fly.dev/voice-review` | GitHub OAuth callback remains on Fly.io |
| Old client site | `https://joshualray.github.io/Sandline/` | Remains live until cutover; GitHub Free unpublishes it when the repo becomes private |

Cloudflare Pages project creation and the visibility change require owner access and should be handled as explicit gates.

## Existing implementation points (verified 2026-10-16)

| Path | Current behavior | Planned change |
| --- | --- | --- |
| `.github/workflows/pages.yml` | Build and deploy GitHub Pages on `main` | Retire only after replacement is operational |
| `.github/workflows/ci.yml` | Required `verify`, `streaming`, `parity-non-v8`, `mission` jobs | Add a Cloudflare production deployment gated by **all four** jobs |
| `.github/workflows/host.yml` | Fly deploy; set `SANDLINE_HOST`; dispatch `pages.yml` | Preserve Fly deploy, replace Pages trigger with an appropriate tested Cloudflare rebuild path |
| `.github/workflows/voice-notification.yml` | `repository_dispatch` creates a GitHub issue | Confirm token continues working when repo is private |
| `packages/client/vite.config.ts` | Build-stamped Vite client; `SANDLINE_HOST` compiled in; `base: './'` | Retain relative paths and public `wss://` host; update stale comments |
| `packages/client/public/manifest.webmanifest` | Relative web-app `id`/`start_url`/`scope` | Test fresh installs; old installed shortcuts are origin-specific |
| `fly.toml` | `VOICE_SITE_ORIGIN = "https://joshualray.github.io"` | Switch only after temporary compatibility period |
| `packages/server/src/voice/intake.ts` | Exact single-origin allowlist for voice CORS | Temporarily allow only the **two exact** approved origins, then narrow to Cloudflare |
| `packages/server/src/main.ts` | Configures intake origin and GitHub notification | Handle temporary allowlist without weakening restrictions |
| `packages/server/src/voice/review.ts` | Same-origin owner review and Fly.io OAuth callback | Preserve its `VOICE_REVIEW_ORIGIN`; adjust GitHub OAuth App homepage as needed |
| `packages/client/src/net/identity.ts` | Stores host-specific player token in browser `localStorage` | Plan opt-in transfer for returning players |
| `packages/client/src/ui/VoiceSubmission.ts` | Stores submission ID/token in browser `localStorage` | Preserve access to unfinished submissions without exposing tokens |

## PR 1 — Cloudflare Pages deployment (old site remains live)

**Owner prerequisites**

1. Create/sign into Cloudflare Free, create a Pages project named `sandline` via **Direct Upload** (not Git-connected deployment). If that name is unavailable, record the actual project name and URL and propagate them consistently.
2. Create a Cloudflare API token with scoped **Account -> Cloudflare Pages -> Edit** access and obtain the account ID.
3. Set GitHub Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Ensure `SANDLINE_HOST` is the **nonsecret** repository variable `wss://sandline-host.fly.dev`. Never commit credentials.
4. Check current account limits and deployment cost assumptions before enabling automation.

**Agent work**

- Extend `.github/workflows/ci.yml` to deploy only on an eligible `main` run **after** `verify`, `streaming`, `parity-non-v8` and `mission` succeed on the same commit. No production deploy from untrusted pull requests.
- Build from the monorepo root using `pnpm install --frozen-lockfile` and `pnpm --filter @sandline/client build`, with `SANDLINE_HOST` set at build time.
- Deploy only `packages/client/dist` with `cloudflare/wrangler-action@v4` or the then-supported Wrangler CLI.
- Use the existing `base: './'` relative asset configuration, check the output path, static fallback behavior, and the generated website URL.
- Add a predeploy assertion for Cloudflare Pages Free file limits (currently **20,000 files/site** and **25 MiB per file**; verify limits before implementation).
- Keep `pages.yml` running in parallel during this PR. An interim Cloudflare site may not submit voices until PR 2 changes the CORS allowlist.

A candidate CI job (append/adapt; not a separate complete workflow):

```yaml
  deploy-client:
    if: github.ref == 'refs/heads/main' && github.event_name != 'pull_request'
    needs: [verify, streaming, parity-non-v8, mission]
    runs-on: ubuntu-latest
    permissions:
      contents: read
      deployments: write
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @sandline/client build
        env:
          SANDLINE_HOST: ${{ vars.SANDLINE_HOST }}
      - uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy packages/client/dist --project-name=sandline --branch=main
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}
```

Ensure this is configured to skip safely if required Cloudflare credentials are not yet installed, without weakening the existing four CI jobs. Validate action version and permissions in CI.

**PR 1 acceptance:** HTTPS page renders, built asset URLs load, build SHA appears, original Pages site remains live, browser can connect to Fly WebSocket, both game sites can coexist.

## PR 2 — Voice-origin and identity compatibility

**Voice**

- Teach `VoiceIntake` to accept an explicit, tightly validated set of allowed *origins* (not wildcard CORS and not arbitrary request Origin reflection). Include a short overlap window containing `https://joshualray.github.io` and the actual new Pages origin.
- Maintain current `Origin` rejection rules, CORS preflight handling, accepted methods/headers, upload limits, contribution consent, access tokens, and no public listing/playback.
- Add regression tests: both approved origins succeed during transition, all other origins are rejected, unauthenticated audio reads fail, and existing voice flow still works.
- Keep voice recordings and `VOICE_INTAKE_DIR` on the **same Fly volume**. Do not reset `VOICE_GITHUB_DISPATCH_TOKEN` without need.
- Change the GitHub OAuth App **Homepage URL** to the new game URL when ready. Keep **Authorization callback URL** as `https://sandline-host.fly.dev/voice-review/callback` and keep Fly `VOICE_REVIEW_ORIGIN=https://sandline-host.fly.dev` unchanged.
- Verify the OAuth owner's stable GitHub identity, sign-in, audio seeking/download, logout and unauthorized-user denial.

**Cross-origin browser storage**

Browser `localStorage` is isolated by origin. Moving from GitHub Pages to Cloudflare Pages does **not** carry existing tokens with it, even if Fly keeps its database.

- Existing host-signed player tokens need an **optional** explicit transfer mechanism for returning players whose campaign identity matters. Provide a locally handled export/import or equivalent consented mechanism available on both sites during overlap. No token in the URL, query string, referrer, analytics, CI log or backend log.
- Existing voice submission tokens require separate, careful handling for contributors who have in-progress recordings. Tokens grant access to private submissions; do not automatically publish or bulk-migrate them. Prefer a one-time copy/import in the contributor's own browser, with safety instructions, clear revocation expectations and tests.
- For new testers, no transfer is needed; explain that players without a transferred identity may be issued a new identity while old Fly data remains stored.
- Account for old `localStorage` values, old installed mobile/PWA shortcuts, and fresh iPhone/Android permission prompts.

**PR 2 acceptance:** both origins can submit and restore recordings during overlap, unauthorized origins are blocked, owner review works, notification issues can be created on a private test context or using an appropriately scoped credential, and returning-player identity preservation is demonstrated with an opt-in test.

## PR 3 — Finalize deployment automation and docs

- Once the Cloudflare site has passed live QA, remove `.github/workflows/pages.yml`, replace GitHub Pages URLs in `README.md` and `docs/DEPLOYING.md`, and update any relevant links in release/playtest documents.
- Replace the `gh workflow run pages.yml --ref main` step in `host.yml`. If the Fly hostname differs from `SANDLINE_HOST`, update that GitHub variable and dispatch a CI-gated rebuild; do **not** dispatch a workflow that omits verification or has a condition that excludes `workflow_dispatch`. Add `workflow_dispatch` to `ci.yml` if using it for manual rebuilds.
- Preserve host deployment triggers, container build, volume mounting, health checks, graceful drain, voice review/notifications and campaign state.
- Include a specific Fly deploy ordering: deploy compatibility support before exposing the new voice origin; later narrow its allowlist to Cloudflare when old Pages can be retired.
- Finalize `VOICE_SITE_ORIGIN` (or its successor) to the **actual** Pages origin, not a guessed hostname; old GitHub Pages origin is removed after the overlap window.
- Update the hosting/rollback instructions so AI agents and maintainers do not attempt to deploy to the defunct Pages site.
- Preserve `pnpm verify` and all four branch/PR CI gates; avoid unnecessary duplicate builds and artifacts to control private Actions minutes.

**PR 3 acceptance:** production client is served by Cloudflare; Fly deploys never try to run the removed Pages workflow; all URLs and origins are correct; the Cloudflare build runs after the full CI gate.

## Production QA / visibility gate

Before changing GitHub visibility, the owner or executing agent must record evidence for every line:

- [ ] Cloudflare HTTPS game and assets load in desktop Chrome, Safari and Firefox.
- [ ] WebSocket host/join and room-code sharing work in two browsers/network sessions.
- [ ] Mobile iPhone Safari/Chrome and Android spectator/command controls work.
- [ ] Returning player identity and campaign data remain accessible after an opted-in transfer; new-player flow works.
- [ ] Voice contribution obtains consent, records, submits, stores, and restores multiple takes.
- [ ] Owner GitHub OAuth review shows the submissions, plays audio, and rejects non-owner accounts.
- [ ] New recording creates the intended private-repository GitHub issue through `repository_dispatch`.
- [ ] Server runs on the existing Fly app/volume; `/healthz` succeeds; no save or audio data was erased.
- [ ] CI's `verify`, `streaming`, `parity-non-v8`, `mission` succeed on the relevant current head.
- [ ] Cloudflare production deployment is confirmed at the recorded URL/commit SHA.
- [ ] No server secret, OAuth secret, API token, source recording or other private artifact is shipped in the client bundle.
- [ ] Claude Code/Codex/GitHub App access to the *private* repository has been prepared; reauthorization paths are known.
- [ ] A rollback procedure has been rehearsed without touching the Fly volume.

## Owner cutover (manual, last)

1. Freeze merges, tag/record the cutover commit, and preserve a full Git mirror backup (branches, tags) in a secure location:
   `git clone --mirror https://github.com/JoshuaLRay/Sandline.git`.
2. Verify all acceptance checks; finish optional exports from the old site **before** it disappears. Snapshot/backup the Fly volume/database by a safe method.
3. Confirm the new URL is the one being advertised. Existing shared GitHub Pages links and installed shortcuts will **not** redirect automatically.
4. In GitHub: `Sandline -> Settings -> General -> Danger Zone -> Change repository visibility -> Make private`. GitHub Free will **unpublish** the old GitHub Pages site.
5. Confirm GitHub Actions, Fly deployment credentials, `repository_dispatch`, and Codex/Claude GitHub permissions still work for a **private** repository. Reauthorize app installations or fine-grained tokens if necessary.
6. Test the Cloudflare build, Fly multiplayer, voice upload, OAuth review and campaign persistence one more time. Remove the temporary old-origin permission once no longer needed.
7. Remove stale public-site links from project docs and invitations; record the successful migration in the changelog or final backlog task.

Do **not** perform step 4 automatically as part of a pull request.

## Rollback and safety

- **Before privacy cutover:** Keep GitHub Pages live; revert Cloudflare/client/CORS PRs or fix the new Pages deployment without touching Fly data.
- **After privacy cutover:** Prefer rolling back the Cloudflare deployment to a known-good build, reverting the specific code change and redeploying, while leaving the repository private. Returning to public visibility is a **separate owner decision** and would expose any code added while private.
- **If voice breaks:** Restore the previous verified voice CORS configuration or deploy the fixed allowlist; preserve `VOICE_INTAKE_DIR`, `VOICE_REVIEW_ORIGIN`, tokens and persistent volume.
- **If multiplayer breaks:** Verify build-time `SANDLINE_HOST` uses `wss://`, Fly `/healthz`, protocol version compatibility, and WebSocket connectivity; rollback the client or server independently as needed.
- **If credentials fail:** Rotate/re-authorize the affected scoped tokens; do not print them into Action logs, source code or documentation.
- A once-public repository cannot retract previous clones/downloads. Public forks, if any, remain separate/public when visibility changes. Audit dependency/asset licenses before asserting proprietary rights.

## Costs, quotas and references

- GitHub Free private repositories remain available; **private** GitHub Actions jobs consume plan-included runner minutes and artifact storage. Sandline's four expensive CI jobs and map-review uploads warrant checking usage after cutover.
- Cloudflare Pages has a Free plan, but verify up-to-date quotas and account settings. Do not assume that GitHub Actions execution itself is free.
- Fly.io stays on its **existing** pricing/account and public hostname. Its storage and network costs are independent of source visibility.
- Cloudflare Direct Upload through GitHub Actions: https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/
- Cloudflare Pages limits: https://developers.cloudflare.com/pages/platform/limits/
- GitHub visibility and Pages effects: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility
- GitHub Actions usage and billing: https://docs.github.com/en/billing/concepts/product-billing/github-actions

## Completion definition

Migration is DONE only when the repository is private on GitHub Free, Sandline is publicly playable from Cloudflare Pages, the same Fly.io sessions/campaign/voice data continue working, required CI/deployment automation works with private-repository credentials, and the owner confirms the final live review.

**No implementation, account setup, visibility change or deployment is authorized by merely storing this plan.**
