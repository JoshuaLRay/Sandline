# TASKS

> **Ongoing work after the slice:** [BACKLOG.md](BACKLOG.md) is now the default
> queue for “complete the next task”. This file retains legacy T-ID status and
> legacy acceptance records; request an explicit T-ID to use its old workflow.
> The ordering below applies to legacy milestone work only. No gate is closed by
> this routing change.

Status tracker for every leaf task in `PLAN.md`. One line each. This file is
the answer to legacy milestone status — read it for T-IDs, then only the one `PLAN.md`
section a task names. See `/CLAUDE.md` for the full routing rules.

Legend: **DONE** · **OPEN** (deps satisfied, not started) · **BLOCKED** (deps
unsatisfied) · 🧍 = real acceptance criterion is human feel, not a test · ⚠️ =
risk spike (failure is an acceptable, written-up outcome — PLAN.md §0.2).

---

## Owner acceptance and open work — 2026-10-09

The owner instructed: "Mark all human reviews as approved and mark appropriate
tasks as ready" and "Merge when green and create context transfer for the next
task." This is the acceptance source for existing implemented human review gates.
The approval records below do not claim a new playtest, listening session,
hardware measurement, deployment, or supplied voice recordings.

M2's six remaining gates, M3's four gates, M4's gate, the existing character and
weapon art reviews, and T-2.46's weapon-sound acceptance are approved. Their run
sheets retain the blank session and measurement fields; previously completed
human gates retain their original verdicts. T-5.08's human review is also
approved, while the task stays blocked by unfinished dependencies.

Remaining legacy work:

| Task | State | Remaining requirement |
|---|---|---|
| T-4.30 | BLOCKED | Explicit agreement to regional hosting cost |
| T-4.31 | BLOCKED | Two-region deployment and WebSocket replay verification |
| T-4.32 | BLOCKED | Staging drain/deploy run |
| 🧍 T-5.05 | OPEN | Select the existing lighting fallback or lightmaps |
| T-5.06 | OPEN | Finish close-quarters bounding and meet the scenario floors |
| 🧍 T-5.08 | BLOCKED | Human review approved; T-5.05 and T-5.06 remain open |

The ongoing queue and its READY status remain in [BACKLOG.md](BACKLOG.md).
General review approval does not select a new lighting architecture, authorize
hosting spend, or complete missing engineering and deployment evidence.

---

## M0 — Foundations (PLAN.md §5)

| Task | Status | Depends |
|---|---|---|
| T-0.01 | DONE | — |
| T-0.02 | DONE | T-0.01 |
| T-0.03 | DONE | T-0.01 |
| T-0.04 | DONE | T-0.02 |
| T-0.05 | DONE | T-0.03, T-0.04 |
| T-0.06 | DONE | T-0.02 |
| T-0.07 | DONE | T-0.02 |
| T-0.08 | DONE | T-0.02 |
| T-0.09 | DONE | T-0.02 |
| T-0.10 | DONE | T-0.09 |
| T-0.11 | DONE | T-0.08, T-0.10, T-0.14 |
| T-0.12 | DONE | T-0.11 |
| T-0.13 | DONE | — |
| T-0.14 | DONE | T-0.02 |

## M1 — Netcode prototype (PLAN.md §6)

