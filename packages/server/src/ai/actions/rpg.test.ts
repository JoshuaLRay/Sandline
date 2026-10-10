/**
 * The RPG gunner (U-157): its shot search, and the archetype on the session —
 * the wind-up then the rocket, the long reload, the move after a shot, the
 * rifle up close, and the friend it will not fire near. The fight with a squad
 * as a whole is `pnpm sim-run --scenario rpg` (tools/src/scenarios).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type EnemyLauncher,
  PROJECTILE_IDS,
  TREE_DEFS,
  buildTree,
  createMoveState,
  getEnemy,
  getProjectile,
  parseEncounter,
  parseTreeDef,
  rememberSeen,
  requireWorld,
  stanceEye,
} from '@sandline/shared';
import { type BrainMemory, type BrainTree, createBrainRegistry } from '../Brain.ts';
import { type NavMesh, initNav } from '../nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from '../nav/bakedNav.ts';
import { type EnemyEntity, Session } from '../../session/Session.ts';
import { chooseRocket, inCoverFrom, meetsBody } from './rpg.ts';

const TICK_MS = 1000 / 30;
const RPG = getEnemy('rpg');
const LAUNCHER = RPG.launcher as EnemyLauncher;
const ROCKET = getProjectile(LAUNCHER.projectile);
const ROCKET_INDEX = (PROJECTILE_IDS as readonly string[]).indexOf(LAUNCHER.projectile);
const RANGE = requireWorld('range');
const WORLD = { boxes: RANGE.boxes, groundY: 0 };

let mesh: NavMesh;
beforeAll(async () => {
  await initNav();
  mesh = loadWorldNavMesh('range');
});

/** The low wall's north face is z = -0.85; a soldier just north of it is behind it from the south. */
const BEHIND_WALL = { x: -9, y: 0, z: 0.2 };
const SOUTH_OF_WALL = { x: -9, y: 0, z: -28 };

describe('the rocket search (U-157)', () => {
  it('meets a body only inside its radius and between its feet and its head', () => {
    const feet = { x: 0, y: 0, z: 0 };
    expect(meetsBody({ x: -1, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }, feet)).not.toBeNull();
    expect(meetsBody({ x: -1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }, feet)).toBeNull();
    expect(meetsBody({ x: -1, y: 2.5, z: 0 }, { x: 1, y: 2.5, z: 0 }, feet)).toBeNull();
  });

  it('calls a soldier behind something near it in cover, not one behind something far off or in the open', () => {
    const eye = stanceEye(SOUTH_OF_WALL);
    expect(inCoverFrom(eye, BEHIND_WALL, RANGE.boxes, LAUNCHER.coverNearM)).toBe(true);
    // Far behind the same wall: the wall is in the way, not its cover.
    expect(inCoverFrom(eye, { x: -9, y: 0, z: 3.5 }, RANGE.boxes, 1)).toBe(false);
    expect(inCoverFrom(stanceEye({ x: 0, y: 0, z: 22 }), { x: 0, y: 0, z: -6 }, RANGE.boxes, LAUNCHER.coverNearM)).toBe(false);
  });

  it('fires at a soldier behind cover, bursting within reach of them, aimed high for the drop', () => {
    const shot = chooseRocket(ROCKET, LAUNCHER, stanceEye(SOUTH_OF_WALL), SOUTH_OF_WALL, BEHIND_WALL, [], [], WORLD);
    expect(shot).not.toBeNull();
    expect(shot!.missM).toBeLessThanOrEqual(ROCKET.blastRadiusM * LAUNCHER.reachFraction);
    expect(shot!.group).toBe(1);
  });

  it('fires at a soldier in the open only with another beside them: a group', () => {
    const from = { x: 0, y: 0, z: 22 };
    const target = { x: 0, y: 0, z: -6 };
    expect(chooseRocket(ROCKET, LAUNCHER, stanceEye(from), from, target, [], [], WORLD)).toBeNull();
    const shot = chooseRocket(ROCKET, LAUNCHER, stanceEye(from), from, target, [{ x: 1.5, y: 0, z: -6 }], [], WORLD);
    expect(shot?.group).toBe(2);
    // Someone it knows of far off is no group.
    expect(chooseRocket(ROCKET, LAUNCHER, stanceEye(from), from, target, [{ x: 10, y: 0, z: -6 }], [], WORLD)).toBeNull();
  });

  it('never fires with a friend inside the blast or in the flight', () => {
    const shot = (friends: { x: number; y: number; z: number }[]) =>
      chooseRocket(ROCKET, LAUNCHER, stanceEye(SOUTH_OF_WALL), SOUTH_OF_WALL, BEHIND_WALL, [], friends, WORLD);
    expect(shot([])).not.toBeNull();
    // Beside the target, well inside the blast.
    expect(shot([{ x: -7, y: 0, z: 1.5 }])).toBeNull();
    // Just past the blast and the margin: no reason to hold.
    expect(shot([{ x: -9 + ROCKET.blastRadiusM + LAUNCHER.safetyMarginM + 1, y: 0, z: 0.2 }])).not.toBeNull();
    // Standing in the line of fire halfway there.
    expect(shot([{ x: -9, y: 0, z: -14 }])).toBeNull();
  });
});

