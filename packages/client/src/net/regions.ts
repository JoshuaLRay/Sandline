/**
 * Region selection in the lobby (T-4.20): ping every region's host, show
 * the round trips, pick the lowest — unless the player picked one, which
 * is remembered — and send a tagged code to the region it names.
 *
 * The choice is pure (`pickRegion`) so it is tested with numbers; the ping
 * is one `fetch` of `/healthz` timed on the caller's clock, which is what
 * the lobby can do before any socket exists and is near enough to the
 * socket's own round trip to choose by. It is a choice for CREATING a room;
 * joining goes where the code's tag says, whatever the player's region.
 */
import { type Region, regionByTag, splitTaggedCode } from '@sandline/shared';

/** A round trip in ms, or null for a region that did not answer. */
export type Rtt = number | null;

export const REGION_KEY = 'sandline.region';

/** The `/healthz` URL for a region's socket address: `wss://` is `https://`, `ws://` is `http://`. */
export function healthUrl(host: string): string {
  const url = new URL(host);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/healthz';
  url.search = '';
  return url.toString();
}

/**
 * Time one health check to a region. Null when it fails, times out or
 * answers anything but OK, which is a region to show as unreachable, not
 * to choose.
 */
export async function measureRtt(
  region: Region,
  options: { fetch?: typeof fetch; now?: () => number; timeoutMs?: number } = {},
): Promise<Rtt> {
  const fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => performance.now());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 3000);
  const from = now();
  try {
    const res = await fetcher(healthUrl(region.host), { cache: 'no-store', signal: controller.signal });
    if (!res.ok) return null;
    return Math.max(0, now() - from);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Which region to create a room in: the one the player chose, when it still
 * exists (a choice is a choice, measured or not); else the lowest round trip
 * among those that answered; else the first, so there is always somewhere.
 * Null only with no regions at all.
 */
export function pickRegion(regions: readonly Region[], rtts: ReadonlyMap<string, Rtt>, remembered: string | null): Region | null {
  if (regions.length === 0) return null;
  if (remembered !== null) {
    const chosen = regions.find((r) => r.id === remembered);
    if (chosen) return chosen;
  }
  let best: Region | null = null;
  let bestRtt = Number.POSITIVE_INFINITY;
  for (const region of regions) {
    const rtt = rtts.get(region.id) ?? null;
    if (rtt !== null && rtt < bestRtt) {
      best = region;
      bestRtt = rtt;
    }
  }
  return best ?? regions[0] ?? null;
}

/** The region a typed or pasted code names by its tag, or null for an untagged code or no code. */
export function regionForCode(raw: string, regions: readonly Region[]): Region | null {
  const split = splitTaggedCode(raw, regions);
  return split?.tag ? regionByTag(split.tag, regions) : null;
}

/** A round trip as the lobby prints it beside a region's name. */
export function describeRtt(rtt: Rtt | undefined): string {
  if (rtt === undefined) return '…';
  if (rtt === null) return 'no answer';
  return `${Math.round(rtt)} ms`;
}

export function readStoredRegion(): string | null {
  try {
    return localStorage.getItem(REGION_KEY);
  } catch {
    return null;
  }
}

export function storeRegion(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(REGION_KEY);
    else localStorage.setItem(REGION_KEY, id);
  } catch {
    // Preference only.
  }
}
