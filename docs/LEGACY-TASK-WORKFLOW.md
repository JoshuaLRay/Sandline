# Legacy milestone task workflow

Use only for an explicitly requested `T-` task in `TASKS.md`/`PLAN.md`.
The ongoing default queue is `BACKLOG.md`; this procedure does not override it.

Complete the next available task from `TASKS.md`.

## Procedure

1. **Read `/TASKS.md` first, and nothing else.** Do not open `PLAN.md` yet.
   Check the "Open now" block at the top first, then scan the milestone
   tables in order (M0 → M1 → M1.5 → M2 → …). Find the first task whose
   status is `OPEN` and whose `Depends` are all `DONE`.

2. **If the first open task with satisfied deps is marked 🧍:** stop. Do not
   implement it. See "Human gates" below.

3. **Open only that task's `PLAN.md` section** — the one named in `TASKS.md`
   next to it (e.g. "§7.5"). Do not read `PLAN.md` end to end and do not read
   sibling sections you don't need. Read the task's own `Depends` / `Files` /
   `Do` / `Done when` / `Size` block.

4. **Read the 🔒 ADRs the section names**, in `docs/adr/`. If the task's
   `Depends` list points at files from earlier tasks, skim those files to
   match existing patterns — don't re-read their PLAN.md history.

5. **Implement exactly that task's scope.** Its file list, its acceptance
   criteria, nothing adjacent. If the spec is underspecified or looks wrong,
   stop and report — do not guess or silently substitute a different
   approach for a 🔒 decision.

6. **Run `pnpm verify`.** It must exit 0.

7. **Walk each "Done when" criterion explicitly**, one at a time, and confirm
   it in your own words before moving on. A criterion you can't verify by
   running something is a criterion you haven't met.

8. **Append the CHANGELOG line.** One line in `docs/CHANGELOG.md`, format
   `T-<id> — <what changed>`, appended at the end (newest last).

9. **Flip the `TASKS.md` row** for that task from `OPEN` to `DONE` — same
   commit as the CHANGELOG line (PLAN.md §0.3 rule 7).

10. **Commit** as `T-<id>: <short description>`.

## Human gates — never close these yourself

A task marked 🧍 has a real acceptance criterion that is *feel*, not a test:
netcode responsiveness, camera, animation, audio, whether something reads as
good. You can make it compile and pass `pnpm verify`; you cannot judge it.

- **Never write a verdict yourself.** No simulated playtest, no invented
  "PASS", no filling in a run sheet's judgement sections as if a human sat
  through it.
- **If the task's run sheet doesn't exist yet** (check `docs/playtests/` for
  the file the task names), you *may* create the run sheet itself — the
  blank instrument the human will use — modeled on an existing prepared one.
  That is real, unblocked work. Do not fill in its verdict.
- **Stop and hand it to the owner.** Say which gate is next, whether its run
  sheet exists, and what — if anything — is still missing before a human can
  run it. Then look for the next non-🧍 open task instead, if one exists.

## Adapting scope mid-task

If, while implementing, you find the task's spec conflicts with a 🔒 decision
or an already-completed dependency's actual behavior, stop rather than
reconcile it silently. Report the conflict; let the owner decide.
