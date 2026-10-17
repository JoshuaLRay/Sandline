/** U-219: tooling-only map topology; coordinates are authored feet positions. */
import { z } from 'zod';

const id = z.string().min(1);
const coordinate = z.number().finite();
const point = z.object({ x: coordinate, y: coordinate, z: coordinate }).strict();
const volume = z.object({
  minX: coordinate, maxX: coordinate, minY: coordinate, maxY: coordinate, minZ: coordinate, maxZ: coordinate,
}).strict().refine((v) => v.minX < v.maxX && v.minY < v.maxY && v.minZ < v.maxZ, 'empty cut volume');
const endpoint = z.object({ approach: id, point }).strict();

export const approachGraphSchema = z.object({
  world: id,
  stage: id,
  $comment: z.string().optional(),
  approaches: z.array(z.object({ id, waypoints: z.array(point).min(2), probes: z.array(point).default([]) }).strict()).min(1),
  separations: z.array(z.tuple([id, id])),
  connections: z.array(z.object({
    id, kind: z.enum(['crossing', 'convergence']),
    endpoints: z.array(endpoint).min(2), direction: z.enum(['both', 'forward']),
    cuts: z.array(volume).min(1),
  }).strict()),
}).strict().superRefine((g, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  const ids = new Set(g.approaches.map((a) => a.id));
  if (ids.size !== g.approaches.length) fail('duplicate approach ID');
  if (new Set(g.connections.map((c) => c.id)).size !== g.connections.length) fail('duplicate connection ID');
  const pairs = new Set<string>();
  for (const [a, b] of g.separations) {
    if (!ids.has(a) || !ids.has(b) || a === b) fail('invalid separation approaches');
    const key = [a, b].sort().join('/');
    if (pairs.has(key)) fail('duplicate separation');
    pairs.add(key);
    for (const name of [a, b]) if ((g.approaches.find((p) => p.id === name)?.probes.length ?? 0) < 2)
      fail(`${name}: separation needs at least two interior probes`);
  }
  for (const c of g.connections) {
    if (c.endpoints.some((e) => !ids.has(e.approach)) || new Set(c.endpoints.map((e) => e.approach)).size !== c.endpoints.length)
      fail(`${c.id}: invalid connection approaches`);
    if (c.direction === 'forward' && c.endpoints.length !== 2) fail(`${c.id}: directed connection needs two endpoints`);
  }
});

export type ApproachGraph = z.infer<typeof approachGraphSchema>;
