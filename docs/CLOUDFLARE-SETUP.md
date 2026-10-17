# Cloudflare Worker production deployment (Sandline)

> **Current site:** https://sandline.joshualray21.workers.dev
> **Status:** Worker was published manually via Cloudflare Workers Builds (2026-10-17).
> The GitHub Actions **Worker deployment is opt-in** until credentials are
> configured and an actual gated release succeeds. Do not mistake merged
> code for verified production deployment. See [private-repo migration](PRIVATE-REPO-MIGRATION.md).

## Architecture

- GitHub `main` is the source of truth. A production Worker release from
  `.github/workflows/ci.yml` waits for **verify, streaming, parity-non-v8,
  mission** to succeed for that same commit.
- The Worker named `sandline` serves the static `packages/client/dist`
  bundle using Wrangler's `--assets` mode; production URL stays
  `https://sandline.joshualray21.workers.dev` (not `*.pages.dev`).
- The built client defaults to `wss://sandline-host.fly.dev`; its Fly.io
  multiplayer, campaign volume and voice-review service **stay on Fly.io**.
- Worker Builds' existing GitHub integration currently builds/deploys outside
  the four GitHub CI gates. **Do not leave both uploaders active** after
  switching release ownership to GitHub Actions.

## Finish GitHub Actions activation (iPhone Safari)

1. Cloudflare dashboard → account API Tokens → **Create Token**.
   Grant **Workers Editor** for the existing `sandline` Worker (or the scoped
   **Edit Cloudflare Workers** template for your account). A Pages-only
   token is *not* sufficient. Do not send the token to chat.
2. GitHub repository → [Actions secrets](https://github.com/JoshuaLRay/Sandline/settings/secrets/actions):
   - Secret `CLOUDFLARE_WORKERS_API_TOKEN`: the new Worker-capable token.
   - Secret `CLOUDFLARE_ACCOUNT_ID`: the matching Cloudflare account ID.
   - Variable `SANDLINE_HOST`: `wss://sandline-host.fly.dev`.
3. Cloudflare dashboard → **Workers & Pages → sandline → Settings → Builds**:
   **disable automatic Builds** (or **Disconnect** the Git integration) so
   it can no longer publish a new `main` build ahead of CI.
   **Do not delete the Worker.** Disabling Builds preserves its last live
   deployment. This is a Cloudflare setting, not a GitHub secret.
4. In [GitHub Actions variables](https://github.com/JoshuaLRay/Sandline/settings/variables/actions),
   set `CLOUDFLARE_WORKER_DEPLOY_ENABLED` to exactly `true`.
5. Run [CI → Run workflow](https://github.com/JoshuaLRay/Sandline/actions/workflows/ci.yml)
   against **main**. Wait for all four tests **and** `deploy-worker` to
   succeed. The deploy must use the current `main` SHA; otherwise it fails
   closed rather than replacing a newer release.
6. Open the public Worker link and check the HUD build SHA, assets, room
   host/join, mobile spectator, voice contribution, and saved campaign state.
   Then proceed to the repository visibility change in the migration plan.

An intentionally **skipped** `deploy-worker` while the opt-in flag is absent
means that CI tests may be green but GitHub has not shipped the game. Do not
mark deployment complete based on test jobs alone.

## What the automation does

On a push or manual dispatch to `main`, after all four required jobs pass,
`deploy-worker` checks credentials and `SANDLINE_HOST`, verifies it is
still testing current main, builds the Vite client on Node 22, validates
`dist/index.html` and static asset bounds, then runs:

```sh
wrangler deploy --assets ./packages/client/dist --name sandline --compatibility-date 2026-10-12
```

GitHub PR workflows **never** publish. On a Fly host deployment, `host.yml`
updates the `SANDLINE_HOST` repository variable then dispatches **`ci.yml`**,
not the retired GitHub Pages workflow; that dispatch still runs all four gates.
If you keep Worker Builds active, it can independently deploy a failing
`main` commit before CI is finished; that is **not** CI-gated.

## Voice, credentials and private-repo considerations

- Fly's `VOICE_SITE_ORIGIN` remains the historical GitHub Pages origin in
  `fly.toml`; the already-implemented `VOICE_EXTRA_ORIGINS` can authorize
  the exact new `https://sandline.joshualray21.workers.dev` origin.
  Treat this as **live verification required**, not proof it is configured
  on the running Fly instance. After a tested transition, make the Worker
  the primary allowed origin and retire the old origin deliberately.
- Old GitHub Pages identity and submission tokens are browser-origin-local.
  Offer the consented migration from the phase-2 implementation before
  old Pages is unpublished; do not put tokens in URLs or repository files.
- The OAuth review callback remains on `sandline-host.fly.dev`, and its
  homepage can be updated to the Worker address. Ensure GitHub App/PAT
  permissions cover a private repository and that voice notifications
  continue. Never publish secrets or contributor audio.
- GitHub Free private Actions consumes the account's private runner-minutes
  allowance. The Worker site remains public; privatizing GitHub does not
  conceal browser-delivered JavaScript or remove historical public clones.

## Troubleshooting and rollback

- **deploy-worker skipped:** verify `CLOUDFLARE_WORKER_DEPLOY_ENABLED=true`
  under GitHub *Variables*; dispatch CI on `main`.
- **deploy-worker fails on token:** check `CLOUDFLARE_WORKERS_API_TOKEN`
  Worker Editor scope and the matching `CLOUDFLARE_ACCOUNT_ID`.
- **main advanced:** re-run CI on current main; never deploy a stale SHA.
- **No default multiplayer host:** `SANDLINE_HOST` must be the `wss://` Fly
  address at **build** time, not a value added later to the browser.
- **Voice 403:** inspect the Fly exact-origin allowlist and deployment; do not
  allow all origins or rotate the persisted contributor credentials.
- **Recover previous release:** restore the last known-good Worker version
  from Cloudflare's deployment history; keep the Fly volume untouched and
  fix the cause before the next CI release. If GitHub Actions deployment
  was not yet verified, leave the old GitHub Pages site available.

Official references: [Cloudflare Workers GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/),
[Worker permissions](https://developers.cloudflare.com/workers/authorization/workers/),
[Worker Builds](https://developers.cloudflare.com/workers/ci-cd/builds/).
