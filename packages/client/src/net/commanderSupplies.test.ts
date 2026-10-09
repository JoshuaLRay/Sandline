import { describe, expect, it } from 'vitest';
import {
  BaseTransport, createLoopbackPair, decodeMessage, encodeMessage, PROTOCOL_VERSION, ServerConnection,
  type Channel, type Message,
} from '@sandline/shared';
import { NetClient } from './NetClient.ts';

type CommanderSelection = Extract<Message, { kind: 'CommanderSupplySelect' }>;
type DesktopSelection = Extract<Message, { kind: 'SupplySelect' }>;
const KIT = { kind: 'health-kit' } as const;

/** Like the reconnecting socket, the client-facing transport survives individual connections. */
class RejoiningLoopback extends BaseTransport {
  pair = createLoopbackPair();

  constructor() {
    super();
    this.forwardMessages();
  }

  send(data: Uint8Array, channel: Channel = 'reliable'): void {
    this.pair.b.send(data, channel);
  }

  reconnect(): void {
    this.pair.b.close('network lost');
    this.pair = createLoopbackPair();
    this.forwardMessages();
  }

  private forwardMessages(): void {
    const pair = this.pair;
    pair.b.onMessage(data => { if (pair === this.pair) this.emitMessage(data); });
  }
}

function connection(transport: RejoiningLoopback) {
  const commander: CommanderSelection[] = [];
  const desktop: DesktopSelection[] = [];
  const server = new ServerConnection(transport.pair.a, {
    onJoined: conn => conn.accept(1, 0, 0, '', 'range'),
    onCommanderSupplySelect: (_, message) => commander.push(message),
    onSupplySelect: (_, message) => desktop.push(message),
  }, 0);
  return { server, commander, desktop };
}

function client() {
  const transport = new RejoiningLoopback();
  const net = new NetClient(transport, 'commander');
  const host = connection(transport);
  const settle = () => transport.pair.settle();
  const join = () => { net.join(); settle(); };
  return { transport, net, host, settle, join };
}

describe('commander supply network requests (U-146)', () => {
  it('waits for the current-version handshake before sending selections or cancellations', () => {
    const r = client();
    r.net.selectCommanderSupply(1, 'medical', KIT);
    r.net.selectCommanderSupply(1, 'medical', null);
    expect(r.transport.pair.b.sent).toEqual([]);
    r.net.join();
    r.net.selectCommanderSupply(1, 'medical', KIT);
    expect(r.transport.pair.b.sent.map(packet => decodeMessage(packet.data))).toEqual([
      expect.objectContaining({ kind: 'Join', version: PROTOCOL_VERSION }),
    ]);
    r.settle();
    expect(r.host.server.state).toBe('active');
    expect(r.net.joined).toBe(true);
    expect(PROTOCOL_VERSION).toBe(70);
    r.net.selectCommanderSupply(1, 'medical', KIT); r.settle();
    expect(r.host.commander).toEqual([{ kind: 'CommanderSupplySelect', requestId: 1, slot: 1, cacheId: 'medical', item: KIT }]);
  });

  it('delivers reliable target-specific start and cancel requests with independent monotonic IDs', () => {
    const r = client(); r.join();
    r.net.selectSupply('medical', KIT);
    r.net.selectCommanderSupply(1, 'medical', KIT);
    r.net.selectCommanderSupply(1, 'medical', null);
    r.net.selectSupply('medical', null);
    r.net.selectCommanderSupply(5, 'other-cache', { kind: 'projectile', projectile: 'rocket' });
    r.settle();
    expect(r.host.desktop.map(message => message.requestId)).toEqual([1, 2]);
    expect(r.host.commander).toEqual([
      { kind: 'CommanderSupplySelect', requestId: 1, slot: 1, cacheId: 'medical', item: KIT },
      { kind: 'CommanderSupplySelect', requestId: 2, slot: 1, cacheId: 'medical', item: null },
      { kind: 'CommanderSupplySelect', requestId: 3, slot: 5, cacheId: 'other-cache', item: { kind: 'projectile', projectile: 'rocket' } },
    ]);
    expect(r.transport.pair.b.sent.slice(1).map(packet => packet.channel)).toEqual(Array(5).fill('reliable'));
  });

  it('withholds start and cancel during incompatible restore, then sends only a new explicit choice', () => {
    const r = client(); r.join();
    r.host.server.send({ kind: 'RestoreGate', choice: { mission: 'range', host: 0, restart: 'original' } }); r.settle();
    const sent = r.transport.pair.b.sent.length;
    r.net.selectCommanderSupply(1, 'medical', KIT);
    r.net.selectCommanderSupply(1, 'medical', null); r.settle();
    expect(r.transport.pair.b.sent).toHaveLength(sent);
    expect(r.host.commander).toEqual([]);
    r.host.server.send({ kind: 'RestoreGate', choice: null }); r.settle();
    expect(r.host.commander).toEqual([]);
    r.net.selectCommanderSupply(1, 'medical', KIT); r.settle();
    expect(r.host.commander).toEqual([{ kind: 'CommanderSupplySelect', requestId: 1, slot: 1, cacheId: 'medical', item: KIT }]);
  });

  it('resets request IDs for a new connection without replaying a previous selection', () => {
    const r = client(); r.join();
    r.net.selectCommanderSupply(1, 'medical', KIT);
    r.net.selectCommanderSupply(1, 'medical', null); r.settle();
    r.net.resetForRejoin();
    const sent = r.transport.pair.b.sent.length;
    r.net.selectCommanderSupply(1, 'medical', KIT);
    expect(r.transport.pair.b.sent).toHaveLength(sent);
    r.transport.reconnect();
    const host = connection(r.transport);
    r.join();
    expect(r.host.server.state).toBe('closed');
    expect(host.commander).toEqual([]);
    r.net.selectCommanderSupply(1, 'medical', KIT); r.settle();
    expect(host.commander).toEqual([{ kind: 'CommanderSupplySelect', requestId: 1, slot: 1, cacheId: 'medical', item: KIT }]);
    expect(r.host.commander).toHaveLength(2);
  });

  it('receives version rejection before any commander selection can reach the host', () => {
    const r = client();
    r.transport.pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION - 1, name: 'old-client', room: '' })); r.settle();
    expect(r.net.disconnectCode).toBe('bad version');
    r.net.selectCommanderSupply(1, 'medical', KIT); r.settle();
    expect(r.host.server.state).toBe('closed');
    expect(r.host.commander).toEqual([]);
    expect(r.transport.pair.b.sent).toHaveLength(1);
  });
});
