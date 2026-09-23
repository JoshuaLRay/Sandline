# TASKS

Status tracker for every leaf task in `PLAN.md`. One line each. This file is
the answer to "what's next" — read it first, and read only the one `PLAN.md`
section a task names. See `/CLAUDE.md` for the full routing rules.

Legend: **DONE** · **OPEN** (deps satisfied, not started) · **BLOCKED** (deps
unsatisfied) · 🧍 = real acceptance criterion is human feel, not a test · ⚠️ =
risk spike (failure is an acceptable, written-up outcome — PLAN.md §0.2).

---

## Open now

| Task | What | Run sheet | Depends | PLAN.md § |
|---|---|---|---|---|
| 🧍 T-2.24 | E-2.2 sign-off (locomotion) | `docs/playtests/e2-2.md` — exists, prepared, not run | T-2.17..T-2.23 (all done) | §7.2 |
| 🧍 T-2.29 | E-2.3 sign-off (animation layers) | `docs/playtests/e2-3.md` — **missing** | T-2.25..T-2.28 (all done) | §7.5 |
| 🧍 T-2.34 | E-2.5 sign-off (projectiles) | `docs/playtests/e2-5.md` — **missing** | T-2.30..T-2.33 (all done) | §7.6 |
| 🧍 T-2.39 | Soldier's-look sign-off | `docs/playtests/soldier-look.md` — exists, prepared, not run | T-2.35..T-2.38 (all done) | §7.7 |
| 🧍 T-2.43 | E-2.8 sign-off (prone) | `docs/playtests/e2-8.md` — exists, prepared, not run | T-2.40..T-2.42 (all done) | §7.8 |

All five gates' build dependencies are satisfied. All five need the owner in
the room with another human — an agent cannot close any of them, and must
never fabricate a verdict or simulate the playtest to get one.

**If nothing here is actionable** (no human available): E-2.8's build tasks
are done (T-2.42 landed 2026-09-22), so its gate T-2.43 is open too; its
run sheet `e2-8.md` is prepared. Writing the two missing run sheets
(`e2-3.md`, `e2-5.md`), modeled on `e2-2.md` and `soldier-look.md`, is real unblocked work an agent can do
— it does not require a human, only requires not inventing a verdict inside
it. Past that, **E-2.7** (combat audio, PLAN.md §7 epic table) needs breaking
out into leaf tasks and is blocked on an assets sourcing decision (R1, §9
Q2 — purchased/commissioned/in-house).

**M3 is broken out** (PLAN.md §7.9). E-3.1's navmesh pipeline is done:
T-3.01 (the Recast spike), T-3.02 (named worlds), T-3.03 (the range baked
and committed, with a staleness hash) and T-3.04 (vault links); E-3.2 is
done too — path following (T-3.05) and local avoidance (T-3.06), and so is
the behaviour tree runtime (T-3.07), and brains tick on the session
(T-3.08), with an AI debug view on B (T-3.09), and enemies exist as
entities (T-3.10) drawn in the page (T-3.11, `?enemies` for eyes). The
next build tasks are **T-3.12** (interest management), **T-3.13** (perception),
**T-3.18** (cover points in the bake) and **T-3.27** (orders on the wire).

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

### E-2.2 — Locomotion & character presentation (§7.2) — awaiting T-2.24

| Task | Status | Depends |
|---|---|---|
| T-2.17 | DONE | T-2.06, T-1.12 |
| T-2.18 | DONE (backfilled — see CHANGELOG) | T-2.17 |
| T-2.19 | DONE | T-2.18 |
| T-2.20 | DONE | T-2.17 |
| T-2.21 | DONE | T-2.20 |
| T-2.22 | DONE | T-2.19 |
| T-2.23 | DONE | T-2.21 |
| 🧍 T-2.24 | OPEN | T-2.17..T-2.23 |

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

### E-2.3 — Animation system (§7.5) — awaiting T-2.29

| Task | Status | Depends |
|---|---|---|
| T-2.25 | DONE | T-2.22, T-2.23 |
| T-2.26 | DONE | T-2.25 |
| T-2.27 | DONE | T-2.25 |
| T-2.28 | DONE | T-2.25 |
| 🧍 T-2.29 | OPEN — run sheet `e2-3.md` missing, write it first | T-2.25..T-2.28 |

### E-2.5 — Projectile weapons (§7.6) — awaiting T-2.34

