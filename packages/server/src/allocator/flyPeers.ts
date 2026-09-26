/**
 * Peer discovery on Fly (T-4.31): the machines of this app in this region,
 * from the platform's private DNS. `vms.<app>.internal` answers a TXT record
 * per machine, `<id> <region>`, and `<id>.vm.<app>.internal` resolves to that
 * machine on the private network, so a peer's URL is a name, not an address,
 * and a machine that has stopped simply stops resolving.
 *
 * Nothing here runs on a laptop: without `FLY_APP_NAME` a host has no peers
 * and the allocator answers every decision with `here`.
 */
import { promises as dns } from 'node:dns';
import type { PeerInfo } from './Allocator.ts';

export interface FlyPeersOptions {
  app: string;
  region: string;
  /** This machine's id, left out of its own peers. */
  self: string;
  port: number;
  /** Injected in tests; `dns.resolveTxt` otherwise. */
  resolveTxt?: (name: string) => Promise<string[][]>;
}

/** The `<id> <region>` pairs in Fly's TXT answer, whatever the record boundaries and separators. */
export function parseVmsTxt(records: readonly (readonly string[])[]): { instance: string; region: string }[] {
  const out: { instance: string; region: string }[] = [];
  for (const record of records) {
    for (const entry of record.join('').split(',')) {
      const [instance, region] = entry.trim().split(/\s+/);
      if (instance && region) out.push({ instance, region });
    }
  }
  return out;
}

/** A discovery function for the allocator: this region's other machines, fresh on every call. */
export function flyPeers(options: FlyPeersOptions): () => Promise<PeerInfo[]> {
  const resolve = options.resolveTxt ?? ((name: string) => dns.resolveTxt(name));
  return async () => {
    const records = await resolve(`vms.${options.app}.internal`);
    return parseVmsTxt(records)
      .filter((vm) => vm.region === options.region && vm.instance !== options.self)
      .map((vm) => ({ instance: vm.instance, url: `http://${vm.instance}.vm.${options.app}.internal:${options.port}` }));
  };
}

/** The allocator's Fly configuration from the environment, or null off Fly. */
export function flyEnvironment(env: NodeJS.ProcessEnv = process.env): { app: string; region: string; instance: string } | null {
  const app = env['FLY_APP_NAME'];
  const region = env['FLY_REGION'];
  const instance = env['FLY_MACHINE_ID'];
  return app && region && instance ? { app, region, instance } : null;
}
