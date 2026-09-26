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
it. **E-2.7** (combat audio) is broken out (PLAN.md §7.10, ADR-017: made
in-house by AI). Its first task, **T-2.44** (the synthesiser and render
pipeline), is open. The owner can record the voice lines any time, from
`docs/audio/voice-script.md`.

**M3 is broken out** (PLAN.md §7.9). E-3.1's navmesh pipeline is done:
T-3.01 (the Recast spike), T-3.02 (named worlds), T-3.03 (the range baked
and committed, with a staleness hash) and T-3.04 (vault links); E-3.2 is
done too — path following (T-3.05) and local avoidance (T-3.06), and so is
the behaviour tree runtime (T-3.07), and brains tick on the session
(T-3.08), with an AI debug view on B (T-3.09), and enemies exist as
entities (T-3.10) drawn in the page (T-3.11, `?enemies` for eyes), and
each client is sent only what is within 120 m of it (T-3.12), and
perception exists as pure functions (T-3.13), wired on the session into
hearing, memory and target choice (T-3.14), and a brain can shoot through the
human fire path (T-3.15), and rounds going past suppress every soldier (T-3.16), which the page shows
(T-3.17, `?suppress` for eyes), and cover points are baked beside the navmesh
(T-3.18) and queried and reserved (T-3.19), and the rifleman fights from it
(T-3.20, `pnpm sim-run --scenario cover-duel`), and groups suppress and flank a
pinned target (T-3.21, `--scenario pinned`), and throw grenades at a target
gone still in cover (T-3.22), and the slice's two archetypes exist — the
rifleman and an MG that deploys, suppresses first and relocates rarely
(T-3.23, `--scenario mg`), and friendly bots follow their fireteam's lead in
formation (T-3.25, the `friendly` tree) and fight and revive beside it
(T-3.26, `--scenario squad`), and players can order bots and mark targets
over the wire (T-3.27, protocol 21), which the bots carry out and report on
(T-3.28), from an order wheel on Q and a mark on F in the page, drawn in the
world from the host's broadcast (T-3.29, `?squad` for eyes). E-3.8's build
tasks are done; its sign-off (🧍 T-3.30) and the combat AI sign-off (🧍
T-3.24) wait on their run sheets. E-3.9 has begun: the grey-box mission map
is a second named world with an overwatch and an assault route, spawn zones
and its bake (T-3.31, `WORLD=greybox-01`, `?world=greybox-01` for eyes), and
an encounter file per world spawns its groups on their triggers, out of every
human's sight and under an alive cap, in the posture each group is given
(T-3.32), paced by a director from the fight's intensity and sized by the
humans seated, not the squad (T-3.33), toward one objective — clear the
compound and hold it — evaluated on the server, broadcast, shown on the HUD,
and restartable (T-3.34, protocol 22, `?mission` for eyes), and played
headless by six bots at both budgets with the exit gate's claims as numbers
(T-3.35, `pnpm sim-run --scenario mission`; the bots lose most fights —
docs/BUGS.md B-11). M3's build tasks are done; its gates (🧍 T-3.24, T-3.30,
T-3.36, T-3.37) wait on their run sheets and people.

