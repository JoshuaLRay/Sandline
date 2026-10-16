# Voice contributor origin cutover

This is migration phase 2 of [PRIVATE-REPO-MIGRATION.md](PRIVATE-REPO-MIGRATION.md).
The existing Fly app and its `sandline_data` volume remain the authority for all recordings and campaign/player saves.

## Safe configuration order

1. Deploy the updated Fly server from `packages/server/src/voice/intake.ts` and `packages/server/src/main.ts` **without changing** the existing `VOICE_SITE_ORIGIN=https://joshualray.github.io`. Old voice contributors continue working.
2. When the actual Cloudflare Pages site origin is known, set `VOICE_EXTRA_ORIGINS` to the **exact HTTPS origin**. Example only (if assigned): `VOICE_EXTRA_ORIGINS=https://sandline.pages.dev`. Set this in `fly.toml` under `[env]` in a separate configuration PR, or use Fly's runtime secret configuration if appropriate; then redeploy in a quiet playtest window.
3. Confirm preflight, audio submission, restoration and unauthorized-origin rejection from the old and new sites. No wildcard CORS or URL paths.
4. Update the GitHub OAuth App **Homepage URL** to the new Cloudflare site. Keep its callback `https://sandline-host.fly.dev/voice-review/callback`, its client secret in Fly secrets, and `VOICE_REVIEW_ORIGIN=https://sandline-host.fly.dev`.
5. Before the old site is unpublished, separately provide a consented transfer of origin-scoped player identity and any existing unfinished voice submission credentials that must be retained. **This server allowlist alone does not migrate browser localStorage.**
6. Only after final acceptance, change `VOICE_SITE_ORIGIN` to the new origin, remove `VOICE_EXTRA_ORIGINS` and redeploy. Removing the old origin is a security requirement, not optional cleanup.

## Config contract

- `VOICE_SITE_ORIGIN`: required canonical primary HTTP(S) origin.
- `VOICE_EXTRA_ORIGINS`: optional comma-separated set of additional canonical origins, at most two more. It has no effect when unset, leaving behavior unchanged.
- Scheme, host, port and absence of path/query/fragment must match; any invalid origin fails startup. Never use `*`.
- CORS allows only one exact approved response Origin per request and sends `Vary: Origin`; requests with a different nonempty Origin receive HTTP 403.
- `VOICE_INTAKE_DIR` and `VOICE_SITE_ORIGIN` must be configured together as before; `VOICE_EXTRA_ORIGINS` by itself fails startup.
- `VOICE_REVIEW_ORIGIN` is **separate** from these settings: owner review runs on the same Fly origin and uses host-only cookies.

## Acceptance

- Both approved origins get successful OPTIONS responses with only their own `Access-Control-Allow-Origin`.
- Hostname lookalikes, `null`, wildcards, malformed sites and third-party origins are rejected.
- Two authorized sites can create submissions; contributor bearer token restrictions, name privacy, file limits, consent and recording access remain intact.
- Owner login, playback and GitHub `repository_dispatch` continue to work.
- Existing Fly `/data` remains mounted and no persistent files are reset.

Automated tests: `pnpm --filter @sandline/server test` if present, otherwise `pnpm exec vitest run packages/server/src/voice/intake.test.ts`. The repository-level `pnpm verify` and all four CI jobs remain required.
