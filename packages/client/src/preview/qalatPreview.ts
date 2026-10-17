/** U-234: explicit, disposable WIP access. Never register this world or open a save. */
import * as THREE from 'three';
import { loadLevel, type World } from '@sandline/shared';
import { initNav, NavMesh } from '@sandline/server/nav';
import type { bakedNavFor } from '@sandline/server/nav/baked';
import type { LocalServerOptions } from '../net/LocalServer.ts';
type BakedNav = NonNullable<ReturnType<typeof bakedNavFor>>;

type Surface = { levelHash: string; renderHash: string; encoding: string; contentHash: string; data: string };
type Manifest = { world: string; mapRevision: number; registered: boolean; bundleHash: string;
  hashes: Record<string, string>; levelHash: string; renderHash: string; boxes: number };
async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
interface QalatPreview {
  world: World;
  nav: NavMesh;
  cover: NonNullable<LocalServerOptions['cover']>;
  mesh: THREE.Mesh;
  manifest: Manifest;
  mount(start: () => void): void;
}
export async function loadQalatPreview(): Promise<QalatPreview> {
  const notice = document.createElement('p');
  notice.textContent = 'Loading Qalat WIP construction and navigation…';
  notice.style.cssText = 'position:fixed;inset:20px;z-index:20000;background:#18232b;color:white;padding:20px';
  document.body.append(notice);
  try {
    const fetchJson = async (name: string): Promise<unknown> => {
      const response = await fetch(`./wip-qalat/${name}.json`);
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
      return response.json();
    };
    const [level, rawSurface, rawNav, rawManifest] = await Promise.all(['level', 'surface', 'nav', 'manifest'].map(fetchJson));
    const surface = rawSurface as Surface, navData = rawNav as BakedNav, manifest = rawManifest as Manifest;
    const world = loadLevel(level);
    const hashes = await Promise.all([digest(level), digest(surface), digest(navData), digest(navData.cover), digest(manifest.hashes)]);
    if (manifest.registered !== false || world.mapRevision !== 2 || manifest.mapRevision !== 2 ||
      world.id !== manifest.world || world.id !== navData.world || world.boxes.length !== manifest.boxes ||
      hashes[0] !== manifest.hashes['level'] || hashes[1] !== manifest.hashes['surface'] ||
      hashes[2] !== manifest.hashes['nav'] || hashes[3] !== manifest.hashes['cover'] || hashes[4] !== manifest.bundleHash ||
      surface.levelHash !== hashes[0] || manifest.levelHash !== hashes[0] || surface.renderHash !== manifest.renderHash ||
      surface.encoding !== 'gzip-json-v1') throw new Error('Stale or mixed Qalat WIP bundle');
    const bytes = Uint8Array.from(atob(surface.data), (c) => c.charCodeAt(0));
    const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const rendered = JSON.parse(text) as { positions: number[]; normals: number[]; colours: number[]; indices: number[] };
    if (await digest(rendered) !== surface.contentHash) throw new Error('Stale Qalat WIP render payload');
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(rendered.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(rendered.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(rendered.colours, 3));
    geometry.setIndex(rendered.indices);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    mesh.name = 'U-227 actual replacement construction';
    await initNav();
    const nav = NavMesh.load(Uint8Array.from(atob(navData.base64), (c) => c.charCodeAt(0)), navData.agent.height);
    notice.remove();
    return { world, nav, cover: navData.cover, mesh, manifest,
      mount(start: () => void): void {
        const panel = document.createElement('aside');
        panel.id = 'qalat-wip';
        panel.style.cssText = 'position:fixed;top:8px;left:8px;max-width:540px;z-index:10000;background:#18232bee;color:#f3d18b;padding:10px;font:14px system-ui';
        panel.innerHTML = '<strong>Qalat · PLAYABLE WIP · U-227 construction, revision 2</strong><details open><summary>Unfinished content & controls</summary><p>Explore the actual insertion, road, ridge, depot and outpost with the normal controller, weapons and five squad bots. Encounters, objectives, five caches, mission flow, final art and full verification are unfinished. No campaign progress or saves. Reload to reset.</p><p>Click game to capture mouse · WASD move · Shift sprint · Space jump/vault · C crouch · Z prone · left mouse fire · right mouse aim/first person · R reload · 1–6 equipment · V shoulder/exit first person · hold Q for orders · Esc for squad switching and settings.</p></details>';
        const button = document.createElement('button');
        button.textContent = 'Start WIP playtest';
        button.onclick = () => { start(); panel.querySelector('details')!.open = false; button.remove(); };
        panel.append(button);
        document.body.append(panel);
        document.body.dataset['previewWorld'] = world.id;
        document.body.dataset['previewBundle'] = manifest.bundleHash;
      },
    };
  } catch (error) {
    notice.textContent = `Qalat WIP failed to load: ${String(error)}. Reload to retry.`;
    throw error;
  }
}
