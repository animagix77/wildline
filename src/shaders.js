import * as THREE from 'three';
import { COMPOUND, BASE } from './config.js';

/* =========================================================================
   WILDLINE — procedural GLSL suite.

   The project ships ZERO texture files: every square metre of ground, the
   sky, the grove pools, the Server Core shield and the Overgrowth field are
   generated in the fragment shader from noise written here.

   Exports
     makeTerrainMaterial()      MeshStandardMaterial + onBeforeCompile
     makeSkyDome()              Mesh (BackSide sphere)
     makeWaterMaterial()        ShaderMaterial  (grove pools)
     makeShieldMaterial()       ShaderMaterial  (core hologram dome)
     makeEnergyFieldMaterial()  ShaderMaterial  (Overgrowth AoE)
     tickShaders(t, dt)         advances every uniform created here

   Conventions
     * every identifier injected into three's shaders is prefixed `wl_` so it
       can never collide with a three.js chunk symbol.
     * no `precision` statements and no `#version` directive: three.js adds
       both (and `#define attribute in` / `#define varying out` for GLSL3),
       so the classic `attribute` / `varying` keywords are the portable form.
     * `#include <tonemapping_fragment>` + `#include <colorspace_fragment>`
       close every raw ShaderMaterial so custom FX sit in the same ACES /
       sRGB pipeline as the rest of the scene (same pattern three's own
       examples/jsm/objects/Sky.js uses).
   ========================================================================= */


/* =========================================================================
   Shared GLSL library — simplex noise, fbm, hex lattice, colour helpers.
   Concatenated into every program below.
   ========================================================================= */

const WL_LIB = /* glsl */`
float wl_hash11( float n ) {
  return fract( sin( n * 12.9898 ) * 43758.5453123 );
}
float wl_hash21( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
}

vec3 wl_mod289v3( vec3 x ) { return x - floor( x * ( 1.0 / 289.0 ) ) * 289.0; }
vec2 wl_mod289v2( vec2 x ) { return x - floor( x * ( 1.0 / 289.0 ) ) * 289.0; }
vec3 wl_permute3( vec3 x ) { return wl_mod289v3( ( ( x * 34.0 ) + 1.0 ) * x ); }

/* 2D simplex noise, range ~[-1,1]. */
float wl_snoise( vec2 v ) {
  const vec4 C = vec4( 0.211324865405187, 0.366025403784439,
                      -0.577350269189626, 0.024390243902439 );
  vec2 i  = floor( v + dot( v, C.yy ) );
  vec2 x0 = v - i + dot( i, C.xx );
  vec2 i1 = ( x0.x > x0.y ) ? vec2( 1.0, 0.0 ) : vec2( 0.0, 1.0 );
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = wl_mod289v2( i );
  vec3 p = wl_permute3( wl_permute3( i.y + vec3( 0.0, i1.y, 1.0 ) )
                                   + i.x + vec3( 0.0, i1.x, 1.0 ) );
  vec3 m = max( 0.5 - vec3( dot( x0, x0 ), dot( x12.xy, x12.xy ),
                            dot( x12.zw, x12.zw ) ), 0.0 );
  m = m * m;
  m = m * m;
  vec3 x  = 2.0 * fract( p * C.www ) - 1.0;
  vec3 h  = abs( x ) - 0.5;
  vec3 ox = floor( x + 0.5 );
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0 * a0 + h * h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot( m, g );
}

/* fbm variants, remapped to ~[0,1]. Each octave is rotated as well as scaled
   so the lattice never lines up with the world axes. */
float wl_fbm3( vec2 p ) {
  float s = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 3; i ++ ) {
    s += a * wl_snoise( p );
    p = mat2( 1.62, 1.18, -1.18, 1.62 ) * p + 17.13;
    a *= 0.5;
  }
  return s * 0.57 + 0.5;
}
float wl_fbm4( vec2 p ) {
  float s = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 4; i ++ ) {
    s += a * wl_snoise( p );
    p = mat2( 1.62, 1.18, -1.18, 1.62 ) * p + 17.13;
    a *= 0.5;
  }
  return s * 0.54 + 0.5;
}
float wl_fbm5( vec2 p ) {
  float s = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 5; i ++ ) {
    s += a * wl_snoise( p );
    p = mat2( 1.62, 1.18, -1.18, 1.62 ) * p + 17.13;
    a *= 0.5;
  }
  return s * 0.52 + 0.5;
}

/* Ridged noise - sharp creases, used for cracks and cloud edges. */
float wl_ridge( vec2 p ) {
  float s = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 3; i ++ ) {
    s += a * ( 1.0 - abs( wl_snoise( p ) ) );
    p = mat2( 1.62, 1.18, -1.18, 1.62 ) * p + 9.71;
    a *= 0.5;
  }
  return s * 1.14;
}

/* Hex lattice. Returns ( localOffset.xy, cellId.xy ).
   Cell pitch is 1.0 in x, so scaling x by an integer keeps the pattern
   seamless when it is wrapped round a full turn (used by the shield). */
vec4 wl_hexInfo( vec2 p ) {
  vec2 s = vec2( 1.0, 1.7320508 );
  vec4 hC = floor( vec4( p, p - vec2( 0.5, 1.0 ) ) / s.xyxy ) + 0.5;
  vec4 h  = vec4( p - hC.xy * s, p - ( hC.zw + 0.5 ) * s );
  return dot( h.xy, h.xy ) < dot( h.zw, h.zw )
       ? vec4( h.xy, hC.xy )
       : vec4( h.zw, hC.zw + 0.5 );
}
/* 0 at a cell centre, 0.5 exactly on a cell wall. */
float wl_hexDist( vec2 p ) {
  p = abs( p );
  return max( dot( p, vec2( 0.5, 0.8660254 ) ), p.x );
}

/* Author colours as sRGB triples; the renderer works in linear. */
vec3 wl_sRGB( vec3 c ) { return pow( clamp( c, 0.0, 1.0 ), vec3( 2.2 ) ); }
`;


