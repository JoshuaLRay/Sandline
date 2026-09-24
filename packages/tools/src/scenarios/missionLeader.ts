/** Scripted orders only: movement, combat, revives and mission rules stay in the session. */
import { type Encounter, type MissionDef, type World, SQUAD, TICK_SECONDS, isDead, isDowned, resolveArea } from '@sandline/shared';
import type { Session } from '../../../server/src/session/Session.ts';
import type { MissionConfig } from './mission.ts';

type Point = { x: number; y: number; z: number };
const flat = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

export function createMissionLeader(session: Session, def: MissionDef, encounter: Encounter, world: World, config: MissionConfig): () => void {
  const mission = world.mission!;
  // The approach routes describe the world's main objective, not arbitrary areas.
  // Keep T-3.35's opening approach when that is the first objective.
  const first = def.objectives[0]!;
  const approach = first.type === 'clear-and-hold' && first.area === 'objective';
  const roles = ['overwatch', 'assault'] as const;
  const stops = SQUAD.fireteams.map((_, i) => approach
    ? (mission.routes.find((r) => r.role === roles[i % roles.length])?.via ?? []).map((p) => ({ ...p, y: 0 }))
    : []);
  const at = SQUAD.fireteams.map(() => 0);
  const since = SQUAD.fireteams.map(() => 0);
  const teamOf = (slot: number) => SQUAD.fireteams.findIndex((f) => f.slots.includes(slot));
  const reviving = new Map<number, number>();
  const standing = (i: number) => !isDead(session.slots[i]!.health) && !isDowned(session.slots[i]!.health);
  let objectiveIndex = session.mission!.objective;
  let anchors = session.slots.map((s) => ({ ...s.state }));

  const groupHint = (id: string, slot: number, visited = new Set<string>()): { point: Point; target: number | null } => {
    if (visited.has(id)) throw new Error(`destroy group '${id}': cyclic spawn prerequisites`);
    visited.add(id);
    const group = encounter.groups.find((g) => g.id === id)!;
    const spawner = session.spawner!;
    if (!spawner.fired(id)) {
      if (group.trigger.kind === 'dead' && !spawner.dead(group.trigger.group)) return groupHint(group.trigger.group, slot, visited);
      if (group.trigger.kind === 'enter') return { point: { ...resolveArea(group.trigger.area, encounter, world), y: 0 }, target: null };
    }
    const ids = spawner.spawnedBy(id);
    const enemies = session.enemies.filter((e) => ids.includes(e.netId) && !isDead(e.health));
    const from = session.slots[slot]!.state;
    const target = enemies.reduce<(typeof enemies)[number] | null>((best, e) => best === null || flat(from, e.state) < flat(from, best.state) ? e : best, null);
    return target
      ? { point: { ...target.state }, target: target.netId }
      : { point: { ...mission.spawnZones.find((z) => z.id === group.zone)!, y: 0 }, target: null };
  };

  const orderTeamMember = (slot: number) => {
    const team = teamOf(slot);
    const objective = def.objectives[objectiveIndex]!;
    let point: Point;
    let target: number | null = null;
    let order: 'hold' | 'move' | 'attack' = 'hold';
    if (objectiveIndex === 0 && at[team]! < stops[team]!.length) {
      point = stops[team]![at[team]!]!;
      order = 'move';
    } else if ('area' in objective) {
      // Hold walks to the exact anchor; move may choose cover outside a small reach area.
      point = { ...resolveArea(objective.area, encounter, world), y: 0 };
    } else if (objective.type === 'destroy') {
      ({ point, target } = groupHint(objective.group, slot));
      if (target !== null) order = 'attack';
    } else {
      point = anchors[slot]!;
    }
    const old = session.orderFor(slot);
    if (old?.order === order && old.target === target && (target !== null || (old.point && flat(old.point, point) < 0.01 && old.point.y === point.y))) return;
    session.orderFrom(0, { order, address: { to: 'slot', index: slot }, point: target === null ? { x: point.x, y: point.y, z: point.z } : null, target });
  };
  const orderTeam = (team: number) => {
    for (const slot of SQUAD.fireteams[team]!.slots) if (!reviving.has(slot)) orderTeamMember(slot);
  };
  SQUAD.fireteams.forEach((_, t) => orderTeam(t));

  return () => {
    if (session.mission!.state !== 'progress') return;
    if (objectiveIndex !== session.mission!.objective) {
      objectiveIndex = session.mission!.objective;
      anchors = session.slots.map((s) => ({ ...s.state }));
      SQUAD.fireteams.forEach((_, t) => orderTeam(t));
    }
    const tick = session.tick;
    if (objectiveIndex === 0) SQUAD.fireteams.forEach((f, t) => {
      if (at[t]! >= stops[t]!.length) return;
      const goal = stops[t]![at[t]!]!;
      const up = f.slots.filter((i) => standing(i) && !reviving.has(i));
      const arrived = up.length > 0 && up.every((i) => flat(session.slots[i]!.state, goal) <= config.arriveM);
      if (arrived || tick - since[t]! >= config.stopSeconds / TICK_SECONDS) {
        at[t]!++;
        since[t] = tick;
        orderTeam(t);
      }
    });
    // A destroy target can die or spawn between leader updates.
    if (def.objectives[objectiveIndex]!.type === 'destroy') SQUAD.fireteams.forEach((_, t) => orderTeam(t));
    for (const [reviver, downed] of [...reviving]) {
      if (!isDowned(session.slots[downed]!.health) || !standing(reviver)) {
        reviving.delete(reviver);
        if (standing(reviver)) orderTeamMember(reviver);
      }
    }
    for (const s of session.slots) {
      if (!isDowned(s.health) || [...reviving.values()].includes(s.index)) continue;
      const helpers = session.slots.filter((h) => h.index !== s.index && standing(h.index) && !reviving.has(h.index));
      if (helpers.length === 0) continue;
      const nearest = helpers.reduce((a, b) => flat(a.state, s.state) <= flat(b.state, s.state) ? a : b);
      reviving.set(nearest.index, s.index);
      session.orderFrom(0, { order: 'revive', address: { to: 'slot', index: nearest.index }, point: null, target: s.netId });
    }
  };
}
