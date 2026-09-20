/**
 * The browser's networked client (T-1.14, T-1.15, T-1.16 finally in the page).
 *
 * Deliberately a sibling of BotClient rather than a reimplementation: same
 * predict/reconcile path from `shared`, same snapshot store, same reconcile
 * rule. The bot proves that path in CI; this one makes it visible. Anything
 * this file did differently would make the bot's evidence worthless.
 *
 * Two things it adds that the bot does not need: interpolation buffers for
 * remote entities (the bot has no renderer), and hit events (the bot does not
 * shoot).
 */
import {
  COMPONENT_IDS,
  ClockSync,
  type DisconnectCode,
  type RosterEntry,
  InterpolationBuffer,
  type InterpResult,
  INTERPOLATION_DELAY_MS,
  type InputFrame,
  MAX_PRIOR_INPUTS,
  type Message,
  type MoveConfig,
  type MoveInput,
  type MoveState,
  PROTOCOL_VERSION,
  POSITION,
  Predictor,
  SnapshotStore,
  TICK_SECONDS,
  type Transport,
  VELOCITY,
  decodeMessage,
  dequantize,
  encodeMessage,
  type Vitality,
  vitalityFromCode,
} from '@sandline/shared';

const T = COMPONENT_IDS.Transform;
const V = COMPONENT_IDS.Velocity;
const H = COMPONENT_IDS.Health;
const TICK_MS = TICK_SECONDS * 1000;

export interface ServerShot {
  shooterNetId: number;
  /** 0 when the shot hit nothing. */
  targetNetId: number;
  x: number;
  y: number;
  z: number;
  damage: number;
}

export interface NetStats {
  joined: boolean;
  netId: number;
  serverTick: number;
  snapshotsApplied: number;
  rejectedDeltas: number;
  missedBaselines: number;
  corrections: number;
  reconciles: number;
  lastDivergence: number;
  peakDivergence: number;
  remotes: number;
  /** Round trip from Ping/Pong, median over the sync window (T-1.10). */
  rttMs: number;
  /** Spread of snapshot inter-arrival times — what interpolation has to absorb. */
  jitterMs: number;
  /**
   * Fraction of snapshot ticks the client never got state for.
   *
   * NOT the injected packet loss, and reads higher than it on purpose. A
   * dropped delta usually takes the NEXT one with it, because that one's
   * baseline is now missing and it has to be rejected — so 5% packet loss
   * showed as 9.8% of ticks unaccounted for. This is the number the client
   * actually experiences, which is the one worth graphing; raw packet loss is
   * already on the slider that caused it.
   */
  snapshotGapRate: number;
  /** Mean bytes per snapshot, against the ADR-012 budget. */
  snapshotBytes: number;
  /**
   * Ticks of interpolation buffer still AHEAD of what is being rendered.
   *
   * Not the sample count, which sits pinned at the ring's capacity forever and
   * says nothing. This is how much runway interpolation has left: it falls
   * toward zero as snapshots stop arriving, and zero is the moment remote
   * entities start extrapolating and then freeze (T-1.16).
   */
  interpAheadTicks: number;
  /**
   * Ticks between the client's running estimate of server time and the newest
   * tick actually received. Grows when snapshots stop arriving.
   */
  tickDrift: number;
  health: number;
  maxHealth: number;
  /** Alive, downed (crawling, bleeding out) or dead (waiting to respawn). */
  vitality: Vitality;
  /** Whole seconds left of the bleed-out or the respawn, from the server. */
  vitalTimer: number;
}

export class NetClient {
  private readonly store = new SnapshotStore();
  private predictor: Predictor | null = null;
  private readonly buffers = new Map<number, InterpolationBuffer>();
  private netIdValue = -1;
  private slotValue = -1;
  private joinedFlag = false;
  /**
   * Why the host closed the connection, when it said (T-1.5.02).
   *
   * Previously dropped on the floor: on a loopback pair the only sender was
   * this page, so the message carried nothing a tester could act on. On a real
   * socket it is the one thing that distinguishes "the session is full" from
   * "the host went away" from "your build is too old to speak to it" — three
   * situations with three different responses, which look identical from a
   * frozen screen.
   */
  private disconnectReasonValue: string | null = null;
  private disconnectCodeValue: DisconnectCode | null = null;
  private roomValue = '';
  /**
   * Who is in the six slots, as the host last said (T-1.5.04). Empty until
   * seated; six entries after. The lobby's roster is drawn from this.
   */
  private rosterValue: RosterEntry[] = [];