/* =========================================================================
   Uniform registry
   ========================================================================= */

const _registry = [];

/** Register a uniform block so `tickShaders` drives it. */
function _register( uniforms, decay = 0 ) {
  _registry.push( { uniforms, decay } );
  return uniforms;
}

/**
 * Advance every uniform block created by this module. One call per frame is
 * all any caller needs — `tickShaders( G.time, dt )`.
 *
 * @param {number} t   total elapsed seconds
 * @param {number} dt  seconds since the previous call
 *
 * Blocks created with a decay time (the Overgrowth field) burn their `wl_life`
 * uniform down from 1 to 0 on their own; setting `wl_life` back above 0 re-arms
 * the same material for another cast. Spent one-shot blocks are reaped once
 * enough of them pile up, so the registry stays bounded over a long match.
 */
export function tickShaders( t, dt = 0 ) {
  for ( let i = 0; i < _registry.length; i ++ ) {
    const entry = _registry[ i ];
    const u = entry.uniforms;
    if ( u.wl_time ) u.wl_time.value = t;
    if ( entry.decay > 0 && u.wl_life && u.wl_life.value > 0 ) {
      u.wl_life.value = Math.max( 0, u.wl_life.value - dt / entry.decay );
    }
  }

  if ( _registry.length > 48 ) {
    for ( let i = _registry.length - 1; i >= 0 && _registry.length > 24; i -- ) {
      const entry = _registry[ i ];
      if ( entry.decay > 0 && entry.uniforms.wl_life &&
           entry.uniforms.wl_life.value <= 0 ) {
        _registry.splice( i, 1 );
      }
    }
  }
}


/* =========================================================================
   1. TERRAIN
   -------------------------------------------------------------------------
   A MeshStandardMaterial whose albedo, micro-normal, roughness and metalness
   are replaced by procedural GLSL through `onBeforeCompile`. Everything three
   provides — directional + hemisphere lighting, PCF soft shadow reception,
   linear fog, ACES tone mapping, sRGB output — is left untouched, which is
   precisely why this is not a raw ShaderMaterial.

   BLIGHT ATTRIBUTE
   ----------------
   The vertex shader reads `attribute float blight;` (0 = wild valley,
   1 = campus tarmac). src/world.js must add it to the terrain geometry:

       const blightAttr = new Float32Array( pos.count );
       for ( let i = 0; i < pos.count; i ++ ) { ...blightAttr[i] = b; }
       geo.setAttribute( 'blight', new THREE.BufferAttribute( blightAttr, 1 ) );

   If the attribute is missing the generic vertex attribute supplies 0.0, so
   `blight` safely defaults to 0 (wild) and nothing breaks. To keep the campus
   readable in that case the shader also derives an analytic blight field from
   the compound rectangle and takes the larger of the two; set
   `material.userData.uniforms.wl_fallbackMix.value = 0` once the real
   attribute is in place if you want attribute-only control.

   Do NOT enable `vertexColors` on this material: three's <color_fragment>
   runs after our injection and would multiply the procedural albedo by the
   legacy vertex colours.
   ========================================================================= */

