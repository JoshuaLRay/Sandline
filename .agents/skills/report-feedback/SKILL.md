---
name: report-feedback
description: Record a Sandline bug report, playtest observation, suggestion or Conflict-parity feature request as backlog cards before any gameplay change, then ask whether to implement it now (unless the user already said to fix/build it). Use when the user gives feedback, the repo URL plus an observation, or asks to queue a Conflict feature.
---

# Record feedback, then ask

The feedback is the user's message (Claude passes it as `$ARGUMENTS`). Recording
it does not authorize gameplay changes, completion claims or merges.

1. Fetch `origin/main` and preserve unrelated work. Search `BACKLOG.md`, its
   cards, `docs/backlog/archive/`, matching `docs/BUGS.md` entries and open PRs
   for the same behavior; read only the matches. A prior fix does not
   invalidate a newly observed regression.
2. Capture it faithfully: the user's symptom and desired outcome, date/source,
   repro details if given, UNKNOWN for the rest. Separate observation from
   suspected cause. Do not demand a perfect repro before recording.
3. Extend an existing active card instead of duplicating. A regression of a DONE
   task gets a new linked U-ID. Split several requests into focused leaves under
   an epic. Use `docs/backlog/TEMPLATE.md` (pillar, size, read-first list, where
   the human verdict is batched). Allocate the next unused U-ID across the
   active table, the archive and open PRs; recheck the remote before pushing.
4. Conflict-parity requests: describe what the series did (see
   `docs/design/CONFLICT-PARITY.md`, ADR-021) and how it adapts to six soldiers
   and online co-op; then update that gap's row in the parity tracker to point
   at the new card.
5. Add rows to `BACKLOG.md` with priority, order, dependencies and status: READY
   only with bounded scope and observable acceptance; INBOX if it still needs
   decomposition; BLOCKED for a concrete missing asset/decision/dependency. A
   decision blocker gets a "Decision needed" section with options and a
   recommended default, and the row says `Decision: … — default: …`.
   Label small reversible defaults as proposals; never silently decide a
   conflicting ADR, recording source, purchase or skill.
6. Save before asking. Push a `feedback/<short-name>` branch and open a docs-only
   PR (reuse an open intake PR if there is one). It merges with owner
   authorization; if push or access fails, give the exact saved path and branch
   and never say the shared queue was updated.
7. Report the new or updated IDs and ask: **"Do you want me to complete U-NNN
   now, or leave it in the backlog?"** For several reports, recommend the first
   actionable one. If the user already said "fix / build / do it now", that is
   the answer: for a single focused report, put the card and the
   implementation in **one** task PR under the next-task skill (no separate
   intake PR); for several, keep intake separate and implement the named one.

A status-only question is not a new feedback report.
