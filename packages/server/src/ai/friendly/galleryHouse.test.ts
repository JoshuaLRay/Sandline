/** U-124: the committed gallery bake supports the house and its roof stair. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ClientConnection,
  buildTree,
  createLoopbackPair,
  createMoveState,
  type Message,
} from '@sandline/shared';
import { createBrainRegistry } from '../Brain.ts';
import { initNav, type NavMesh, type NavPoint } from '../nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from '../nav/bakedNav.ts';
import { Session } from '../../session/Session.ts';

const OPEN = { x: 0, y: 0, z: 36 };
const INTERIOR = { x: 0, y: 0, z: 44 };
const ROOF = { ...INTERIOR, y: 3.25 };
const TICK_MS = 1000 / 30;
let mesh: NavMesh;

beforeAll(async () => {
  await initNav();
  mesh = loadWorldNavMesh('kit-gallery');
});
afterAll(() => mesh.destroy());

function gallery() {
  const session = new Session(undefined, '', 'kit-gallery', {
    navMesh: mesh,
    cover: bakedCoverFor('kit-gallery'),
    brainTree: buildTree('friendly', createBrainRegistry()),
  });
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  const failed: Extract<Message, { kind: 'OrderFailed' }>[] = [];
  const client = new ClientConnection(pair.b, { onOrderFailed: (m) => failed.push(m) });
  client.join('lead');
  pair.settle();
  session.slots.forEach((slot, i) => {
    const p = i === 1 ? OPEN : { x: 20 + i * 2, y: 0, z: -20 };
    slot.state = createMoveState(p.x, p.y, p.z);
  });
  const bot = session.slots[1]!;
  let tick = 0;
  return {
    session,
    bot,
    failed,
    order(point: NavPoint) {
      client.send({ kind: 'Order', order: 'move', address: { to: 'slot', index: 1 }, point, target: null });
      pair.settle();
    },
    runUntilReport(each?: () => void) {
      const count = session.orderReports.filter((r) => r.slot === 1).length;
      for (let t = 0; t < 30 * 30; t++) {
        client.send({ kind: 'Input', tick: ++tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0 });
        pair.settle();
        session.step((session.tick + 1) * TICK_MS);
        pair.settle();
        each?.();
        if (session.orderReports.filter((r) => r.slot === 1).length > count) return;
      }
    },
    reports: () => session.orderReports.filter((r) => r.slot === 1),
  };
}

function arrived(at: NavPoint, goal: NavPoint) {
  expect(Math.hypot(at.x - goal.x, at.z - goal.z)).toBeLessThan(0.6);
  expect(at.y).toBeCloseTo(goal.y, 1);
}

describe('the gallery house on its committed bake (U-124)', () => {
  it('includes the doorstep, floor beneath the roof, stair approach and roof on their intended levels', () => {
    for (const p of [{ x: 0, y: 0, z: 41 }, INTERIOR, { x: 2.85, y: 0, z: 40.6 }, { x: 2.85, y: 3.25, z: 45.5 }, ROOF]) {
      const near = mesh.nearestPoint(p, { x: 0.1, y: 0.1, z: 0.1 });
      expect(near, `missing gallery floor at ${JSON.stringify(p)}`).not.toBeNull();
      expect(Math.hypot(near!.point.x - p.x, near!.point.z - p.z)).toBeLessThan(0.1);
      expect(Math.abs(near!.point.y - p.y)).toBeLessThan(0.1);
    }
  });

  it.each([['interior', INTERIOR], ['roof', ROOF]] as const)('has a complete path from open ground to the %s', (_, goal) => {
    const path = mesh.path(OPEN, goal);
    expect(path).not.toBeNull();
    expect(Math.hypot(path!.points.at(-1)!.x - goal.x, path!.points.at(-1)!.z - goal.z)).toBeLessThan(0.1);
    expect(Math.abs(path!.points.at(-1)!.y - goal.y)).toBeLessThan(0.1);
    if (goal === ROOF) {
      expect(path!.vaults, 'the stair and landing must provide a walking route').toEqual([]);
      const stair = mesh.polygons().filter((p) => path!.corridor.includes(p.ref) &&
        p.centre.x > 2.3 && p.centre.x < 3.4 && p.centre.y > 0.5 && p.centre.y < 3);
      expect(stair.length, 'roof route must climb the authored stair').toBeGreaterThan(0);
    }
  });

  it('a wire move order enters the house through its doorway', () => {
    const g = gallery();
    try {
      let throughDoor = false;
      g.order(INTERIOR);
      g.runUntilReport(() => {
        throughDoor ||= Math.abs(g.bot.state.x) < 0.6 && Math.abs(g.bot.state.z - 42) < 0.3 && g.bot.state.y < 0.1;
      });
      expect(g.reports()).toEqual([expect.objectContaining({ order: 'move', outcome: 'done' })]);
      expect(g.failed).toEqual([]);
      expect(throughDoor).toBe(true);
      arrived(g.bot.state, INTERIOR);
    } finally {
      g.session.close();
    }
  });

  it('a wire move order climbs the stair to y3.25, then reaches the interior at identical x/z and y0', () => {
    const g = gallery();
    try {
      let climbedStair = false;
      g.order(ROOF);
      g.runUntilReport(() => {
        climbedStair ||= g.bot.state.x > 2.3 && g.bot.state.x < 3.4 && g.bot.state.y > 0.5 && g.bot.state.y < 3;
      });
      expect(g.reports()).toEqual([expect.objectContaining({ order: 'move', outcome: 'done' })]);
      expect(climbedStair).toBe(true);
      arrived(g.bot.state, ROOF);
      console.log(`[U-124] roof arrival: (${g.bot.state.x.toFixed(2)}, ${g.bot.state.y.toFixed(2)}, ${g.bot.state.z.toFixed(2)})`);

      g.order(INTERIOR);
      g.runUntilReport();
      expect(g.reports().at(-1)).toMatchObject({ order: 'move', outcome: 'done' });
      expect(g.reports().some((r) => r.outcome === 'failed')).toBe(false);
      expect(g.failed).toEqual([]);
      arrived(g.bot.state, INTERIOR);
      console.log(`[U-124] interior arrival: (${g.bot.state.x.toFixed(2)}, ${g.bot.state.y.toFixed(2)}, ${g.bot.state.z.toFixed(2)})`);
    } finally {
      g.session.close();
    }
  });
});
