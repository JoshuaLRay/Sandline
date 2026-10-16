# Cloudflare Pages setup (private-repository migration, phase 1)

> **Status:** Deployment automation added, but Cloudflare activation requires the owner to create a Pages project and configure GitHub Actions. **Do not** make this repository private or remove GitHub Pages yet. See [PRIVATE-REPO-MIGRATION.md](PRIVATE-REPO-MIGRATION.md).

## Architecture

- GitHub Actions builds Sandline from this repository after `verify`, `streaming`, `parity-non-v8` and `mission` all succeed on the same `main` commit.
- Only `packages/client/dist` is uploaded to **Cloudflare Pages** via Direct Upload.
- The browser connects to the unchanged Fly.io multiplayer/voice host at `wss://sandline-host.fly.dev`.
- The original `https://joshualray.github.io/Sandline/` stays available until the separately approved cutover.
- A Pages Direct Upload project cannot later be converted in place to Cloudflare Git integration; using GitHub Actions to upload is intentional.

## One-time owner actions

1. Sign into [Cloudflare Dashboard](https://dash.cloudflare.com/) using a Free account.
2. Navigate to **Workers & Pages**, create a **Pages** project using **Direct Upload**, and choose `sandline` if available, with production branch `main`. A placeholder drag-and-drop is **not required** if the dashboard supports creating an empty Direct Upload project; otherwise create it using Wrangler (`npx wrangler pages project create sandline --production-branch main`) while logged in. Keep the actual project name and site URL.
3. Open [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens); create a narrowly scoped token with **Account: Cloudflare Pages: Edit**, restricted to the correct account, and copy the account ID from Cloudflare's account overview.
4. In [Sandline GitHub Actions secrets and variables](https://github.com/JoshuaLRay/Sandline/settings/secrets/actions), set:
   - Secret `CLOUDFLARE_API_TOKEN`: scoped Cloudflare Pages API token.
   - Secret `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID. (Treat this as configuration; storing as a secret follows the documented workflow.)
   - Repository variable `CLOUDFLARE_PAGES_PROJECT`: **actual** Pages project name, e.g. `sandline`.
   - Repository variable `SANDLINE_HOST`: `wss://sandline-host.fly.dev` (already used by GitHub Pages).
5. Go to GitHub **Actions → CI → Run workflow**, choose `main`. This triggers all four CI gates before the Cloudflare release. A subsequent merge to `main` also runs the deployment automatically.
6. In the run summary, confirm `deploy-client` completed successfully. If it says **Cloudflare Pages not configured**, check that the two secrets and the project variable exist. A missing configuration does not affect GitHub Pages.
7. Record the **actual** Cloudflare URL (commonly `https://sandline.pages.dev/`, but not guaranteed) in the migration plan/checklist and open it on desktop and mobile. Verify the build SHA, game boot, assets, WSS lobby connection and two-player sessions. The old site remains untouched.

## What the new CI job does

`.github/workflows/ci.yml` defines `deploy-client` with `needs: [verify, streaming, parity-non-v8, mission]`. No PR build can publish. Main-branch pushes and manually dispatched main CI runs can publish **only** if all required jobs pass.

The deploy job skips its build/deploy steps, with an informational notice, until **all three** Cloudflare settings are present. Once enabled, it builds the client using the configured `SANDLINE_HOST`, checks the current Cloudflare Pages limits of 20,000 files and 25 MiB per file, and uploads through `cloudflare/wrangler-action@v4`. Build, upload, authentication or quota failures are reported as job failures, rather than ignored.

## Known migration blockers

- Voice submission currently only accepts the exact GitHub Pages origin in `fly.toml`/`packages/server/src/voice/intake.ts`. The new website can be loaded and multiplayer can be tested, but **voice recordings from Cloudflare may be rejected** until migration PR 2 introduces a temporary, explicit origin allowlist and is deployed to Fly.
- Player identity and voice submission credentials are saved in origin-specific browser `localStorage`; they will not automatically transfer from GitHub Pages to the new site. Preserve them for returning playtesters in PR 2.
- `.github/workflows/host.yml` still triggers `pages.yml` after a Fly host update. Do **not** remove `pages.yml` until PR 3 migrates this dependency.
- Do not change GitHub repository visibility until the Cloudflare site, Fly multiplayer, voice submissions, OAuth owner review, and private GitHub credentials have passed the full cutover checklist.

## Troubleshooting

- **Cloudflare deploy skipped:** Confirm `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_PAGES_PROJECT`; do not copy secret values into issues or logs.
- **Project not found:** Ensure the project has been created as Direct Upload and its name is correct. GitHub credentials do not create Cloudflare account access by themselves.
- **Game loads but room cannot connect:** Confirm `SANDLINE_HOST` begins with `wss://` and `https://sandline-host.fly.dev/healthz` is healthy.
- **Voice upload returns 403 from Cloudflare site:** Expected before PR 2 is deployed; do not weaken CORS to `*`.
- **Asset 404 / blank page:** Confirm build output contains `index.html` and keep Vite's `base: './'`.

References: [Cloudflare Direct Upload CI](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/), [Direct Upload setup](https://developers.cloudflare.com/pages/get-started/direct-upload/), [Pages limits](https://developers.cloudflare.com/pages/platform/limits/).
