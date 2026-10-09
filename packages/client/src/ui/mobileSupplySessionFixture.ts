import {
  BaseTransport, createLoopbackPair, createMoveState, decodeMessage, encodeMessage, parseEncounter, parseEventScript,
  requireWorld, SUPPLY_AMMO_UNITS_PER_MAGAZINE, TICK_SECONDS, type Channel, type MissionDef,
} from '@sandline/shared';
import { Session } from '@sandline/server/session';
import { NetClient } from '../net/NetClient.ts';
import { SUPPLY_FIXTURES } from './supplyFixtures.ts';
import { mobileSupplyState } from './mobileSupplyState.ts';

/** Like a reconnecting socket, this transport retains its client-facing identity. */
export class ReviewTransport extends BaseTransport {
  pair = createLoopbackPair();
  readonly sent: Uint8Array[] = [];
  constructor() { super(); this.forward(); }
  send(data: Uint8Array, channel: Channel = 'reliable'): void {
    this.sent.push(data.slice()); this.pair.b.send(data, channel);
  }
  override close(reason = 'closed'): void { this.pair.b.close(reason); super.close(reason); }
  reconnect(): void {
    this.pair.b.close('network lost'); this.pair = createLoopbackPair(); this.open = true; this.forward();
  }
  private forward(): void {
    const pair = this.pair;
    pair.b.onMessage(data => { if (pair === this.pair) this.emitMessage(data); });
    pair.b.onClose(reason => { if (pair === this.pair) super.close(reason); });
  }
}

/** Real Session, codec, snapshots and production mobile adapter. Placement and clock are controlled. */
export function createMobileSupplySessionFixture() {
  const world = requireWorld('greybox-01');
  const encounter = parseEncounter({ world: world.id, aliveCap: 4, probes: [1], areas: {}, groups: [
    { id: 'unused', members: [{ archetype: 'rifleman', count: 1 }], zone: 'behind-objective', posture: { kind: 'hold' }, trigger: { kind: 'script' } },
  ] });
  const mission: MissionDef = { id: 'mobile-supply-presentation', world: world.id, respawn: false,
    objectives: [{ type: 'survive', label: 'Review commander supplies', seconds: 3600 }] };
  const events = parseEventScript({ world: world.id, blockers: [], events: [], supplyCaches: SUPPLY_FIXTURES.map(cache => ({
    ...cache, stock: { projectiles: cache.stock.projectiles, healthKits: cache.stock.healthKits,
      primaryMagazines: cache.stock.primaryAmmoUnits / SUPPLY_AMMO_UNITS_PER_MAGAZINE },
  })) }, encounter, world, mission);
  const session = new Session(undefined, '', world, { encounter, mission, events, loadouts: 'class' });
  let now = 0; let tick = 0;
  const people: { net: NetClient; transport: ReviewTransport; holding: boolean }[] = [];
  const settle = () => { for (let n = 0; n < 3; n++) for (const player of people) player.transport.pair.settle(); };
  const join = (slot: number) => {
    const transport = new ReviewTransport(); session.addConnection(transport.pair.a, now);
    const net = new NetClient(transport, `Reviewer ${slot + 1}`);
    const player = { net, transport, holding: false }; people.push(player);
    net.join('', '', '', '', '', false, slot); settle(); return player;
  };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      tick++; now += TICK_SECONDS * 1000;
      for (const player of people) if (player.transport.isOpen) {
        player.transport.send(encodeMessage({ kind: 'Ping', id: tick, clientTime: now }));
        player.transport.send(encodeMessage({ kind: 'Input', tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: player.holding ? 8 : 0 }));
      }
      settle(); session.step(now); settle();
    }
  };
  const place = (slot: number, cacheIndex = 0, offset = 0) => {
    const feet = SUPPLY_FIXTURES[cacheIndex]!.feet;
    const soldier = session.slots[slot]!;
    soldier.state = createMoveState(feet.x + offset, feet.y, feet.z - 1); return soldier;
  };
  const reconnect = (player: ReturnType<typeof join>) => {
    const slot = player.net.slot; const resume = player.net.resumeToken;
    player.transport.reconnect(); player.net.resetForRejoin();
    session.addConnection(player.transport.pair.a, now);
    player.net.join('', '', '', resume, '', false, slot); settle();
  };
  const requests = (player: ReturnType<typeof join>) => player.transport.sent.map(decodeMessage)
    .filter(message => message.kind === 'CommanderSupplySelect');
  return { session, join, settle, step, place, reconnect, requests,
    model: (player: ReturnType<typeof join>) => mobileSupplyState(player.net),
    dispose: () => { for (const player of people) player.transport.close('fixture ended'); session.close('fixture ended'); },
  };
}
