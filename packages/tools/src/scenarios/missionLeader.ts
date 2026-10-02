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
  // T-5.02: the routes are walked into whichever objective clears and holds the world's main objective — the first
  // one or a later one — joined at the stop nearest each fireteam when it starts, so a squad already up a lane goes on.
  // U-011: or whichever takes it by destroying the group that holds it from the start (a later garrison — a
  // counterattack sent into it — is fought where it is, not walked up to).
  const garrisons = (id: string) => {
    const group = encounter.groups.find((g) => g.id === id);
    return group?.posture.kind === 'garrison' && group.posture.at === 'objective' && group.trigger.kind === 'start';
  };
  const approachIndex = def.objectives.findIndex((o) => (o.type === 'reach' && o.area === 'compound-ring') || (o.type === 'clear-and-hold' && o.area === 'objective') || (o.type === 'destroy' && garrisons(o.group)));
  const roles = ['overwatch', 'assault'] as const;
  const stops = SQUAD.fireteams.map((_, i) => approachIndex >= 0
    ? (mission.routes.find((r) => r.role === roles[i % roles.length])?.via ?? []).map((p) => ({ ...p, y: 0 }))
    : []);
  const at = SQUAD.fireteams.map(() => 0);
  const since = SQUAD.fireteams.map(() => 0);
  const teamOf = (slot: number) => SQUAD.fireteams.findIndex((f) => f.slots.includes(slot));
  const reviving = new Map<number, number>();
  const standing = (i: number) => !isDead(session.slots[i]!.health) && !isDowned(session.slots[i]!.health);
  let objectiveIndex = session.mission!.objective;
  let anchors = session.slots.map((s) => ({ ...s.state }));
  /**
   * U-011: an upload — the slot on its feet nearest the terminal holds at it (a bot held there starts the upload
   * while it waits, and again after every cut); the rest hold spread between the terminal and the lever, where
   * they cover both and the way the enemy comes to cut it.
   */
  let presser = -1;
  const LEVER_GUARD = [
    { x: 0, z: 0 },
    { x: -1.5, z: -1.5 },
    { x: 1.5, z: 1.5 },
    { x: -1.5, z: 1.5 },
    { x: 1.5, z: -1.5 },
  ];
  const pickPresser = (terminal: Point) => {
    const up = session.slots.filter((s) => standing(s.index) && !reviving.has(s.index));
    presser = up.length === 0 ? -1 : up.reduce((a, b) => (flat(a.state, terminal) <= flat(b.state, terminal) ? a : b)).index;
  };

  const groupHint = (id: string, slot: number, visited = new Set<string>()): { point: Point; target: number | null } => {
    if (visited.has(id)) throw new Error(`destroy group '${id}': cyclic spawn prerequisites`);
    visited.add(id);
    const group = encounter.groups.find((g) => g.id === id)!;
    const spawner = session.spawner!;
    if (!spawner.fired(id)) {
      if (group.trigger.kind === 'dead' && !spawner.broken(group.trigger.group)) return groupHint(group.trigger.group, slot, visited);
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
    if (objectiveIndex === approachIndex && at[team]! < stops[team]!.length) {
      point = stops[team]![at[team]!]!;
      order = 'move';
    } else if ('area' in objective) {
      // Hold walks to the exact anchor; move may choose cover outside a small reach area.
      const area = resolveArea(objective.area, encounter, world);
      point = { ...area, y: 0 };
      // B-11: clear it before walking in, as a human lead would — attack the nearest living enemy
      // within `clearWithinM` of the area; hold it once none is left. Walking the squad into the
      // middle of a garrison is how it lost every fight at seven metres.
      if (objective.type === 'clear-and-hold') {
        const from = session.slots[slot]!.state;
        const nearest = session.enemies
          .filter((e) => !isDead(e.health) && flat(e.state, point) <= area.radius + config.clearWithinM)
          .reduce<Session['enemies'][number] | null>((b, e) => (b === null || flat(from, e.state) < flat(from, b.state) ? e : b), null);
        if (nearest) {
          order = 'attack';
          target = nearest.netId;
        }
      }
    } else if (objective.type === 'destroy') {
      ({ point, target } = groupHint(objective.group, slot));
      if (target !== null) order = 'attack';
    } else if (objective.type === 'rescue' && objective.group) {
      const ids = session.spawner!.spawnedBy(objective.group);
      const pow = session.enemies.find((e) => ids.includes(e.netId) && e.def.friendly && !isDead(e.health));
      point = pow ? { x: pow.state.x, y: pow.state.y, z: pow.state.z - 1 } : groupHint(objective.group, slot).point;
      const from = session.slots[slot]!.state;
      const threat = session.enemies.filter((e) => !e.def.friendly && !isDead(e.health) && flat(e.state, point) <= config.clearWithinM)
        .reduce<Session['enemies'][number] | null>((best, e) => best === null || flat(from, e.state) < flat(from, best.state) ? e : best, null);
      if (threat) { order = 'attack'; target = threat.netId; }
    } else if (objective.type === 'upload') {
      if (presser < 0 || !standing(presser)) pickPresser(objective.terminal);
      if (slot === presser || !objective.lever) {
        point = { x: objective.terminal.x, y: 0, z: objective.terminal.z };
      } else {
        const guards = session.slots.filter((s) => s.index !== presser).map((s) => s.index);
        const spot = LEVER_GUARD[Math.max(0, guards.indexOf(slot)) % LEVER_GUARD.length]!;
        const mid = { x: (objective.lever.at.x + objective.terminal.x) / 2, z: (objective.lever.at.z + objective.terminal.z) / 2 };
        point = { x: mid.x + spot.x, y: 0, z: mid.z + spot.z };
      }
    } else {
      point = anchors[slot]!;
    }
    const old = session.orderFor(slot);
    if (old?.order === order && old.target === target && (target !== null || (old.point && flat(old.point, point) < 0.01 && old.point.y === point.y))) return;
    session.orderFrom(0, { order, address: { to: 'slot', index: slot }, point: target === null ? { x: point.x, y: point.y, z: point.z } : null, target });
  };
  /** Each fireteam joins its route at the stop nearest its first soldier on its feet. */
  const joinRoutes = () => {
    SQUAD.fireteams.forEach((f, t) => {
      const who = f.slots.find((i) => standing(i));
      const route = stops[t]!;
      if (who === undefined || route.length === 0) return;
      const from = session.slots[who]!.state;
      let nearest = 0;
      route.forEach((p, i) => {
        if (flat(from, p) < flat(from, route[nearest]!)) nearest = i;
      });
      at[t] = nearest;
      since[t] = session.tick;
    });
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
      if (objectiveIndex === approachIndex) joinRoutes();
      SQUAD.fireteams.forEach((_, t) => orderTeam(t));
    }
    const tick = session.tick;
    if (objectiveIndex === approachIndex) SQUAD.fireteams.forEach((f, t) => {
      if (at[t]! >= stops[t]!.length) return;
      const goal = stops[t]![at[t]!]!;
      const up = f.slots.filter((i) => standing(i) && !reviving.has(i));
      const arrived = up.length > 0 && up.every((i) => flat(session.slots[i]!.state, goal) <= config.arriveM);
      if (arrived || tick - since[t]! >= config.stopSeconds / TICK_SECONDS) {
        // A lead brings the fireteams to the objective together: one does not start its last leg while another has
        // not started its own, for up to `groupUpSeconds` (they would arrive one at a time, the faster into the garrison alone).
        const lastLeg = at[t]! + 1 === stops[t]!.length - 1;
        const behind = SQUAD.fireteams.some((o, u) => u !== t && o.slots.some((i) => standing(i)) && at[u]! < stops[u]!.length - 1);
        if (lastLeg && behind && tick - since[t]! < config.groupUpSeconds / TICK_SECONDS) return;
        at[t]!++;
        since[t] = tick;
        orderTeam(t);
      }
    });
    // A destroy target — or, once the approach is walked, an enemy left near a clear-and-hold area — can die or spawn between leader updates.
    const current = def.objectives[objectiveIndex]!;
    const approached = objectiveIndex !== approachIndex || at.every((a, t) => a >= stops[t]!.length);
    // U-011: an upload's presser can fall; the next nearest takes the terminal.
    const presserLost = current.type === 'upload' && (presser < 0 || !standing(presser));
    if (current.type === 'rescue' || current.type === 'destroy' || (current.type === 'clear-and-hold' && approached) || presserLost) SQUAD.fireteams.forEach((_, t) => orderTeam(t));
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
