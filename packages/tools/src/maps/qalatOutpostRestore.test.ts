import { describe, expect, it } from 'vitest';
import { missionFor, requireWorld, type MissionDef } from '@sandline/shared';
import type { CampaignState } from '../../../server/src/persistence/CampaignDatabase.ts';
import type { CheckpointWorld } from '../../../server/src/session/checkpointWorld.ts';
import { fixture, heldSlots, play, pool, world } from './outpostSessionFixture.ts';

function checkpoint(run: 'campaign' | 'replay', count: number) {
  const p = play(pool(run, count));
  try {
    p.step(2);
    p.session.slots[0]!.weaponState.ammo = 1; p.session.slots[0]!.kits = 0;
    const host = p.join();
    p.send(host, { kind: 'SupplySelect', requestId: 1, cacheId: 'fixture-stock', item: { kind: 'health-kit' } });
    p.step(35, true);
    expect(p.session.supplyCaches[0]!.stock.healthKits).toBe(0);
    expect(p.session.slots[0]!.kits).toBe(1);
    p.session.slots[0]!.kits = 0;
    p.session.slots[0]!.state.x += .25;
    // Same-revision saves must keep later exact positions, rather than silently
    // snapping either prisoner kind back to its original authored socket.
    for (const s of p.session.slots.filter((s) => s.captured)) {
      s.prisoner = { ...s.prisoner!, x: s.prisoner!.x + .125, z: s.prisoner!.z + .25 };
      Object.assign(s.state, s.prisoner);
    }
    p.pow().state.x += .25; p.pow().state.z += .25;
    return p.save();
  } finally { p.close(); }
}
function oldSave(run: 'campaign' | 'replay', count: number, revision: number | undefined) {
  const saved = checkpoint(run, count);
  if (revision === undefined) delete saved.checkpoint!.mapRevision;
  else saved.checkpoint!.mapRevision = revision;
  const old = { x: -60, y: 0, z: 12 };
  saved.checkpoint!.spawns = saved.checkpoint!.spawns.map(() => ({ ...old }));
  for (const p of saved.checkpoint!.missionStart!.captured) p.at = { ...old };
  for (const s of saved.soldiers) if (s.captured && run === 'campaign') s.prisoner = { ...old };
  if (run === 'replay') for (const p of saved.replayPrisoners ?? []) p.at = { ...old };
  for (const e of (saved.checkpoint!.world as CheckpointWorld).enemies) Object.assign(e, old);
  return saved;
}
function otherPool(after: CampaignState, before: CampaignState, run: 'campaign' | 'replay') {
  expect(after.completedMissions).toEqual(before.completedMissions);
  expect(after.soldiers[0]).toMatchObject({ xp: before.soldiers[0]!.xp, rank: before.soldiers[0]!.rank,
    loadout: before.soldiers[0]!.loadout });
  if (run === 'campaign') expect(after.replayPrisoners).toEqual(before.replayPrisoners);
  else expect(after.soldiers).toEqual(before.soldiers);
}

