import * as THREE from 'three';

// Options → Faces: how the polytope's faces are drawn.
//   Glow: the original look, unlit, faint centres rising to bright rims.
//   Glass, Diamond, Water, Soap, Metal, Frosted: physically based, lit by the surroundings
//   (scene.environment, see FaceEnvironment in Scene.jsx), each with the
//   cell-coloured rim added as a glow so neighbouring cells stay distinct.
// Faces carry no normals (they move every frame), so the lit looks use flat
// shading: the normal comes from screen-space derivatives, always toward the viewer.

export const FACE_LOOKS = ['glow', 'glass', 'diamond', 'water', 'soap', 'metal', 'frosted'];
export const FACE_LOOK_LABELS = { glow: 'Glow', glass: 'Glass', diamond: 'Diamond', water: 'Water', soap: 'Soap', metal: 'Metal', frosted: 'Frosted' };
const WAVE_HEIGHT = 0.03; // in model units: with WAVE_SCALE, sets how steep the ripples are
const WAVE_SCALE = 4.5; // waves per unit, roughly: several ripples across each face
const WAVE_SHINE = 0.5; // the light the ripple slopes catch (see addWaves)
const FILM_STRENGTH = 0.35; // how strongly Soap's rainbow film shows (see addFilm)

/**
 * Physical material settings per look. `alpha` multiplies the polytope's
 * face opacity; `alphaFloor` lifts the faint face centres toward the rims
 * (0: the alpha map as is, 1: evenly opaque). Glass and Frosted have
 * almost no specular reflection: on turning faces it reads as flicker.
 * Glass is slightly rough, which also softens the stars seen through it.
 */
const LOOKS = {
  glass: { roughness: 0.15, metalness: 0, transmission: 1, ior: 1.45, thickness: 1, specularIntensity: 0.03, alpha: 2.5, alphaFloor: 0, rim: 0.7 },
  // Glass at diamond's index of refraction, for comparison: the view through bends more
  diamond: { roughness: 0.15, metalness: 0, transmission: 1, ior: 2.42, thickness: 1, specularIntensity: 0.03, alpha: 2.5, alphaFloor: 0, rim: 0.7 },
  metal: { roughness: 0.12, metalness: 1, specularIntensity: 1, alpha: 3.5, alphaFloor: 0.45, rim: 0.5 },
  // water: rippling (see addWaves), clear and faintly blue, a little sheen on the ripples
  water: {
    roughness: 0.05,
    metalness: 0,
    transmission: 1,
    ior: 1.33,
    thickness: 1,
    attenuationColor: '#bfe4ff',
    attenuationDistance: 2,
    specularIntensity: 0.12,
    alpha: 2.5,
    alphaFloor: 0.15,
    rim: 0.6,
    waves: true,
  },
  // soap: a clear film with swirling rainbow bands (see addFilm), plus three's
  // own thin-film iridescence on its reflections
  soap: {
    roughness: 0.05,
    metalness: 0,
    transmission: 1,
    ior: 1.33,
    thickness: 0.2,
    iridescence: 1,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [250, 900],
    specularIntensity: 0.25,
    alpha: 2.5,
    alphaFloor: 0.1,
    rim: 0.4,
    film: true,
  },
  frosted: { roughness: 0.6, metalness: 0, transmission: 1, ior: 1.3, thickness: 0.4, specularIntensity: 0, alpha: 3, alphaFloor: 0.3, rim: 0.7, bumps: true },
};

export const nextFaceLook = (current) => FACE_LOOKS[(FACE_LOOKS.indexOf(current) + 1) % FACE_LOOKS.length];

/**
 * Frosted's coarse random grain: a tangent-space normal map (bends what is
 * seen through it) and the grain itself (patches of frost that let less
 * through), both tiling.
 */
