/**
 * The mission briefing (T-5.03), as a pure model: what a player is told
 * before a mission starts — its objectives in order, from the mission's own
 * data; the two ways in, from the world's routes; the squad, from the
 * roster's classes; and the handful of keys a first mission needs. The page
 * draws it (`Briefing.ts`); a test reads it without one.
 */
import { type MissionDef, type ObjectiveDef, type World, classById, getWorld, missionFor } from '@sandline/shared';
import { KEY_BINDINGS } from '../menu/settings.ts';

export interface Briefing {
  title: string;
  objectives: readonly string[];
  routes: string;
  squad: string;
  controls: readonly { action: string; keys: string }[];
}

/** The keys a first mission needs, by the menu's own names. */
const BRIEF_KEYS = ['Move', 'Fire', 'Aim', 'Reload', 'Crouch', 'Order wheel', 'Mark target', 'Interact / revive', 'Pause menu'];

function seconds(s: number): string {
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s - m * 60);
  return rest === 0 ? `${m} min` : `${m} min ${rest} s`;
}

/** One objective as the briefing says it. */
export function objectiveText(o: ObjectiveDef): string {
  switch (o.type) {
    case 'clear-and-hold':
      return `Clear ${o.label} and hold it for ${seconds(o.holdSeconds)}`;
    case 'reach':
      return o.who === 'all' ? `Get everyone to ${o.label}` : `Reach ${o.label}`;
    case 'destroy':
      return `Destroy ${o.label}`;
    case 'defend':
      return `Defend ${o.label} for ${seconds(o.seconds)}`;
    case 'survive':
      return `Survive for ${seconds(o.seconds)}`;
  }
}

/** Where each route runs, by the side of the map its stops average to. */
export function routesText(world: World): string {
  const routes = world.mission?.routes ?? [];
  if (routes.length === 0) return '';
  const parts = routes.map((r) => {
    const x = r.via.reduce((s, p) => s + p.x, 0) / Math.max(1, r.via.length);
    const side = x < -2 ? 'west' : x > 2 ? 'east' : 'centre';
    return `the ${r.role} route up the ${side}`;
  });
  return `${routes.length === 2 ? 'Two ways in' : `${routes.length} ways in`}: ${parts.join(', and ')}. Split the squad — one fireteam covers while the other moves.`;
}

/** The squad by class: "3 Team Leader, 3 Marksman". */
export function squadText(classIds: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const id of classIds) {
    const name = classById(id)?.name;
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, n]) => `${n} ${name}`).join(', ');
}

/** The briefing for a world's mission, or null when the world has none. */
export function briefingFor(worldId: string, classIds: readonly string[] = [], mission: MissionDef | undefined = missionFor(worldId)): Briefing | null {
  const world = getWorld(worldId);
  if (!world || !mission) return null;
  return {
    title: world.id.split('-').map((w) => (/^\d+$/.test(w) ? w : w[0]!.toUpperCase() + w.slice(1))).join(' '),
    objectives: mission.objectives.map(objectiveText),
    routes: routesText(world),
    squad: squadText(classIds),
    controls: BRIEF_KEYS.map((a) => KEY_BINDINGS.find((k) => k.action === a)).filter((k): k is { action: string; keys: string } => k !== undefined),
  };
}
