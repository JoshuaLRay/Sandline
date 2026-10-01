/**
 * U-077: a campaign run starts each soldier from the loadout the campaign holds (guns, rounds, pouch, kits,
 * equipment), written when a mission is won; a retry or a restart returns to that start; a replay run starts from
 * the class's loadout and, by the campaign's data, keeps what it ends with for the campaign; an older save with no
 * loadout starts from the class's.
 */
import { describe, expect, it } from 'vitest';
import { ClientConnection, type MissionDef, createLoopbackPair, getWeapon, parseEncounter, requireWorld, CAMPAIGN } from '@sandline/shared';
import { type CampaignState, newCampaignState } from '../persistence/CampaignDatabase.ts';
import { Session } from './Session.ts';

const TICK_MS = 1000 / 30;
const world = requireWorld('greybox-01');

const ENCOUNTER = parseEncounter({
  world: 'greybox-01',
  aliveCap: 10,
  probes: [0.3, 1.0, 1.7],
  areas: {},
  groups: [{ id: 'a', members: [{ archetype: 'rifleman', count: 2 }], zone: 'behind-objective', posture: { kind: 'garrison', at: 'objective' }, trigger: { kind: 'start' } }],
});
const ONE: MissionDef = { id: 'test', world: 'greybox-01', respawn: false, objectives: [{ type: 'destroy', label: 'group a', group: 'a' }] };

function play(campaign: CampaignState = newCampaignState('greybox-01'), keepsReplay = true) {
  const saves: CampaignState[] = [];
  const session = new Session(undefined, '', world, {
    encounter: ENCOUNTER,
    mission: ONE,
    testHumanCount: 1,
    campaign,
    loadouts: 'class',
    campaignDef: { ...CAMPAIGN, replayKeepsLoadout: keepsReplay },
    onCampaignSave: (s) => saves.push(s),
  });
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  const client = new ClientConnection(pair.b, {});
  client.join('lead');
  pair.settle();
  let now = 0;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += TICK_MS;
      if (i % 30 === 0) client.send({ kind: 'Ping', id: 1, clientTime: 0 });
      pair.settle();
      session.step(now);
      pair.settle();
    }
  };
  const win = () => {
    step(60);
    for (const e of session.enemies) Object.assign(e.health, { current: 0, diedAt: now / 1000 });
    step(2);
  };
  return { session, saves, step, win };
}

/** Spend soldier 1's kits and rounds and give them a marksman rifle with 7 rounds. */
function spend(session: Session): void {
  const s = session.slots[1]!;
  s.kits = 0;
  s.weapon = getWeapon('marksman');
  s.primary = 'marksman';
  s.pickedUp = true;
  s.weaponState = { ...s.weaponState, ammo: 7 };
}

describe('the loadout the campaign carries (U-077)', () => {
  it('is written when a mission is won, and the next campaign run starts from it', () => {
    const first = play();
    const classKits = first.session.slots[1]!.kits;
    expect(classKits).toBeGreaterThan(0);
    first.step(2);
    spend(first.session);
    first.win();
    const saved = first.saves.at(-1)!;
    expect(saved.soldiers[1]!.loadout).toMatchObject({ weapon: 'marksman', kits: 0 });
    expect(saved.soldiers[1]!.loadout!.ammo).toContainEqual(['marksman', 7]);

    const next = play(saved);
    const s = next.session.slots[1]!;
    expect(s.weapon.id).toBe('marksman');
    expect(s.weaponState.ammo).toBe(7);
    expect(s.kits).toBe(0);
    expect(s.pickedUp).toBe(true);
    // The others carry what they had, which was the class loadout.
    expect(next.session.slots[2]!.kits).toBe(first.session.slots[2]!.kits);
  });

  it('is what a restart and a retry return to, not a half-spent state', () => {
    const first = play();
    first.step(2);
    spend(first.session);
    first.win();
    const carried = play(first.saves.at(-1)!);
    carried.step(2);
    const s = () => carried.session.slots[1]!;
    s().weaponState.ammo = 1;
    s().kits = 5;
    carried.session.restartMission();
    expect(s().weapon.id).toBe('marksman');
    expect(s().weaponState.ammo).toBe(7);
    expect(s().kits).toBe(0);
  });

  it('is not used by a replay run, which starts from the class loadout', () => {
    const first = play();
    first.step(2);
    spend(first.session);
    first.win();
    const state = { ...first.saves.at(-1)!, run: 'replay' as const };
    const replay = play(state);
    expect(replay.session.slots[1]!.weapon.id).not.toBe('marksman');
    expect(replay.session.slots[1]!.kits).toBeGreaterThan(0);
  });

  it('keeps what a replay ends with for the campaign, or not, as the campaign data says', () => {
    for (const keeps of [true, false]) {
      const first = play();
      first.step(2);
      spend(first.session);
      first.win();
      const replay = play({ ...first.saves.at(-1)!, run: 'replay' }, keeps);
      replay.step(2);
      replay.session.slots[1]!.kits = 1;
      replay.win();
      const kept = replay.saves.at(-1)!.soldiers[1]!.loadout!;
      // Kept: the replay's end (1 kit). Not kept: the campaign's loadout as it was (0 kits).
      expect(kept.kits).toBe(keeps ? 1 : 0);
    }
  });

  it('starts an older save with no loadout from the class loadout', () => {
    const old = newCampaignState('greybox-01');
    expect(old.soldiers.every((s) => s.loadout === undefined)).toBe(true);
    const fresh = play(old);
    const plain = play();
    expect(fresh.session.slots.map((s) => [s.weapon.id, s.kits])).toEqual(plain.session.slots.map((s) => [s.weapon.id, s.kits]));
  });
});