/** @returns {THREE.MeshStandardMaterial} */
export function makeTerrainMaterial() {
  const uniforms = {
    wl_time:         { value: 0 },
    wl_macroScale:   { value: 0.0105 },   // low-frequency colour regions
    wl_detailScale:  { value: 1.15 },     // fine grain
    wl_detailFade:   { value: new THREE.Vector2( 70, 260 ) }, // near/far LOD band
    wl_bumpStrength: { value: 0.38 },     // micro-normal amplitude
    wl_fallbackMix:  { value: 1.0 },      // 1 = use analytic blight fallback
    // read at creation time: loadMap() mutates COMPOUND/BASE before buildScene()
    wl_compound:     { value: new THREE.Vector4( COMPOUND.x, COMPOUND.z, COMPOUND.hw, COMPOUND.hd ) },
    wl_compoundFade: { value: 34.0 },
    wl_heart:        { value: new THREE.Vector2( BASE.x, BASE.z ) },
    wl_heartRadius:  { value: 42.0 },
  };

  const mat = new THREE.MeshStandardMaterial( {
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.0,
    flatShading: false,
    vertexColors: false,
    dithering: true,
  } );

  mat.onBeforeCompile = ( shader ) => {
    Object.assign( shader.uniforms, uniforms );

    /* ---------------------------- vertex ---------------------------- */
    shader.vertexShader = shader.vertexShader
      .replace( '#include <common>', /* glsl */`
#include <common>
attribute float blight;          // supplied by world.js; defaults to 0.0
varying vec3  wl_vPos;
varying vec3  wl_vNrm;
varying float wl_vBlight;
` )
      .replace( '#include <beginnormal_vertex>', /* glsl */`
#include <beginnormal_vertex>
wl_vNrm = normalize( mat3( modelMatrix ) * objectNormal );
` )
      .replace( '#include <begin_vertex>', /* glsl */`
#include <begin_vertex>
wl_vPos    = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
wl_vBlight = clamp( blight, 0.0, 1.0 );
` );

    /* --------------------------- fragment --------------------------- */
    shader.fragmentShader = shader.fragmentShader
      .replace( '#include <common>', /* glsl */`
#include <common>

uniform float wl_time;
uniform float wl_macroScale;
uniform float wl_detailScale;
uniform vec2  wl_detailFade;
uniform float wl_bumpStrength;
uniform float wl_fallbackMix;
uniform vec4  wl_compound;
uniform float wl_compoundFade;
uniform vec2  wl_heart;
uniform float wl_heartRadius;

varying vec3  wl_vPos;
varying vec3  wl_vNrm;
varying float wl_vBlight;

${ WL_LIB }

/* Written by the albedo block, read by the normal / roughness blocks that
   three.js runs later in main(). */
float wl_gYard;
float wl_gBlight;
float wl_gNear;      // 1 close to the camera, 0 far away: a hand-rolled LOD
vec2  wl_gWarp;

/* Height field driving the micro-normal: soft tufted grass out in the wild,
   hard hex-panel grooves once we are on the campus slab. Frequencies are kept
   low enough that a top-down RTS camera never samples below a pixel. */
float wl_bumpH( vec2 p ) {
  float soft = wl_fbm3( p * 0.60 ) + wl_snoise( p * 1.90 ) * 0.18;
  vec4  hx   = wl_hexInfo( p * 0.55 + wl_gWarp );
  float seam = smoothstep( 0.450, 0.5, wl_hexDist( hx.xy ) );
  float hard = 0.5 - seam * 0.30 + wl_snoise( p * 1.1 ) * 0.06;
  return mix( soft, hard, wl_gYard );
}
` )
      .replace( '#include <map_fragment>', /* glsl */`
#include <map_fragment>
{
  // wl_p.x is world X, wl_p.y is world Z.
  vec2 wl_p = wl_vPos.xz;

  /* ---- how machine-blighted is this square metre? ----
     The attribute is authoritative. The analytic fallback below reproduces
     world.js's own convention (1.0 on the compound slab, at most 0.72 in the
     poisoned margin around it) so the campus still reads correctly on a
     geometry that has no blight attribute at all. */
  float wl_ex = max( abs( wl_p.x - wl_compound.x ) - wl_compound.z, 0.0 );
  float wl_ez = max( abs( wl_p.y - wl_compound.y ) - wl_compound.w, 0.0 );
  float wl_ed = length( vec2( wl_ex, wl_ez ) );
  float wl_fallback = max( 1.0 - smoothstep( 0.0, 6.0, wl_ed ),
                           0.72 * ( 1.0 - smoothstep( 0.0, wl_compoundFade, wl_ed ) ) );
  float wl_bRaw = max( wl_vBlight, wl_fallback * wl_fallbackMix );

  // The colour blend uses a jittered copy so the dead zone never reads as a
  // rounded rectangle. The jitter is strongest mid-transition and vanishes at
  // both ends, so it can never punch holes in the wild valley or in the yard.
  float wl_edge = 4.0 * wl_bRaw * ( 1.0 - wl_bRaw );
  float wl_b = clamp( wl_bRaw + ( wl_fbm3( wl_p * 0.035 ) - 0.5 ) * 0.46 * wl_edge,
                      0.0, 1.0 );

  /* ---- distance LOD: the highest-frequency bands are faded out before they
         drop below a pixel, which is what keeps the ground from boiling ---- */
  wl_gNear = 1.0 - smoothstep( wl_detailFade.x, wl_detailFade.y,
                               length( cameraPosition - wl_vPos ) );

  /* ---- noise bands: macro regions, mid mottle, close-up grain ---- */
  float wl_macro = wl_fbm4( wl_p * wl_macroScale );
  float wl_mid   = wl_fbm3( wl_p * wl_macroScale * 5.5 );
  float wl_det   = wl_fbm3( wl_p * 0.42 );
  float wl_fine  = wl_snoise( wl_p * wl_detailScale ) * 0.5 + 0.5;
  float wl_slope = clamp( 1.0 - normalize( wl_vNrm ).y, 0.0, 1.0 );

  /* ---- palette ---- */
  vec3 wl_cGrass = wl_sRGB( vec3( 0.184, 0.353, 0.161 ) );
  vec3 wl_cLush  = wl_sRGB( vec3( 0.278, 0.502, 0.227 ) );
  vec3 wl_cMoss  = wl_sRGB( vec3( 0.388, 0.639, 0.290 ) );
  vec3 wl_cStraw = wl_sRGB( vec3( 0.490, 0.478, 0.271 ) );
  vec3 wl_cDirt  = wl_sRGB( vec3( 0.325, 0.259, 0.176 ) );
  vec3 wl_cDry   = wl_sRGB( vec3( 0.310, 0.322, 0.200 ) );
  vec3 wl_cAsh   = wl_sRGB( vec3( 0.216, 0.208, 0.188 ) );
  vec3 wl_cTar   = wl_sRGB( vec3( 0.245, 0.256, 0.284 ) );

  /* ---- the wild valley ---- */
  vec3 wl_wild = mix( wl_cGrass, wl_cLush, smoothstep( 0.34, 0.78, wl_macro ) );
  wl_wild = mix( wl_wild, wl_cMoss,
                 smoothstep( 0.56, 0.96, wl_mid ) * 0.55 );
  wl_wild = mix( wl_wild, wl_cStraw,
                 smoothstep( 0.60, 0.98, wl_macro * 0.6 + wl_mid * 0.4 ) * 0.42 );
  // scree and exposed dirt on the steep faces
  wl_wild = mix( wl_wild, wl_cDirt,
                 smoothstep( 0.26, 0.62, wl_slope ) * ( 0.55 + 0.35 * wl_mid ) );
  wl_wild *= 0.80 + 0.40 * wl_mid;                            // macro drift
  wl_wild *= 0.88 + 0.24 * wl_det;                            // metre-scale mottle
  wl_wild *= 1.0 + ( wl_fine - 0.5 ) * 0.30 * wl_gNear;       // close-up grain

  /* ---- the poisoned margin ---- */
  vec3 wl_dead = mix( wl_cDry, wl_cAsh, smoothstep( 0.22, 0.86, wl_b ) );
  wl_dead *= 0.80 + 0.38 * wl_mid;
  wl_dead *= 0.90 + 0.20 * wl_det;
  wl_dead *= 1.0 + ( wl_fine - 0.5 ) * 0.24 * wl_gNear;

  vec3 wl_col = mix( wl_wild, wl_dead, smoothstep( 0.05, 0.70, wl_b ) );

  /* ---- moss halo around the Heart Tree ---- */
  float wl_halo = 1.0 - smoothstep( 0.0, wl_heartRadius,
                                    length( wl_p - wl_heart ) );
  wl_col = mix( wl_col, wl_cMoss, wl_halo * 0.42 * ( 1.0 - wl_b ) );

  /* ---- the paved yard: cracked hex slabs. Gated on the UNjittered blight
         so the slab can only ever appear where blight climbs past ~0.75 --
         i.e. on the compound itself, never out in the poisoned margin. ---- */
  float wl_yard = smoothstep( 0.78, 0.90,
                    wl_bRaw + ( wl_fbm3( wl_p * 0.070 + 8.3 ) - 0.5 ) * 0.10 );
  wl_gYard   = wl_yard;
  wl_gBlight = wl_b;
  wl_gWarp   = vec2( wl_snoise( wl_p * 0.30 ),
                     wl_snoise( wl_p * 0.30 + 37.4 ) ) * 0.13;

  vec4  wl_hx    = wl_hexInfo( wl_p * 0.55 + wl_gWarp );
  float wl_hdist = wl_hexDist( wl_hx.xy );
  float wl_seam  = smoothstep( 0.450, 0.50, wl_hdist );
  float wl_cellR = wl_hash21( wl_hx.zw );

  // 8 m expansion joints running with the compound axes
  vec2  wl_pg    = abs( fract( wl_p * 0.125 + 0.5 ) - 0.5 );
  float wl_joint = 1.0 - smoothstep( 0.0, 0.030, min( wl_pg.x, wl_pg.y ) );

  // hairline cracks wandering across the slabs
  float wl_crack = smoothstep( 0.86, 1.00, wl_ridge( wl_p * 0.55 + 3.7 ) );
  // coolant spill / rust staining
  float wl_stain = smoothstep( 0.58, 0.92, wl_fbm3( wl_p * 0.09 + 21.0 ) );

  vec3 wl_tar = wl_cTar * ( 0.80 + 0.42 * wl_cellR ) *
                ( 1.0 + ( wl_fine - 0.5 ) * 0.24 * wl_gNear ) *
                ( 0.90 + 0.20 * wl_det );
  wl_tar = mix( wl_tar, wl_cTar * 0.62, wl_seam * 0.45 );
  wl_tar = mix( wl_tar, wl_cTar * 0.52, wl_joint * 0.55 );
  wl_tar = mix( wl_tar, wl_cTar * 0.40, wl_crack * 0.85 );
  wl_tar = mix( wl_tar, wl_sRGB( vec3( 0.155, 0.145, 0.115 ) ), wl_stain * 0.50 );
  // cold conduit light bleeding up through the seams
  wl_tar += vec3( 0.005, 0.022, 0.030 ) * wl_seam *
            ( 0.35 + 0.65 * ( 0.5 + 0.5 * sin( wl_time * 0.7 + wl_cellR * 6.283 ) ) );

  wl_col = mix( wl_col, wl_tar, wl_yard );

  diffuseColor.rgb = wl_col;
}
` )
      .replace( '#include <roughnessmap_fragment>', /* glsl */`
#include <roughnessmap_fragment>
roughnessFactor = clamp(
  mix( 1.0, 0.55, wl_gYard ) - 0.08 * wl_gBlight * ( 1.0 - wl_gYard ),
  0.32, 1.0 );
` )
      .replace( '#include <metalnessmap_fragment>', /* glsl */`
#include <metalnessmap_fragment>
metalnessFactor = mix( metalnessFactor, 0.09, wl_gYard );
` )
      .replace( '#include <normal_fragment_maps>', /* glsl */`
#include <normal_fragment_maps>
if ( wl_gNear > 0.002 ) {
  vec2  wl_bp  = wl_vPos.xz;
  // widen the sampling stencil with distance: a cheap band-limiting filter
  float wl_eps = mix( 0.90, 0.28, wl_gNear );
  float wl_h0  = wl_bumpH( wl_bp );
  float wl_hx2 = wl_bumpH( wl_bp + vec2( wl_eps, 0.0 ) );
  float wl_hz2 = wl_bumpH( wl_bp + vec2( 0.0, wl_eps ) );
  vec3  wl_pert = vec3( wl_h0 - wl_hx2, 0.0, wl_h0 - wl_hz2 )
                * ( wl_bumpStrength / wl_eps ) * wl_gNear;
  normal = normalize( normal + wl_pert );
}
` );
  };

  // one program for every terrain material we hand out
  mat.customProgramCacheKey = () => 'wl_terrain_v1';
  mat.userData.uniforms = _register( uniforms );
  return mat;
}


