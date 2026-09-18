/**
 * A second client in the page, walking a seeded patrol (T-1.23).
 *
 * The netgraph's interpolation numbers are meaningless against five idle
 * capsules: a stationary entity interpolates perfectly at any latency. Remote
 * MOTION is where a poor link actually shows — rubber-banding, extrapolation,
 * the freeze when the buffer starves — and T-1.23's acceptance is explicitly a
 * two-client session.
 *
 * It runs the real NetClient over its own simulated link, so it is a genuine
 * second player as far as the session is concerned, not a puppet moved by the
 * renderer.
 *
 * Seeded rather than random, for the same reason the bot is (T-1.20): a harness
 * that patrols differently every reload cannot be compared against itself.
 */
import { type MoveInput, Sfc32, type Transport } from '@sandline/shared';
import { NetClient } from './NetClient.ts';

export class SparringPartner {
  private readonly client: NetClient;
  private readonly rng: Sfc32;
  private current: MoveInput = {
    moveX: 0,
    moveY: 1,
    yaw: 0,
    jump: false,
    sprint: false,
    crouch: false,
  };

  constructor(transport: Transport, seed = 20260918) {
    this.client = new NetClient(transport, 'sparring');
    this.rng = new Sfc32(seed);
    this.client.join();
  }

  /**
   * One tick of patrol. Direction changes occasionally rather than every tick,
   * so the motion reads as a player crossing the range rather than as jitter
   * that averages to standing still — the latter would interpolate beautifully
   * and prove nothing.
   */
  tick(tickNumber: number): void {
    if (this.rng.nextUint32() % 24 === 0) {
      this.current = {
        moveX: (this.rng.nextUint32() % 3) - 1,
        moveY: (this.rng.nextUint32() % 3) - 1,
        yaw: this.rng.nextUint32() % 1024,
        jump: this.rng.nextUint32() % 12 === 0,
        sprint: this.rng.nextUint32() % 3 === 0,
        crouch: false,
      };
    }
    this.client.tick(tickNumber, this.current, 0);
  }

  advanceClock(frameMs: number): void {
    this.client.advanceClock(frameMs);
  }
}
