Record Sandline feedback from $ARGUMENTS or the user's message, then ask whether
to implement it. This workflow also applies without the slash command.

1. Confirm the repository/branch and preserve unrelated work. Read `BACKLOG.md`;
   search its cards, relevant `docs/BUGS.md` entries and open PRs for the same
   behavior. Read only matching entries. A prior FIXED label does not invalidate
   a new observed regression.
2. Capture the report immediately in documentation. Preserve the user's actual
   symptom and desired outcome, source/date, repro details if supplied, and mark
   unknowns honestly. Do not demand a perfect repro before recording it. Separate
   observation from a suspected cause; do not label an uninvestigated cause proven.
3. Update an existing matching active card rather than duplicate it. For a new
   regression against a DONE task, create a new linked U-ID with the old fix noted.
   Split multiple requests into focused leaves under epic labels. Use
   `docs/backlog/TEMPLATE.md`; allocate stable next-unused U IDs across active,
   pending PR and archived work. Recheck remote IDs before push to avoid collisions.
4. Add rows to `BACKLOG.md` with proposed priority/order, dependencies and status.
   Use READY only with bounded scope and observable acceptance criteria; use
   INBOX for work still needing decomposition and BLOCKED for a concrete missing
   asset/decision/dependency. Small reversible defaults can be labelled proposals;
   never silently decide a conflicting ADR, recording source, purchase or skill.
   Card status is not duplicated elsewhere. Link relevant legacy reports.
5. Save the documentation before asking about gameplay implementation. Commit and
   push a focused `feedback/...` branch and open/update a docs-only PR when GitHub
   is available; reuse the relevant intake PR if one already exists. Apply existing
   owner merge authorization only if present and checks permit. Otherwise explain
   that the report is recorded in the PR and awaits merging into the default queue.
   If push/access is blocked, give the exact saved path/branch and limitation;
   never say the shared queue was updated when it wasn't.
6. Briefly report the new/updated IDs and ask: **“Do you want me to complete
   U-NNN now, or leave it in the backlog?”** For several reports, recommend the
   first actionable one and show the other IDs. If the user already explicitly
   requested “fix/implement/complete this now”, that is the answer: record first,
   then execute `.claude/commands/next-task.md` for the named task without asking
   the same permission again. The implementation needs its own focused PR when
   the intake contains unrelated reports.

Intake itself does not authorize gameplay code changes, marking work complete,
or silently merging. A status-only question is not a new feedback report.
