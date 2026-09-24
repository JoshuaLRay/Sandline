/**
 * T-4.12 baked-lighting fallback.
 *
 * A conventional level lightmap wants a unique second UV set for every placed
 * surface. Sandline's kit intentionally does the opposite: UV0 tiles a shared
 * family atlas and T-4.07 instances repeated pieces from one shared geometry.
 * The spike therefore takes PLAN.md's fallback: keep the hemisphere + one sun
 * and bake ambient occlusion PER PIECE.
 *
 * This bake runs once when a static asset template is loaded. It traces a
 * small, fixed hemisphere against that piece's own triangles and writes the
 * result into the geometry's vertex-colour attribute. Every InstancedMesh then
 * shares those bytes. There is no screen-space AO, no realtime GI, no extra
 * texture and no extra draw call.
 */
import * as THREE from 'three';

const AO_BAKE_KEY = 'sandlinePieceAoV1';
const AO_MAX_DISTANCE_M = 1.5;
const AO_EPSILON_M = 0.003;
const AO_STRENGTH = 0.45;

const HEMISPHERE = [
  [0, 0, 1],
  [0.6, 0, 0.8],
  [-0.6, 0, 0.8],
  [0, 0.6, 0.8],
  [0, -0.6, 0.8],
  [0.5, 0.5, Math.SQRT1_2],
  [-0.5, 0.5, Math.SQRT1_2],
  [0.5, -0.5, Math.SQRT1_2],
  [-0.5, -0.5, Math.SQRT1_2],
] as const;

interface TriangleSample {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
}

interface MeshSample {
  mesh: THREE.Mesh;
  positions: THREE.Vector3[];
  normals: THREE.Vector3[];
}

export interface StaticAoBakeResult {
  meshes: number;
  vertices: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

/**
 * Bake vertex AO into every ordinary mesh below `root`.
 *
 * Geometry is evaluated in root-local space so child transforms are honoured
 * before the result is shared by every level placement. Skinned meshes are not
 * static level geometry and are deliberately ignored.
 */
export function bakeStaticPieceAo(root: THREE.Object3D): StaticAoBakeResult {
  root.updateMatrixWorld(true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const meshes: MeshSample[] = [];
  const triangles: TriangleSample[] = [];

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh) return;

    const geometry = object.geometry;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    if (!position || !normal || position.count !== normal.count) return;

    const toRoot = inverseRoot.clone().multiply(object.matrixWorld);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(toRoot);
    const positions = Array.from({ length: position.count }, (_, i) =>
      new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(toRoot),
    );
    const normals = Array.from({ length: normal.count }, (_, i) =>
      new THREE.Vector3().fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize(),
    );

    const index = geometry.getIndex();
    const corners = index?.count ?? position.count;
    for (let i = 0; i + 2 < corners; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      triangles.push({ a: positions[ia]!, b: positions[ib]!, c: positions[ic]! });
    }
    meshes.push({ mesh: object, positions, normals });
  });

  let bakedMeshes = 0;
  let bakedVertices = 0;
  for (const sample of meshes) {
    const geometry = sample.mesh.geometry;
    if (geometry.userData[AO_BAKE_KEY] !== true) {
      const colours = new Float32Array(sample.positions.length * 3);
      for (let i = 0; i < sample.positions.length; i += 1) {
        const ao = vertexAo(sample.positions[i]!, sample.normals[i]!, triangles);
        colours[i * 3] = ao;
        colours[i * 3 + 1] = ao;
        colours[i * 3 + 2] = ao;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
      geometry.userData[AO_BAKE_KEY] = true;
      bakedMeshes += 1;
      bakedVertices += sample.positions.length;
    }
    enableVertexColours(sample.mesh);
  }

  return { meshes: bakedMeshes, vertices: bakedVertices };
}

function vertexAo(position: THREE.Vector3, normal: THREE.Vector3, triangles: readonly TriangleSample[]): number {
  const n = normal.clone().normalize();
  const reference = Math.abs(n.y) < 0.9 ? UP : RIGHT;
  const tangent = new THREE.Vector3().crossVectors(reference, n).normalize();
  const bitangent = new THREE.Vector3().crossVectors(n, tangent).normalize();
  const origin = position.clone().addScaledVector(n, AO_EPSILON_M);
  const ray = new THREE.Ray();
  const hit = new THREE.Vector3();
  const maxDistanceSq = AO_MAX_DISTANCE_M * AO_MAX_DISTANCE_M;
  let blocked = 0;

  for (const [tx, ty, nz] of HEMISPHERE) {
    const direction = new THREE.Vector3()
      .addScaledVector(tangent, tx)
      .addScaledVector(bitangent, ty)
      .addScaledVector(n, nz)
      .normalize();
    ray.set(origin, direction);

    let occluded = false;
    for (const triangle of triangles) {
      const point = ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, hit);
      if (point && point.distanceToSquared(origin) <= maxDistanceSq) {
        occluded = true;
        break;
      }
    }
    if (occluded) blocked += 1;
  }

  return Math.max(1 - AO_STRENGTH, 1 - AO_STRENGTH * (blocked / HEMISPHERE.length));
}

function enableVertexColours(mesh: THREE.Mesh): void {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) {
    const vertexMaterial = material as THREE.Material & { vertexColors?: boolean };
    if (!('vertexColors' in vertexMaterial)) continue;
    vertexMaterial.vertexColors = true;
    material.needsUpdate = true;
  }
}
