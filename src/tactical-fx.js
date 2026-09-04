import * as THREE from 'three';
import { G } from './state.js';
import { terrainHeight } from './utils.js';

const TACTICAL_LIMIT = 512;
let tacticalMesh = null, tacticalData = null;
const tacticalTransform = new THREE.Object3D();
const tacticalTargets = new Set();

/* One draw for the whole selection: rings, facing notches, windup arcs and
   focused targets. Depth-free markers stay readable through the foliage; the
   same visibility check as the game prevents them revealing unexplored units. */
export function initTacticalFX(scene) {
  const geo = new THREE.PlaneGeometry(2, 2); geo.rotateX(-Math.PI / 2);
  tacticalData = new THREE.InstancedBufferAttribute(new Float32Array(TACTICAL_LIMIT * 4), 4);
  tacticalData.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aTactical', tacticalData);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    vertexShader: `attribute vec4 aTactical; varying vec2 vTacticalUV; varying vec4 vTactical;
      void main(){vTacticalUV=uv;vTactical=aTactical;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec2 vTacticalUV; varying vec4 vTactical;
      void main(){
        vec2 p=(vTacticalUV-.5)*2.;float r=length(p);
        float theta=atan(p.x,-p.y);float angle=(theta+3.141593)/6.283186;
        float ring=smoothstep(.71,.74,r)*(1.-smoothstep(.78,.81,r));
        float dashed=step(.22,fract(angle*8.));
        float facing=(1.-smoothstep(.06,.11,abs(p.x)))*smoothstep(.81,.86,-p.y)*(1.-smoothstep(.92,.99,-p.y));
        float wind=smoothstep(.86,.89,r)*(1.-smoothstep(.93,.96,r))*step(angle,vTactical.y)*step(.001,vTactical.y);
        vec3 base=mix(vec3(.68,.86,.48),vec3(1.,.52,.3),vTactical.w);
        float a=ring*mix(.24,.68,vTactical.x)*mix(1.,dashed,vTactical.w)+facing*vTactical.x*.9;
        vec3 color=mix(base,vec3(1.,.83,.42),step(.01,wind));
        a=max(a,wind*.9);
        float hit=smoothstep(.55,.6,r)*(1.-smoothstep(.69,.73,r))*vTactical.z;
        color=mix(color,vec3(1.,.95,.77),step(.01,hit));a=max(a,hit*.9);
        if(a<.01)discard;gl_FragColor=vec4(color,a);
      }`,
  });
  tacticalMesh = new THREE.InstancedMesh(geo, mat, TACTICAL_LIMIT);
  tacticalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  tacticalMesh.count = 0; tacticalMesh.frustumCulled = false; tacticalMesh.renderOrder = 900;
  tacticalMesh.raycast = () => {}; scene.add(tacticalMesh);
  G.tacticalMarkers = true;
}

export function updateTacticalFX() {
  if (!tacticalMesh) return;
  let n = 0; tacticalTargets.clear();
  const visible = e => e.alive && e.mesh.visible && !e.ghost && (!G.fogVisible || G.fogVisible(e.pos.x,e.pos.z));
  const add = (e, selected, target) => {
    if (n >= TACTICAL_LIMIT) return;
    const size = Math.max(1.9,e.radius * (e.vScale || 1) * 1.65);
    tacticalTransform.position.set(e.pos.x,terrainHeight(e.pos.x,e.pos.z)+.38,e.pos.z);
    tacticalTransform.rotation.set(0,e.mesh.rotation.y,0); tacticalTransform.scale.set(size,1,size);
    tacticalTransform.updateMatrix(); tacticalMesh.setMatrixAt(n,tacticalTransform.matrix);
    tacticalData.setXYZW(n++, selected, e.attackPose?.progress || 0, Math.max(0,e.hitT || 0)/.18, target);
  };
  if (G.phase === 'playing') {
    for (const e of G.selection) {
      if (!visible(e)) continue;
      if (!e.isBuilding) add(e,1,0);
      if (e.target && visible(e.target)) tacticalTargets.add(e.target);
    }
    for (const e of tacticalTargets) if (!e.selected) add(e,0,1);
  }
  tacticalMesh.count = n; tacticalMesh.instanceMatrix.needsUpdate = true; tacticalData.needsUpdate = true;
}

export function tacticalStats() { return { count: tacticalMesh?.count || 0, limit: TACTICAL_LIMIT, targets: tacticalTargets.size }; }
