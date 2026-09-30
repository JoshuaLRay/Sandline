/**
 * U-051: a joining player may ask for a slot (a character) and gets it when it
 * is free; otherwise the lowest free one. A resume keeps its own seat. Real
 * `Session`, real `NetClient`s over loopback.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createLoopbackPair } from '@sandline/shared';
import { initNav } from '@sandline/server/nav';
import { Session } from '@sandline/server/session';
import { NetClient } from '../net/NetClient.ts';

function room() {
  const session = new Session(undefined, '', 'greybox-01', { roomLobby: true });
  const pairs: ReturnType<typeof createLoopbackPair>[] = [];
  const join = (name: string, slot = -1, resume = '') => {
    const pair = createLoopbackPair();
    pairs.push(pair);
    session.addConnection(pair.a, 0);
    const net = new NetClient(pair.b, name);
    net.join('', '', '', resume, '', false, slot);
    pair.settle();
    return { net, pair };
  };
  return { session, join };
}

describe('choosing a slot at join (U-051)', () => {
  beforeAll(() => initNav());

  it('seats a player in the slot they asked for, when it is free', () => {
    const r = room();
    const a = r.join('a', 4);
    expect(a.net.slot).toBe(4);
    expect(r.session.roster[4]?.human).toBe(true);
    expect(r.session.roster[4]?.classId).toBe('marsh');
  });

  it('asking for nothing takes the lowest free slot, as before', () => {
    const r = room();
    expect([r.join('a').net.slot, r.join('b').net.slot]).toEqual([0, 1]);
  });

  it('two asking for the same slot: one gets it, the other the lowest free, and no character is doubled', () => {
    const r = room();
    const a = r.join('a', 3);
    const b = r.join('b', 3);
    expect(a.net.slot).toBe(3);
    expect(b.net.slot).toBe(0);
    const humans = r.session.roster.map((row, i) => (row.human ? i : -1)).filter((i) => i >= 0);
    expect(humans).toEqual([0, 3]);
  });

  it('a slot that does not exist falls back to the lowest free', () => {
    const r = room();
    const a = r.join('a', 9);
    expect(a.net.slot).toBe(0);
  });

  it('a resume returns to the player\'s own seat, whatever slot is asked for', () => {
    const r = room();
    const a = r.join('a', 2);
    r.join('keep', 0);
    const token = a.net.resumeToken;
    a.pair.b.close('network lost');
    a.pair.settle();
    const back = r.join('a', 5, token);
    expect(back.net.slot).toBe(2);
    expect(back.net.resumed).toBe(true);
  });
});