| Task | Status | Depends |
|---|---|---|
| T-1.01 | DONE | T-0.02 |
| T-1.02 | DONE | T-1.01 |
| T-1.03 | DONE | T-1.02, T-0.09 |
| T-1.04 | DONE | T-1.03 |
| T-1.05 | DONE | T-1.04 |
| T-1.06 | DONE | T-1.05 |
| T-1.07 | DONE | T-1.06, T-0.07 |
| T-1.08 | DONE | T-1.06 |
| T-1.09 | DONE | T-1.07, T-1.08 |
| T-1.10 | DONE | T-1.09 |
| T-1.11 | DONE | T-1.05 |
| T-1.12 | DONE | T-0.10, T-0.14, T-1.11 |
| T-1.13 | DONE | T-1.12, T-1.09 |
| T-1.14 | DONE | T-1.13 |
| T-1.15 | DONE | T-1.14 |
| T-1.16 | DONE | T-1.13 |
| T-1.17 | DONE | T-1.12 |
| T-1.18 | DONE | T-1.17, T-1.16 |
| T-1.19 | DONE | T-1.18 |
| T-1.20 | DONE | T-1.09, T-1.14 |
| T-1.21 | DONE | T-1.07 |
| T-1.22 | DONE | T-1.20, T-1.21 |
| T-1.23 | DONE | T-1.15, T-1.16 |
| 🧍 T-1.24 | DONE | T-1.22, T-1.23 |

## M1.5 — Two humans, one session — CLOSED (PLAN.md §6A)

| Task | Status | Depends |
|---|---|---|
| T-1.5.01 | DONE | T-1.07, T-1.09, T-1.13 |
| T-1.5.02 | DONE | T-1.5.01, T-1.08 |
| 🧍 T-1.5.03 | DONE | T-1.5.02 |
| T-1.5.04 | DONE | T-1.5.01 |
| T-1.5.05 | DONE | T-1.5.04 |
| T-1.5.06 | DONE | T-1.5.05, T-1.5.02 |
| T-1.5.07 | DONE | T-1.5.05 |
| 🧍 T-1.5.08 | DONE | T-1.5.07, T-1.5.06, T-1.5.03 |

## M2 — Shooter feel (PLAN.md §7)

### E-2.1 — Third-person camera (§7.1) — closed, T-2.07 passed

| Task | Status | Depends |
|---|---|---|
| T-2.01 | DONE | — |
| T-2.02 | DONE | T-2.01 |
| T-2.03 | DONE | T-2.02 |
| T-2.04 | DONE | T-2.01 |
| T-2.05 | DONE | T-2.02, T-2.04 |
| T-2.06 | DONE | T-2.05 |
| 🧍 T-2.07 | DONE | T-2.01..T-2.06 |

### E-2.2 — Locomotion & character presentation (§7.2) — owner approved 2026-10-09

| Task | Status | Depends |
|---|---|---|
| T-2.17 | DONE | T-2.06, T-1.12 |
| T-2.18 | DONE (backfilled — see CHANGELOG) | T-2.17 |
| T-2.19 | DONE | T-2.18 |
| T-2.20 | DONE | T-2.17 |
| T-2.21 | DONE | T-2.20 |
| T-2.22 | DONE | T-2.19 |
| T-2.23 | DONE | T-2.21 |
| 🧍 T-2.24 | DONE — owner approved 2026-10-09 | T-2.17..T-2.23 |

### E-2.4 — Weapon feel (§7.3) — closed, T-2.12 passed

| Task | Status | Depends |
|---|---|---|
| T-2.08 | DONE | T-1.17, T-2.01 |
| T-2.09 | DONE | T-2.01 |
| T-2.10 | DONE | T-2.06 |
| T-2.11 | DONE | T-1.12, T-2.06 |
| 🧍 T-2.12 | DONE | T-2.08..T-2.11 |

### E-2.6 — Downed & revive (§7.4) — closed, T-2.16 passed

| Task | Status | Depends |
|---|---|---|
| T-2.13 | DONE | T-1.19, T-1.12 |
| T-2.14 | DONE | T-2.13, T-2.06 |
| T-2.15 | DONE | T-2.13 |
| 🧍 T-2.16 | DONE | T-2.13, T-2.14, T-2.15 |

### E-2.3 — Animation system (§7.5) — owner approved 2026-10-09

| Task | Status | Depends |
|---|---|---|
| T-2.25 | DONE | T-2.22, T-2.23 |
| T-2.26 | DONE | T-2.25 |
| T-2.27 | DONE | T-2.25 |
| T-2.28 | DONE | T-2.25 |
| 🧍 T-2.29 | DONE — owner approved 2026-10-09 | T-2.25..T-2.28 |

