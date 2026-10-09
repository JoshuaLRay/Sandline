/**
 * The order wheel and the mark (T-3.29).
 *
 * Hold Q: a radial wheel of the five orders and (U-153) the three stances a
 * player holds bots in opens, and the view stops turning;
 * the mouse's motion while it is held picks a sector by direction. Release Q:
 * the order in that sector is sent, at the point under the converged aim —
 * the point the crosshair's own raycast found (`main.ts`), which is what the
 * player was looking at when they opened the wheel, since the view does not
 * move while it is open; a move or hold, at the feet on the floor there
 * (U-123, `orderPick.ts`). Released inside the deadzone, nothing is sent.
 * Number keys while Q is held choose who hears it: 1–6 a slot, 7 and 8 a
 * fireteam, 0 everyone (the default). A stance — Auto, Crouch, Prone — goes
 * to the same addressee and needs nothing under the crosshair: hold Q, flick
 * to prone, release, and the squad hits the dirt (U-153). A tap of F marks
 * what is under the crosshair: the enemy, if it is one, else the point.
 *
 * Everything here that decides something is a pure function of its inputs,
 * so the tests can hold the mapping and the message to account without a
 * page. `OrderWheelView` is only the picture of `wheelChoice`.
 */
import { ORDER_KINDS, STANCE_KINDS, type Message, type OrderAddress, type OrderKind, SQUAD, type SquadStance } from '@sandline/shared';

/** What a wheel sector gives: an order, or (U-153) a stance to hold bots in. The two name sets do not overlap. */
export type WheelItem = OrderKind | SquadStance;
/** What a release sends: an Order, or a Stance. */
export type WheelCommand = Extract<Message, { kind: 'Order' | 'Stance' }>;

/** The wheel, clockwise from the top: the orders, then the stances, one sector of 45° each, centred on its direction. */
export const ORDER_WHEEL: readonly WheelItem[] = [...ORDER_KINDS, ...STANCE_KINDS];

function isStance(item: WheelItem): item is SquadStance {
  return (STANCE_KINDS as readonly string[]).includes(item);
}

/** How the wheel names a sector: a stance says it is one. */
export function wheelLabel(item: WheelItem): string {
  return item === 'auto' ? 'auto stance' : item;
}
/** Mouse travel, in pixels, before the wheel picks anything. Released inside it: cancelled. */
export const WHEEL_DEADZONE_PX = 24;
/**
 * The wheel's reach, in pixels: travel beyond it is dropped, so turning
 * back towards another sector costs the same however far the mouse ran.
 */
export const WHEEL_RADIUS_PX = 120;

const SECTOR_DEG = 360 / ORDER_WHEEL.length;

/** Where the wheel's pointer is: screen pixels from the centre, x right and y down. */
export interface WheelPointer {
  dx: number;
  dy: number;
}

/** Add mouse motion to the pointer, held inside the wheel's reach. */
export function moveWheelPointer(p: WheelPointer, dx: number, dy: number): WheelPointer {
  let x = p.dx + dx;
  let y = p.dy + dy;
  const length = Math.sqrt(x * x + y * y);
  if (length > WHEEL_RADIUS_PX) {
    x = (x / length) * WHEEL_RADIUS_PX;
    y = (y / length) * WHEEL_RADIUS_PX;
  }
  return { dx: x, dy: y };
}

/** The sector index under the pointer, clockwise from the top, or -1 inside the deadzone. */
export function wheelSector(p: WheelPointer): number {
  if (Math.sqrt(p.dx * p.dx + p.dy * p.dy) < WHEEL_DEADZONE_PX) return -1;
  // Clockwise from up: screen y grows downward, so up is -dy.
  const deg = (Math.atan2(p.dx, -p.dy) * 180) / Math.PI;
  const turned = (deg + 360 + SECTOR_DEG / 2) % 360;
  return Math.floor(turned / SECTOR_DEG) % ORDER_WHEEL.length;
}

/** The order or stance under the pointer, or null inside the deadzone. */
export function wheelChoice(p: WheelPointer): WheelItem | null {
  const sector = wheelSector(p);
  return sector < 0 ? null : ORDER_WHEEL[sector]!;
}

/** Who a number key pressed while the wheel is open addresses: 1–6 a slot, 7–8 a fireteam, 0 all. */
export function addressForDigit(digit: number): OrderAddress | null {
  if (digit === 0) return { to: 'all' };
  if (digit >= 1 && digit <= 6) return { to: 'slot', index: digit - 1 };
  const team = digit - 7;
  if (team >= 0 && team < SQUAD.fireteams.length) return { to: 'fireteam', index: team };
  return null;
}

