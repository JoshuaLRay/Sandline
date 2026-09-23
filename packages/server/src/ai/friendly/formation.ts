/**
 * Formation following (T-3.25): whom a friendly bot follows, and where.
 *
 * The six slots are two fixed fireteams (`data/squad.json`). A fireteam's
 * **lead** is its first human, in slot order; with none, the squad's first
 * human; with none at all, slot 0 — whoever sits there, bot or not. Every bot
 * that is not a lead follows its fireteam's lead, at a **rank**: the lead's
 * own fireteam first, then the other, each in slot order — so when both
 * fireteams follow one lead the other falls in behind. Its **place** is the
 * lead's fireteam's formation offset for that rank laid along the lead's own
 * trail: `back` metres behind it along the way it walked (breadcrumbs), `right`
 * metres square to the trail there (half as far to the side while the lead
 * sprints, `sprintSpreadScale`). A formation turned round the lead would
 * swing its outer places metres at every corner, faster than anyone can run
 * when the lead sprints; laid on the trail, a follower takes the corner where
 * the lead took it. Closed up while the lead is still, and projected onto the
 * navmesh. A place the projection squeezes
 * onto the lead (against a wall) is refused for the one straight behind it at
 * the same distance, and failing that there is none this think.
 *
 * Pace: walk when the lead walks, sprint when the lead sprints — or when the
 * follower is more than `catchUpM` from its place (after a corner), to
 * rejoin. With the lead still and the follower within `arriveM` of its place,
 * it stands.
 *
 * Server-only (§7.9 rule 2) and deterministic: it reads the session's slots
 * and remembers only each slot's last position and heading.
 */
import { SQUAD, type SquadConfig, fireteamOf } from '@sandline/shared';
import type { LocomotionIntent } from '../locomotion/followPath.ts';
import type { NavPoint } from '../nav/NavMesh.ts';

/** A slot as the formation reads it: the session's own, each tick. */
export interface FormationSlot {
  readonly index: number;
  readonly human: boolean;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Facing, wire units (1024 a turn): the heading before the first move. */
  readonly yaw: number;
  /** Horizontal speed over its last step, m/s. */
  readonly speed: number;
  /** Holding sprint. */
  readonly sprint: boolean;
}

/** The lead of `fireteam`: its first human; else the squad's first human; else slot 0. */
export function leadOf(fireteam: number, slots: readonly { index: number; human: boolean }[], config: SquadConfig = SQUAD): number {
  const byIndex = [...slots].sort((a, b) => a.index - b.index);
  const team = config.fireteams[fireteam]!.slots;
  const own = byIndex.find((s) => s.human && team.includes(s.index));
  if (own) return own.index;
  const any = byIndex.find((s) => s.human);
  return any ? any.index : 0;
}

/** Where a follower should be this think, and how to get there. */
export interface FormationPlace {
  lead: number;
  rank: number;
  /** The formation offset it keeps, [right, back], before any closing up. */
  offset: readonly [number, number];
  /** The place, on the mesh. */
  goal: NavPoint;
  /** The walk to it, or null to stand where it is. */
  intent: LocomotionIntent | null;
}

/** Spacing of a lead's breadcrumbs, and how much trail is kept, metres. */
const CRUMB_M = 0.25;
const TRAIL_M = 40;
/** Half the stretch of trail a place's direction is averaged over, metres: a corner turns a place, it does not snap it. */
const TANGENT_M = 1.5;

type Flat = { x: number; z: number };

export class Formation {
  /** Each slot's trail, oldest first; the slot's own position is its unrecorded head. */
  private readonly trails = new Map<number, Flat[]>();
  /** Each slot's direction before it has walked anywhere: its facing on the first tick seen. */
  private readonly initial = new Map<number, Flat>();
  private slots: readonly FormationSlot[] = [];

  constructor(
    /** Onto the mesh, or null where there is no mesh near. */
    private readonly project: (p: NavPoint) => NavPoint | null,
    private readonly config: SquadConfig = SQUAD,
  ) {}

  /** Every tick: the slots as they stand, and a breadcrumb for each that has moved on. */
  update(slots: readonly FormationSlot[]): void {
    this.slots = slots;
    for (const s of slots) {
      if (!this.initial.has(s.index)) {
        const a = (s.yaw / 1024) * Math.PI * 2;
        this.initial.set(s.index, { x: Math.sin(a), z: Math.cos(a) });
      }
      let trail = this.trails.get(s.index);
      if (!trail) this.trails.set(s.index, (trail = [{ x: s.x, z: s.z }]));
      const last = trail[trail.length - 1]!;
      const d = Math.sqrt((s.x - last.x) ** 2 + (s.z - last.z) ** 2);
      // A jump (a respawn, a test moving a soldier) starts the trail again.
      if (d > 5) trail.splice(0, trail.length, { x: s.x, z: s.z });
      else if (d >= CRUMB_M) trail.push({ x: s.x, z: s.z });
      let length = 0;
      for (let i = trail.length - 1; i > 0 && length <= TRAIL_M; i--) {
        length += Math.sqrt((trail[i]!.x - trail[i - 1]!.x) ** 2 + (trail[i]!.z - trail[i - 1]!.z) ** 2);
        if (length > TRAIL_M) trail.splice(0, i - 1);
      }
    }
  }