**M4 is broken out** (PLAN.md §7.11), behind everything above in scan
order. The asset pipeline is done (T-4.02, `pnpm gen:assets`) with its budgets
in CI (T-4.03, `pnpm check:assets`) and the loader (T-4.05, `?assets` for
eyes); streaming/load-screen gating (T-4.06, `pnpm check:packs`) and LOD/instancing (T-4.07) are done, beside
the level format (T-4.09), the mission's objective types (T-4.14), scripted
events (T-4.15), checkpoints/retry (T-4.16) and every-mission CI (T-4.17)
all done; the room before the mission T-4.19 and the player HUD T-4.25, menus T-4.26, classes T-4.27 and the scoreboard T-4.28 are done; the mounted MG (T-4.29) and observability (T-4.33) are done, the
regions addendum (T-4.30) is written and waits on the owner agreeing its
cost — and two owner decisions gate the rest. Art sourcing is decided (🧍 T-4.01, ADR-018: authored as code,
with procedural animation): the generator library and its first kit piece
are done (T-4.04, `pnpm gen:art`, the wall on `?assets`), and the characters
from assets (T-4.08) are open, and with the level format done (T-4.09,
`data/levels/`, greybox-01 the first level) the kit (T-4.10) and level
validation (T-4.11) are open. The slice kit is done (T-4.10: 25 code-authored
pieces, `data/kit.json`, `?kit` for the walkable gallery), and the baked-lighting
spike is done (T-4.12): the fallback keeps the sun + hemisphere and adds
per-piece baked vertex AO without breaking instancing. **The setting is Afghanistan, winter 2001–2002**
(ADR-020; the brief is `docs/art/direction.md`). The squad now wears the
detailed desert-camouflage soldier (T-4.08) and carries period weapons
(T-4.36; enemies hold the AK, PKM and RPG-7), and every enemy is the
irregular fighter (T-4.35). Where progress lives is decided
too (🧍 T-4.21, ADR-019: on the host, per campaign), and player identity
is done (T-4.22: host-signed anonymous IDs, `IDENTITY_SECRET`), and campaign saves
are durable in SQLite on the Fly volume (T-4.23). Soldiers now earn data-driven
XP and ranks from human play, saved with the campaign and shown at mission end
(T-4.24, protocol 29); bots earn nothing.

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

### E-2.7 — Combat audio (§7.10) — broken out 2026-09-23

Made in-house per `docs/adr/017-in-house-audio.md`: effects synthesised from
code and rendered offline, voices recorded by people and processed by code,
placed in the world with Web Audio. Claude cannot hear, so the owner listens
on the deployed site's sound board (`?sounds`, T-2.45).

| Task | Status | Depends |
|---|---|---|
| T-2.44 | OPEN | — |
| T-2.45 | BLOCKED | T-2.44 |
| T-2.46 | BLOCKED | T-2.45 |
| T-2.47 | BLOCKED | T-2.45 |
| T-2.48 | BLOCKED — also needs the owner's recordings (`docs/audio/voice-script.md`) to process real lines; the pipeline itself is tested on generated signals | T-2.44 |
| T-2.49 | BLOCKED — ships with synthesised chirps until recordings arrive | T-2.45, T-2.48 |
| 🧍 T-2.50 | BLOCKED — run sheet `e2-7.md` to be written | T-2.46, T-2.47, T-2.49 |

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
| 🧍 T-3.24 | BLOCKED — run sheet `e3-5.md` to be written first | T-3.11, T-3.17, T-3.23 |

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
| 🧍 T-3.30 | BLOCKED — run sheet `e3-8.md` to be written first | T-3.11, T-3.25, T-3.26, T-3.28, T-3.29 |

### E-3.9 — AI director and the grey-box mission

| Task | Status | Depends |
|---|---|---|
| T-3.31 | DONE | T-3.02, T-3.04, T-3.18 |
| T-3.32 | DONE | T-3.10, T-3.31 |
| T-3.33 | DONE | T-3.32, T-3.14 |
| T-3.34 | DONE | T-3.31, T-3.32 |
| T-3.35 | DONE | T-3.23, T-3.28, T-3.33, T-3.34 |
| 🧍 T-3.36 | BLOCKED — run sheet `m3-solo.md` to be written first | T-3.24, T-3.30, T-3.35 |
| 🧍 T-3.37 | BLOCKED — run sheet `m3-six.md` to be written first; needs six people | T-3.35 |

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
| T-4.08 | DONE — re-scoped by the owner: the detailed soldier (ADR-020) | T-4.01, T-4.05 |
| T-4.35 | DONE — the enemy fighter; the owner judges it on the deployed site | T-4.08 |
| T-4.36 | DONE — period weapons | T-4.08 |

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
| T-4.20 | BLOCKED | T-4.30, T-4.31 |

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
| T-4.32 | BLOCKED | T-4.31 |
| T-4.33 | DONE | — |

### M4 exit gate

| Task | Status | Depends |
|---|---|---|
| 🧍 T-4.34 | BLOCKED — run sheet `m4.md` to be written; after M3's gate | T-4.13, T-4.17, T-4.23, T-4.25, T-4.26, T-4.27, T-4.29 |

---

## M5

Epics only, not broken out — see PLAN.md §7 (epic tables) and §4 (milestone
table). Nothing here is a task an agent can pick up; it gets leaf tasks at
its own planning gate (§0.5).
