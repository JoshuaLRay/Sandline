import { describe, expect, it } from 'vitest';
import { DEFAULT_MOVE_CONFIG, buildTree, createMoveState } from '@sandline/shared';
import { createBrainRegistry } from '../ai/Brain.ts';
import { initNav } from '../ai/nav/NavMesh.ts';
import { bakedCoverFor, loadWorldNavMesh } from '../ai/nav/bakedNav.ts';
import { Session } from './Session.ts';

describe('Session character separation (U-099)', () => {
  it('separates six stationary bots initialized at the same point', () => {
    const session = new Session();
    for (const slot of session.slots) slot.state = createMoveState(0, 0, -10);
    // Reproduction: the ordinary controller leaves every idle footprint here.
    expect(new Set(session.slots.map((s) => `${s.state.x},${s.state.z}`)).size).toBe(1);
    for (let tick = 0; tick < 6; tick++) session.step((session.tick + 1) * 1000 / 30);
    for (let i = 0; i < session.slots.length; i++) for (let j = i + 1; j < session.slots.length; j++) {
      const a = session.slots[i]!.state;
      const b = session.slots[j]!.state;
      expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z))).toBeGreaterThanOrEqual(2 * DEFAULT_MOVE_CONFIG.radius - 1e-6);
    }
  });
  it('gets opposing squads through the doorway without overlapping', async () => {
    await initNav();
    const mesh = loadWorldNavMesh('range');
    try {
      const session = new Session(undefined, '', 'range', { navMesh: mesh, cover: bakedCoverFor('range'), brainTree: buildTree('friendly', createBrainRegistry()) });
      const xs = [-10.2, -8.4, -6.6];
      const goals = session.slots.map((s, i) => ({ x: xs[2 - i % 3]!, y: 0, z: i < 3 ? 6.5 : 2 }));
      for (const s of session.slots) {
        s.state = createMoveState(xs[s.index % 3]!, 0, s.index < 3 ? 2 : 6.5);
        session.orderFrom(0, { order: 'move', address: { to: 'slot', index: s.index }, point: goals[s.index]!, target: null });
      }
      const arrived = new Set<number>();
      for (let tick = 0; tick < 1800 && arrived.size < 6; tick++) {
        session.step((session.tick + 1) * 1000 / 30);
        for (const s of session.slots) if (Math.hypot(s.state.x - goals[s.index]!.x, s.state.z - goals[s.index]!.z) < 0.8) arrived.add(s.index);
        for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
          const a = session.slots[i]!.state; const b = session.slots[j]!.state;
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(2 * DEFAULT_MOVE_CONFIG.radius - 1e-6);
        }
      }
      expect([...arrived].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    } finally { mesh.destroy(); }
  }, 30000);
});