  /**
   * The point `back` metres behind a slot along the way it came, head first —
   * past the oldest breadcrumb, straight on back the way the trail began.
   */
  private behind(index: number, head: Flat, back: number): Flat {
    const trail = this.trails.get(index) ?? [];
    let from = head;
    let left = back;
    for (let i = trail.length - 1; i >= 0; i--) {
      const to = trail[i]!;
      const len = Math.sqrt((to.x - from.x) ** 2 + (to.z - from.z) ** 2);
      if (len >= left && len > 1e-9) return { x: from.x + ((to.x - from.x) * left) / len, z: from.z + ((to.z - from.z) * left) / len };
      left -= len;
      from = to;
    }
    // Off the end of the trail: on back along its first direction, or the facing it started with.
    const first = trail[0];
    const second = trail[1] ?? head;
    let dir = first ? { x: first.x - second.x, z: first.z - second.z } : { x: 0, z: 0 };
    const len = Math.sqrt(dir.x * dir.x + dir.z * dir.z);
    if (len > 1e-6) dir = { x: dir.x / len, z: dir.z / len };
    else {
      const f = this.initial.get(index) ?? { x: 0, z: 1 };
      dir = { x: -f.x, z: -f.z };
    }
    return { x: from.x + dir.x * left, z: from.z + dir.z * left };
  }

  /** The lead a slot follows (its fireteam's). */
  leadFor(slotIndex: number): number {
    return leadOf(fireteamOf(slotIndex, this.config), this.slots, this.config);
  }

  /** The bots following `lead`, in rank order. */
  followersOf(lead: number): number[] {
    const leadTeam = fireteamOf(lead, this.config);
    return this.slots
      .filter((s) => !s.human && s.index !== lead && this.leadFor(s.index) === lead)
      .map((s) => s.index)
      .sort((a, b) => {
        const ta = fireteamOf(a, this.config) === leadTeam ? 0 : 1;
        const tb = fireteamOf(b, this.config) === leadTeam ? 0 : 1;
        return ta - tb || a - b;
      });
  }

  /** Where `slotIndex` should be, or null for a human, a lead, or a place with nowhere on the mesh to stand. */
  place(slotIndex: number): FormationPlace | null {
    const me = this.slots.find((s) => s.index === slotIndex);
    if (!me || me.human) return null;
    const lead = this.leadFor(slotIndex);
    if (lead === slotIndex) return null;
    const leader = this.slots.find((s) => s.index === lead);
    if (!leader) return null;
    const rank = this.followersOf(lead).indexOf(slotIndex);
    const offsets = this.config.formations[this.config.fireteams[fireteamOf(lead, this.config)]!.formation]!;
    const offset = offsets[Math.min(rank, offsets.length - 1)]!;
    const still = leader.speed <= this.config.stillMps;
    const sprinting = leader.sprint && !still;
    const scale = still ? this.config.closeUpScale : 1;
    const side = sprinting ? this.config.sprintSpreadScale : 1;
    const head = { x: leader.x, z: leader.z };
    // Back is measured along the lead's own trail, so a follower takes a
    // corner where the lead took it; right is square to the trail there.
    const at = (r: number, back: number): NavPoint => {
      const p = this.behind(lead, head, back);
      const ahead = this.behind(lead, head, Math.max(0, back - TANGENT_M));
      const past = this.behind(lead, head, back + TANGENT_M);
      let fx = ahead.x - past.x;
      let fz = ahead.z - past.z;
      const len = Math.sqrt(fx * fx + fz * fz);
      if (len > 1e-6) {
        fx /= len;
        fz /= len;
      } else {
        const f = this.initial.get(lead) ?? { x: 0, z: 1 };
        fx = f.x;
        fz = f.z;
      }
      // The controller's frame (see Session.enemyHands): forward (sin, cos), right (−cos, sin).
      return { x: p.x - fz * r, y: leader.y, z: p.z + fx * r };
    };
    const far = (p: NavPoint) => Math.sqrt((p.x - leader.x) ** 2 + (p.z - leader.z) ** 2) >= this.config.minFromLeadM;
    let goal = this.project(at(offset[0] * scale * side, offset[1] * scale));
    if (!goal || !far(goal)) {
      // Squeezed onto the lead: straight behind it at the same distance instead.
      goal = this.project(at(0, Math.sqrt(offset[0] ** 2 + offset[1] ** 2) * scale));
      if (!goal || !far(goal)) return null;
    }
    const gap = Math.sqrt((goal.x - me.x) ** 2 + (goal.z - me.z) ** 2);
    if (still && gap <= this.config.arriveM) return { lead, rank, offset, goal, intent: null };
    const sprint = sprinting || gap > this.config.catchUpM;
    return { lead, rank, offset, goal, intent: { goal, pace: sprint ? 'sprint' : 'walk' } };
  }
}