### E-2.5 — Projectile weapons (§7.6) — owner approved 2026-10-09

| Task | Status | Depends |
|---|---|---|
| T-2.30 | DONE | — |
| T-2.31 | DONE | T-2.30 |
| T-2.32 | DONE | T-2.31 |
| T-2.33 | DONE | T-2.32 |
| 🧍 T-2.34 | DONE — owner approved 2026-10-09 | T-2.30..T-2.33 |

### The soldier's look (§7.7) — owner approved 2026-10-09

| Task | Status | Depends |
|---|---|---|
| T-2.35 | DONE | — |
| T-2.36 | DONE | T-2.35 |
| T-2.37 | DONE | T-2.35 |
| T-2.38 | DONE | T-2.35 |
| 🧍 T-2.39 | DONE — owner approved 2026-10-09 | T-2.35..T-2.38 |

### E-2.7 — Combat audio (§7.10) — broken out 2026-09-23

Made in-house per `docs/adr/017-in-house-audio.md`: effects synthesised from
code and rendered offline, voices recorded by people and processed by code,
placed in the world with Web Audio. Claude cannot hear, so the owner listens
on the deployed site's sound board (`?sounds`, T-2.45).

| Task | Status | Depends |
|---|---|---|
| T-2.44 | DONE | — |
| T-2.45 | DONE | T-2.44 |
| T-2.46 | DONE — existing weapon-sound review and first-listening acceptance approved by owner 2026-10-09 | T-2.45 |
| T-2.47 | DONE | T-2.45 |
| T-2.48 | DONE — the pipeline is built and tested on generated signals; no recordings are uploaded yet (`docs/audio/voice-script.md`), so no lines are committed | T-2.44 |
| T-2.49 | DONE — heard as the radio chirp until recordings arrive | T-2.45, T-2.48 |
| 🧍 T-2.50 | DONE — owner approved 2026-10-09; voice recordings remain absent | T-2.46, T-2.47, T-2.49 |

### E-2.8 — Prone stance & voluntary crawl (§7.8) — owner approved 2026-10-09

Reopens ADR-002's prone exclusion; see `docs/adr/016-prone-stance.md`. Not
the downed crawl B-05 removed (that stays removed) — a voluntary stance for
a standing, alive soldier, built on the crouch (T-2.20) and crawl-gait
(E-2.6) groundwork.

| Task | Status | Depends |
|---|---|---|
| T-2.40 | DONE | T-2.20, T-2.13 |
| T-2.41 | DONE | T-2.40, T-2.06 |
| T-2.42 | DONE | T-2.40, T-2.41 |
| 🧍 T-2.43 | DONE — owner approved 2026-10-09 | T-2.40..T-2.42 |

---

## M3 — AI & squad command (PLAN.md §7.9) — broken out 2026-09-22

Broken out ahead of M2's exit gate at the owner's request; M2's rows above
still come first in scan order. Read §7.9's preamble (rules, scope calls)
once before the first M3 task — it is short and every task leans on it.

### E-3.1 — Navmesh pipeline

| Task | Status | Depends |
|---|---|---|
| ⚠️ T-3.01 | DONE | — |
| T-3.02 | DONE | — |
| T-3.03 | DONE | T-3.01, T-3.02 |
| T-3.04 | DONE | T-3.03 |

### E-3.2 — AI locomotion

| Task | Status | Depends |
|---|---|---|
| T-3.05 | DONE | T-3.04 |
| T-3.06 | DONE | T-3.05 |

### E-3.3 — Behaviour tree runtime

| Task | Status | Depends |
|---|---|---|
| T-3.07 | DONE | — |
| T-3.08 | DONE | T-3.07 |
| T-3.09 | DONE | T-3.08 |

### E-3.6 (entities) — Enemies exist before they think

