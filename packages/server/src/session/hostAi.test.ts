/**
 * The host builds a new room on the map its creator chose, and with the AI
 * when it runs it (`HOST_AI=1`) — so a QA run on the deployed host plays
 * what the in-page session plays: fighting bots, and on the mission map the
 * mission. Without `HOST_AI` a room is what T-1.5 built: idle bots, no
 * mission, the netcode instrument `pnpm bot --url` compares against.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { type Message, PROTOCOL_VERSION, TICK_SECONDS, createLoopbackPair, decodeMessage, encodeMessage } from '@sandline/shared';
import { initNav } from '../ai/nav/NavMesh.ts';
import type { Logger } from '../log.ts';
import { Registry } from './Registry.ts';
import { SessionHost } from './SessionHost.ts';

const TICK_MS = TICK_SECONDS * 1000;
const quiet: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

describe('a room on the map its creator chose (T-3.35 follow-up)', () => {
  beforeAll(() => initNav());

  it('without HOST_AI: the chosen world, and nothing else — no mission, no cover', () => {
    const registry = new Registry({ world: 'range' });
    const room = registry.create(0, 'greybox-01')!;
    expect(room.session.world.id).toBe('greybox-01');
    expect(room.session.mission).toBeNull();
    expect(room.session.cover).toBeNull();
    // An unknown map, or none, is the host's own.
    expect(registry.create(0, 'atlantis')!.session.world.id).toBe('range');
    expect(registry.create(0)!.session.world.id).toBe('range');
  });

  it('with HOST_AI: the mission map gets its mission and cover; the range its cover and no mission', () => {
    const registry = new Registry({ world: 'range', ai: true });
    const mission = registry.create(0, 'greybox-01')!;
    expect(mission.session.mission).toMatchObject({ state: 'progress', attempt: 1 });
    // T-4.19: hosted rooms build mission data immediately but do not start the encounter until ready-up completes.
    expect(mission.session.spawner).toBeNull();
    expect(mission.session.started).toBe(false);
    expect(mission.session.cover).not.toBeNull();
    const range = registry.create(0, 'range')!;
    expect(range.session.mission).toBeNull();
    expect(range.session.cover).not.toBeNull();
    registry.close('test over');
  });

  it('over the host: the creator’s map is the room’s; a joiner asking for another gets the room’s; the mission is sent', () => {
    let t = 0;
    const host = new SessionHost({ port: 0, log: quiet, autoTick: false, now: () => t, registry: { ai: true } });
    const join = (room: string, world: string) => {
      const pair = createLoopbackPair();
      const got: Message[] = [];
      pair.b.onMessage((bytes) => got.push(decodeMessage(bytes)));
      host.accept(pair.a);
      pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'qa', room, ...(world === '' ? {} : { world }) }));
      pair.settle();
      return { got, pair, ack: () => got.find((m) => m.kind === 'JoinAck') as Extract<Message, { kind: 'JoinAck' }> | undefined };
    };
    const first = join('', 'greybox-01');
    expect(first.ack()?.world).toBe('greybox-01');
    expect(first.got.some((m) => m.kind === 'RoomState' && !m.started)).toBe(true);
    expect(first.got.some((m) => m.kind === 'Mission')).toBe(false);
    const second = join(first.ack()!.room, 'range');
    expect(second.ack()?.world).toBe('greybox-01');
    // The creator force-starts; only now is the mission sent and the encounter allowed to run.
    first.pair.b.send(encodeMessage({ kind: 'RoomCommand', command: 'start' }));
    first.pair.settle();
    second.pair.settle();
    expect(first.got.some((m) => m.kind === 'Mission')).toBe(true);
    // A second of the room: the encounter spawns, as it does in the page.
    for (let i = 0; i < 30; i++) {
      t += TICK_MS;
      host.tickNow();
      first.pair.settle();
      second.pair.settle();
    }
    const room = host.registry.get(first.ack()!.room)!;
    expect(room.session.enemies.length).toBeGreaterThan(0);
  });
});
