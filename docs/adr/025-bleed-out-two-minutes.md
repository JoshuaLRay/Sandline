# ADR-025: A downed soldier bleeds out over two minutes

- **Status:** Accepted
- **Date:** 2026-10-16
- **Plan reference:** P5 in [VISION.md](../VISION.md); CONFLICT-PARITY CP-24; U-033, U-061–U-064, U-059; [U-181](../backlog/U-181.md)

## Context

A soldier whose health is emptied is **downed**: immobile, revivable by a
squadmate or a health kit, capturable by an enemy (U-062), and dead when the
bleed-out runs out. A death fails the mission (U-033). Since T-2.13 the
bleed-out was 30 s (`damage.json`), a deliberate shortening of the series:
*Conflict: Desert Storm* gives a badly wounded soldier about two minutes.

On 2026-10-16 the owner approved restoring the longer window: "Change the
current bleed-out timer from 30 seconds to 120 seconds (2 minutes). The goal is
to create more opportunities for enemies to capture downed squad members and
for teammates to attempt rescues or revives." Thirty seconds was too short for
the capture system (a 5 s channel by an enemy who first has to walk there) and
for a rescue under fire to be a real decision.

## Decision

1. `downed.bleedOutSeconds` is **120** in `packages/shared/src/data/damage.json`,
   the one authoritative value. Nothing else hard-codes it.
2. The replicated vital timer (the Health component's `timer`) carries whole
   seconds up to `VITAL_TIMER_MAX_SECONDS` (127, seven bits, up from six and
   63 s), so every client counts down the full two minutes the server counts.
   The bit comes from the revive/lever progress field, which now travels in
   sixty-thirds (`progressToWire` / `progressFromWire`): a soldier's Health
   costs no more on the wire. `PROTOCOL_VERSION` 73.
3. Unchanged rules: shots on a downed body still cut the bleed-out in
   proportion to damage (T-2.13); revive (3 s) and health kits work for the whole
   window; capture still needs 2 s down, no squadmate within 15 m and a 5 s
   channel that can finish inside what is left; a soldier who bleeds out is
   dead and the mission fails (U-033). **There is no respawn** in a mission.
4. A checkpoint is still never saved while anyone is downed (U-059); a queued
   checkpoint can now wait up to two minutes for the squad to be up, revived,
   captured or dead.

## Consequences

- Downed soldiers are now a longer, contested objective: enemies have the time
  to walk over and take them prisoner, and the squad has the time to fight its
  way to them. Capture and next-mission rescue (U-061–U-064) become a common
  outcome instead of an edge case.
- Missions may last a little longer and fail less often from a single
  unreached soldier; the mission simulation's completion figures can move and
  are re-measured, not re-baselined.
- `bleedOutSeconds` cannot exceed what the wire can show: the data parser
  rejects anything above `VITAL_TIMER_MAX_SECONDS`. A longer window would need a
  wider field and a new protocol version.
- Revive and lever progress bars move in 1/63 steps (about 1.6 %); they are read
  rounded down, so a bar never shows done before the server does.

## Alternatives rejected

- **Keep 30 s.** Rejected by the owner: too little time for capture or rescue.
- **Widen the timer without trading a bit.** Rejected: it pushes the common
  Transform + Health entity past the snapshot budget test (ADR-012), which is a
  gate, not a number to re-baseline.
- **Coarser timer steps above a minute.** Rejected: the HUD would count down
  in jumps, and the precise last seconds are what a rescuer needs.
- **A different window per difficulty or per character.** Not requested; the
  director budget stays the only dial (CAMPAIGN D8).