| Task | Status | Depends |
|---|---|---|
| T-2.30 | DONE | — |
| T-2.31 | DONE | T-2.30 |
| T-2.32 | DONE | T-2.31 |
| T-2.33 | DONE | T-2.32 |
| 🧍 T-2.34 | OPEN — run sheet `e2-5.md` missing, write it first | T-2.30..T-2.33 |

### The soldier's look (§7.7) — awaiting T-2.39

| Task | Status | Depends |
|---|---|---|
| T-2.35 | DONE | — |
| T-2.36 | DONE | T-2.35 |
| T-2.37 | DONE | T-2.35 |
| T-2.38 | DONE | T-2.35 |
| 🧍 T-2.39 | OPEN | T-2.35..T-2.38 |

### E-2.7 — Combat audio — not broken out yet

Still an epic (PLAN.md §7 epic table). Blocked on an art/audio sourcing
decision (R1, §9 Q2) before it can be split into leaf tasks.

### E-2.8 — Prone stance & voluntary crawl (§7.8) — awaiting T-2.43 (run sheet ready)

Reopens ADR-002's prone exclusion; see `docs/adr/016-prone-stance.md`. Not
the downed crawl B-05 removed (that stays removed) — a voluntary stance for
a standing, alive soldier, built on the crouch (T-2.20) and crawl-gait
(E-2.6) groundwork.

| Task | Status | Depends |
|---|---|---|
| T-2.40 | DONE | T-2.20, T-2.13 |
| T-2.41 | DONE | T-2.40, T-2.06 |
| T-2.42 | DONE | T-2.40, T-2.41 |
| 🧍 T-2.43 | OPEN — run sheet `e2-8.md` prepared, not run | T-2.40..T-2.42 |

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
| T-3.12 | OPEN | T-3.10 |

### E-3.4 — Perception

| Task | Status | Depends |
|---|---|---|
| T-3.13 | OPEN | T-3.07 |
| T-3.14 | BLOCKED | T-3.13, T-3.10 |

### E-3.5 — Combat AI

| Task | Status | Depends |
|---|---|---|
| T-3.15 | BLOCKED | T-3.10, T-3.13 |
| T-3.16 | BLOCKED | T-3.15 |
| T-3.17 | BLOCKED | T-3.16 |
| T-3.18 | OPEN | T-3.04 |
| T-3.19 | BLOCKED | T-3.18, T-3.13 |
| T-3.20 | BLOCKED | T-3.05, T-3.14, T-3.15, T-3.19 |
| T-3.21 | BLOCKED | T-3.20, T-3.16, T-3.06 |
| T-3.22 | BLOCKED | T-3.20 |

### E-3.6 — Enemy archetypes (slice set: rifleman, MG — ADR-015)

| Task | Status | Depends |
|---|---|---|
| T-3.23 | BLOCKED | T-3.21, T-3.22 |
| 🧍 T-3.24 | BLOCKED — run sheet `e3-5.md` to be written first | T-3.11, T-3.17, T-3.23 |

### E-3.7 — Friendly bot

| Task | Status | Depends |
|---|---|---|
| T-3.25 | BLOCKED | T-3.06, T-3.08 |
| T-3.26 | BLOCKED | T-3.25, T-3.20 |

### E-3.8 — Order system

| Task | Status | Depends |
|---|---|---|
| T-3.27 | OPEN | T-3.08 |
| T-3.28 | BLOCKED | T-3.27, T-3.26, T-3.19 |
| T-3.29 | BLOCKED | T-3.27 |
| 🧍 T-3.30 | BLOCKED — run sheet `e3-8.md` to be written first | T-3.11, T-3.25, T-3.26, T-3.28, T-3.29 |

### E-3.9 — AI director and the grey-box mission

| Task | Status | Depends |
|---|---|---|
| T-3.31 | BLOCKED | T-3.02, T-3.04, T-3.18 |
| T-3.32 | BLOCKED | T-3.10, T-3.31 |
| T-3.33 | BLOCKED | T-3.32, T-3.14 |
| T-3.34 | BLOCKED | T-3.31, T-3.32 |
| T-3.35 | BLOCKED | T-3.23, T-3.28, T-3.33, T-3.34 |
| 🧍 T-3.36 | BLOCKED — run sheet `m3-solo.md` to be written first | T-3.24, T-3.30, T-3.35 |
| 🧍 T-3.37 | BLOCKED — run sheet `m3-six.md` to be written first; needs six people | T-3.35 |

---

## M4–M5

Epics only, not broken out — see PLAN.md §7 (epic tables) and §4 (milestone
table). Nothing here is a task an agent can pick up; they get leaf tasks at
their own planning gate (§0.5).
