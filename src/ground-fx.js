import * as THREE from 'three';
import { G } from './state.js';
import { terrainHeight } from './utils.js';

let contactMesh = null;
const contactTransform = new THREE.Object3D();
const CONTACT_LIMIT = 768;
const contactSlopes = new WeakMap();

/* A single instanced draw grounds moving silhouettes even where the large
   directional shadow map cannot resolve paws. No per-animal GPU allocation. */
export function initGroundFX(scene) {
  const geometry = new THREE.PlaneGeometry(2, 2);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true,
    polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    vertexShader: `varying vec2 vContactUv;
      void main(){vContactUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`,
    fragmentShader: `varying vec2 vContactUv;
      void main(){float d=length((vContactUv-.5)*2.0);
      float a=(1.0-smoothstep(.05,1.0,d))*.3;
      if(a<.005)discard;gl_FragColor=vec4(.018,.025,.016,a);}`,
  });
  contactMesh = new THREE.InstancedMesh(geometry, material, CONTACT_LIMIT);
  contactMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  contactMesh.frustumCulled = false;
  contactMesh.count = 0;
  contactMesh.renderOrder = 2;
  contactMesh.raycast = () => {};
  scene.add(contactMesh);
}

export function updateGroundFX() {
  if (!contactMesh) return;
  let count = 0;
  for (const e of G.entities) {
    if (!e.alive || e.isBuilding || !e.mesh.visible || e.ghost) continue;
    if (G.fogVisible && !G.fogVisible(e.pos.x, e.pos.z)) continue;
    if (count >= CONTACT_LIMIT) break;
    const x = e.pos.x, z = e.pos.z;
    let slope = contactSlopes.get(e);
    if (!slope || (x - slope.x) ** 2 + (z - slope.z) ** 2 > 0.25) {
      slope = { x, z, y: terrainHeight(x, z),
        rx: -Math.atan((terrainHeight(x, z + 0.6) - terrainHeight(x, z - 0.6)) / 1.2),
        rz: Math.atan((terrainHeight(x + 0.6, z) - terrainHeight(x - 0.6, z)) / 1.2) };
      contactSlopes.set(e, slope);
    }
    const ground = e.flying ? slope.y : e.pos.y;
    const size = e.radius * (e.vScale || 1) * (e.flying ? 1.1 : 1.35);
    contactTransform.position.set(x, ground + 0.29, z);
    // Fit the patch to the local slope rather than slicing through the hillside.
    contactTransform.rotation.set(slope.rx, 0, slope.rz);
    contactTransform.scale.set(size, 1, size);
    contactTransform.updateMatrix();
    contactMesh.setMatrixAt(count++, contactTransform.matrix);
  }
  contactMesh.count = count;
  contactMesh.instanceMatrix.needsUpdate = true;
}
