import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { PROTOCOL_VERSION, type Message, createLoopbackPair, decodeMessage, encodeMessage } from '@sandline/shared';
import type { Logger } from '../log.ts';
import { Identity } from '../identity/Identity.ts';
import { SessionHost } from '../session/SessionHost.ts';
import { CampaignDatabase, SqlitePlayerDirectory } from './CampaignDatabase.ts';

const quiet: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const SECRET = 'c'.repeat(32);
const roots: string[] = [];

function dbPath(): string {
  const root = mkdtempSync(pathJoin(tmpdir(), 'sandline-campaign-host-'));
  roots.push(root);
  return pathJoin(root, 'campaigns.sqlite');
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function hosted(path: string): { host: SessionHost; db: CampaignDatabase } {
  const db = new CampaignDatabase(path);
  const identity = new Identity({
    secrets: [SECRET],
    now: () => 1_750_000_000_000,
    directory: new SqlitePlayerDirectory(db),
  });
  return {
    db,
    host: new SessionHost({ port: 0, log: quiet, autoTick: false, identity, campaigns: db }),
  };
}

function join(host: SessionHost, room: string, identity = ''): Extract<Message, { kind: 'JoinAck' }> {
  const pair = createLoopbackPair();
  const got: Message[] = [];
  pair.b.onMessage((bytes) => got.push(decodeMessage(bytes)));
  host.accept(pair.a);
  pair.b.send(encodeMessage({
    kind: 'Join',
    version: PROTOCOL_VERSION,
    name: 'ray',
    room,
    ...(identity === '' ? {} : { identity }),
  }));
  pair.settle();
  const ack = got.find((message): message is Extract<Message, { kind: 'JoinAck' }> => message.kind === 'JoinAck');
  if (!ack) throw new Error(`JoinAck missing: ${JSON.stringify(got)}`);
  return ack;
}

describe('campaign rooms over SessionHost (T-4.23)', () => {
  it('returns a durable campaign code for a new room and restores a new room from that code after restart', () => {
    const path = dbPath();
    const first = hosted(path);
    const created = join(first.host, '');
    expect(created.room).toMatch(/^[ACDEFGHJKMNPRTUVWXY34679]{8}$/);
    expect(first.db.loadCampaign(created.room)?.state.world).toBe('range');

    const advanced = first.db.loadCampaign(created.room)!;
    advanced.state.world = 'greybox-01';
    first.db.saveCampaign(created.room, advanced.state);
    first.db.close();

    const second = hosted(path);
    const resumed = join(second.host, created.room, created.identity);
    expect(resumed.room).toBe(created.room);
    expect(resumed.world).toBe('greybox-01');
    expect(second.host.registry.size).toBe(1);
    second.db.close();
  });

  it('routes the same campaign code into its live room instead of creating a duplicate', () => {
    const path = dbPath();
    const current = hosted(path);
    const first = join(current.host, '');
    const second = join(current.host, first.room, first.identity);
    expect(second.room).toBe(first.room);
    expect(current.host.registry.size).toBe(1);
    current.db.close();
  });
});
