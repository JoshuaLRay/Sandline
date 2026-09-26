/**
 * The session allocator (T-4.31), as the ADR-011 addendum decided it: not a
 * service but a library in every host. A region is one Fly app; its machines
 * are peers that find each other over the private network (`flyPeers.ts`),
 * and a host that gets a connection it should not serve tells the platform
 * to REPLAY it to the peer that should (`fly-replay` on the upgrade,
 * `WsTransport.ts`). There is nothing to register and nothing to go stale:
 * the room directory is the set of processes holding rooms, asked directly.
 *
 * Two questions, both answered before a socket is upgraded, from the code in
 * the upgrade URL (`?room=`):
 *
 * - **A code**: who holds it? This host, if its registry has the room or its
 *   database the campaign; else the first peer that answers 200 to
 *   `/internal/room/<code>`; else nobody, and the host takes the connection
 *   so the handshake can say `no such room` in the usual typed way.
 * - **No code** (a new room, or quick-join): who is least loaded? Rooms held,
 *   from `/healthz`, over this host and every peer that answers, is not
 *   draining and has a room to spare. Ties go to this host: a replay is a
 *   round trip through the proxy, and not worth it for nothing.
 *
 * A peer that does not answer within the timeout, or answers badly, is dead
 * for this decision and skipped; the next decision asks it again. Peers are
 * asked in parallel, so a decision costs one round trip however many there
 * are, and there are never many (§4 of the addendum: one, then two).
 */

export interface PeerInfo {
  /** The Fly machine id: what `fly-replay: instance=` names. */
  instance: string;
  /** Where its HTTP port answers on the private network, e.g. `http://<id>.vm.<app>.internal:8080`. */
  url: string;
}

/** What `/healthz` says that placement reads. */
export interface PeerLoad {
  rooms: number;
  maxRooms: number;
  draining: boolean;
}

/** This host, as the allocator asks it. */
export interface AllocatorHost {
  readonly instance: string;
  /** Whether a live room or a saved campaign with this code is here. */
  holds(code: string): boolean;
  load(): PeerLoad;
}

export type Placement = { kind: 'here' } | { kind: 'replay'; instance: string };

export interface AllocatorOptions {
  host: AllocatorHost;
  /** Discovery: every peer in this region but this host. Empty with none. */
  peers: () => Promise<readonly PeerInfo[]>;
  /** Injected in tests; `globalThis.fetch` otherwise. */
  fetch?: typeof fetch;
  /** How long a peer has to answer before it is dead for this decision. */
  timeoutMs?: number;
  /** Told about peers that did not answer, so a dead machine is visible in the log. */
  onPeerDown?: (peer: PeerInfo, why: string) => void;
}

export const DEFAULT_PEER_TIMEOUT_MS = 500;

export class Allocator {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: AllocatorOptions) {
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PEER_TIMEOUT_MS;
  }

  /** Where a connection asking for `code` (or for a new room, with null) should go. */
  async decide(code: string | null): Promise<Placement> {
    if (code !== null && code !== '') return (await this.locate(code)) ?? { kind: 'here' };
    return this.place();
  }

  /** Who holds a code: this host, a peer, or nobody (null). */
  async locate(code: string): Promise<Placement | null> {
    if (this.options.host.holds(code)) return { kind: 'here' };
    const peers = await this.livePeers();
    const answers = await Promise.all(
      peers.map(async (peer) => {
        const res = await this.ask(peer, `/internal/room/${encodeURIComponent(code)}`);
        return res !== null && res.status === 200 ? peer : null;
      }),
    );
    const holder = answers.find((p) => p !== null);
    return holder ? { kind: 'replay', instance: holder.instance } : null;
  }

  /** The least-loaded host with a room to spare: this one on a tie, or when no peer is better. */
  async place(): Promise<Placement> {
    const mine = this.options.host.load();
    const peers = await this.livePeers();
    const loads = await Promise.all(
      peers.map(async (peer) => {
        const res = await this.ask(peer, '/healthz');
        if (res === null) return null;
        try {
          const body = (await res.json()) as Partial<PeerLoad>;
          if (typeof body.rooms !== 'number' || typeof body.maxRooms !== 'number') throw new Error('no room counts');
          return { peer, load: { rooms: body.rooms, maxRooms: body.maxRooms, draining: body.draining === true || res.status === 503 } };
        } catch (e) {
          this.options.onPeerDown?.(peer, `bad health: ${e instanceof Error ? e.message : String(e)}`);
          return null;
        }
      }),
    );
    let best: { instance: string | null; rooms: number } | null = mine.draining || mine.rooms >= mine.maxRooms ? null : { instance: null, rooms: mine.rooms };
    for (const entry of loads) {
      if (!entry || entry.load.draining || entry.load.rooms >= entry.load.maxRooms) continue;
      if (best === null || entry.load.rooms < best.rooms) best = { instance: entry.peer.instance, rooms: entry.load.rooms };
    }
    return best === null || best.instance === null ? { kind: 'here' } : { kind: 'replay', instance: best.instance };
  }

  private async livePeers(): Promise<readonly PeerInfo[]> {
    try {
      return await this.options.peers();
    } catch {
      return [];
    }
  }

  /** One GET to a peer within the timeout, or null when it is dead for this decision. */
  private async ask(peer: PeerInfo, path: string): Promise<Response | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetcher(`${peer.url}${path}`, { signal: controller.signal });
    } catch (e) {
      this.options.onPeerDown?.(peer, e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** The room code in an upgrade URL's `?room=`, or null: what the allocator decides on. */
export function roomFromUpgradeUrl(url: string | undefined): string | null {
  if (!url) return null;
  const q = url.indexOf('?');
  if (q < 0) return null;
  const room = new URLSearchParams(url.slice(q + 1)).get('room');
  return room === null || room === '' ? null : room;
}

/** The private network as Fly gives it (6PN, `fdaa::/16`), plus loopback for a laptop and a test. */
export function isPrivateAddress(address: string | undefined): boolean {
  if (!address) return false;
  const a = address.startsWith('::ffff:') ? address.slice(7) : address;
  return a === '127.0.0.1' || a === '::1' || a.toLowerCase().startsWith('fdaa:');
}
