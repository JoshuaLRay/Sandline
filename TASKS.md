# TASKS

Status tracker for every leaf task in `PLAN.md`. One line each. This file is
the answer to "what's next" — read it first, and read only the one `PLAN.md`
section a task names. See `/CLAUDE.md` for the full routing rules.

Legend: **DONE** · **OPEN** (deps satisfied, not started) · **BLOCKED** (deps
unsatisfied) · 🧍 = real acceptance criterion is human feel, not a test.

---

## Open now

| Task | What | Run sheet | Depends | PLAN.md § |
|---|---|---|---|---|
| 🧍 T-2.24 | E-2.2 sign-off (locomotion) | `docs/playtests/e2-2.md` — exists, prepared, not run | T-2.17..T-2.23 (all done) | §7.2 |
| 🧍 T-2.29 | E-2.3 sign-off (animation layers) | `docs/playtests/e2-3.md` — **missing** | T-2.25..T-2.28 (all done) | §7.5 |
| 🧍 T-2.34 | E-2.5 sign-off (projectiles) | `docs/playtests/e2-5.md` — **missing** | T-2.30..T-2.33 (all done) | §7.6 |
| 🧍 T-2.39 | Soldier's-look sign-off | `docs/playtests/soldier-look.md` — exists, prepared, not run | T-2.35..T-2.38 (all done) | §7.7 |

All four gates' build dependencies are satisfied. All four need the owner in
the room with another human — an agent cannot close any of them, and must
never fabricate a verdict or simulate the playtest to get one.

**If nothing here is actionable** (no human available): writing the two
missing run sheets (`e2-3.md`, `e2-5.md`), modeled on `e2-2.md` and
`soldier-look.md`, is real unblocked work an agent can do — it does not
require a human, only requires not inventing a verdict inside it. Past that,
the next build work is **E-2.7** (combat audio, PLAN.md §7 epic table), which
needs breaking out into leaf tasks and is blocked on an assets sourcing
decision (R1, §9 Q2 — purchased/commissioned/in-house).

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

---

## M3–M5

Epics only, not broken out — see PLAN.md §7 (epic tables) and §4 (milestone
table). Nothing here is a task an agent can pick up; they get leaf tasks at
their own planning gate (§0.5).
