/**
 * The allocator with fake peers (T-4.31): a code is found where it is held
 * — here, on a peer, or nowhere; a new room goes to the least-loaded host
 * with this one winning ties; a peer that is dead, slow, draining or full
 * is skipped; and the pieces the host uses on the way — the code in an
 * upgrade URL, what counts as the private network, Fly's TXT answer — read
 * what they should.
 */
import { describe, expect, it } from 'vitest';
import { Allocator, type PeerInfo, type PeerLoad, isPrivateAddress, roomFromUpgradeUrl } from './Allocator.ts';
import { flyPeers, parseVmsTxt } from './flyPeers.ts';

interface FakePeer {
  info: PeerInfo;
  rooms: Set<string>;
  load: PeerLoad;
  /** 'dead' throws, 'slow' never answers, 'garbage' answers nonsense. */
  mode?: 'dead' | 'slow' | 'garbage';
}

function fakes(peers: FakePeer[]) {
  const asked: string[] = [];
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    asked.push(url);
    const peer = peers.find((p) => url.startsWith(p.info.url));
    if (!peer || peer.mode === 'dead') return Promise.reject(new Error(`ECONNREFUSED ${url}`));
    if (peer.mode === 'slow') {
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    const path = url.slice(peer.info.url.length);
    if (peer.mode === 'garbage') return Promise.resolve(path === '/healthz' ? new Response('<html>', { status: 200 }) : new Response('', { status: 500 }));
    if (path === '/healthz') return Promise.resolve(new Response(JSON.stringify(peer.load), { status: peer.load.draining ? 503 : 200 }));
    const m = /^\/internal\/room\/(.+)$/.exec(path);
    if (m) return Promise.resolve(new Response('', { status: peer.rooms.has(decodeURIComponent(m[1]!)) ? 200 : 404 }));
    return Promise.resolve(new Response('', { status: 404 }));
  }) as typeof fetch;
  return { fetcher, asked };
}

const peer = (instance: string, rooms: string[], load: Partial<PeerLoad> = {}, mode?: FakePeer['mode']): FakePeer => ({
  info: { instance, url: `http://${instance}.vm.app.internal:8080` },
  rooms: new Set(rooms),
  load: { rooms: rooms.length, maxRooms: 4, draining: false, ...load },
  ...(mode ? { mode } : {}),
});

function allocator(peers: FakePeer[], mine: { rooms: string[]; load?: Partial<PeerLoad> }, timeoutMs = 50) {
  const { fetcher, asked } = fakes(peers);
  const down: string[] = [];
  const a = new Allocator({
    host: {
      instance: 'self',
      holds: (code) => mine.rooms.includes(code),
      load: () => ({ rooms: mine.rooms.length, maxRooms: 4, draining: false, ...mine.load }),
    },
    peers: () => Promise.resolve(peers.map((p) => p.info)),
    fetch: fetcher,
    timeoutMs,
    onPeerDown: (p, why) => down.push(`${p.instance}: ${why}`),
  });
  return { a, asked, down };
}