/* =========================================================================
   2. SKY DOME
   -------------------------------------------------------------------------
   Horizon→zenith gradient, sun disc with a two-lobe halo, domain-warped
   drifting cloud fbm and a colder cast toward the campus (+x, -z).
   ========================================================================= */

/** @returns {THREE.Mesh} */
export function makeSkyDome() {
  const uniforms = {
    wl_time:       { value: 0 },
    wl_sunDir:     { value: new THREE.Vector3( -70, 110, 60 ).normalize() },
    wl_zenith:     { value: new THREE.Color( 0.055, 0.150, 0.360 ) },
    wl_horizon:    { value: new THREE.Color( 0.400, 0.500, 0.430 ) },
    wl_ground:     { value: new THREE.Color( 0.075, 0.115, 0.085 ) },
    wl_sunColor:   { value: new THREE.Color( 1.000, 0.870, 0.640 ) },
    wl_cloudCover: { value: 0.55 },
    wl_campusTint: { value: new THREE.Color( 0.70, 0.92, 1.16 ) },
  };

  const mat = new THREE.ShaderMaterial( {
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    transparent: false,
    fog: false,
    vertexShader: /* glsl */`
varying vec3 wl_vDir;

void main() {
  vec4 wl_wp = modelMatrix * vec4( position, 1.0 );
  wl_vDir = normalize( wl_wp.xyz - modelMatrix[ 3 ].xyz );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`,
    fragmentShader: /* glsl */`
uniform float wl_time;
uniform vec3  wl_sunDir;
uniform vec3  wl_zenith;
uniform vec3  wl_horizon;
uniform vec3  wl_ground;
uniform vec3  wl_sunColor;
uniform float wl_cloudCover;
uniform vec3  wl_campusTint;

varying vec3 wl_vDir;

${ WL_LIB }

void main() {
  vec3 d = normalize( wl_vDir );

  /* ---- gradient ---- */
  float up  = clamp( d.y, 0.0, 1.0 );
  vec3  sky = mix( wl_horizon, wl_zenith, pow( up, 0.55 ) );

  // a tight, brighter haze band hugging the horizon: this is the slice an RTS
  // camera actually sees, so it has to carry structure rather than one flat tone
  sky = mix( sky, wl_horizon * 1.30, exp( -up * 15.0 ) * 0.60 );
  sky = mix( sky, wl_horizon * 0.72, exp( -up * 60.0 ) * 0.55 );
  sky = mix( wl_ground, sky, smoothstep( -0.26, 0.01, d.y ) );

  /* ---- the sun warms its own quarter of the horizon ---- */
  float azl   = max( length( d.xz ), 1e-4 );
  float sunAz = clamp( dot( d.xz / azl, normalize( wl_sunDir.xz ) ), 0.0, 1.0 );
  sky = mix( sky, sky * vec3( 1.30, 1.12, 0.90 ),
             pow( sunAz, 2.0 ) * exp( -up * 6.0 ) * 0.75 );

  /* ---- sun ---- */
  float sd   = max( dot( d, wl_sunDir ), 0.0 );
  float halo = pow( sd, 256.0 ) * 1.10
             + pow( sd, 24.0 )  * 0.34
             + pow( sd, 4.0 )   * 0.11;
  sky += wl_sunColor * halo;
  float disc = smoothstep( 0.99855, 0.99930, sd );
  sky = mix( sky, wl_sunColor * 2.4, disc );

  /* ---- clouds: domain-warped fbm on a flattened dome ---- */
  float ch = max( d.y, 0.045 );
  vec2  cp = d.xz / ch * 1.55;
  vec2  drift = vec2( wl_time * 0.0105, wl_time * 0.0042 );
  vec2  q = vec2( wl_fbm3( cp * 0.26 + drift ),
                  wl_fbm3( cp * 0.26 + drift + 5.23 ) ) - 0.5;
  float c  = wl_fbm5( cp * 0.30 + q * 0.45 + drift );
  float cr = wl_ridge( cp * 0.62 + q * 0.30 - drift * 1.7 );

  // high deck: broken cumulus
  float cloud = smoothstep( 0.555, 0.760, c + cr * 0.08 );
  // low deck: stretched banks that stack up along the horizon
  float bank  = smoothstep( 0.60, 0.88, wl_fbm4( cp * vec2( 0.10, 0.34 ) + drift * 2.4 ) );

  cloud = max( cloud, bank * 0.80 * exp( -up * 3.2 ) );
  cloud *= smoothstep( 0.012, 0.10, d.y );      // hide the flat-projection singularity
  cloud *= wl_cloudCover;

  float lit = pow( clamp( sd, 0.0, 1.0 ), 3.0 );
  vec3 cloudCol = mix( vec3( 0.26, 0.295, 0.360 ),
                       vec3( 1.05, 0.98, 0.88 ), 0.28 + 0.64 * lit );
  // brighter, thinner edges
  cloudCol += wl_sunColor * smoothstep( 0.545, 0.605, c ) *
              ( 1.0 - smoothstep( 0.62, 0.74, c ) ) * ( 0.30 + 0.6 * lit );
  // the low banks pick up the horizon haze instead of the zenith blue
  cloudCol = mix( cloudCol, wl_horizon * 1.15, exp( -up * 9.0 ) * 0.5 );
  sky = mix( sky, cloudCol, cloud );

  /* ---- the campus bleeds cold light into its quarter of the sky ---- */
  float campus = clamp( ( d.x - d.z ) * 0.70710678, 0.0, 1.0 );
  campus = pow( campus, 1.6 ) * smoothstep( 0.55, -0.05, d.y );
  sky = mix( sky, sky * wl_campusTint, campus * 0.62 );
  sky += vec3( 0.008, 0.055, 0.082 ) * campus *
         smoothstep( 0.30, -0.02, d.y ) *
         ( 0.75 + 0.25 * sin( wl_time * 0.45 ) );

  /* ---- a little dithered grain kills the banding in the gradient ---- */
  sky += ( wl_hash21( gl_FragCoord.xy ) - 0.5 ) * 0.0055;

  gl_FragColor = vec4( max( sky, 0.0 ), 1.0 );

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`,
  } );

  const mesh = new THREE.Mesh( new THREE.SphereGeometry( 600, 48, 32 ), mat );
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.userData.uniforms = _register( uniforms );
  return mesh;
}


