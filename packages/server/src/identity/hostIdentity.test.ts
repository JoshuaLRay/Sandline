/**
 * Player identity over a session host (T-4.22): the Join carries a token, the
 * JoinAck hands one back, and a forged or expired token is refused with the
 * typed `bad identity` before any room is made. Loopback transports and an
 * injected clock, as `SessionHost.test.ts` does.
 */
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type Message, createLoopbackPair, decodeMessage, encodeMessage } from '@sandline/shared';
import { SessionHost } from '../session/SessionHost.ts';
import type { Logger } from '../log.ts';
import { Identity } from './Identity.ts';
import { issueToken, newPlayerId, verifyToken } from './token.ts';

const quiet: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const SECRET = 'k'.repeat(32);

function join(host: SessionHost, identity = '', name = 'ray'): Message[] {
  const pair = createLoopbackPair();
  const got: Message[] = [];
  pair.b.onMessage((bytes) => got.push(decodeMessage(bytes)));
  host.accept(pair.a);
  pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name, room: '', ...(identity === '' ? {} : { identity }) }));
  pair.settle();
  return got;
}

const ackOf = (got: Message[]) => got.find((m) => m.kind === 'JoinAck') as Extract<Message, { kind: 'JoinAck' }> | undefined;
const byeOf = (got: Message[]) => got.find((m) => m.kind === 'Disconnect') as Extract<Message, { kind: 'Disconnect' }> | undefined;

function newHost(now: () => number = () => 1_750_000_000_000): SessionHost {
  return new SessionHost({ port: 0, log: quiet, autoTick: false, identity: new Identity({ secrets: [SECRET], now }) });
}

describe('player identity over the host (T-4.22)', () => {
  it('issues a signed identity in the JoinAck of a first Join', () => {
    const host = newHost();
    const ack = ackOf(join(host));
    expect(ack).toBeDefined();
    const verified = verifyToken(ack?.identity ?? '', 1_750_000_000, [SECRET]);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(host.identity.directory.get(verified.claims.playerId)?.name).toBe('ray');
  });

  it('knows the same player when the token comes back, in any room', () => {
    const host = newHost();
    const token = ackOf(join(host))?.identity ?? '';
    const again = ackOf(join(host, token, 'ray again'));
    expect(again?.identity).toBe(token);
    expect(host.identity.directory.size).toBe(1);
  });

  it('refuses a forged token as bad identity and makes no room', () => {
    const host = newHost();
    const forged = issueToken(newPlayerId(), 1_750_000_000, 3600, 'x'.repeat(32));
    const got = join(host, forged);
    expect(ackOf(got)).toBeUndefined();
    expect(byeOf(got)).toMatchObject({ code: 'bad identity', reason: 'identity token refused (bad signature)' });
    expect(host.registry.size).toBe(0);
    expect(host.identity.directory.size).toBe(0);
  });

  it('refuses an expired token as bad identity', () => {
    let t = 1_750_000_000_000;
    const host = newHost(() => t);
    const token = ackOf(join(host))?.identity ?? '';
    t += 181 * 24 * 60 * 60_000;
    expect(byeOf(join(host, token))).toMatchObject({ code: 'bad identity', reason: 'identity token expired' });
  });

  it('hands a rotated token back to a returning player once theirs is a week old', () => {
    let t = 1_750_000_000_000;
    const host = newHost(() => t);
    const token = ackOf(join(host))?.identity ?? '';
    t += 8 * 24 * 60 * 60_000;
    const rotated = ackOf(join(host, token))?.identity ?? '';
    expect(rotated).not.toBe(token);
    const a = verifyToken(token, Math.floor(t / 1000), [SECRET]);
    const b = verifyToken(rotated, Math.floor(t / 1000), [SECRET]);
    expect(a.ok && b.ok && a.claims.playerId === b.claims.playerId).toBe(true);
  });
});