describe('U-226 replacement Session checkpoint/restart matrix', () => {
  for (const run of ['campaign', 'replay'] as const) for (const count of [0, 1, 5]) {
    it(`${run}/${count}: exact elevated restore and failed retry retain spent stock and both pools`, () => {
      const saved = checkpoint(run, count), original = structuredClone(saved), p = play(saved), host = p.join();
      try {
        expect(p.gate(host)).toBeNull();
        expect(p.inventory()).toEqual((saved.checkpoint!.world as CheckpointWorld).slots);
        expect(p.session.slots.map((s) => ({ x: s.state.x, y: s.state.y, z: s.state.z }))).toEqual(saved.checkpoint!.spawns);
        expect(p.pow().state).toMatchObject({ x: 16.25, y: 8, z: 402.25 });
        expect(p.pow().captive).toBe(true);
        expect(p.session.supplyCaches[0]!.stock.healthKits).toBe(0);
        const captured = p.captured();
        expect(captured).toEqual(heldSlots(count).map((slot, i) => ({ slot, at: {
          ...fixture.mission.prisonerHoldings[i]!.feet, x: fixture.mission.prisonerHoldings[i]!.feet.x + .125,
          z: fixture.mission.prisonerHoldings[i]!.feet.z + .25,
        } })));
        // A real failed mission, rather than calling reset on a healthy run.
        Object.assign(p.session.slots[0]!.health, { current: 0, diedAt: 1 }); p.step(2);
        expect(p.session.mission!.state).toBe('failed');
        p.send(host, { kind: 'MissionRestart' });
        expect(p.session.mission!.state).toBe('progress'); expect(p.captured()).toEqual(captured);
        expect(p.inventory()).toEqual((saved.checkpoint!.world as CheckpointWorld).slots);
        expect(p.session.supplyCaches[0]!.stock.healthKits).toBe(0);
        expect(p.session.enemies).toHaveLength(1); expect(p.pow().captive).toBe(true);
        otherPool(p.save(), saved, run); expect(saved).toEqual(original);
      } finally { p.close(); }
    });

    for (const revision of [1, undefined]) it(`${run}/${count}: revision ${revision} restarts only original pool at authored holdings`, () => {
      const saved = oldSave(run, count, revision), original = structuredClone(saved), p = play(saved), host = p.join();
      try {
        expect(p.gate(host)).toMatchObject({ restart: 'original' });
        expect(p.session.started).toBe(false); expect(p.session.enemies).toHaveLength(0);
        expect(p.session.slots.every((s) => s.prisoner === null && s.state.y === 8)).toBe(true);
        p.step(30); expect(p.session.tick).toBe(0); expect(p.saves).toEqual([]);
        p.send(host, { kind: 'MissionRestart', full: true });
        const expected = heldSlots(count).map((slot, i) => ({ slot, at: fixture.mission.prisonerHoldings[i]!.feet }));
        expect(p.gate(host)).toBeNull(); expect(p.captured()).toEqual(expected);
        expect(p.inventory()).toEqual(saved.checkpoint!.missionStart!.slots);
        expect(p.session.enemies).toHaveLength(1); expect(p.pow().captive).toBe(true);
        expect(p.pow().state).toMatchObject({ x: 16, y: 8, z: 402 });
        const after = p.save(); otherPool(after, saved, run);
        expect(after.checkpoint).toMatchObject({ mapRevision: 2, missionStart: { captured: expected } });
        const reloaded = play(after), owner = reloaded.join();
        try {
          for (let i = 0; i < 3; i++) {
            reloaded.send(owner, { kind: 'MissionRestart', full: true });
            expect(reloaded.captured()).toEqual(expected); expect(reloaded.session.enemies).toHaveLength(1);
          }
        } finally { reloaded.close(); }
        expect(saved).toEqual(original);
      } finally { p.close(); }
    });

    for (const holdings of [undefined, fixture.mission.prisonerHoldings.slice(0, Math.max(0, count - 1))]) {
      if (!count) continue;
      it(`${run}/${count}: ${holdings ? 'insufficient' : 'missing'} holdings refuse restart and preserve mission select`, () => {
        const saved = oldSave(run, count, 1), mission: MissionDef = { ...fixture.mission };
        if (holdings) mission.prisonerHoldings = holdings;
        else delete mission.prisonerHoldings;
        const p = play(saved, { mission }), host = p.join(), guest = p.join();
        try {
          expect(p.gate(host)).toMatchObject({ restart: 'prisoner-placement' });
          p.send(host, { kind: 'MissionRestart', full: true }); p.step(30);
          expect(p.session.slots.every((s) => s.prisoner === null)).toBe(true); expect(p.session.enemies).toHaveLength(0);
          expect(p.snapshot()).toEqual(saved); expect(p.saves).toEqual([]);
          p.send(guest, { kind: 'RoomCommand', command: 'choose', run: 'replay', mission: 'earlier' });
          expect(p.handoffs()).toBe(0);
          p.send(host, { kind: 'RoomCommand', command: 'choose', run: 'replay', mission: 'earlier' });
          const after = p.saves.at(-1)!;
          expect(p.handoffs()).toBe(1); expect(after.checkpoint).toEqual(saved.checkpoint);
          expect(after.soldiers).toEqual(saved.soldiers); expect(after.replayPrisoners).toEqual(saved.replayPrisoners);
          expect(after.completedMissions).toEqual(saved.completedMissions);
        } finally { p.close(); }
      });
    }
  }

  for (const run of ['campaign', 'replay'] as const) {
    it(`${run}: later captures do not enter original restart pool; reconnect and ready-up cannot bypass host choice`, () => {
      const saved = oldSave(run, 1, 1), later = { slot: 5, at: { x: -59, y: 0, z: 13 } };
      if (run === 'campaign') Object.assign(saved.soldiers[5]!, { captured: true, prisoner: later.at });
      else saved.replayPrisoners!.push(later);
      const p = play(saved, { lobby: true }), host = p.join(), guest = p.join();
      try {
        for (const person of [host, guest]) p.send(person, { kind: 'RoomCommand', command: 'ready', ready: true });
        p.send(host, { kind: 'RoomCommand', command: 'start' });
        p.send(host, { kind: 'MissionRestart' });
        p.send(guest, { kind: 'MissionRestart', full: true });
        p.send(host, { kind: 'RoomCommand', command: 'choose', run, mission: 'later' });
        expect(p.session.started).toBe(false); expect(p.saves).toEqual([]);
        host.pair.b.close('drop'); p.step(2);
        expect(p.gate(guest)).toMatchObject({ host: guest.client.slot });
        const resumed = p.join(host.resume);
        expect(resumed.client.slot).toBe(0); expect(p.session.stats.resumes).toBe(1);
        expect(p.gate(resumed)).toMatchObject({ host: 0, restart: 'original' });
        p.send(guest, { kind: 'MissionRestart', full: true }); expect(p.saves).toEqual([]);
        p.send(resumed, { kind: 'MissionRestart', full: true });
        expect(p.session.started).toBe(false);
        expect(p.captured()).toEqual([{ slot: 1, at: fixture.mission.prisonerHoldings[0]!.feet }]);
        const acknowledged = p.saves.at(-1)!, reloaded = play(acknowledged, { lobby: true }), owner = reloaded.join();
        try {
          reloaded.send(owner, { kind: 'RoomCommand', command: 'ready', ready: true });
          expect(reloaded.session.started).toBe(true); expect(reloaded.session.enemies).toHaveLength(1);
          reloaded.session.restartMission();
          expect(reloaded.captured()).toEqual(p.captured()); expect(reloaded.session.enemies).toHaveLength(1);
        } finally { reloaded.close(); }
      } finally { p.close(); }
    });

    it(`${run}: legacy inventory restart and unrelated checkpoints stay independent`, () => {
      const saved = oldSave(run, 5, undefined); delete saved.checkpoint!.missionStart;
      const p = play(saved), host = p.join();
      try {
        expect(p.gate(host)).toMatchObject({ restart: 'legacy' });
        p.send(host, { kind: 'MissionRestart', full: true });
        expect(p.session.slots[0]!.kits).toBe(run === 'campaign' ? 2 : 3);
        expect(p.session.slots[0]!.weaponState.ammo).toBe(run === 'campaign' ? 7 : 30);
        expect(p.captured()).toHaveLength(5); otherPool(p.save(), saved, run);
      } finally { p.close(); }
      for (const unrelated of ['mission', 'run'] as const) {
        const input = structuredClone(saved);
        if (unrelated === 'mission') input.checkpoint!.mission = 'earlier';
        else input.checkpoint!.run = run === 'campaign' ? 'replay' : 'campaign';
        const fresh = play(input);
        try {
          expect(fresh.session.started).toBe(true); fresh.session.restartMission();
          expect(fresh.snapshot().checkpoint).toEqual(input.checkpoint);
        } finally { fresh.close(); }
      }
    });
  }

  it('keeps replacement unregistered and the old live mission without replacement coordinates', () => {
    expect(missionFor(world.id)).toBeUndefined();
    expect(requireWorld('qalat-road').mapRevision ?? 1).toBe(1);
    expect(missionFor('qalat-road')!.prisonerHoldings).toBeUndefined();
  });
});