/* =========================================================================
   3. GROVE WATER
   -------------------------------------------------------------------------
   For the circular pool at the centre of each grove. `wl_bloom` (0..1) walks
   the pool from stagnant machine-teal to a living, caustic-lit green.
   Give every grove its OWN material — the bloom state is per-grove.
   ========================================================================= */

/** @returns {THREE.ShaderMaterial} */
export function makeWaterMaterial() {
  const uniforms = {
    wl_time:    { value: 0 },
    wl_bloom:   { value: 0 },
    wl_opacity: { value: 0.92 },
  };

  const mat = new THREE.ShaderMaterial( {
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    vertexShader: /* glsl */`
varying vec2 wl_vUv;
varying vec3 wl_vW;
varying vec3 wl_vN;

void main() {
  wl_vUv = uv;
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  wl_vW = wp.xyz;
  wl_vN = normalize( mat3( modelMatrix ) * normal );
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`,
    fragmentShader: /* glsl */`
uniform float wl_time;
uniform float wl_bloom;
uniform float wl_opacity;

varying vec2 wl_vUv;
varying vec3 wl_vW;
varying vec3 wl_vN;

${ WL_LIB }

void main() {
  vec2  c = wl_vUv * 2.0 - 1.0;
  float r = length( c );
  float bloom = clamp( wl_bloom, 0.0, 1.0 );

  /* ---- ripples: concentric rings crossed with drifting fbm ---- */
  float rings = sin( r * 24.0 - wl_time * 2.1 ) * 0.5 + 0.5;
  float n1 = wl_fbm4( wl_vW.xz * 0.85 + vec2(  wl_time * 0.075, -wl_time * 0.052 ) );
  float n2 = wl_fbm3( wl_vW.xz * 2.60 + vec2( -wl_time * 0.110,  wl_time * 0.093 ) );
  float ripple = clamp( rings * 0.22 + n1 * 0.62 + n2 * 0.26, 0.0, 1.2 );

  /* stagnant: cold, murky, machine-teal.  bloomed: deep living green. */
  vec3 stagnant = wl_sRGB( vec3( 0.098, 0.290, 0.278 ) );
  vec3 living   = wl_sRGB( vec3( 0.106, 0.600, 0.372 ) );
  vec3 base = mix( stagnant, living, bloom );

  vec3 col = base * ( 0.55 + 0.62 * ripple );

  /* ---- caustic glints on the crests ---- */
  float caust = pow( max( n2 * 1.55 - 0.60, 0.0 ), 2.0 ) * 2.2;
  col += mix( wl_sRGB( vec3( 0.16, 0.40, 0.40 ) ),
              wl_sRGB( vec3( 0.52, 0.95, 0.42 ) ), bloom ) *
         caust * ( 0.28 + 0.72 * bloom );

  /* ---- fresnel-ish edge brightening ---- */
  vec3  V = normalize( cameraPosition - wl_vW );
  float fres = pow( 1.0 - clamp( abs( dot( normalize( wl_vN ), V ) ), 0.0, 1.0 ), 3.5 );
  float rim  = smoothstep( 0.80, 0.99, r ) * ( 1.0 - smoothstep( 0.965, 1.0, r ) );
  vec3  rimCol = mix( wl_sRGB( vec3( 0.22, 0.52, 0.52 ) ),
                      wl_sRGB( vec3( 0.42, 0.90, 0.46 ) ), bloom );
  col += rimCol * ( fres * 0.42 + rim * ( 0.30 + 0.20 * ripple ) );

  /* ---- silt darkening toward the middle so it reads as depth ---- */
  col *= mix( 0.68, 1.06, smoothstep( 0.05, 0.95, r ) );

  float alpha = wl_opacity * ( 0.72 + 0.12 * ripple + rim * 0.16 + fres * 0.14 );
  alpha *= smoothstep( 1.0, 0.955, r );      // soften the polygon edge

  gl_FragColor = vec4( max( col, 0.0 ), clamp( alpha, 0.0, 1.0 ) );

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`,
  } );

  mat.userData.uniforms = _register( uniforms );
  return mat;
}


