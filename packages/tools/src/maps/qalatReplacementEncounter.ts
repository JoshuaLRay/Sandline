/** U-228: fixed, unregistered Qalat encounter. No live campaign lookup or mutation. */
import { DEFAULT_MOVE_CONFIG as move, blockedAt, supportUnder, getEmplacement, gunnerPlace, loadMission, parseEncounter, parsePlacedEmplacements,
  type Encounter, type World, type WorldMission } from '@sandline/shared';
import rawEncounter from './qalat-replacement-encounter.json' with { type: 'json' };
import rawMission from './qalat-replacement-encounter-mission.json' with { type: 'json' };
import { OUTPOST } from './qalatOutpost.ts';
import { tankReturnRoute } from './qalatRoadSupports.ts';

const GUN = OUTPOST.southGateGun;
const yawDeg = Math.atan2(GUN.toward.x - GUN.gun.x, GUN.toward.z - GUN.gun.z) * 180 / Math.PI;
const emplacements = parsePlacedEmplacements('U-228 replacement', [{
  id: 'og1-mg', kind: GUN.kind, ...GUN.gun, yawDeg,
}]);

/** Temporary authoring mission provides validated 3D spawn-zone names while
 * U-230 owns the real mission objectives and route metadata. The live level
 * remains mission-free until the atomic U-233 installation. */
export function replacementEncounterWorld(world: World): World {
  if (world.id !== rawEncounter.world || world.mapRevision !== 2)
    throw new Error('U-228 encounter requires unregistered replacement revision 2');
  return { ...world, mission: loadMission(world.id, rawMission), emplacements };
}

export function buildReplacementEncounter(world: World): {
  encounter: Encounter; encounterMission: WorldMission; emplacements: typeof emplacements;
} {
  const context = replacementEncounterWorld(world);
  // During initial authoring, report every spec-versus-build collision mismatch
  // at once rather than failing one member per CI cycle.
  const mismatch: string[] = [];
  for (const group of rawEncounter.groups) for (const socket of group.sockets) {
    if (socket.archetype === 'tank') continue;
    for (const point of [socket.feet, ...('patrol' in socket && socket.patrol ? socket.patrol.route : []),
      ...('advance' in socket && socket.advance ? socket.advance : [])]) {
      const checks = (point === socket.feet ? [-move.radius, 0, move.radius] : [0]).flatMap((dx) =>
        (point === socket.feet ? [-move.radius, 0, move.radius] : [0]).map((dz) =>
          supportUnder(point.x + dx, point.z + dz, point === socket.feet ? 0 : move.radius,
            point.y + .05, world.boxes, move.groundY)));
      const blocked = blockedAt(point.x, point.z, move.radius, point.y, .05, move.height, world.boxes);
      if (checks.some((y) => Math.abs(y - point.y) > .05) || blocked)
        mismatch.push(`${socket.id} ${JSON.stringify(point)} support=${JSON.stringify(checks)} blocked=${blocked}`);
    }
  }
  if (mismatch.length) {
    for (const id of ['RL1', 'RL2', 'RL3']) {
      const socket = rawEncounter.groups.flatMap((g) => g.sockets).find((x) => x.id === id);
      if (!socket) continue;
      const { x, y, z } = socket.feet;
      const local = world.boxes.filter((q) =>
        q.minX < x + 9 && q.maxX > x - 9 && q.minZ < z + 9 && q.maxZ > z - 9);
      const candidates: { x: number; y: number; z: number; distance: number }[] = [];
      for (let ix = -12; ix <= 12; ix++) for (let iz = -12; iz <= 12; iz++) {
        const px = x + ix * .5, pz = z + iz * .5;
        if ([-move.radius, 0, move.radius].some((dx) => [-move.radius, 0, move.radius].some((dz) =>
          Math.abs(supportUnder(px + dx, pz + dz, 0, y + .05, local, move.groundY) - y) > .05))) continue;
        if (blockedAt(px, pz, move.radius, y, .05, move.height, local)) continue;
        candidates.push({ x: px, y, z: pz, distance: ix * ix + iz * iz });
      }
      candidates.sort((a, b) => a.distance - b.distance);
      mismatch.push('candidates ' + id + ' ' + JSON.stringify(candidates.slice(0, 8)));
    }
    throw new Error('U-228 authored collision audit:\\n' + mismatch.join('\\n'));
  }
  const encounter = parseEncounter(rawEncounter, (id) => id === world.id ? context : undefined);
  const expectedRoute = tankReturnRoute();
  const tank = encounter.groups.find((g) => g.id === 'tank');
  if (!tank?.staged || !tank.path || tank.sockets?.length !== 1 ||
    JSON.stringify([tank.sockets[0]!.feet, ...tank.path]) !==
    JSON.stringify(expectedRoute.map(({ x, y, z }) => ({ x, y, z }))))
    throw new Error('U-228 staged tank no longer follows exact constructed y8 return');
  if (encounter.groups.reduce((n, g) => n + (g.sockets?.length ?? 0), 0) !== 38)
    throw new Error('U-228 requires all 38 fixed encounter entities');
  const gunner = gunnerPlace(emplacements[0]!, getEmplacement(GUN.kind));
  if (Math.hypot(gunner.x - GUN.use.x, gunner.z - GUN.use.z) > .05 ||
    gunner.y !== GUN.use.y) throw new Error('OG1 socket and mounted gun use position differ');
  return { encounter, encounterMission: context.mission!, emplacements };
}
