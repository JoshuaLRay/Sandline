import * as THREE from 'three';
export interface RenderSurface { positions: number[]; normals: number[]; colours: number[]; indices: number[] }

/** Preserve every triangle, with compact local buffers for bounded ray and GPU work. */
export function surfaceChunks(surface: RenderSurface): THREE.Mesh[] {
  type Chunk = RenderSurface & { local: Map<number, number> };
  const chunks = new Map<string, Chunk>();
  for (let i = 0; i < surface.indices.length; i += 3) {
    const triangle = surface.indices.slice(i, i + 3);
    let x = 0, z = 0;
    for (const index of triangle) { x += surface.positions[index * 3]!; z += surface.positions[index * 3 + 2]!; }
    const key = `${Math.floor(x / 3 / 48)},${Math.floor(z / 3 / 48)}`;
    let chunk = chunks.get(key);
    if (!chunk) {
      chunk = { positions: [], normals: [], colours: [], indices: [], local: new Map() };
      chunks.set(key, chunk);
    }
    for (const index of triangle) {
      let local = chunk.local.get(index);
      if (local === undefined) {
        local = chunk.positions.length / 3;
        chunk.local.set(index, local);
        for (let axis = 0; axis < 3; axis++) {
          chunk.positions.push(surface.positions[index * 3 + axis]!);
          chunk.normals.push(surface.normals[index * 3 + axis]!);
          chunk.colours.push(surface.colours[index * 3 + axis]!);
        }
      }
      chunk.indices.push(local);
    }
  }
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  return [...chunks].map(([key, chunk]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(chunk.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(chunk.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(chunk.colours, 3));
    geometry.setIndex(chunk.indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `U-227 actual replacement construction ${key}`;
    return mesh;
  });
}
