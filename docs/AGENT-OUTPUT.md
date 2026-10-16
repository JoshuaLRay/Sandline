# Bounded agent output and measurement (Phase 4)

On-demand operational reference. [AGENTS.md](../AGENTS.md) retains the
mandatory tests, human gates and four latest-head CI checks. Shorter
**responses** do not mean fewer checks or shorter diagnostic evidence.

## Command output

For noisy automated commands, run from the repository root:

```sh
pnpm agent:run -- pnpm verify
pnpm agent:run -- pnpm sim-run --scenario mission --seeds 20
```

The wrapper executes the requested command without a shell, captures its
complete stdout/stderr in ignored local `.agent-logs/<unique>.log`, and
returns the **same exit code** (or nonzero for an execution error).
On success it prints command, PASS, exit, duration, local log path and at
most three recognized test counter lines. On failure it prints FAIL,
the real exit, duration, the full log path and a bounded excerpt including
an early diagnostic and the final lines. It never reinterprets failing
checks as green. The full log remains available for targeted inspection.
Run ordinary commands directly if interaction/live output is required;
do not wrap a long-running server or a command needing prompts.

For failure triage, inspect the actual error and surrounding evidence in
the saved log, then rerun a relevant focused test. An excerpt is a
**navigation aid**, not complete proof; do not guess a fix from truncation.
Avoid sending credentials in command arguments or capturing sensitive
content in logs; logs are local and not committed.

## Diff and source reads

1. Use `git status --short`, `git diff --stat` and
   `git diff --name-only` first. For staged changes, add `--cached`.
2. Inspect individual changed files or symbol-bounded hunks
   (`git diff -- packages/tools/src/file.ts` or `rg -n 'pattern' file`).
3. Fetch the full patch only for a correctness concern requiring it.
   Never omit review of a risky changed hunk just to save context.
4. Summarize changed paths and substantive behavior, not a pasted
   thousands-line diff. Keep generated outputs and all required proof
   artifacts; this convention controls **agent-visible text**, not commits.

## CI: short summary, complete decision evidence

Fetch the PR's *current* head SHA, mergeability and current main before
looking at its **pull_request** workflow run. Read job metadata before logs.
Report each of `verify`, `streaming`, `parity-non-v8`, and `mission` with
job name, status/conclusion, run number/id and head SHA. On a failure,
retrieve the failed step and relevant full log section; preserve the log
link. Never infer success from a combined GitHub status that omits jobs.
If the checked SHA is stale or main advanced, sync and rerun **all four**
before merging. Treat pending, skipped, cancelled, missing, failed or
stale jobs as **not mergeable**, even if other jobs succeed. Use the PR
head guard `expected_head_sha` on merge; confirm merged PR and main commit.
Unrelated conditional jobs (such as a deliberately skipped deployment)
do not substitute for the four named required jobs.

## Measurement protocol: evidence before claims

The unit of comparison is one *comparable agent task start*; the following
are distinct measurements, **not interchangeable proxies**:

| Signal | Collection method | Interpretation |
|---|---|---|
| Input tokens before first edit | Agent/session telemetry, with model, config and task category | Actual startup context cost |
| Total task tokens | Same telemetry after task | Detect downstream rework/shift |
| Files retrieved and bytes | Tool logs or explicit read trace | Context retrieval volume, **not tokens** |
| Tool calls / elapsed selection time | Tool trace with timestamps | Workflow overhead, not direct token cost |
| Handoff tokens | Model tokenizer/telemetry with version | Actual handoff size; word count is a proxy |
| Wrong claims, blockers, regressions, test failures | PR and task-card evidence | Correctness guardrail |

Take matched before/after samples for at least a simple feature, a bug and a
large map or multiplayer task, with the **same agent/model/config** wherever
possible. Preserve the prompt, commit, selected card, measurement window,
tool availability, test/CI result, and retry count. Report unmatched cases
separately; never cherry-pick only fast/successful runs. Do not send private
prompts, tokens, or credentials into public issues. If telemetry is
unavailable, write **not collected**; do not estimate input tokens by dividing
bytes or words. Do not claim an overall percentage without a paired sample
and a correctness comparison.

### Verified structural baseline (not token telemetry)

| Snapshot | Git commit | Shared entry bytes | How measured |
|---|---|---:|---|
| Before Phase 3 | `b0ecb69b2a94f983497332d88ebe7a475e8d4e84` | 10,862 | UTF-8 bytes of `AGENTS.md` |
| After Phase 3 / before Phase 4 | `7e6481a7979c307f5e487261aeff7ba50b969028` | 6,070 | UTF-8 bytes of `AGENTS.md` |

The reduction is **4,792 bytes (44.1%)**, not a measured token reduction.
The baseline plan's file-size observations were approximate and are not
session usage measurements. The Phase 4 run had no available per-session
input/total-token telemetry or genuinely paired historical task starts,
so **actual token savings, end-to-end time savings, tool-call reductions
and task correctness deltas are not collected**. Once real samples are
available, append results with source/method; retain this baseline.

### Measurement record template (leave unknowns explicit)

| Pair / category | Before/after commit | Agent+model/config | Input tokens before edit | Total task tokens | Files/bytes retrieved | Tool calls / selection duration | Handoff tokens | Claim/blocker errors | Tests/CI and retries |
|---|---|---|---|---|---|---|---|---|---|
| Simple feature | not collected | not collected | not collected | not collected | not collected | not collected | not collected | not collected | not collected |
| Bug fix | not collected | not collected | not collected | not collected | not collected | not collected | not collected | not collected | not collected |
| Map/multiplayer | not collected | not collected | not collected | not collected | not collected | not collected | not collected | not collected | not collected |

## Regression/failure scenarios to preserve

- A failing test near the beginning of a huge log must remain findable;
  the tail alone is insufficient and the full log must survive.
- A spawned command returning nonzero (or failing to start) must not
  produce PASS or a successful process exit.
- Successful logging must not remove test counts from diagnostics or
  suppress the original log.
- A shortened diff must not hide a relevant changed file from review.
- A skipped/pending/missing/old-SHA CI job must never count as success.
- A sample lacking telemetry must never be reported as measured tokens.

The tool unit tests enforce the bounded output/full-log/exit behaviors.
The agent documentation contract test ensures this reference stays linked
and protects the no-fake-token-claims and CI wording.