/** A range with every slot parked far off, and the gunner's knowledge of slot 0 kept fresh by `see`. */
function range(options: { cover?: boolean } = {}) {
  const session = new Session(undefined, '', 'range', { navMesh: mesh, ...(options.cover === false ? {} : { cover: bakedCoverFor('range') }) });
  session.slots.forEach((s, i) => (s.state = createMoveState(-60 + i * 4, 0, -95)));
  const step = (ticks: number, each?: (tick: number) => void) => {
    for (let i = 0; i < ticks; i++) {
      session.step((session.tick + 1) * TICK_MS);
      each?.(session.tick);
    }
  };
  return { session, step };
}

function spawn(session: Session, archetype: string, at: { x: number; z: number }, tree?: BrainTree): EnemyEntity {
  const id = session.spawnEnemy(archetype, { x: at.x, y: 0, z: at.z, yaw: 0, ...(tree ? { tree } : {}) }) as number;
  return session.enemies.find((e) => e.netId === id)!;
}

/** Keep slot `index` alive and where it was put, and the gunner knowing where it stands. */
function hold(session: Session, index: number, enemy: EnemyEntity): void {
  const slot = session.slots[index]!;
  Object.assign(slot.health, { current: slot.health.max, downedAt: null, diedAt: null });
  rememberSeen(enemy.memory, slot.netId, { x: slot.state.x, y: slot.state.y, z: slot.state.z }, session.tick / 30, false);
}

/** A fixture tree of one action that writes `memory` onto the blackboard every think. */
function wants(memory: () => Partial<BrainMemory>): BrainTree {
  const registry = createBrainRegistry().action('want', ({ blackboard }) => {
    for (const [k, v] of Object.entries(memory())) blackboard.set(k as keyof BrainMemory, v as never);
    return 'running';
  });
  return buildTree(parseTreeDef({ id: 'test-want', root: { type: 'action', name: 'want' } }), registry);
}