/* =========================================================================
   4. SERVER CORE SHIELD
   -------------------------------------------------------------------------
   Additive hologram dome: fresnel rim, travelling scanlines, a hex cell grid
   that wraps seamlessly round the sphere, and — as `wl_health` falls — band
   tearing, holes and flicker.
   ========================================================================= */

/** @returns {THREE.ShaderMaterial} */
export function makeShieldMaterial() {
  const uniforms = {
    wl_time:    { value: 0 },
    wl_health:  { value: 1 },
    wl_opacity: { value: 0.85 },
    wl_colorA:  { value: new THREE.Color( 0.13, 0.72, 0.92 ) },  // intact: cyan
    wl_colorB:  { value: new THREE.Color( 1.00, 0.32, 0.16 ) },  // failing: red
  };

  const mat = new THREE.ShaderMaterial( {
    uniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */`
varying vec3 wl_vW;
varying vec3 wl_vN;
varying vec3 wl_vObj;

void main() {
  wl_vObj = position;
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  wl_vW = wp.xyz;
  wl_vN = normalize( mat3( modelMatrix ) * normal );
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`,
    fragmentShader: /* glsl */`
uniform float wl_time;
uniform float wl_health;
uniform float wl_opacity;
uniform vec3  wl_colorA;
uniform vec3  wl_colorB;

varying vec3 wl_vW;
varying vec3 wl_vN;
varying vec3 wl_vObj;

${ WL_LIB }

void main() {
  float hp     = clamp( wl_health, 0.0, 1.0 );
  float stress = 1.0 - hp;

  vec3 N = normalize( wl_vN );
  vec3 V = normalize( cameraPosition - wl_vW );
  float fres = pow( 1.0 - clamp( abs( dot( N, V ) ), 0.0, 1.0 ), 2.6 );

  /* ---- lat/long hex lattice.
         22 columns over a full turn: the lattice pitch is 1.0 in x, so an
         integer column count makes the grid wrap without a seam. ---- */
  vec3  o   = normalize( wl_vObj );
  float lat = asin( clamp( o.y, -1.0, 1.0 ) );
  float lon = atan( o.z, o.x );
  vec2  hcoord = vec2( lon * ( 22.0 / 6.2831853 ), lat * 11.0 );

  // torn bands shear sideways as the shield fails
  float band = floor( hcoord.y * 1.6 );
  float shear = ( wl_hash11( band + floor( wl_time * 6.0 ) ) - 0.5 ) * stress * stress * 1.6;
  hcoord.x += shear;

  vec4  hx   = wl_hexInfo( hcoord );
  float hd   = wl_hexDist( hx.xy );
  float cell = wl_hash21( hx.zw );
  float edge = smoothstep( 0.395, 0.50, hd );
  float pulse = 0.5 + 0.5 * sin( wl_time * 2.2 + cell * 6.2831853 + wl_vW.y * 0.35 );

  /* ---- travelling scanlines ---- */
  float scanA = sin( ( wl_vW.y - wl_time * 2.8 ) * 3.2 );
  scanA = smoothstep( 0.70, 1.0, scanA );
  float scanB = sin( ( wl_vW.y - wl_time * 0.9 ) * 0.55 );
  scanB = smoothstep( 0.88, 1.0, scanB );

  /* ---- integrity: noise holes open up and grow with damage ---- */
  float tear = wl_fbm3( hcoord * 0.55 + vec2( wl_time * 0.22, -wl_time * 0.16 ) );
  float solid = smoothstep( stress * 0.76 - 0.06, stress * 0.76 + 0.16, tear );

  /* ---- flicker ---- */
  float fl = wl_hash11( floor( wl_time * 23.0 ) );
  float flicker = mix( 1.0, 0.22 + 0.78 * step( 0.34, fl ), stress );

  float glow = fres * 1.15
             + edge * ( 0.30 + 0.42 * pulse )
             + scanA * 0.46
             + scanB * 0.30
             + 0.05;
  glow *= solid * flicker;
  // panic surge just before collapse
  glow *= 1.0 + stress * ( 0.5 + 0.5 * sin( wl_time * 14.0 ) ) * 0.55;

  if ( glow <= 0.004 ) discard;

  vec3 col = mix( wl_colorA, wl_colorB, stress * stress );
  col = mix( col, vec3( 1.0 ), pow( fres, 3.0 ) * 0.35 );
  col *= glow;

  gl_FragColor = vec4( max( col, 0.0 ),
                       clamp( glow * wl_opacity, 0.0, 1.0 ) );

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`,
  } );

  mat.userData.uniforms = _register( uniforms );
  return mat;
}


