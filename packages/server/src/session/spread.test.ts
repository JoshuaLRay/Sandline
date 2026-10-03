import { describe, expect, it } from 'vitest';
import { ClientConnection, type Message, SPREAD_KINDS, createLoopbackPair, createMoveState, decodeMessage, encodeMessage } from '@sandline/shared';
import { Session } from './Session.ts';
import { Formation } from '../ai/friendly/formation.ts';

describe('squad spread (U-100)', () => {
  it('round-trips each preset, address and the whole squad state', () => {
    for (const spread of SPREAD_KINDS) for (const address of [{ to: 'all' }, { to: 'slot', index: 5 }, { to: 'fireteam', index: 1 }] as const) {
      const message: Message = { kind: 'Spread', address, spread };
      expect(decodeMessage(encodeMessage(message))).toEqual(message);
    }
    const state: Message = { kind: 'Spreads', spreads: ['tight', 'standard', 'wide', 'tight', 'standard', 'wide'] };
    expect(decodeMessage(encodeMessage(state))).toEqual(state);
  });
  it('changes only commanded bots and gives a late joiner the authoritative settings', () => {
    const session = new Session();
    const connect = () => {
      const pair = createLoopbackPair();
      session.addConnection(pair.a, 0);
      let spreads: readonly string[] = [];
      const client = new ClientConnection(pair.b, { onSpreads: (value) => { spreads = value; } });
      client.join('commander'); pair.settle();
      return { client, pair, spreads: () => spreads };
    };
    const first = connect(); const second = connect();
    const roster = session.roster;
    first.client.send({ kind: 'Spread', address: { to: 'all' }, spread: 'wide' }); first.pair.settle(); second.pair.settle();
    for (let i = 0; i < 6; i++) expect(session.spreadFor(i)).toBe(!roster[i]!.human && roster[i]!.commander === 0 ? 'wide' : 'standard');
    const late = connect();
    expect(late.spreads()).toEqual(Array.from({ length: 6 }, (_, i) => session.spreadFor(i)));
    expect(first.spreads()).toEqual(second.spreads());
  });
  it('scales follow offsets while keeping every projected place distinct', () => {
    const spans: number[] = [];
    for (const spread of SPREAD_KINDS) {
      const formation = new Formation((p) => p);
      formation.update(Array.from({ length: 6 }, (_, index) => ({ index, human: index === 0, ...createMoveState(), yaw: 0, speed: 1, sprint: false, spread })));
      const places = [1, 2, 3, 4, 5].map((i) => formation.place(i)!);
      spans.push(Math.hypot(places[4]!.goal.x, places[4]!.goal.z));
      expect(new Set(places.map((p) => `${p.goal.x},${p.goal.z}`)).size).toBe(5);
    }
    expect(spans[0]).toBeLessThan(spans[1]!);
    expect(spans[1]).toBeLessThan(spans[2]!);
  });
});
