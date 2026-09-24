/**
 * The mission's objectives, in order (T-3.34's one objective, a sequence
 * since T-4.14). Evaluated once a tick on the server from what the session
 * answers (`MissionWorld`); nothing here reads the session, so each rule is
 * testable on its own.
 *
 * The types (`ObjectiveDef`, `shared/src/sim/mission.ts`):
 *   - clear-and-hold: the hold counts a tick when no living enemy is inside
 *     the area and a living squad soldier is; any living enemy inside sets
 *     it back to zero; the squad stepping out with the area still clear
 *     pauses it. Complete at the hold.
 *   - reach: complete the tick every standing squad soldier (`all`) or any
 *     one (`any`) is inside. Standing is alive and not downed: a soldier
 *     who cannot move cannot be asked to arrive.
 *   - destroy: complete once the encounter group is dead (the spawner's
 *     rule: every member it will send placed, none alive).
 *   - defend: the clock runs; the area is overrun while a living enemy is
 *     inside and no living squad soldier is, and `breachSeconds` of it in a
 *     row fails the objective, and the mission with it. Complete when the
 *     clock reaches `seconds`.
 *   - survive: complete when the clock reaches `seconds`.
 *
 * Whatever the objective, a squad wipe — every slot dead at once — fails the
 * mission. The next objective starts the tick one completes; the mission is
 * complete when the last does. Complete and failed are final until a
 * restart (`reset`).
 */
import { type AreaRef, type GroundArea, type MissionDef, type MissionView, type ObjectiveDef, TICK_SECONDS } from '@sandline/shared';

/** What the session answers the mission each tick. */
export interface MissionWorld {
  /** Living enemies inside an area. */
  enemiesIn(area: GroundArea): number;
  /** Living squad soldiers inside an area (downed ones count: they are there). */
  squadIn(area: GroundArea): number;
  /** Standing squad soldiers — alive, not downed — in all, and inside an area. */
  standing(): number;
  standingIn(area: GroundArea): number;
  /** Every slot is dead. */
  wiped(): boolean;
  /** An encounter group: whether it is dead, and how many it has placed and lost so far. */
  group(id: string): { dead: boolean; spawned: number; down: number };
}

const ticksOf = (seconds: number): number => Math.max(1, Math.round(seconds / TICK_SECONDS));

export class MissionRun {
  private view: MissionView;
  /** Ticks in a row the defended area has been overrun. */
  private breach = 0;
  private readonly areas: (GroundArea | null)[];

  constructor(
    private readonly def: MissionDef,
    /** Resolves an objective's named area (`resolveArea` with the encounter and world). */
    resolve: (ref: AreaRef) => GroundArea,
  ) {
    this.areas = def.objectives.map((o) => ('area' in o ? resolve(o.area) : null));
    this.view = this.start(0, 1);
  }

  /** Where the mission stands. */
  get current(): Readonly<MissionView> {
    return this.view;
  }

  /** Whether the respawn rule applies (the mission's `respawn`). */
  get respawns(): boolean {
    return this.def.respawn;
  }

  /** The objective being played, and its resolved area if it has one. */
  get objective(): { def: ObjectiveDef; area: GroundArea | null } {
    return { def: this.def.objectives[this.view.objective]!, area: this.areas[this.view.objective] ?? null };
  }

  /** Objective `index`'s opening view. */
  private start(index: number, attempt: number): MissionView {
    const o = this.def.objectives[index]!;
    const goal = o.type === 'clear-and-hold' ? ticksOf(o.holdSeconds) : o.type === 'defend' || o.type === 'survive' ? ticksOf(o.seconds) : 1;
    this.breach = 0;
    return {
      state: 'progress',
      attempt,
      objective: index,
      objectives: this.def.objectives.length,
      type: o.type,
      label: o.label,
      progress: 0,
      goal,
      satisfied: o.type !== 'clear-and-hold' && o.type !== 'reach',
    };
  }

  /**
   * Evaluate one tick. Returns true when anything a client shows changed:
   * the state, the objective, whether its condition holds, a count, or a
   * whole second of a clock.
   */
  step(w: MissionWorld): boolean {
    if (this.view.state !== 'progress') return false;
    const before = this.view;
    let next: MissionView = { ...before };
    if (w.wiped()) {
      next.state = 'failed';
    } else {
      const { def, area } = this.objective;
      switch (def.type) {
        case 'clear-and-hold': {
          const clear = w.enemiesIn(area!) === 0;
          const held = !clear ? 0 : w.squadIn(area!) > 0 ? Math.min(next.goal, next.progress + 1) : next.progress;
          next = { ...next, satisfied: clear, progress: held };
          break;
        }
        case 'reach': {
          const need = def.who === 'all' ? w.standing() : 1;
          const there = Math.min(w.standingIn(area!), Math.max(need, 1));
          next = { ...next, goal: Math.max(need, 1), progress: there, satisfied: need > 0 && there >= need };
          break;
        }
        case 'destroy': {
          const g = w.group(def.group);
          next = { ...next, goal: Math.max(1, g.spawned), progress: Math.min(g.down, Math.max(1, g.spawned)), satisfied: true };
          if (g.dead) next.progress = next.goal;
          break;
        }
        case 'defend': {
          const overrun = w.enemiesIn(area!) > 0 && w.squadIn(area!) === 0;
          this.breach = overrun ? this.breach + 1 : 0;
          next = { ...next, satisfied: !overrun, progress: Math.min(next.goal, next.progress + 1) };
          if (this.breach >= ticksOf(def.breachSeconds)) next.state = 'failed';
          break;
        }
        case 'survive':
          next = { ...next, progress: Math.min(next.goal, next.progress + 1) };
          break;
      }
      const done = def.type === 'reach' ? next.satisfied : def.type === 'destroy' ? w.group(def.group).dead : next.progress >= next.goal;
      if (next.state === 'progress' && done) {
        if (next.objective + 1 < next.objectives) next = this.start(next.objective + 1, next.attempt);
        else next.state = 'complete';
      }
    }
    this.view = next;
    const second = (v: MissionView) => (v.type === 'reach' || v.type === 'destroy' ? v.progress : Math.floor(v.progress * TICK_SECONDS));
    return (
      next.state !== before.state ||
      next.objective !== before.objective ||
      next.satisfied !== before.satisfied ||
      next.goal !== before.goal ||
      second(next) !== second(before)
    );
  }

  /** Jump to an authored objective in this attempt (T-4.15 scripted action). */
  setObjective(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= this.def.objectives.length) return false;
    if (this.view.state === 'progress' && this.view.objective === index) return false;
    this.view = this.start(index, this.view.attempt);
    return true;
  }

  /** Start again: the first objective, nothing done, the next attempt. */
  reset(): void {
    this.view = this.start(0, this.view.attempt + 1);
  }
}
