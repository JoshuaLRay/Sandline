/**
 * Room registry (T-1.5.05): one process, many sessions.
 *
 * WHAT A ROOM IS. A `Session` (T-1.13) with a code, on its own clock. Nothing
 * inside `Session` changes to become a room; it never knew it was the only
 * one. The registry makes them, finds them by code, steps every live one each
 * tick, and reclaims the ones nobody is in. PLAN.md §3 named
 * `server/src/session/` as "room, tick loop, player slots"; the first and last
 * existed, this is the middle word.
 *
 * ONE CLOCK PER ROOM, STARTING AT ZERO. Simulation time is what lag
 * compensation rewinds by (T-1.18): a client's Fire carries the server time it
 * was rendering, computed as `tick x TICK_MS` from the ticks it has seen, and
 * the server subtracts that from its own `nowMs` to find how far back to look.
 * A room made ten minutes into the host's life, stepped on the host's clock,
 * would have a `nowMs` ten minutes ahead of the `tick x TICK_MS` its clients
 * compute — every shot would ask for a rewind of ten minutes, be clamped to
 * MAX_REWIND_MS, and resolve against the oldest history there is. Each room
 * therefore counts its own time from its own first tick, exactly as a
 * single-session host did (T-1.5.01), and a connection joining it restarts its
 * heartbeat clock on that time (`ServerConnection.resetClock`).
 *
 * RECLAIMING IS A JUDGEMENT CALL, so the number is a parameter. A room with no
 * humans in it still costs a full 30 Hz tick loop and six simulated soldiers,
 * and should not outlive the people who were in it. But the moment the last
 * person's wifi drops is exactly the moment they are about to reconnect — the
 * client's backoff (T-1.08) takes up to ~16 s to give up — and reclaiming
 * then hands them a "no such room" for a game that was fine a second ago. The
 * grace defaults to two minutes: long enough for every reconnect the client
 * will attempt and for a "hang on, reloading" over voice, short enough that an
 * abandoned room is gone before anyone pays for it.
 *
 * CAPS, BECAUSE THIS WILL BE PUBLIC. A deployed host (T-1.5.07) has no
 * accounts in front of it — R12, arriving early. Rooms per process and players
 * per room are both hard limits that REJECT rather than degrade: a seventh
 * player gets `room full`, a request for one room too many gets `host full`,
 * and the rooms that exist keep ticking at the rate they promised.
 */
import { type MoveConfig, Sfc32, TICK_SECONDS, generateRoomCode } from '@sandline/shared';
import { Session } from './Session.ts';

const TICK_MS = TICK_SECONDS * 1000;

/** Default grace before an empty room is reclaimed. See the header. */
export const DEFAULT_ROOM_GRACE_MS = 120_000;
/** Default rooms per process. Six players each; one small instance. */
export const DEFAULT_MAX_ROOMS = 8;

export interface Room {
  readonly code: string;
  readonly session: Session;
  /** Registry time the room was made, ms. */
  readonly createdAt: number;
  /** This room's own simulation clock: ticks x TICK_MS, from zero. */
  simTimeMs: number;
  /** Registry time the last human left, or null while someone is in it. */
  emptySince: number | null;
}

export interface RegistryOptions {
  maxRooms?: number;
  graceMs?: number;
  /** Seeds the code generator, so a test can predict the codes it gets. */
  seed?: number;
  moveConfig?: MoveConfig;
  /** Called when a room is reclaimed, with why. For the host's log. */
  onReclaim?: (room: Room, reason: string) => void;
}

export interface RegistryStats {
  rooms: number;
  maxRooms: number;
  players: number;
  /** Rooms with nobody in them, waiting out the grace. */
  idle: number;
}

export class Registry {
  private readonly rooms = new Map<string, Room>();
  private readonly rng: Sfc32;
  readonly maxRooms: number;
  readonly graceMs: number;
  private readonly moveConfig: MoveConfig | undefined;
  private readonly onReclaim: ((room: Room, reason: string) => void) | undefined;

  constructor(options: RegistryOptions = {}) {
    this.maxRooms = options.maxRooms ?? DEFAULT_MAX_ROOMS;
    this.graceMs = options.graceMs ?? DEFAULT_ROOM_GRACE_MS;
    this.rng = new Sfc32(options.seed ?? 0x2e0a);
    this.moveConfig = options.moveConfig;
    this.onReclaim = options.onReclaim;
  }

  get size(): number {
    return this.rooms.size;
  }

  get stats(): RegistryStats {
    let players = 0;
    let idle = 0;
    for (const room of this.rooms.values()) {
      players += room.session.players;
      if (room.emptySince !== null) idle += 1;
    }
    return { rooms: this.rooms.size, maxRooms: this.maxRooms, players, idle };
  }

  /** Every live room, for the health endpoint and the shutdown log. */
  list(): Room[] {
    return [...this.rooms.values()];
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  /**
   * Make a room, or return null at the cap.
   *
   * A new room starts EMPTY and on the grace clock. The caller is about to
   * seat someone in it (the host admits the creator in the same call), but if
   * that seating fails — the creator's socket died during the handshake — the
   * room must not live forever with nobody in it.
   */
  create(now: number): Room | null {
    if (this.rooms.size >= this.maxRooms) return null;
    let code = generateRoomCode(() => this.rng.next());
    // 24^4 codes against at most a handful of rooms: a collision is rare, and
    // a loop that tries again is cheaper than reasoning about how rare.
    while (this.rooms.has(code)) code = generateRoomCode(() => this.rng.next());
    const room: Room = {
      code,
      session: new Session(this.moveConfig, code),
      createdAt: now,
      simTimeMs: 0,
      emptySince: now,
    };
    this.rooms.set(code, room);
    return room;
  }

  /**
   * Advance every room one tick, then reclaim what has sat empty too long.
   *
   * `now` is the registry's clock — the host's wall time — and is used only for
   * the grace period. Each session is stepped on ITS OWN clock (see the header)
   * by exactly one tick per call, which is what keeps a room's time equal to
   * `tick x TICK_MS` however the host's wall clock stalled.
   */
  step(now: number): void {
    for (const room of this.rooms.values()) {
      room.simTimeMs += TICK_MS;
      room.session.step(room.simTimeMs);
      this.noteOccupancy(room, now);
    }
    this.reclaim(now);
  }

  /**
   * Update a room's empty-since stamp. Called after every step and after
   * every admission, because a join is what ends the grace period and a step
   * is what notices a leave.
   */
  noteOccupancy(room: Room, now: number): void {
    if (room.session.players > 0) room.emptySince = null;
    else room.emptySince ??= now;
  }

  private reclaim(now: number): void {
    for (const room of [...this.rooms.values()]) {
      if (room.emptySince === null || now - room.emptySince < this.graceMs) continue;
      this.rooms.delete(room.code);
      // Nobody is seated, but a handshaking peer could still be attached to
      // the session; it is told the truth rather than left hanging.
      room.session.close('room reclaimed');
      this.onReclaim?.(room, `empty for ${Math.round((now - room.emptySince) / 1000)} s`);
    }
  }

  /** Tell everyone in every room, then drop the rooms. */
  close(reason: string): void {
    for (const room of this.rooms.values()) room.session.close(reason);
    this.rooms.clear();
  }
}