| Task | Status | Depends |
|---|---|---|
| T-3.10 | DONE | T-3.08 |
| T-3.11 | DONE | T-3.10 |
| T-3.12 | DONE | T-3.10 |

### E-3.4 — Perception

| Task | Status | Depends |
|---|---|---|
| T-3.13 | DONE | T-3.07 |
| T-3.14 | DONE | T-3.13, T-3.10 |

### E-3.5 — Combat AI

| Task | Status | Depends |
|---|---|---|
| T-3.15 | DONE | T-3.10, T-3.13 |
| T-3.16 | DONE | T-3.15 |
| T-3.17 | DONE | T-3.16 |
| T-3.18 | DONE | T-3.04 |
| T-3.19 | DONE | T-3.18, T-3.13 |
| T-3.20 | DONE | T-3.05, T-3.14, T-3.15, T-3.19 |
| T-3.21 | DONE | T-3.20, T-3.16, T-3.06 |
| T-3.22 | DONE | T-3.20 |

### E-3.6 — Enemy archetypes (slice set: rifleman, MG — ADR-015)

| Task | Status | Depends |
|---|---|---|
| T-3.23 | DONE | T-3.21, T-3.22 |
| 🧍 T-3.24 | DONE — owner approved 2026-10-09 | T-3.11, T-3.17, T-3.23 |

### E-3.7 — Friendly bot

| Task | Status | Depends |
|---|---|---|
| T-3.25 | DONE | T-3.06, T-3.08 |
| T-3.26 | DONE | T-3.25, T-3.20 |

### E-3.8 — Order system

| Task | Status | Depends |
|---|---|---|
| T-3.27 | DONE | T-3.08 |
| T-3.28 | DONE | T-3.27, T-3.26, T-3.19 |
| T-3.29 | DONE | T-3.27 |
| 🧍 T-3.30 | DONE — owner approved 2026-10-09 | T-3.11, T-3.25, T-3.26, T-3.28, T-3.29 |

### E-3.9 — AI director and the grey-box mission

| Task | Status | Depends |
|---|---|---|
| T-3.31 | DONE | T-3.02, T-3.04, T-3.18 |
| T-3.32 | DONE | T-3.10, T-3.31 |
| T-3.33 | DONE | T-3.32, T-3.14 |
| T-3.34 | DONE | T-3.31, T-3.32 |
| T-3.35 | DONE | T-3.23, T-3.28, T-3.33, T-3.34 |
| 🧍 T-3.36 | DONE — owner approved 2026-10-09 | T-3.24, T-3.30, T-3.35 |
| 🧍 T-3.37 | DONE — owner approved 2026-10-09; no new six-person measurements claimed | T-3.35 |

---

## M4 — Content pipeline & the full slice (PLAN.md §7.11) — broken out 2026-09-24

Broken out ahead of M3's exit gate at the owner's request; everything above
still comes first in scan order, and T-4.34 is not reached before M3's gate
is passed. Read §7.11's preamble (rules, what exists, order of work) once
before the first M4 task. Two rows are the owner's decisions, not agent
work: **T-4.01** (art sourcing) is decided — ADR-018, art authored as code
with procedural animation — and so is **T-4.21** (where progress lives):
ADR-019, on the host, per campaign. ADR-019's storage is the owner's (SQLite on a Fly
volume, its addendum); its identity and privacy lines are agent defaults
the owner may still overrule before T-4.23.

### E-4.1 — Asset pipeline

| Task | Status | Depends |
|---|---|---|
| 🧍 T-4.01 | DONE — option A, art authored as code (ADR-018) | — |
| T-4.02 | DONE | — |
| T-4.03 | DONE | T-4.02 |
| T-4.04 | DONE | T-4.01, T-4.02 |

### E-4.2 — Runtime loading, streaming, LOD, budgets

