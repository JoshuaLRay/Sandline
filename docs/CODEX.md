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

Codex loads the root `AGENTS.md` automatically, plus any nested `AGENTS.md` on
the path to the directory it works in (for example `packages/shared/AGENTS.md`).
That file is the single shared brief; `CLAUDE.md` only imports it for Claude
Code, so there is one copy of the rules. Codex does not read `CLAUDE.md`.

The procedures are skills in `.agents/skills/` (`next-task`, `report-feedback`,
`next-task-context-transfer-text-box`), which Codex discovers by their
descriptions. Plain prompts route to them; see the prompt table in
[WORKFLOW.md](WORKFLOW.md):

> Complete the next task for JoshuaLRay/Sandline.

> Queue the next Conflict parity gap.

Codex's whole instruction budget is 32 KiB across all `AGENTS.md` files, so keep
`AGENTS.md` short and put depth in linked documents. If a Codex cloud task cannot
watch CI or merge, it stops at a locally verified PR and says what remains.