function createFrostTextures(size = 64) {
  // smoothed noise height field, wrapping at the edges so it tiles
  let height = Float32Array.from({ length: size * size }, Math.random);
  for (let pass = 0; pass < 3; pass++) {
    const blurred = new Float32Array(size * size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) sum += height[((y + dy + size) % size) * size + ((x + dx + size) % size)];
        blurred[y * size + x] = sum / 9;
      }
    height = blurred;
  }
  // stretch to the full 0..1 range: blurring leaves the noise close to 0.5
  let low = Infinity;
  let high = -Infinity;
  for (const h of height) {
    low = Math.min(low, h);
    high = Math.max(high, h);
  }
  height = height.map((h) => (h - low) / (high - low));
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  const data = new Uint8Array(size * size * 4);
  const grainData = new Uint8Array(size * size * 4);
  const strength = 3;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = new THREE.Vector3((at(x - 1, y) - at(x + 1, y)) * strength, (at(x, y - 1) - at(x, y + 1)) * strength, 1).normalize();
      data.set([(n.x * 0.5 + 0.5) * 255, (n.y * 0.5 + 0.5) * 255, (n.z * 0.5 + 0.5) * 255, 255], (y * size + x) * 4);
      const g = at(x, y) * 255;
      grainData.set([g, g, g, 255], (y * size + x) * 4);
    }
  const tiling = (pixels) => {
    const texture = new THREE.DataTexture(pixels, size, size);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1.5, 1.5);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  };
  return { normalMap: tiling(data), grain: tiling(grainData) };
}

let frost = null;

/**
 * A physical material for `look`, sharing the faces' alpha map (uv.y runs
 * from the face centre, 0, to its rim, 1). The rim glow is added in the
 * shader: vertex colour, strongest at the rim.
 */