| Task | Status | Depends |
|---|---|---|
| T-4.05 | DONE | T-4.02 |
| T-4.06 | DONE | T-4.05 |
| T-4.07 | DONE | T-4.05 |
| T-4.08 | DONE — the detailed soldier (ADR-020); owner review approved 2026-10-09 | T-4.01, T-4.05 |
| T-4.35 | DONE — the enemy fighter; owner review approved 2026-10-09 | T-4.08 |
| T-4.36 | DONE — period weapons; owner review approved 2026-10-09 | T-4.08 |

### E-4.3 — Level format, kit, lightmaps

| Task | Status | Depends |
|---|---|---|
| T-4.09 | DONE | — |
| T-4.10 | DONE | T-4.04, T-4.09 |
| T-4.11 | DONE | T-4.09 |
| ⚠️ T-4.12 | DONE | T-4.09, T-4.10 |
| T-4.13 | DONE | T-4.10, T-4.11, T-4.14 |

### E-4.4 — Mission scripting

| Task | Status | Depends |
|---|---|---|
| T-4.14 | DONE | — |
| T-4.15 | DONE | T-4.14 |
| T-4.16 | DONE | T-4.14 |
| T-4.17 | DONE | T-4.14, T-3.35 |

### E-4.5 — Matchmaking, parties, regions, reconnect, invites

| Task | Status | Depends |
|---|---|---|
| T-4.18 | DONE | — |
| T-4.19 | DONE | T-4.14 |
| T-4.20 | DONE | T-4.30, T-4.31 |

### E-4.6 — Persistence

| Task | Status | Depends |
|---|---|---|
| 🧍 T-4.21 | DONE — on the host (ADR-019) | — |
| T-4.22 | DONE | T-4.21 |
| T-4.23 | DONE | T-4.21, T-4.22, T-4.16 |
| T-4.24 | DONE | T-4.22, T-4.23 |

### E-4.7 — HUD, menus, class selection, scoreboard

| Task | Status | Depends |
|---|---|---|
| T-4.25 | DONE | — |
| T-4.26 | DONE | T-4.25 |
| T-4.27 | DONE | — |
| T-4.28 | DONE | T-4.25 |

### E-4.8 — Vehicles (the mounted MG only, §4.1)

| Task | Status | Depends |
|---|---|---|
| T-4.29 | DONE | — |

### E-4.9 — Deployment, multi-region

| Task | Status | Depends |
|---|---|---|
| T-4.30 | BLOCKED — addendum written (ADR-011); the owner's agreement of its cost is what is left | — |
| T-4.31 | BLOCKED — built and tested with fake peers and two real hosts; the two-region deploy is the owner's | T-4.30 |
| T-4.32 | BLOCKED — built and tested on a fake clock; the staging run is the owner's | T-4.31 |
| T-4.33 | DONE | — |

### M4 exit gate

| Task | Status | Depends |
|---|---|---|
| 🧍 T-4.34 | DONE — owner approved 2026-10-09 | T-4.13, T-4.17, T-4.23, T-4.25, T-4.26, T-4.27, T-4.29 |

---

## M5 — Vertical slice (PLAN.md §7.12, broken out 2026-09-26)

Broken out at the owner's request, ahead of the M3 and M4 gates. It does not
jump the queue: those gates come first, and T-5.08 is not reached before
T-4.34 is passed.

| Task | Status | Depends |
|---|---|---|
| T-5.01 | DONE | — |
| T-5.02 | DONE | T-5.01 |
| T-5.03 | DONE | — |
| T-5.04 | DONE — fps on target hardware waits on the owner opening `?perf` there | — |
| 🧍 T-5.05 | OPEN — the owner's decision (T-4.12's fallback or lightmaps) | — |
| T-5.06 | OPEN — cover under fire landed (60% / 20% with the clearing leader); bounding and the walk-in floors remain | B-11 |
| T-5.07 | DONE | T-5.03 |
| 🧍 T-5.08 | BLOCKED — human review owner-approved 2026-10-09; T-5.05 lighting decision and T-5.06 engineering remain open | T-5.01..T-5.07, T-4.34 |
