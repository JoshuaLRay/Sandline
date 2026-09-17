/**
 * Transport abstraction (T-1.06, ADR-008).
 *
 * Everything downstream codes against this interface so WebSocket can be
 * replaced by WebTransport without touching game code.
 *
 * Both channels map to TCP today, so `unreliable` is currently a lie — but it
 * is a deliberate one. Code written against it will be correct when it stops
 * being a lie. The real risk ADR-008 names is assumption leakage: because TCP
 * delivers everything in order, it is easy to write code that quietly depends
 * on that and can never move off it. Hence NetSim, and hence every netcode test
 * running with loss enabled.
 *
 * NO WALL-CLOCK READS. Time is always passed in. A transport that calls
 * Date.now() internally makes every test that depends on it flaky.
 */

export type Channel = 'reliable' | 'unreliable';

export interface Transport {
  readonly isOpen: boolean;
  send(data: Uint8Array, channel?: Channel): void;
  onMessage(handler: (data: Uint8Array) => void): void;
  onClose(handler: (reason: string) => void): void;
  close(reason?: string): void;
}

/** Shared bookkeeping for handler registration and close semantics. */
export abstract class BaseTransport implements Transport {
  protected messageHandlers: ((data: Uint8Array) => void)[] = [];
  protected closeHandlers: ((reason: string) => void)[] = [];
  protected open = true;

  get isOpen(): boolean {
    return this.open;
  }

  abstract send(data: Uint8Array, channel?: Channel): void;

  onMessage(handler: (data: Uint8Array) => void): void {
    this.messageHandlers.push(handler);
  }

  onClose(handler: (reason: string) => void): void {
    this.closeHandlers.push(handler);
  }

  protected emitMessage(data: Uint8Array): void {
    for (const h of this.messageHandlers) h(data);
  }

  close(reason = 'closed'): void {
    if (!this.open) return; // close is idempotent
    this.open = false;
    for (const h of this.closeHandlers) h(reason);
  }
}

/**
 * Two transports wired to each other in memory.
 *
 * This is the backbone of the netcode test suite: it exercises the real
 * connection lifecycle, clock sync and tick loop with no sockets, no ports and
 * no timing races. Delivery is queued rather than synchronous, and `pump()`
 * flushes it, so tests control exactly when messages land and reentrancy is
 * impossible.
 */
class LoopbackTransport extends BaseTransport {
  peer: LoopbackTransport | null = null;
  readonly inbox: Uint8Array[] = [];
  /** Every datagram ever sent, for assertions about traffic. */
  readonly sent: { data: Uint8Array; channel: Channel }[] = [];

  send(data: Uint8Array, channel: Channel = 'reliable'): void {
    if (!this.open) return;
    this.sent.push({ data, channel });
    if (this.peer?.open) this.peer.inbox.push(data.slice());
  }

  deliver(): number {
    const n = this.inbox.length;
    const batch = this.inbox.splice(0, n);
    for (const msg of batch) this.emitMessage(msg);
    return n;
  }

  override close(reason = 'closed'): void {
    const wasOpen = this.open;
    super.close(reason);
    if (wasOpen && this.peer?.open) this.peer.close(reason);
  }
}

export interface LoopbackPair {
  a: LoopbackTransport;
  b: LoopbackTransport;
  /** Deliver everything queued in both directions; returns messages delivered. */
  pump(): number;
  /** Pump repeatedly until the network is quiet, so replies get delivered too. */
  settle(maxRounds?: number): void;
}

export function createLoopbackPair(): LoopbackPair {
  const a = new LoopbackTransport();
  const b = new LoopbackTransport();
  a.peer = b;
  b.peer = a;
  const pump = (): number => a.deliver() + b.deliver();
  return {
    a,
    b,
    pump,
    settle(maxRounds = 16): void {
      for (let i = 0; i < maxRounds; i++) if (pump() === 0) return;
    },
  };
}

export type { LoopbackTransport };