/** How the wheel names who hears the order. */
export function addressLabel(address: OrderAddress): string {
  if (address.to === 'all') return 'everyone';
  if (address.to === 'fireteam') return `fireteam ${address.index + 1}`;
  return `slot ${address.index + 1}`;
}

/** What the wheel was left on when Q came up: latched by `LocalInput` on the release itself. */
export interface WheelRelease {
  pointer: WheelPointer;
  address: OrderAddress;
}

/** What is under the crosshair, from the aim raycast the crosshair uses. */
export interface AimSubject {
  /** The converged aim point: where the crosshair's ray met the world. */
  point: { x: number; y: number; z: number };
  /**
   * U-123: the feet a move or hold at that point means (`pickFeet`): the floor
   * pointed at — a wall's foot, the floor beneath a ceiling — not the face in
   * mid-air the ray happened to meet.
   */
  feet: { x: number; y: number; z: number };
  /** The netId of the soldier the ray hit first, if it hit one. */
  netId: number | null;
  /** That soldier is an enemy that is not dead: something to attack or mark. */
  enemy: boolean;
  /** That soldier is a downed squadmate: someone to revive. */
  downedMate: boolean;
}

/**
 * The Order message for `kind` to `address` at what is under the crosshair,
 * or null when there is nothing to give it to: an attack needs a living enemy
 * under the crosshair, a revive a downed squadmate. Move and hold take the
 * aim's feet (U-123); regroup takes nothing. What the session refuses anyway
 * (`orderProblem`) is never built here.
 */
export function buildOrder(kind: OrderKind, address: OrderAddress, aim: AimSubject): Extract<Message, { kind: 'Order' }> | null {
  const point = { x: aim.feet.x, y: aim.feet.y, z: aim.feet.z };
  switch (kind) {
    case 'move':
    case 'hold':
      return { kind: 'Order', order: kind, address, point, target: null };
    case 'regroup':
      return { kind: 'Order', order: kind, address, point: null, target: null };
    case 'attack':
      return aim.enemy && aim.netId !== null ? { kind: 'Order', order: kind, address, point: null, target: aim.netId } : null;
    case 'revive':
      return aim.downedMate && aim.netId !== null ? { kind: 'Order', order: kind, address, point: null, target: aim.netId } : null;
  }
}

/**
 * The order the wheel was released on, built — or the stance, which needs no aim; null if it was cancelled or has
 * nothing to act on.
 */
export function orderFromRelease(release: WheelRelease, aim: AimSubject): WheelCommand | null {
  const item = wheelChoice(release.pointer);
  if (item === null) return null;
  return isStance(item) ? { kind: 'Stance', address: release.address, stance: item } : buildOrder(item, release.address, aim);
}

/** The Mark message for a tap of F: the enemy under the crosshair, else the point. */
export function buildMark(aim: AimSubject): Extract<Message, { kind: 'Mark' }> {
  return { kind: 'Mark', point: { x: aim.point.x, y: aim.point.y, z: aim.point.z }, target: aim.enemy ? aim.netId : null };
}

/** The picture of the wheel: eight labels round a centre that names the addressee. */
export class OrderWheelView {
  private readonly root: HTMLDivElement;
  private readonly items: HTMLDivElement[] = [];
  private readonly centre: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'order-wheel';
    this.root.hidden = true;
    ORDER_WHEEL.forEach((kind, i) => {
      const el = document.createElement('div');
      el.className = 'order-wheel-item';
      el.textContent = wheelLabel(kind);
      if (isStance(kind)) el.classList.add('stance');
      const rad = (i * SECTOR_DEG * Math.PI) / 180;
      el.style.transform = `translate(-50%, -50%) translate(${Math.sin(rad) * 96}px, ${-Math.cos(rad) * 96}px)`;
      this.root.append(el);
      this.items.push(el);
    });
    this.centre = document.createElement('div');
    this.centre.className = 'order-wheel-centre';
    this.root.append(this.centre);
    parent.append(this.root);
  }

  /** Show the wheel with `pointer`'s sector lit, or hide it (null). */
  update(open: { pointer: WheelPointer; address: OrderAddress } | null): void {
    this.root.hidden = open === null;
    if (!open) return;
    const sector = wheelSector(open.pointer);
    this.items.forEach((el, i) => el.classList.toggle('active', i === sector));
    this.centre.textContent = `${sector < 0 ? 'cancel' : wheelLabel(ORDER_WHEEL[sector]!)} → ${addressLabel(open.address)}`;
  }
}