describe('Allocator (T-4.31)', () => {
  it('finds a code here without asking anyone, on a peer by asking every peer at once, and nowhere as null', async () => {
    const { a, asked } = allocator([peer('p1', ['AAAA']), peer('p2', ['BBBB'])], { rooms: ['MINE'] });
    expect(await a.locate('MINE')).toEqual({ kind: 'here' });
    expect(asked).toHaveLength(0);
    expect(await a.locate('BBBB')).toEqual({ kind: 'replay', instance: 'p2' });
    expect(asked).toEqual(['http://p1.vm.app.internal:8080/internal/room/BBBB', 'http://p2.vm.app.internal:8080/internal/room/BBBB']);
    expect(await a.locate('ZZZZ')).toBeNull();
    // A code nobody holds is this host's to refuse in the handshake.
    expect(await a.decide('ZZZZ')).toEqual({ kind: 'here' });
  });

  it('places a new room on the least-loaded host, ties to this one, and never on a full or draining peer', async () => {
    const empty = allocator([peer('p1', ['A', 'B']), peer('p2', [])], { rooms: ['X'] });
    expect(await empty.a.place()).toEqual({ kind: 'replay', instance: 'p2' });
    const tie = allocator([peer('p1', ['A']), peer('p2', ['B'])], { rooms: ['X'] });
    expect(await tie.a.place()).toEqual({ kind: 'here' });
    const busy = allocator([peer('p1', []), peer('p2', [], { draining: true })], { rooms: ['A', 'B'] });
    expect(await busy.a.place()).toEqual({ kind: 'replay', instance: 'p1' });
    const full = allocator([peer('p1', [], { rooms: 4, maxRooms: 4 }), peer('p2', ['A'], { draining: true })], { rooms: ['A', 'B', 'C'] });
    expect(await full.a.place()).toEqual({ kind: 'here' });
    // This host full and a peer with room: the peer.
    const meFull = allocator([peer('p1', ['A'])], { rooms: ['A', 'B', 'C', 'D'] });
    expect(await meFull.a.place()).toEqual({ kind: 'replay', instance: 'p1' });
    // This host draining and nobody else: still here — the handshake says `host draining`.
    const draining = allocator([], { rooms: [], load: { draining: true } });
    expect(await draining.a.place()).toEqual({ kind: 'here' });
    expect(await draining.a.decide(null)).toEqual({ kind: 'here' });
  });

  it('skips a dead, a slow and a nonsense peer, says which, and asks it again next time', async () => {
    const { a, down } = allocator([peer('dead', ['D'], {}, 'dead'), peer('slow', ['S'], {}, 'slow'), peer('junk', [], {}, 'garbage'), peer('ok', ['K'])], { rooms: ['A', 'B'] });
    expect(await a.locate('K')).toEqual({ kind: 'replay', instance: 'ok' });
    expect(await a.locate('S')).toBeNull();
    expect(await a.place()).toEqual({ kind: 'replay', instance: 'ok' });
    expect(down.filter((d) => d.startsWith('dead:')).length).toBeGreaterThanOrEqual(3);
    expect(down.filter((d) => d.startsWith('slow:')).length).toBeGreaterThanOrEqual(3);
    expect(down.some((d) => d.startsWith('junk: bad health'))).toBe(true);
  });

  it('survives discovery failing: no peers, every decision here', async () => {
    const a = new Allocator({
      host: { instance: 'self', holds: () => false, load: () => ({ rooms: 0, maxRooms: 4, draining: false }) },
      peers: () => Promise.reject(new Error('dns down')),
      fetch: (() => Promise.reject(new Error('never'))) as typeof fetch,
    });
    expect(await a.decide('AAAA')).toEqual({ kind: 'here' });
    expect(await a.decide(null)).toEqual({ kind: 'here' });
  });
});

describe('what the host reads on the way (T-4.31)', () => {
  it('takes the code from the upgrade URL and nothing else', () => {
    expect(roomFromUpgradeUrl('/?room=KM7X')).toBe('KM7X');
    expect(roomFromUpgradeUrl('/?quick=1&room=KM7XRT34')).toBe('KM7XRT34');
    expect(roomFromUpgradeUrl('/?room=')).toBeNull();
    expect(roomFromUpgradeUrl('/')).toBeNull();
    expect(roomFromUpgradeUrl(undefined)).toBeNull();
  });

  it('counts Fly\'s private network and loopback as private, and nothing else', () => {
    expect(isPrivateAddress('fdaa:0:1234:a7b:1f2:3:4:5')).toBe(true);
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('203.0.113.7')).toBe(false);
    expect(isPrivateAddress('::ffff:203.0.113.7')).toBe(false);
    expect(isPrivateAddress(undefined)).toBe(false);
  });

  it('reads Fly\'s TXT answer into this region\'s other machines, by name', async () => {
    expect(parseVmsTxt([['148e21ea7b1234 iad,', '3d8d9e5a2c4567 lhr'], ['9080e1234abcde iad']])).toEqual([
      { instance: '148e21ea7b1234', region: 'iad' },
      { instance: '3d8d9e5a2c4567', region: 'lhr' },
      { instance: '9080e1234abcde', region: 'iad' },
    ]);
    const peers = flyPeers({
      app: 'sandline-iad',
      region: 'iad',
      self: '148e21ea7b1234',
      port: 8080,
      resolveTxt: () => Promise.resolve([['148e21ea7b1234 iad,3d8d9e5a2c4567 lhr,9080e1234abcde iad']]),
    });
    expect(await peers()).toEqual([{ instance: '9080e1234abcde', url: 'http://9080e1234abcde.vm.sandline-iad.internal:8080' }]);
  });
});
