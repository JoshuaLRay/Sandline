import { expect, it } from 'vitest';
import { initNav } from '@sandline/server/nav';
import { getWorld, requireWorld } from '@sandline/shared';
import { LocalServer } from './LocalServer.ts';
import { NetClient } from './NetClient.ts';

it('joins and predicts an explicitly injected local world while leaving registered lookup unchanged', async () => {
  await initNav();
  const base = requireWorld('range');
  const world = { ...base, id: 'unregistered-preview-test', mapRevision: 2 };
  const server = new LocalServer(undefined, undefined, { world });
  const client = new NetClient(server.transport, 'preview', undefined, (id) => id === world.id ? world : undefined);
  client.join();
  for (let i = 0; i < 12; i++) server.step(i * 34);
  expect(client.joined).toBe(true);
  expect(client.world).toBe(world);
  expect(client.worldBoxes).toEqual(world.boxes);
  expect(client.simulated).not.toBeNull();
  expect(getWorld(world.id)).toBeUndefined();
  expect(requireWorld('qalat-road').mapRevision).not.toBe(2);

  const ordinary = new NetClient(server.connect({ latencyMs: 0, jitterMs: 0, lossRate: 0 }).transport, 'normal');
  ordinary.join();
  for (let i = 12; i < 24; i++) server.step(i * 34);
  expect(ordinary.joined).toBe(false);
  expect(ordinary.world).toBeNull();
});
