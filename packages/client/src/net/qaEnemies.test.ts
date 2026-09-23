/**
 * `?enemies` (T-3.11): the in-page session with riflemen in it, end to end —
 * the real `Session` stepping them on the range's real navmesh, the real
 * wire, a real `NetClient`, and the renderer's `RemoteSoldiers` drawing what
 * that client decodes. This is the arrangement the browser run looks at.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_MOVE_CONFIG, DEFAULT_WORLD_ID, TICK_SECONDS } from '@sandline/shared';
import { type NavMesh, initNav } from '@sandline/server/nav';
import { loadWorldNavMesh } from '@sandline/server/nav/baked';
import { createHumanoidSoldier, soldierSkin } from '../character/humanoidSoldier.ts';
import { RemoteSoldiers } from '../character/remoteSoldiers.ts';
import { soldierAtlas } from '../character/soldierTexture.ts';
import { LocalServer } from './LocalServer.ts';
import { NetClient } from './NetClient.ts';
import { QA_ENEMY_PLACEMENTS, QaEnemies } from './qaEnemies.ts';

const TICK_MS = TICK_SECONDS * 1000;
const LAN = { latencyMs: 0, jitterMs: 0, lossRate: 0 };

let navMesh: NavMesh;
beforeAll(async () => {
  await initNav();
  navMesh = loadWorldNavMesh(DEFAULT_WORLD_ID);
});

describe('enemies on the in-page range (T-3.11)', () => {
  it('spawns the riflemen, walks the patrols, and draws them as the other side', () => {
    const server = new LocalServer(LAN, DEFAULT_MOVE_CONFIG, { navMesh });
    const qa = new QaEnemies(server);
    const net = new NetClient(server.transport, 'qa', DEFAULT_MOVE_CONFIG);
    net.join();
    const scene = new THREE.Scene();
    const remotes = new RemoteSoldiers({
      scene,
      shootable: [],
      create: createHumanoidSoldier,
      world: () => [],
      config: DEFAULT_MOVE_CONFIG,
    });

    const run = (ticks: number): void => {
      for (let i = 0; i < ticks; i += 1) {
        qa.step();
        server.step(server.tick * TICK_MS);
        net.advanceClock(TICK_MS);
        remotes.update(net, TICK_SECONDS);
      }
    };

    run(20);
    expect(net.joined).toBe(true);
    const enemyIds = server.enemyNetIds;
    expect(enemyIds).toHaveLength(QA_ENEMY_PLACEMENTS.length);
    const startAt = new Map(enemyIds.map((id) => [id, { ...remotes.get(id)!.position }]));

    run(240);
    // Still the same three: nothing died, so nothing was respawned.
    expect(server.enemyNetIds).toEqual(enemyIds);
    const moved = enemyIds.map((id) => {
      const from = startAt.get(id)!;
      const to = remotes.get(id)!.position;
      return Math.hypot(to.x - from.x, to.z - from.z);
    });
    // The first stands; the two patrols walk (8 s at walk pace is metres).
    expect(moved[0]).toBeLessThan(0.05);
    expect(moved[1]).toBeGreaterThan(3);
    expect(moved[2]).toBeGreaterThan(3);

    // Every remote the client returns is drawn: five bot slots in squad
    // colours, three enemies in the enemy palette, and nothing else.
    const enemyAtlas = soldierAtlas('enemy');
    let enemies = 0;
    let slots = 0;
    for (const id of net.remotes().keys()) {
      const mesh = remotes.get(id)!;
      const isEnemy = net.remoteEnemy(id) !== null;
      expect((soldierSkin(mesh).material as THREE.MeshLambertMaterial).map === enemyAtlas).toBe(isEnemy);
      if (isEnemy) enemies += 1;
      else slots += 1;
    }
    expect(enemies).toBe(3);
    expect(slots).toBe(5);
    expect(remotes.size).toBe(8);
    // The squad is still six, and no enemy has a slot to be listed under.
    expect(net.roster).toHaveLength(6);
    for (const id of enemyIds) expect(net.remoteSlot(id)).toBe(-1);
  });
});