/* =========================================================================
   5. OVERGROWTH ENERGY FIELD
   -------------------------------------------------------------------------
   Ground decal for the Overgrowth ability. `wl_life` runs 1 → 0; a front of
   thorn/root filaments races out from the centre, then everything fades.
   `tickShaders` burns `wl_life` from 1 down to 0 over `duration` seconds, so
   the caller only has to drop the mesh once
   `material.uniforms.wl_life.value <= 0`. Setting it back to 1 replays the
   effect on the same material.
   ========================================================================= */

/**
 * @param {number} duration seconds the field should live (drives wl_life)
 * @returns {THREE.ShaderMaterial}
 */
export function makeEnergyFieldMaterial( duration = 5 ) {
  const uniforms = {
    wl_time:  { value: 0 },
    wl_life:  { value: 1 },
    wl_root:  { value: new THREE.Color( 0.36, 0.86, 0.20 ) },
    wl_spark: { value: new THREE.Color( 1.00, 0.82, 0.30 ) },
  };

  const mat = new THREE.ShaderMaterial( {
    uniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */`
varying vec2 wl_vUv;

void main() {
  wl_vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`,
    fragmentShader: /* glsl */`
uniform float wl_time;
uniform float wl_life;
uniform vec3  wl_root;
uniform vec3  wl_spark;

varying vec2 wl_vUv;

${ WL_LIB }

void main() {
  vec2  c = wl_vUv * 2.0 - 1.0;
  float r = length( c );
  if ( r > 1.0 ) discard;

  float life = clamp( wl_life, 0.0, 1.0 );
  float age  = 1.0 - life;                       // 0 at cast, 1 when spent
  vec2  dir  = c / max( r, 1e-4 );
  float ang  = atan( c.y, c.x );

  /* ---- per-angle noise. Sampling on the unit circle keeps every angular
         feature seamless across the +/-PI wrap. ---- */
  float fil  = wl_fbm4( dir * 4.5 + 11.0 );
  float fil2 = wl_fbm3( dir * 13.0 - 4.0 );
  float reach = 0.58 + 0.42 * fil;               // how far this spoke gets

  /* ---- the expanding front ---- */
  float front = clamp( age * 1.45, 0.0, 1.25 ) * reach;
  float ring  = smoothstep( 0.11, 0.0, abs( r - front ) );
  float inner = smoothstep( front + 0.02, front - 0.18, r );

  /* ---- root filaments: 19 spokes (integer count = seamless), barbed along r ---- */
  float strandA = pow( abs( sin( ang * 19.0 + fil2 * 5.0 ) ), 6.0 );
  float strandB = pow( abs( sin( ang * 7.0  - fil  * 4.0 + r * 2.2 ) ), 4.0 );
  float strand  = max( strandA, strandB * 0.75 );
  float barb    = 0.5 + 0.5 * sin( r * 58.0 + ang * 7.0 - wl_time * 3.2 );

  /* ---- radial noise mottling so it never reads as a clean disc ---- */
  float mottle = 0.55 + 0.65 * wl_fbm3( c * 6.5 + vec2( 0.0, wl_time * 0.30 ) );

  float roots = strand * inner * ( 0.50 + 0.50 * barb ) * mottle;
  float mask  = roots + ring * ( 0.55 + 0.45 * strand );
  mask *= smoothstep( 1.0, 0.88, r );            // fade at the disc edge
  mask *= smoothstep( 0.03, 0.24, r );          // roots radiate, centre stays open

  /* ---- alpha over life: snap in, hold, fade out ---- */
  float fade = smoothstep( 0.0, 0.07, age ) * smoothstep( 0.0, 0.26, life );
  mask *= fade;
  if ( mask <= 0.004 ) discard;

  vec3 col = mix( wl_root * 0.35, wl_root, strand );
  col += wl_spark * ring * 0.85;
  col += wl_spark * pow( max( barb * strand * inner, 0.0 ), 3.0 ) * 0.6;

  gl_FragColor = vec4( max( col * mask * 1.25, 0.0 ),
                       clamp( mask, 0.0, 1.0 ) );

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`,
  } );

  mat.userData.uniforms = _register( uniforms, Math.max( 0.001, duration ) );
  return mat;
}
