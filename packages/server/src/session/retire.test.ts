/**
 * U-090: a room that has moved on to another mission is retired, so its campaign code names nothing until the clients
 * rejoin, and the rejoin builds a room from the campaign file, which now names the new mission and the kind of run.
 */
import { describe, expect, it } from 'vitest';
import { type CampaignState, newCampaignState } from '../persistence/CampaignDatabase.ts';
import { Registry } from './Registry.ts';

describe('retiring a room (U-090)', () => {
  it('frees its code, and a room built from the changed file is on the new world', () => {
    const registry = new Registry({ maxRooms: 4 });
    const state = newCampaignState('greybox-01');
    const saves: CampaignState[] = [];
    const first = registry.create(0, '', { code: 'ABCDEFGH', state, onSave: (s) => saves.push(s) })!;
    expect(first.session.world.id).toBe('greybox-01');
    expect(registry.getByJoinCode('ABCDEFGH')).toBe(first);

    registry.retire(first.code);
    expect(registry.get(first.code)).toBeUndefined();
    expect(registry.getByJoinCode('ABCDEFGH')).toBeUndefined();
    expect(registry.size).toBe(0);

    // The clients rejoin the same code: the file says range, as a replay.
    const next = registry.create(1, '', { code: 'ABCDEFGH', state: { ...state, world: 'range', run: 'replay' }, onSave: (s) => saves.push(s) })!;
    expect(next.session.world.id).toBe('range');
    expect(registry.getByJoinCode('ABCDEFGH')).toBe(next);
    expect(registry.size).toBe(1);
  });

  it('is what a campaign room does when its session hands off', () => {
    const registry = new Registry({ maxRooms: 4 });
    const room = registry.create(0, '', { code: 'JKMNPRTU', state: newCampaignState('greybox-01'), onSave: () => {} })!;
    expect(registry.size).toBe(1);
    // The session calls this when the host's choice has been saved and the room told.
    (room.session as unknown as { onHandoff: (() => void) | null }).onHandoff?.();
    expect(registry.size).toBe(0);
    expect(registry.getByJoinCode('JKMNPRTU')).toBeUndefined();
  });
});