  private snapshotsApplied = 0;
  private rejectedDeltas = 0;
  private reconciles = 0;
  /**
   * Counted from `result.corrected`, NOT from `Predictor.corrections`.
   *
   * Those two disagree. `Predictor.reconcile` increments its own counter only
   * on the replay path; when the acknowledged tick has aged out of history it
   * snaps straight to authority, returns `corrected: true`, and never counts
   * it. That is the most violent correction there is, so a netgraph fed from
   * the internal counter would under-report precisely the worst case. Raised
   * for T-1.23 rather than changed here: the same counter feeds T-1.22's exit
   * gate, and moving a gate's metric is not a side effect of a client change.
   */
  private correctionCount = 0;
  private lastDivergence = 0;
  private peakDivergence = 0;
  private newestServerMs = 0;
  /**
   * Local estimate of the server's clock, advanced by frame time and pulled
   * forward whenever a fresher snapshot lands. Remote entities render at
   * `this - INTERPOLATION_DELAY_MS` (T-1.16); without a clock that keeps
   * running between snapshots they would step once per arrival instead of
   * moving smoothly.
   */
  private serverClockMs = 0;
  private healthValue = 0;
  private maxHealthValue = 0;
  /**
   * Replicated with the health (T-2.13). Vitality is gameplay, not cosmetic:
   * the predictor needs it to crawl when the server crawls, and the timer is
   * the server's count rather than one started when a zero was first seen.
   */
  private vitalityValue: Vitality = 'alive';
  private vitalTimerValue = 0;
  /** Each remote soldier's vitality from its newest snapshot, for the pose (T-2.14). */
  private readonly remoteVitalities = new Map<number, Vitality>();
  private reviveProgressValue = 0;
  private reviveTargetValue = -1;
  private reviveReviverValue = -1;
  /** Local time the newest snapshot landed, for anchoring the server clock. */
  private lastArrivalAt = 0;

  /* -- Link health, for the netgraph (T-1.23) ----------------------------- */
  private readonly clock = new ClockSync();
  private lastPingAt = 0;
  private rttEstimate = 0;
  /** Arrival times of recent snapshots, for inter-arrival jitter. */
  private readonly arrivals: number[] = [];
  private jitterEstimate = 0;
  private bytesTotal = 0;
  private snapshotsForBytes = 0;
  /** Newest tick seen, and how many ticks were skipped, for a loss estimate. */
  private highestTick = -1;
  private ticksExpected = 0;
  private ticksMissing = 0;

  /**
   * The last few inputs sent, newest first, resent in each packet so a dropped
   * one costs nothing (see the Fire/Input protocol notes).
   */
  private readonly recentInputs: InputFrame[] = [];

  /** Authoritative shot outcomes. Set by the renderer to draw tracers. */
  onShot: ((shot: ServerShot) => void) | null = null;
  /** Seated in a slot. Remote sessions surface this in the HUD (T-1.5.02). */
  onJoined: ((slot: number, room: string) => void) | null = null;
  /** The host said goodbye, and why — typed, so the UI can act on it. */
  onDisconnect: ((reason: string, code: DisconnectCode) => void) | null = null;
  /** The squad changed. */
  onRoster: ((slots: RosterEntry[]) => void) | null = null;

  constructor(
    private readonly transport: Transport,
    private readonly name: string,
    /**
     * Shared with the server's session by reference, so the movement tuning
     * panel cannot move one without the other. Two configs that drifted would
     * mispredict every tick.
     */
    private readonly moveConfig?: MoveConfig,
  ) {
    transport.onMessage((bytes) => this.handle(bytes));
  }

  get netId(): number {
    return this.netIdValue;
  }

