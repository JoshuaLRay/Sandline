import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CampaignDatabase, type CampaignState, newCampaignState } from './CampaignDatabase.ts';
import { type MissionStartCheckpoint, parseMissionStart } from '../session/checkpointWorld.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function state(): CampaignState {
  const state = newCampaignState('greybox-01');
  state.completedMissions = ['earlier'];
  state.soldiers[3] = { slot: 3, classId: 'marksman', rank: 3, xp: 740, captured: true, prisoner: { x: 5, y: 8, z: 14 } };
  state.replayPrisoners = [{ slot: 2, at: { x: 10, y: 16, z: 7 } }];
  state.checkpoint = {
    mission: 'greybox-01', mapRevision: 2, objective: 1, elapsedTicks: 90,
    spawns: Array.from({ length: 6 }, (_, i) => ({ x: i * 2, y: 8, z: 10 })),
    completedGroups: ['one-shot'], event: { fired: ['loot'], pending: [['timer', 30]] },
    missionStart: {
      slots: Array.from({ length: 6 }, () => ({
        health: 100, weapon: 'carbine', primary: 'carbine', secondary: null,
        noPistol: false, pickedUp: true, ammo: [['carbine', 7]], pouch: [0, 1], kits: 2, equipment: -1,
      })),
      captured: [{ slot: 1, at: { x: 4, y: 8, z: 12 } }],
    },
  };
  return state;
}

describe('durable checkpoint provenance and original start data (U-135)', () => {
  it('retains revision, start inventory, timers and both distinct prisoner pools across a real SQLite reopen', () => {
    const root = mkdtempSync(join(tmpdir(), 'sandline-revision-'));
    roots.push(root);
    const file = join(root, 'campaigns.sqlite');
    const db = new CampaignDatabase(file);
    const campaign = db.createCampaign('owner', 'greybox-01', 100, 'ACDEFGHJ');
    const input = state();
    const saved = db.saveCampaign(campaign.code, input, 200);
    db.close();
    const next = new CampaignDatabase(file);
    expect(next.loadCampaign(campaign.code)).toEqual(saved);
    expect(saved.state).toEqual(input);
    next.close();
  });

  it('does not assign a revision or start snapshot to legacy saves', () => {
    const db = new CampaignDatabase(':memory:');
    const made = db.createCampaign('owner', 'greybox-01', 100, 'ACDEFGHJ');
    const old = state();
    delete old.checkpoint!.mapRevision;
    delete old.checkpoint!.missionStart;
    const saved = db.saveCampaign(made.code, old);
    expect(saved.state).toEqual(old);
    expect(saved.state.checkpoint!.mapRevision).toBeUndefined();
    expect(saved.state.checkpoint!.missionStart).toBeUndefined();
    db.close();
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null])('refuses malformed durable revision %s without overwriting acknowledged data', (value) => {
    const db = new CampaignDatabase(':memory:');
    const made = db.createCampaign('owner', 'greybox-01', 100, 'ACDEFGHJ');
    const input = state();
    input.checkpoint!.mapRevision = value as number;
    expect(() => db.saveCampaign(made.code, input)).toThrow(/mapRevision/);
    expect(db.loadCampaign(made.code)).toEqual(made);
    db.close();
  });

  it('refuses partial, duplicated, malformed or unbounded baselines as a whole', () => {
    const baseline = state().checkpoint!.missionStart!;
    const invalid: unknown[] = [
      null, [], { ...baseline, typo: true },
      { ...baseline, slots: baseline.slots.slice(0, 5) },
      { ...baseline, slots: [...baseline.slots, baseline.slots[0]] },
      { ...baseline, slots: baseline.slots.map((s, i) => i ? s : { ...s, kits: -1 }) },
      { ...baseline, captured: [...baseline.captured, ...baseline.captured] },
      { ...baseline, captured: [{ slot: 6, at: { x: 0, y: 0, z: 0 } }] },
      { ...baseline, captured: [{ slot: 0, at: { x: 0, y: Infinity, z: 0 } }] },
      { ...baseline, captured: [{ slot: 0, typo: true, at: { x: 0, y: 0, z: 0 } }] },
    ];
    const db = new CampaignDatabase(':memory:');
    const made = db.createCampaign('owner', 'greybox-01', 100, 'ACDEFGHJ');
    for (const bad of invalid) {
      expect(parseMissionStart(bad)).toBeNull();
      const input = state();
      input.checkpoint!.missionStart = bad as MissionStartCheckpoint;
      expect(() => db.saveCampaign(made.code, input)).toThrow(/missionStart/);
      expect(db.loadCampaign(made.code)).toEqual(made);
    }
    db.close();
  });
});
