/**
 * A fake Web Audio context for headless tests (T-2.45, T-2.46): it records
 * every node made, what each connects to, and when each source starts, and
 * decodes a file to a record naming it, so a test can tell which variant a
 * source played. No audio device, no browser.
 */
import type { AudioContextLike } from './engine.ts';

export interface FakeNode {
  kind: string;
  connections: FakeNode[];
  disconnected: boolean;
  [k: string]: unknown;
}

function param(value = 0) {
  return { value };
}

export function fakeContext() {
  const made: FakeNode[] = [];
  const started: { node: FakeNode; when: number }[] = [];
  const node = (kind: string, extra: Record<string, unknown> = {}): FakeNode => {
    const n: FakeNode = {
      kind,
      connections: [],
      disconnected: false,
      connect(to: FakeNode) {
        n.connections.push(to);
        return to;
      },
      disconnect() {
        n.disconnected = true;
      },
      ...extra,
    };
    made.push(n);
    return n;
  };
  const destination = node('destination');
  const ctx = {
    currentTime: 10,
    state: 'running',
    destination,
    listener: { positionX: param(), positionY: param(), positionZ: param(), forwardX: param(), forwardY: param(), forwardZ: param(), upX: param(), upY: param(), upZ: param() },
    createGain: () => node('gain', { gain: param(1) }),
    createBiquadFilter: () => node('filter', { type: 'lowpass', frequency: param(350) }),
    createPanner: () => node('panner', { panningModel: 'equalpower', distanceModel: 'inverse', positionX: param(), positionY: param(), positionZ: param() }),
    createBufferSource: () => {
      const s = node('source', { buffer: null, onended: null });
      s['start'] = (when = 0) => started.push({ node: s, when });
      s['stop'] = () => {
        s['stopped'] = true;
      };
      return s;
    },
    decodeAudioData: (data: ArrayBuffer) => Promise.resolve({ decoded: data.byteLength, file: new TextDecoder().decode(data) }),
    resume: () => Promise.resolve(),
  };
  return { ctx: ctx as unknown as AudioContextLike, made, started, destination };
}
