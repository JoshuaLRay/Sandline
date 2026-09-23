/**
 * The AI debug report (T-3.09).
 *
 * Nobody can judge an AI whose reasons they cannot see, so a host started with
 * `AI_DEBUG=1` can send any client that asks what every bot brain is doing:
 * the branch of its tree that is running, the intent it handed locomotion, the
 * path being walked, and — once perception (T-3.13) and cover (T-3.18) exist —
 * its cones, the targets it knows and the cover it chose. Until then those go
 * out empty rather than as fields a later task has to add to the wire.
 *
 * Built from the session's own objects, read here and never written: a debug
 * view that changed what it observed would be a debug view of something else.
 */
import type { AiDebugBrain, AiDebugPoint, Message } from '@sandline/shared';
import type { Brain } from './Brain.ts';
import type { PathFollower } from './locomotion/followPath.ts';

/** One bot as the report sees it: its body, its brain, and whatever is walking it. */
export interface AiDebugSource {
  netId: number;
  position: Readonly<AiDebugPoint>;
  brain: Brain;
  follower: PathFollower | null;
}

function point(p: Readonly<AiDebugPoint>): AiDebugPoint {
  return { x: p.x, y: p.y, z: p.z };
}

/** What one brain is doing and why, as of its last thought. */
export function describeBrain(source: AiDebugSource): AiDebugBrain {
  const intent = source.brain.intent;
  return {
    netId: source.netId,
    position: point(source.position),
    tree: source.brain.tree.runningPath(),
    intent: intent ? { ...point(intent.goal), pace: intent.pace } : null,
    corridor: (source.follower?.path?.points ?? []).map(point),
    cones: [],
    targets: [],
    cover: null,
  };
}

/** The report for `tick`: every running brain, in slot order. */
export function buildAiDebug(tick: number, sources: readonly AiDebugSource[]): Extract<Message, { kind: 'AiDebug' }> {
  return {
    kind: 'AiDebug',
    tick,
    brains: sources.filter((s) => !s.brain.isStopped).map(describeBrain),
  };
}