export function createFaceMaterial(look, alphaMap) {
  const { alpha, alphaFloor, rim, bumps, waves, film, ...settings } = LOOKS[look];
  if (bumps && !frost) frost = createFrostTextures();
  const material = new THREE.MeshPhysicalMaterial({
    ...settings,
    vertexColors: true,
    alphaMap,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    flatShading: true,
    normalMap: bumps ? frost.normalMap : null,
    // where the grain is high, less light passes and the frost shows
    transmissionMap: bumps ? frost.grain : null,
    normalScale: new THREE.Vector2(0.6, 0.6),
  });
  material.userData.alpha = alpha;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rimGlow = { value: rim };
    shader.uniforms.alphaFloor = { value: alphaFloor };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float rimGlow;\nuniform float alphaFloor;')
      .replace(
        '#include <alphamap_fragment>',
        `#include <alphamap_fragment>
\tdiffuseColor.a = max( diffuseColor.a, opacity * alphaFloor );
\t#ifdef USE_TRANSMISSIONMAP
\t\tdiffuseColor.a *= 0.55 + 0.9 * texture2D( transmissionMap, vTransmissionMapUv ).r;
\t#endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vColor.rgb * rimGlow * pow( vAlphaMapUv.y, 4.0 );',
      );
  };
  if (waves || film) {
    const compileBase = material.onBeforeCompile;
    material.onBeforeCompile = (shader) => {
      compileBase(shader);
      if (waves) addWaves(shader);
      if (film) addFilm(shader);
    };
  }
  material.customProgramCacheKey = () => `face-${look}`;
  return material;
}

// Water's waves: a few travelling sine waves in the model's own space, so
// they stay on the shape and run continuously across the face triangles.
// The surface stays flat; only its normal tilts with the wave slope (bump
// mapping from screen-space derivatives of the height), which bends the
// refracted view through them. Against the starfield that bend is hard to
// see, so the slopes facing a fixed light above and behind the viewer also
// glow softly: broad, slow highlights that move with the waves.
const waveTime = { value: 0 };

/** Moves Water's waves and Soap's swirls on; call once a frame with the frame's seconds. */
export function advanceWaves(dt) {
  waveTime.value = (waveTime.value + dt) % 1000;
}

function addWaves(shader) {
  shader.uniforms.waveTime = waveTime;
  shader.uniforms.waveHeight = { value: WAVE_HEIGHT };
  shader.uniforms.waveScale = { value: WAVE_SCALE };
  shader.uniforms.waveShine = { value: WAVE_SHINE };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWavePos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvWavePos = transformed;');
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      /* glsl */ `#include <common>
varying vec3 vWavePos;
uniform float waveTime;
uniform float waveHeight;
uniform float waveScale;
uniform float waveShine;
float waveSurface( vec3 p, float t ) {
  p *= waveScale;
  return 0.5 * sin( dot( p, vec3( 6.0, 2.0, 3.0 ) ) + t * 1.3 )
    + 0.35 * sin( dot( p, vec3( -3.0, 5.5, 4.0 ) ) + t * 1.7 )
    + 0.2 * sin( dot( p, vec3( 4.0, -5.0, 7.0 ) ) * 1.6 + t * 2.3 );
}
vec3 waveNormal( vec3 surfPos, vec3 surfNormal, vec2 dHdxy ) {
  vec3 sigmaX = dFdx( surfPos );
  vec3 sigmaY = dFdy( surfPos );
  vec3 r1 = cross( sigmaY, surfNormal );
  vec3 r2 = cross( surfNormal, sigmaX );
  float det = dot( sigmaX, r1 );
  vec3 grad = sign( det ) * ( dHdxy.x * r1 + dHdxy.y * r2 );
  return normalize( abs( det ) * surfNormal - grad );
}`,
    )
    .replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vec3( 0.8, 0.92, 1.0 ) * waveGlint;',
    )
    .replace(
      '#include <normal_fragment_maps>',
      /* glsl */ `#include <normal_fragment_maps>
\tfloat waveH = waveHeight * waveSurface( vWavePos, waveTime );
\tnormal = waveNormal( - vViewPosition, normal, vec2( dFdx( waveH ), dFdy( waveH ) ) );
\t// view space: the light comes from above and behind the viewer
\tfloat waveGlint = waveShine * pow( max( dot( normal, normalize( vec3( 0.25, 0.55, 0.8 ) ) ), 0.0 ), 20.0 );`,
    );
}

// Soap's rainbow: a thin film's colour depends on its thickness and the
// viewing angle. The thickness swirls slowly over the shape (sines warped
// by sines, in the model's own space), and grazing views shift the bands,
// as on a soap bubble or oil on water. Added as light, strongest toward
// the faces' edge-on angles, so the film stays mostly clear face-on.
function addFilm(shader) {
  shader.uniforms.waveTime = waveTime;
  shader.uniforms.filmStrength = { value: FILM_STRENGTH };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vFilmPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvFilmPos = transformed;');
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      /* glsl */ `#include <common>
varying vec3 vFilmPos;
uniform float waveTime;
uniform float filmStrength;
vec3 filmColour( vec3 p, float facing, float t ) {
  vec3 q = p * 2.5;
  q += 0.6 * sin( q.yzx * 1.7 + t * 0.35 );
  float thickness = 0.5 + 0.25 * sin( q.x + q.y * 0.8 + t * 0.2 ) + 0.25 * sin( q.z * 1.3 - q.x * 0.6 - t * 0.15 );
  float bands = thickness * 2.2 + ( 1.0 - facing ) * 0.8;
  return 0.5 + 0.5 * cos( 6.28318 * ( bands + vec3( 0.0, 0.33, 0.67 ) ) );
}`,
    )
    .replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `#include <emissivemap_fragment>
\tfloat filmFacing = abs( dot( normal, normalize( vViewPosition ) ) );
\ttotalEmissiveRadiance += filmColour( vFilmPos, filmFacing, waveTime ) * filmStrength * ( 0.4 + 0.6 * ( 1.0 - filmFacing ) );`,
    );
}
