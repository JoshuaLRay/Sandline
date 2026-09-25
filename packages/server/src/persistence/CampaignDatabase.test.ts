import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PLAYER_RETENTION_MS } from '../identity/PlayerDirectory.ts';
import {
  CAMPAIGN_SCHEMA_VERSION,
  CampaignDatabase,
  SqlitePlayerDirectory,
  newCampaignState,
} from './CampaignDatabase.ts';

const roots: string[] = [];
function file(): string {
  const root = mkdtempSync(join(tmpdir(), 'sandline-campaign-'));
  roots.push(root);
  return join(root, 'campaigns.sqlite');
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function advanced(world = 'mission-01') {
  const state = newCampaignState(world);
  state.completedMissions.push('greybox-01');
  state.checkpoint = {
    mission: world,
    objective: 2,
    elapsedTicks: 912,
    spawns: Array.from({ length: 6 }, (_, slot) => ({ x: slot * 2, y: 0, z: -12 - slot })),
    completedGroups: ['patrol', 'gate'],
    event: { fired: ['open-gate'], flags: ['briefed'] },
  };
  state.soldiers[2] = { slot: 2, classId: 'marksman', rank: 3, xp: 740 };
  return state;
}

describe('campaign persistence (T-4.23)', () => {
  it('saves and restores a campaign from a real SQLite file', () => {
    const path = file();
    const first = new CampaignDatabase(path);
    const made = first.createCampaign('player-one', 'mission-01', 1000, 'ACDEFGHJ');
    const saved = first.saveCampaign(made.code, advanced(), 2000);
    expect(saved.revision).toBe(2);
    first.close();

    const reopened = new CampaignDatabase(path);
    expect(reopened.loadCampaign('acde-fghj')).toEqual(saved);
    reopened.close();
  });

  it('is idempotent and retries a failed write without double-advancing the revision', () => {
    const path = file();
    let failBefore = true;
    const db = new CampaignDatabase(path, {
      fault: (phase) => {
        if (phase === 'before-commit' && failBefore) {
          failBefore = false;
          throw new Error('disk was briefly unavailable');
        }
      },
    });
    const made = db.createCampaign('owner', 'mission-01', 1000, 'ACDEFGHJ');
    const state = advanced();
    const saved = db.saveCampaign(made.code, state, 2000);
    expect(saved.revision).toBe(2);
    expect(db.saveCampaign(made.code, state, 3000)).toEqual(saved);
    db.close();
  });

  it('keeps the last acknowledged state across a crash before commit, and an ack-lost retry observes the committed write', () => {
    const path = file();
    const seed = new CampaignDatabase(path);
    const made = seed.createCampaign('owner', 'mission-01', 1000, 'ACDEFGHJ');
    const acknowledged = advanced();
    seed.saveCampaign(made.code, acknowledged, 2000);
    seed.close();

    const rejected = newCampaignState('mission-01');
    rejected.completedMissions.push('should-not-land');
    const crashing = new CampaignDatabase(path, {
      writeAttempts: 1,
      fault: (phase) => {
        if (phase === 'before-commit') throw new Error('process died mid-write');
      },
    });
    expect(() => crashing.saveCampaign(made.code, rejected, 3000)).toThrow(/process died/);
    crashing.close();

    let loseAck = true;
    const retrying = new CampaignDatabase(path, {
      fault: (phase) => {
        if (phase === 'after-commit' && loseAck) {
          loseAck = false;
          throw new Error('commit landed but acknowledgement was lost');
        }
      },
    });
    const next = advanced();
    next.soldiers[0] = { slot: 0, classId: 'leader', rank: 1, xp: 25 };
    const afterLostAck = retrying.saveCampaign(made.code, next, 4000);
    expect(afterLostAck.revision).toBe(3);
    retrying.close();

    const reopened = new CampaignDatabase(path);
    expect(reopened.loadCampaign(made.code)?.state).toEqual(next);
    expect(reopened.loadCampaign(made.code)?.revision).toBe(3);
    reopened.close();
  });

  it('runs schema migrations from version zero and leaves the file usable', () => {
    const path = file();
    const old = new DatabaseSync(path);
    old.exec('CREATE TABLE legacy_marker (value TEXT); INSERT INTO legacy_marker VALUES (\'keep me\'); PRAGMA user_version = 0;');
    old.close();

    const migrated = new CampaignDatabase(path);
    expect(migrated.schemaVersion).toBe(CAMPAIGN_SCHEMA_VERSION);
    const made = migrated.createCampaign('owner', 'mission-01', 1000, 'ACDEFGHJ');
    expect(migrated.loadCampaign(made.code)?.ownerId).toBe('owner');
    migrated.close();

    const inspect = new DatabaseSync(path);
    expect((inspect.prepare('SELECT value FROM legacy_marker').get() as { value: string }).value).toBe('keep me');
    inspect.close();
  });

  it('puts the player directory in the same SQLite file and retains campaign owners', () => {
    const path = file();
    const db = new CampaignDatabase(path);
    const directory = new SqlitePlayerDirectory(db);
    directory.touch('owner', 'Bravo', 1000);
    directory.touch('visitor', 'Alpha', 1000);
    db.createCampaign('owner', 'mission-01', 1000, 'ACDEFGHJ');
    db.close();

    const reopened = new CampaignDatabase(path);
    const durable = new SqlitePlayerDirectory(reopened);
    expect(durable.get('owner')).toEqual({ id: 'owner', name: 'Bravo', firstSeen: 1000, lastSeen: 1000 });
    expect(durable.prune(1000 + PLAYER_RETENTION_MS + 1)).toBe(1);
    expect(durable.get('owner')?.name).toBe('Bravo');
    expect(durable.get('visitor')).toBeUndefined();
    reopened.close();
  });
});
