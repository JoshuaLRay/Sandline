# Sandline in Codex

## Connect the repository

Open https://chatgpt.com/codex in a browser while signed into the same OpenAI
account as the ChatGPT iOS app. Connect GitHub if prompted and grant Codex access
to `JoshuaLRay/Sandline`. The GitHub connection in a regular chat is separate
from selecting a repository for a Codex cloud environment.

In Codex's environment settings, create an environment for
`JoshuaLRay/Sandline`, named **Sandline**. Select `main` when starting a task.
Use a Node 22 (or newer) runtime and this setup script:

```sh
set -eu
node --version
corepack enable
corepack pnpm install --frozen-lockfile
```

`package.json` pins pnpm to 10.33.0. If the runtime lacks Corepack, install that
exact pnpm version in the environment before running the setup script. Allow
GitHub and the npm registry during setup. This project needs no secrets for
local tests. Browser checks additionally need Playwright's browsers and system
libraries; `.github/workflows/ci.yml` contains the full CI setup.

Run `corepack pnpm verify` as the environment smoke check. For a local game,
run `corepack pnpm host` and `corepack pnpm --filter @sandline/client dev` in
separate terminals.

Once saved, open Codex in the iOS app and select the Sandline environment or
repository when starting a task. Menu labels and mobile availability can vary
by app version and account; if the selector is unavailable there, use Codex in
Safari with the same account. A repository URL pasted into a chat does not by
itself create a saved environment. These instructions prepare the repository;
the account-side environment still needs to be saved in Codex's UI.

## Project instructions and prompts

`AGENTS.md` directs Codex to the existing repository workflow. Keep
`CLAUDE.md` as the shared engineering brief rather than maintaining two copies
of the task rules.

For the newly requested squad controls:

> Complete U-099 for JoshuaLRay/Sandline. Preserve existing collision and
> prediction rules, verify the character-separation edge cases, and deliver a
> tested PR. Do not merge it.

Then complete U-100 (spread), followed by U-101 (aggression) once their
dependencies are merged. These controls are separate from U-087's bounding
and focus-fire experiments. The owner approved Hold fire, Defensive and
Aggressive aggression presets on 2026-10-03.