  /** Squad slot the host seated us in, or -1. ADR-001: always 0..5. */
  get slot(): number {
    return this.slotValue;
  }

  get disconnectReason(): string | null {
    return this.disconnectReasonValue;
  }

  get disconnectCode(): DisconnectCode | null {
    return this.disconnectCodeValue;
  }

  /** The room code the host seated us in; empty on an in-page session. */
  get room(): string {
    return this.roomValue;
  }

  get roster(): readonly RosterEntry[] {
    return this.rosterValue;
  }

  get joined(): boolean {
    return this.joinedFlag;
  }

  get stats(): NetStats {
    return {
      joined: this.joinedFlag,
      netId: this.netIdValue,
      serverTick: Math.round(this.newestServerMs / TICK_MS),
      snapshotsApplied: this.snapshotsApplied,
      rejectedDeltas: this.rejectedDeltas,
      missedBaselines: this.store.missedBaselines,
      corrections: this.correctionCount,
      reconciles: this.reconciles,
      lastDivergence: this.lastDivergence,
      peakDivergence: this.peakDivergence,
      remotes: this.buffers.size,
      rttMs: this.rttEstimate,
      jitterMs: this.jitterEstimate,
      snapshotGapRate: this.ticksExpected === 0 ? 0 : this.ticksMissing / this.ticksExpected,
      snapshotBytes: this.snapshotsForBytes === 0 ? 0 : this.bytesTotal / this.snapshotsForBytes,
      interpAheadTicks: this.interpAhead(),
      tickDrift: Math.max(0, Math.round(this.serverClockMs / TICK_MS) - this.highestTick),
      health: this.healthValue,
      maxHealth: this.maxHealthValue,
      vitality: this.vitalityValue,
      vitalTimer: this.vitalTimerValue,
    };
  }

  /** On their feet, crawling, or waiting to respawn — the server's word. */
  get vitality(): Vitality {
    return this.vitalityValue;
  }

