/**
 * An authoritative session running inside the page, reached over a simulated
 * link (T-1.18 wiring, T-1.21 NetSim).
 *
 * WHY IN-BROWSER. The QA home is GitHub Pages, which is static hosting: there
 * is no process there to connect to, and no session host exists yet (ADR-011
 * describes regional hosting; nothing is deployed). Waiting for one would mean
 * the netcode stays untestable by a person indefinitely.
 *
 * WHAT IS REAL ABOUT IT. Everything except the wire. It is the same `Session`
 * the dedicated server runs, the same encode/decode, the same delta baselines,
 * the same prediction and reconciliation, the same lag compensation. Packets
 * are byte-identical to the ones a socket would carry; they simply travel
 * through NetSim instead of TCP. That is the identical arrangement T-1.22's
 * matrix runs headlessly in CI — this makes it feelable.
 *
 * WHAT IS NOT. Real jitter distributions, real reordering under congestion,
 * real NAT and TCP head-of-line blocking. NetSim's latency, jitter and loss are
 * a model. A remote server is still the only way to judge those, and T-1.24
 * should say so.
 *
 * THE PAYOFF. Because the link is simulated, its conditions are a slider. A
 * tester can feel 200 ms and 20% loss on demand, which is exactly the judgement
 * no amount of green CI substitutes for.
 */
import {
  type MoveConfig,
  NetSim,
  type NetSimOptions,
  TICK_SECONDS,
  type Transport,
  createLoopbackPair,
} from '@sandline/shared';
import { Session } from '@sandline/server/session';

export interface LinkConditions {
  latencyMs: number;
  jitterMs: number;
  lossRate: number;
}

export const DEFAULT_LINK: LinkConditions = {
  // Zero by default so the harness feels like the local one it replaces. The
  // sliders are the instrument; a hidden 80 ms would just look like a bug.
  latencyMs: 0,
  jitterMs: 0,
  lossRate: 0,
};

export class LocalServer {
  readonly transport: Transport;
  private readonly session: Session;
  private readonly pair = createLoopbackPair();
  /**
   * Separate option objects per direction, sharing values but NOT seeds. One
   * shared object would give both directions the same RNG stream, so every lost
   * packet would be lost both ways at once — a link no real network resembles,
   * and a flattering one to reconcile against.
   */
  private readonly upstream: NetSimOptions = { seed: 0x51a7 };
  private readonly downstream: NetSimOptions = { seed: 0x9e37 };
  private readonly sims: NetSim[];

  constructor(conditions: LinkConditions = DEFAULT_LINK, moveConfig?: MoveConfig) {
    this.session = new Session(moveConfig);
    const serverSide = new NetSim(this.pair.a, this.upstream);
    const clientSide = new NetSim(this.pair.b, this.downstream);
    this.sims = [serverSide, clientSide];
    this.transport = clientSide;
    this.session.addConnection(serverSide, 0);
    this.setConditions(conditions);
  }

  /** Live-tunable. NetSim reads these on every send, so changes take effect at once. */
  setConditions(c: LinkConditions): void {
    for (const opts of [this.upstream, this.downstream]) {
      opts.latencyMs = c.latencyMs;
      opts.jitterMs = c.jitterMs;
      opts.lossRate = c.lossRate;
    }
  }

  /**
   * Move queued packets. Called every FRAME, not every tick: at 60 fps that
   * halves the time a packet sits waiting for the next pump, which would
   * otherwise read as latency the sliders did not ask for.
   */
  pump(nowMs: number): void {
    for (const sim of this.sims) sim.pump(nowMs);
    this.pair.settle();
  }

  /** Advance the authoritative simulation one tick. */
  step(nowMs: number): void {
    this.pump(nowMs);
    this.session.step(nowMs);
    this.pump(nowMs);
  }

  get tick(): number {
    return this.session.tick;
  }

  /** Server time the newest tick corresponds to, in ms. */
  get serverTimeMs(): number {
    return this.session.tick * TICK_SECONDS * 1000;
  }

  get inFlight(): number {
    return this.sims.reduce((n, s) => n + s.inFlight, 0);
  }
}
