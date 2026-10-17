import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MOVE_CONFIG, blockedAt, supportUnder } from '@sandline/shared';
import { NavMesh, completePathLength, initNav } from '../../../server/src/ai/nav/NavMesh.ts';
import { bakeRoadSupportNav } from './qalatRoadNav.ts';
import { at, fixture, heldSlots, play, pool, rescueMission, world } from './outpostSessionFixture.ts';

let nav: NavMesh;
const stands = [at(13.2, 400), at(18.8, 400), at(13.2, 404), at(18.8, 404), at(13.2, 408)];
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe('U-226 actual replacement Session rescue and safe return', () => {
  beforeAll(async () => { await initNav(); nav = NavMesh.load(await bakeRoadSupportNav(fixture.world)); }, 240_000);
  afterAll(() => nav?.destroy());

  for (const run of ['campaign', 'replay'] as const) for (const count of [0, 1, 5]) {
    it(`${run}: independently rescues POW and ${count} squad captives, then returns all seven actors`, async () => {
      const slots = heldSlots(count), mission = rescueMission(slots), input = pool(run, count);
      const p = play(input, { nav, mission }), host = p.join();
      const send = (message: Parameters<typeof p.send>[1]) => p.send(host, message);
      const bodies = () => [...p.session.slots.filter((s) => !s.captured), p.pow()];
      let ticks = 0;
      const advance = async (n = 1, interact = false, movement = { yaw: 0, moveY: 0 }) => {
        for (let i = 0; i < n; i++) {
          p.step(1, interact, movement); ticks++;
          for (const b of bodies()) {
            const q = b.state;
            expect(q.y).toBeCloseTo(8, 6); expect(q.vault).toBeNull();
            expect(q.x >= 9 && q.x <= 44 && q.z >= 367 && q.z <= 410, 'left bounded cell/court return').toBe(true);
            expect(blockedAt(q.x, q.z, DEFAULT_MOVE_CONFIG.radius, q.y, .05, DEFAULT_MOVE_CONFIG.height, world.boxes)).toBe(false);
            expect(supportUnder(q.x, q.z, DEFAULT_MOVE_CONFIG.radius, q.y + .01, world.boxes, 0)).toBeCloseTo(8, 6);
            expect(b.health.current).toBe(b.health.max);
          }
          if (ticks % 128 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
        }
      };
      const walk = async (slot: number, goal: ReturnType<typeof at>) => {
        const soldier = p.session.slots[slot]!, path = nav.path(soldier.state, goal);
        expect(completePathLength(path, soldier.state, goal)).not.toBeNull(); expect(path!.vaults).toEqual([]);
        if (slot === 0) {
          // A human walks the standing nav corners with ordinary wire inputs.
          // Other soldiers retain production bot/orders and collision bodies.
          for (const point of [...path!.points.slice(1), goal]) {
            for (let i = 0; i < 1500 && distance(soldier.state, point) > .25; i++) {
              const yaw = Math.round(Math.atan2(point.x - soldier.state.x, point.z - soldier.state.z) * 1024 / (2 * Math.PI)) & 1023;
              await advance(1, false, { yaw, moveY: 1 });
            }
          }
        } else {
          send({ kind: 'Order', order: 'move', address: { to: 'slot', index: slot }, point: goal, target: null });
          for (let i = 0; i < 1500 && distance(soldier.state, goal) > .55; i++) await advance();
        }
        expect(distance(soldier.state, goal), `slot${slot} stranded: ${JSON.stringify(soldier.state)}`).toBeLessThan(.55);
        send({ kind: 'Order', order: 'hold', address: { to: 'slot', index: slot }, point: null, target: null });
      };
      try {
        send({ kind: 'Order', order: 'hold', address: { to: 'all' }, point: null, target: null });
        expect(p.captured()).toEqual(slots.map((slot, i) => ({ slot, at: fixture.mission.prisonerHoldings[i]!.feet })));
        expect(p.pow().state).toMatchObject({ x: 16, y: 8, z: 402 });
        expect(p.pow().captive).toBe(true);
        await walk(0, at(16, 400.8));
        // Letting go interrupts the ordinary timed interaction.
        await advance(15, true); expect(p.pow().captive).toBe(true);
        await advance(1); expect(p.session.mission!.progress).toBe(0);
        await advance(40, true); expect(p.pow().captive).toBe(false);
        expect(p.captured()).toHaveLength(count); // POW rescue never frees a squad slot.
        send({ kind: 'Order', order: 'hold', address: { to: 'all' }, point: null, target: null });
        for (const [i, slot] of slots.entries()) {
          await walk(0, at(16, 392)); await walk(0, stands[i]!);
          await advance(40, true);
          expect(p.session.slots[slot]!.captured).toBe(false);
          expect(p.captured().map((s) => s.slot)).toEqual(slots.slice(i + 1));
          expect(p.pow().captive).toBe(false);
          // Stage each freed body outside the cell before the next approach.
          await walk(slot, at(16, 392)); await walk(slot, world.squadStarts[slot]!);
        }
        expect(p.session.mission).toMatchObject({ type: 'survive', state: 'progress' });
        expect(p.session.slots).toHaveLength(6); expect(p.session.enemies).toHaveLength(1);
        // The real escort follows all-squad move orders through the cell and
        // antechamber doors. Soldiers already staged outside retain their holds.
        await walk(0, at(16, 392)); await walk(0, at(16, 380));
        send({ kind: 'Order', order: 'move', address: { to: 'all' }, point: at(16, 380), target: null });
        for (let i = 0; i < 2400 && bodies().some((b) => b.state.z > 385); i++) await advance();
        expect(bodies().every((b) => b.state.z < 386), 'a rescued actor remained in the cell/antechamber').toBe(true);
        for (const goal of [at(36, 380), at(16, 380)]) {
          send({ kind: 'Order', order: 'move', address: { to: 'all' }, point: goal, target: null });
          for (let i = 0; i < 2400 && distance(p.pow().state, goal) > 2; i++) await advance();
          expect(distance(p.pow().state, goal)).toBeLessThanOrEqual(2);
        }
        const saved = p.save();
        if (run === 'campaign') {
          expect(saved.soldiers.every((s) => !s.captured)).toBe(true);
          expect(saved.replayPrisoners).toEqual(input.replayPrisoners);
        } else {
          expect(saved.replayPrisoners).toEqual([]);
          expect(saved.soldiers[4]!.prisoner).toEqual(input.soldiers[4]!.prisoner);
        }
        console.log(`U-226 ${run} POW+${count}: ${ticks} ticks; rescue/return, no full mission verdict`);
      } finally { p.close(); }
    }, 180_000);
  }
});