  /** Handshake. An empty room asks the host to create one (T-1.5.04). */
  join(room = ''): void {
    this.transport.send(
      encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: this.name, room }),
    );
  }

  /**
   * Say goodbye rather than just closing the socket, so the host frees the
   * slot on the spot instead of after the heartbeat timeout — a leaving
   * player's row in everyone else's roster flips back to bot immediately.
   */
  leave(): void {
    if (this.transport.isOpen) {
      this.transport.send(encodeMessage({ kind: 'Disconnect', code: 'left', reason: 'left' }));
    }
    this.joinedFlag = false;
    this.transport.close('left');
  }

  /**
   * Forget everything about the last connection, before handshaking again.
   *
   * A reconnect is not a resumption. The host hands a dropped player's entity
   * back to a bot the moment the socket closes, so a returning client gets a
   * NEW slot and a NEW NetId — and every piece of state below is about the old
   * one. Keeping the predictor would reconcile our position against a soldier
   * that now belongs to somebody else; keeping the snapshot store would decode
   * the first delta against a baseline from a session we are no longer in,
   * producing world state that is plausible and wrong, which is the one failure
   * mode `SnapshotStore` exists to refuse (see its missed-baseline path).
   *
   * Link-health counters are deliberately NOT reset: RTT, jitter and the
   * snapshot gap rate describe the network between here and the host, and that
   * did not change because a socket did. A tester watching the netgraph through
   * a drop wants the trend, not a fresh graph.
   */
  resetForRejoin(): void {
    this.store.reset();
    this.predictor = null;
    this.buffers.clear();
    this.netIdValue = -1;
    this.slotValue = -1;
    this.joinedFlag = false;
    this.disconnectReasonValue = null;
    this.disconnectCodeValue = null;
    this.roomValue = '';
    this.rosterValue = [];
    this.healthValue = 0;
    this.maxHealthValue = 0;
    this.vitalityValue = 'alive';
    this.vitalTimerValue = 0;
    this.remoteVitalities.clear();
    this.recentInputs.length = 0;
    this.newestServerMs = 0;
    this.serverClockMs = 0;
    this.highestTick = -1;
  }

  /** Predict one tick locally and send the input. Unreliable: a lost input is
   *  covered by the server's repeat-then-idle rule, and resending stale input
   *  would be worse than dropping it. */
  tick(tickNumber: number, input: MoveInput, pitch: number): void {
    if (!this.joinedFlag || !this.predictor) return;
    // The server crawls a downed soldier whatever buttons arrive; predict the
    // same, or every tick down is a correction (T-2.13).
    const predicted = this.vitalityValue === 'downed' ? { ...input, downed: true } : input;
    this.predictor.predict(tickNumber, predicted);
    const buttons = (input.jump ? 1 : 0) | (input.sprint ? 2 : 0) | (input.crouch ? 4 : 0);
    this.transport.send(
      encodeMessage({
        kind: 'Input',
        tick: tickNumber,
        moveX: input.moveX,
        moveY: input.moveY,
        yaw: input.yaw,
        pitch,
        buttons,
        prior: this.recentInputs.slice(0, MAX_PRIOR_INPUTS),
      }),
      'unreliable',
    );
    this.recentInputs.unshift({
      tick: tickNumber,
      moveX: input.moveX,
      moveY: input.moveY,
      yaw: input.yaw,
      pitch,
      buttons,
    });
    if (this.recentInputs.length > MAX_PRIOR_INPUTS) this.recentInputs.length = MAX_PRIOR_INPUTS;
  }

  /**
   * Pull the trigger. Reliable: a dropped shot is a shot the player took and
   * never got, which is far more noticeable than a dropped movement input.
   *
   * `renderTimeMs` is what the server rewinds hitboxes to, so it must be the
   * time this client was actually RENDERING — the interpolated past, not now.
   */
  revive(active: boolean): void {
    if (!this.joinedFlag) return;
    this.transport.send(encodeMessage({ kind: 'Revive', active }), 'unreliable');
  }

  fire(tick: number, yaw: number, pitch: number, weapon: number, ads: boolean): void {
    if (!this.joinedFlag) return;
    this.transport.send(
      encodeMessage({
        kind: 'Fire',
        tick,
        yaw,
        pitch,
        renderTimeMs: Math.max(0, Math.round(this.serverClockMs - INTERPOLATION_DELAY_MS)),
        weapon,
        ads,
      }),
      'reliable',
    );
  }

  /**
   * Send a heartbeat if one is due. Once a second is plenty for a median over
   * sixteen samples, and it doubles as the keep-alive the server's timeout
   * expects.
   */
  private maybePing(nowMs: number): void {
    // Four a second. A sixteen-sample median at 1 Hz takes sixteen seconds to
    // follow a change, which for an instrument you are watching while dragging
    // a slider is useless; at 250 ms it settles in about four.
    if (nowMs - this.lastPingAt < 250) return;
    this.lastPingAt = nowMs;
    const ping = this.clock.beginPing(nowMs);
    this.transport.send(
      encodeMessage({ kind: 'Ping', id: ping.id, clientTime: ping.clientTime }),
      'unreliable',
    );
  }

  /** Advance the local view of server time. Call once per frame. */
  advanceClock(frameMs: number): void {
    const now = performance.now();
    this.maybePing(now);

    /**
     * Server time is ANCHORED ON ARRIVALS: the newest tick we have heard about,
     * plus however long ago we heard it.
     *
     * Two wrong versions preceded this. The first free-ran — advanced every
     * frame, snapped forward on a fresher snapshot, and had nothing able to
     * pull it back, so it drifted steadily ahead of the data and dragged the
     * interpolation render time past the newest buffered sample. Remote players
     * then extrapolated continuously instead of interpolating, which is the
     * failure T-1.16's extrapolation cap exists to BOUND, not a state to live
     * in.
     *
     * The second tried to use the clock sync's offset, which is wrong for a
     * subtler reason worth writing down: that offset estimates the server's
     * `performance.now()`, while snapshot times are `tick * TICK_MS` counting
     * from zero. Same rate, different origins, so the estimate sat a whole
     * startup-offset ahead and the symptom did not change at all. Clock sync is
     * the right tool for round-trip time and the wrong one for this.
     *
     * Re-anchoring on every arrival cannot drift, because the only thing it
     * extrapolates is the gap since the last packet — which is exactly the
     * quantity that SHOULD eat into interpolation runway when snapshots stop.
     */
    if (this.lastArrivalAt > 0) {
      this.serverClockMs = this.newestServerMs + (now - this.lastArrivalAt);
    } else {
      this.serverClockMs += frameMs;
    }
  }

  /** Smoothed local position, or null before the first authoritative state. */
  renderPosition(frameMs: number): { x: number; y: number; z: number } | null {
    return this.predictor ? this.predictor.renderPosition(frameMs) : null;
  }

  get simulated(): MoveState | null {
    return this.predictor?.simulated ?? null;
  }

  /** A remote soldier's vitality, as of their newest snapshot. Not interpolated: a state, not a position. */
  get reviveProgress(): number { return this.reviveProgressValue; }
  get reviveTargetNetId(): number { return this.reviveTargetValue; }
  get reviveReviverNetId(): number { return this.reviveReviverValue; }

  remoteVitality(netId: number): Vitality {
    return this.remoteVitalities.get(netId) ?? 'alive';
  }

  /** Every remote entity, sampled at the interpolation delay. */
  remotes(): Map<number, InterpResult> {
    const out = new Map<number, InterpResult>();
    const renderAt = this.serverClockMs - INTERPOLATION_DELAY_MS;
    for (const [netId, buffer] of this.buffers) {
      const sample = buffer.sample(renderAt);
      if (sample) out.set(netId, sample);
    }
    return out;
  }

  private handle(bytes: Uint8Array): void {
    let msg: Message;
    try {
      msg = decodeMessage(bytes);
    } catch {
      this.rejectedDeltas++;
      return;
    }

    switch (msg.kind) {
      case 'JoinAck':
        this.netIdValue = msg.netId;
        this.slotValue = msg.slot;
        this.roomValue = msg.room;
        this.joinedFlag = true;
        this.onJoined?.(msg.slot, msg.room);
        // The predictor is NOT created here, for the reason BotClient gives:
        // JoinAck does not say where we spawned, and assuming the origin
        // guarantees a large bogus correction on the first snapshot.
        break;

      case 'Delta': {
        const result = this.store.applyDelta(msg.tick, msg.baselineTick, msg.payload);
        if (!result.ok || !result.snapshot) {
          this.rejectedDeltas++;
          return;
        }
        this.snapshotsApplied++;
        this.bytesTotal += bytes.length;
        this.snapshotsForBytes += 1;
        this.observeArrival(msg.tick, performance.now());
        this.transport.send(encodeMessage({ kind: 'Ack', tick: msg.tick }), 'unreliable');

        const serverMs = msg.tick * TICK_MS;
        if (serverMs > this.newestServerMs) {
          this.newestServerMs = serverMs;
          this.lastArrivalAt = performance.now();
        }
        this.ingest(result.snapshot.entities, msg.tick, serverMs, msg.lastProcessedInputTick);
        break;
      }

      case 'Pong': {
        const sample = this.clock.acceptPong(msg.id, msg.serverTime, performance.now());
        // The MEDIAN over the window, not this sample: one late pong on a
        // jittery link should not make the graph jump.
        if (sample) this.rttEstimate = this.clock.rtt;
        break;
      }

      case 'Disconnect':
        this.disconnectReasonValue = msg.reason;
        this.disconnectCodeValue = msg.code;
        this.joinedFlag = false;
        this.onDisconnect?.(msg.reason, msg.code);
        break;

      case 'Roster':
        this.rosterValue = msg.slots;
        this.onRoster?.(msg.slots);
        break;

      case 'ReviveProgress':
        this.reviveProgressValue = msg.progress;
        this.reviveTargetValue = msg.targetNetId;
        this.reviveReviverValue = msg.reviverNetId;
        break;
      case 'HitEvent':
        this.onShot?.({
          shooterNetId: msg.shooterNetId,
          targetNetId: msg.targetNetId,
          x: msg.x,
          y: msg.y,
          z: msg.z,
          damage: msg.damage,
        });
        break;

      default:
        break;
    }
  }

  /**
   * Track snapshot arrival for jitter and loss.
   *
   * Loss is inferred from GAPS IN TICK NUMBERS, not from a counter the server
   * sends: the server has no idea what failed to arrive, and a client that
   * trusted it would report a perfect link on a broken one. Jitter is the mean
   * absolute deviation of inter-arrival times from the tick period — the
   * quantity interpolation actually has to absorb, rather than the variation in
   * round trip that a ping measures.
   */
  /** Buffer runway: newest buffered tick minus the tick being rendered. */
  private interpAhead(): number {
    if (this.buffers.size === 0) return 0;
    const renderTick = (this.serverClockMs - INTERPOLATION_DELAY_MS) / TICK_MS;
    let best = 0;
    for (const buffer of this.buffers.values()) {
      const ahead = buffer.newestTick - renderTick;
      if (ahead > best) best = ahead;
    }
    return Math.round(best);
  }

  private observeArrival(tick: number, atMs: number): void {
    if (this.highestTick >= 0 && tick > this.highestTick) {
      const skipped = tick - this.highestTick - 1;
      this.ticksExpected += skipped + 1;
      this.ticksMissing += skipped;
    } else if (this.highestTick < 0) {
      this.ticksExpected += 1;
    }
    if (tick > this.highestTick) this.highestTick = tick;

    this.arrivals.push(atMs);
    if (this.arrivals.length > 32) this.arrivals.shift();
    if (this.arrivals.length >= 3) {
      let total = 0;
      for (let i = 1; i < this.arrivals.length; i += 1) {
        total += Math.abs((this.arrivals[i] as number) - (this.arrivals[i - 1] as number) - TICK_MS);
      }
      this.jitterEstimate = total / (this.arrivals.length - 1);
    }
  }

  private ingest(
    entities: readonly { netId: number; components: Record<number, readonly number[]> }[],
    tick: number,
    serverMs: number,
    lastProcessedInputTick: number,
  ): void {
    for (const entity of entities) {
      const transform = entity.components[T];
      if (!transform) continue;

      const x = dequantize(transform[0] as number, POSITION);
      const y = dequantize(transform[1] as number, POSITION);
      const z = dequantize(transform[2] as number, POSITION);

      if (entity.netId === this.netIdValue) {
        const health = entity.components[H];
        if (health) {
          this.healthValue = health[0] as number;
          this.maxHealthValue = health[1] as number;
          this.vitalityValue = vitalityFromCode((health[2] as number | undefined) ?? 0);
          this.vitalTimerValue = (health[3] as number | undefined) ?? 0;
        }
        const velocity = entity.components[V];
        this.reconcile(
          {
            x,
            y,
            z,
            vy: velocity ? dequantize(velocity[1] as number, VELOCITY) : 0,
            // Derived rather than replicated, as in BotClient: height already
            // answers the question and a dedicated bit would not pay for itself.
            grounded: y <= 0.001,
          },
          lastProcessedInputTick,
        );
        continue;
      }

      let buffer = this.buffers.get(entity.netId);
      if (!buffer) {
        buffer = new InterpolationBuffer();
        this.buffers.set(entity.netId, buffer);
      }
      buffer.push({ tick, serverTimeMs: serverMs, x, y, z, yaw: (transform[3] as number) & 0x3ff });
      const health = entity.components[H];
      if (health) this.remoteVitalities.set(entity.netId, vitalityFromCode((health[2] as number | undefined) ?? 0));
    }
  }

  private reconcile(authoritative: MoveState, lastProcessedInputTick: number): void {
    if (!this.predictor) {
      this.predictor = new Predictor(authoritative, this.moveConfig);
      return;
    }
    if (lastProcessedInputTick < 0) return;
    const result = this.predictor.reconcile(lastProcessedInputTick, authoritative);
    this.reconciles++;
    if (result.corrected) this.correctionCount++;
    this.lastDivergence = result.error;
    if (result.error > this.peakDivergence) this.peakDivergence = result.error;
  }
}