describe('the RPG archetype on the session (U-157)', () => {
  it('runs its own committed tree, which binds to the server registry, and carries its rockets', () => {
    expect(TREE_DEFS.has('rpg')).toBe(true);
    expect(() => buildTree(RPG.tree, createBrainRegistry())).not.toThrow();
    const { session } = range();
    const rpg = spawn(session, 'rpg', { x: 0, z: 30 });
    expect(rpg.pouch[ROCKET_INDEX]).toBe(LAUNCHER.rockets);
    expect(rpg.launcherInHand).toBe(true);
    expect(spawn(session, 'rifleman', { x: 4, z: 30 }).launcherInHand).toBe(false);
  });

  it('winds up on a soldier behind cover, fires a rocket, moves off, and does not fire again until it has reloaded', () => {
    const { session, step } = range();
    const target = session.slots[0]!;
    target.state = createMoveState(BEHIND_WALL.x, 0, BEHIND_WALL.z);
    const rpg = spawn(session, 'rpg', SOUTH_OF_WALL);
    const launches: { tick: number; at: { x: number; z: number } }[] = [];
    let tellFrom: number | null = null;
    const tells: number[] = [];
    const seen = new Set<number>();
    step(30 * 30, (tick) => {
      hold(session, 0, rpg);
      if (rpg.tell && tellFrom === null) tellFrom = tick;
      for (const p of session.projectilesNow()) {
        if (seen.has(p.netId) || p.ownerNetId !== rpg.netId) continue;
        seen.add(p.netId);
        expect(p.kind).toBe(ROCKET_INDEX);
        launches.push({ tick, at: { x: rpg.state.x, z: rpg.state.z } });
        tells.push(tellFrom === null ? 0 : tick - tellFrom);
      }
      if (!rpg.tell) tellFrom = null;
    });
    expect(launches.length).toBeGreaterThanOrEqual(2);
    // Each rocket after a wind-up of the archetype's length (to the think it ends on).
    for (const t of tells) expect(t / 30).toBeGreaterThanOrEqual(LAUNCHER.tellSeconds - 1 / 30);
    for (let i = 1; i < launches.length; i++) {
      // The long reload between rockets, and each from somewhere else: no cover in reach here, so a side step.
      expect((launches[i]!.tick - launches[i - 1]!.tick) / 30).toBeGreaterThanOrEqual(LAUNCHER.reloadSeconds);
      expect(Math.hypot(launches[i]!.at.x - launches[i - 1]!.at.x, launches[i]!.at.z - launches[i - 1]!.at.z)).toBeGreaterThan(LAUNCHER.relocateM - 0.5);
    }
    expect(rpg.pouch[ROCKET_INDEX]).toBe(LAUNCHER.rockets - launches.length);
  }, 30_000);

  it('never fires with a friend inside the blast', () => {
    const { session, step } = range();
    session.slots[0]!.state = createMoveState(BEHIND_WALL.x, 0, BEHIND_WALL.z);
    const rpg = spawn(session, 'rpg', SOUTH_OF_WALL);
    // A rifleman of its own side stands two metres from the target, told to do nothing.
    spawn(session, 'rifleman', { x: -7, z: 1.5 }, wants(() => ({})));
    let wound = 0;
    step(20 * 30, () => {
      hold(session, 0, rpg);
      if (rpg.tell) wound++;
    });
    expect(session.projectilesNow().filter((p) => p.ownerNetId === rpg.netId)).toEqual([]);
    expect(rpg.pouch[ROCKET_INDEX]).toBe(LAUNCHER.rockets);
    expect(wound).toBe(0);
  }, 30_000);

  it('uses its rifle up close: the launcher put away, rounds fired, no rocket', () => {
    const { session, step } = range({ cover: false });
    const target = session.slots[0]!;
    target.state = createMoveState(0, 0, -6);
    const rpg = spawn(session, 'rpg', { x: 0, z: -6 + LAUNCHER.minRangeM - 4 });
    const rounds0 = rpg.weaponState.shotIndex;
    let launcherUp = 0;
    step(5 * 30, () => {
      hold(session, 0, rpg);
      if (rpg.launcherInHand) launcherUp++;
    });
    expect(rpg.weaponState.shotIndex).toBeGreaterThan(rounds0);
    expect(rpg.pouch[ROCKET_INDEX]).toBe(LAUNCHER.rockets);
    // Out from the first think on (the brain thinks every third tick).
    expect(launcherUp).toBeLessThanOrEqual(3);
  });

  it('fires no rifle round while the launcher is in its hands, whatever its brain asks', () => {
    const { session, step } = range({ cover: false });
    session.slots[0]!.state = createMoveState(0, 0, -6);
    const rpg = spawn(session, 'rpg', { x: 0, z: 14 }, wants(() => ({ fireAt: session.slots[0]!.netId, rifle: false })));
    step(3 * 30, () => hold(session, 0, rpg));
    expect(rpg.weaponState.shotIndex).toBe(0);
    // The same ask with the rifle out fires.
    const rifle = spawn(session, 'rpg', { x: 2, z: 14 }, wants(() => ({ fireAt: session.slots[0]!.netId, rifle: true })));
    step(3 * 30, () => hold(session, 0, rifle));
    expect(rifle.weaponState.shotIndex).toBeGreaterThan(0);
  });

  it('spawns from an encounter group, on its own tree, holding its post with the launcher', async () => {
    const encounter = parseEncounter({
      world: 'greybox-01',
      aliveCap: 10,
      probes: [0.3, 1.0, 1.7],
      areas: {},
      groups: [{ id: 'rockets', members: [{ archetype: 'rpg', count: 1 }], zone: 'assault-flank', posture: { kind: 'hold', face: 'start' }, trigger: { kind: 'start' } }],
    });
    const session = new Session(undefined, '', requireWorld('greybox-01'), { navMesh: loadWorldNavMesh('greybox-01'), cover: bakedCoverFor('greybox-01'), encounter });
    // The squad out of every enemy's sight, as the spawner's own posture test has it.
    for (const s of session.slots) s.state = { ...s.state, x: 95, z: -95 };
    for (let t = 1; t <= 30; t++) session.step(t * TICK_MS);
    const [id] = session.spawner!.spawnedBy('rockets');
    const gunner = session.enemies.find((e) => e.netId === id)!;
    expect(gunner.def.id).toBe('rpg');
    expect(gunner.brain!.tree.runningPath().at(-1)).toMatch(/action:atEase$/);
    expect(gunner.launcherInHand).toBe(true);
    expect(gunner.pouch[ROCKET_INDEX]).toBe(LAUNCHER.rockets);
  });

  it('puts the launcher away for good once its rockets are spent', () => {
    const { session, step } = range();
    const rpg = spawn(session, 'rpg', { x: 0, z: 30 });
    rpg.pouch[ROCKET_INDEX] = 0;
    step(6);
    expect(rpg.launcherInHand).toBe(false);
  });
});
