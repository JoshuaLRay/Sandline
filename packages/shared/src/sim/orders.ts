/**
 * Squad orders and target marks (T-3.27): what a player may tell the bots,
 * and what every client is shown of it.
 *
 * An order is one of five kinds, with a point or a target netId as the kind
 * needs, addressed to one slot, a fireteam, or everyone. The shape is checked
 * here (`orderProblem`), so client and server agree on what a well-formed
 * order is; whether the sender, the target and the addressees are real is the
 * session's to check, because only it knows (ADR-001: any player may order any
 * *bot*, and no one may order a human). Carrying an order out is T-3.28's.
 *
 * Marks are points (optionally on a target) a player puts on the world for
 * everyone to see; they stand for `markSeconds` (`data/orders.json`).
 */
import RAW_ORDERS from '../data/orders.json' with { type: 'json' };
import { MAX_SLOTS } from '../net/Connection.ts';

/** The order kinds, in wire order: reordering them is a PROTOCOL_VERSION bump. */
export const ORDER_KINDS = ['move', 'attack', 'hold', 'regroup', 'revive'] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

/** Whom an order is for: one slot, one fireteam (an index into `SQUAD.fireteams`), or the whole squad. */
export type OrderAddress = { to: 'slot'; index: number } | { to: 'fireteam'; index: number } | { to: 'all' };

export interface OrderPoint {
  x: number;
  y: number;
  z: number;
}

/** An order as given: kind, addressees, and whatever the kind needs. */
export interface OrderSpec {
  order: OrderKind;
  address: OrderAddress;
  point: OrderPoint | null;
  target: number | null;
}

/** An order a bot is under, as the session broadcasts it. */
export interface BotOrder {
  /** The bot's slot index. */
  slot: number;
  order: OrderKind;
  point: OrderPoint | null;
  target: number | null;
  /** The slot index of the human who gave it. */
  from: number;
}

/** A mark on the world, as the session broadcasts it. */
export interface TargetMark {
  /** Unique within the session, never reused. */
  id: number;
  /** The slot index of the human who made it. */
  from: number;
  point: OrderPoint;
  target: number | null;
  /** The tick it is gone on. */
  expiresTick: number;
}

/** What each kind needs: a point, a target, or neither — and nothing it does not use. */
const NEEDS: Readonly<Record<OrderKind, { point: 'required' | 'optional' | 'none'; target: 'required' | 'none' }>> = {
  move: { point: 'required', target: 'none' },
  attack: { point: 'none', target: 'required' },
  hold: { point: 'optional', target: 'none' },
  regroup: { point: 'none', target: 'none' },
  revive: { point: 'none', target: 'required' },
};

/**
 * Why an order is malformed, or null for a well-formed one: a kind it does
 * not know, an addressee outside the squad, a point or target the kind needs
 * and does not have, or one it has and does not use.
 */
export function orderProblem(spec: OrderSpec, fireteams: number): string | null {
  const needs = NEEDS[spec.order];
  if (!needs) return `unknown order "${String(spec.order)}"`;
  const a = spec.address;
  if (a.to === 'slot' && !(Number.isInteger(a.index) && a.index >= 0 && a.index < MAX_SLOTS)) return `no slot ${a.index}`;
  if (a.to === 'fireteam' && !(Number.isInteger(a.index) && a.index >= 0 && a.index < fireteams)) return `no fireteam ${a.index}`;
  if (a.to !== 'slot' && a.to !== 'fireteam' && a.to !== 'all') return 'no such addressee';
  if (needs.point === 'required' && spec.point === null) return `${spec.order} needs a point`;
  if (needs.point === 'none' && spec.point !== null) return `${spec.order} takes no point`;
  if (spec.point && ![spec.point.x, spec.point.y, spec.point.z].every(Number.isFinite)) return 'the point is not finite';
  if (needs.target === 'required' && spec.target === null) return `${spec.order} needs a target`;
  if (needs.target === 'none' && spec.target !== null) return `${spec.order} takes no target`;
  if (spec.target !== null && !(Number.isInteger(spec.target) && spec.target > 0)) return `target ${spec.target} is not a netId`;
  return null;
}

/**
 * The wire's ceiling on a player's marks, and so on the session's: `MAX_MARKS`
 * is six players' worth (ADR-001). A literal six, not `MAX_SLOTS`: the
 * protocol imports this module, and `MAX_SLOTS` lives beside it in
 * `Connection.ts`, which imports the protocol — read at module load, it would
 * not be there yet.
 */
export const MAX_MARKS_PER_PLAYER = 4;
export const MAX_MARKS = 6 * MAX_MARKS_PER_PLAYER;

export interface OrdersConfig {
  readonly markSeconds: number;
  readonly marksPerPlayer: number;
}

class OrdersDataError extends Error {}

export function parseOrdersConfig(raw: unknown): OrdersConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new OrdersDataError('orders: expected an object');
  const row = raw as Record<string, unknown>;
  for (const k of Object.keys(row)) if (!['$comment', 'markSeconds', 'marksPerPlayer'].includes(k)) throw new OrdersDataError(`orders: unknown key "${k}"`);
  const num = (key: string, min: number, max: number): number => {
    const v = row[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new OrdersDataError(`orders.${key} must be a finite number, got ${String(v)}`);
    if (v < min || v > max) throw new OrdersDataError(`orders.${key} must be in [${min}, ${max}], got ${v}`);
    return v;
  };
  const marksPerPlayer = num('marksPerPlayer', 1, MAX_MARKS_PER_PLAYER);
  if (!Number.isInteger(marksPerPlayer)) throw new OrdersDataError('orders.marksPerPlayer must be a whole number');
  return { markSeconds: num('markSeconds', 0.5, 600), marksPerPlayer };
}

export const ORDERS: OrdersConfig = parseOrdersConfig(RAW_ORDERS);
