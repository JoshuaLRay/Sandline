/**
 * Authoritative session and tick loop (T-1.13, ADR-012).
 *
 * Fixed 30 Hz: drain inputs, step the simulation, build a per-client delta
 * against that client's last acknowledged tick, broadcast.
 *
 * ADR-001: six slots, always. Unfilled slots are bots, so a joining player
 * takes over an existing entity rather than spawning a new one, and a leaving
 * player hands theirs back. The world never changes shape, which is what makes
 * drop-in/drop-out an entity swap instead of a session rebuild.
 *
 * Time is injected, never read, so the whole loop is testable without timers.
 */
import { type MoveInput, type MoveState, ServerConnection, type Transport } from '@sandline/shared';
export interface Slot {
    index: number;
    netId: number;
    isBot: boolean;
    state: MoveState;
    yaw: number;
    input: MoveInput;
    /** Ticks since a real input arrived, for the repeat-then-idle rule. */
    staleTicks: number;
    connection: ServerConnection | null;
}
/** ADR-012: repeat a missing input this many ticks, then treat it as idle. */
export declare const MAX_INPUT_REPEAT = 5;
export interface SessionStats {
    tick: number;
    players: number;
    bots: number;
    snapshotsSent: number;
    bytesSent: number;
}
export declare class Session {
    readonly slots: Slot[];
    private readonly history;
    private readonly connections;
    private currentTick;
    private nextNetId;
    private snapshotsSent;
    private bytesSent;
    constructor();
    get tick(): number;
    get stats(): SessionStats;
    /** Attach a transport. The connection handshakes before taking a slot. */
    addConnection(transport: Transport, now: number): ServerConnection;
    private assignSlot;
    private releaseSlot;
    private applyInput;
    /** Advance one authoritative tick and broadcast. */
    step(now: number): void;
    private buildSnapshot;
    private broadcast;
    close(reason?: string): void;
}
//# sourceMappingURL=Session.d.ts.map