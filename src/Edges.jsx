import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// Options → Edges: a frame along the polytope's edges, drawn as tubes with
// a ball at each vertex so the joints are round. Instanced, and re-posed
// each frame as the shape turns in 4D.
//   Glow: a soft light line, brightest along its core (unlit). Drawn with
//   max blending (lighten), so where tubes and joints overlap at a corner
//   it stays as bright as a single line instead of piling up into a dot.
//   Glass: clear round rods: only their reflections are drawn, added on
//   top, so they are nearly invisible face-on and bright where the curve
//   turns edge-on (Fresnel), like a glass rod. Real refraction can't be
//   used: three.js refracts only opaque things, so the rods would show the
//   sky through them and blot out the see-through faces behind.
//   Chrome: polished metal, lit by a neutral studio so it reads on
//   any background (a mirror of the starfield would be nearly black).
// `opacity` fades the frame (the 2D shadow draws it at half strength).

export const EDGE_LOOKS = ['off', 'glow', 'glass', 'chrome'];
export const EDGE_LOOK_LABELS = { off: 'Off', glow: 'Glow', glass: 'Glass', chrome: 'Chrome' };
export const nextEdgeLook = (current) => EDGE_LOOKS[(EDGE_LOOKS.indexOf(current) + 1) % EDGE_LOOKS.length];

const GLOW_COLOR = new THREE.Color(0.75, 0.85, 1);
const GLOW_WIDTH = 1.15; // the glow tube is this much wider than a metal one, fading out at its sides

/** Tube radius: thinner on the dense polytopes so the frame doesn't fill them in. */
const tubeRadius = (poly) => poly.radius * Math.min(0.012, 0.09 / Math.sqrt(poly.edges.length));

function createGlowMaterial(opacity) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: GLOW_COLOR.clone().multiplyScalar(opacity) } },
    vertexShader: /* glsl */ `
      varying float vFacing;
      void main() {
        vec4 p = vec4(position, 1.0);
        vec3 n = normal;
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
          n = mat3(instanceMatrix) * n;
        #endif
        vec4 mv = modelViewMatrix * p;
        // 1 where the surface faces the viewer (the tube's core), 0 at its sides
        vFacing = abs(dot(normalize(normalMatrix * n), normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      varying float vFacing;
      void main() {
        float core = pow(vFacing, 4.0);
        float halo = pow(vFacing, 1.5);
        gl_FragColor = vec4(color * (0.3 * halo + 1.1 * core), 1.0);
      }`,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    depthWrite: false,
  });
}

function createGlassMaterial(envMap, opacity) {
  return new THREE.MeshPhysicalMaterial({
    color: '#000000', // no body colour: reflections only
    metalness: 0,
    roughness: 0.05,
    ior: 1.5,
    specularIntensity: 1,
    envMap,
    envMapIntensity: 1.6 * opacity,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

function createMetalMaterial(color, envMap, opacity) {
  const fading = opacity < 1;
  return new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: 0.18, envMap, opacity, transparent: fading, depthWrite: !fading });
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _matrix = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);

/** The polytope's edge frame in `look`; mount inside the model's group. */
export function Edges({ poly, look, opacity = 1 }) {
  const gl = useThree((s) => s.gl);
  const tubes = useRef(null);
  const joints = useRef(null);

  // a neutral studio for the metals, made once per renderer
  const studio = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    return target;
  }, [gl]);
  useEffect(() => () => studio.dispose(), [studio]);

  const material = useMemo(() => {
    if (look === 'glow') return createGlowMaterial(opacity);
    if (look === 'glass') return createGlassMaterial(studio.texture, opacity);
    return createMetalMaterial('#e8ecf2', studio.texture, opacity);
  }, [look, studio, opacity]);
  useEffect(() => () => material.dispose(), [material]);

  // unit tube along +Y (its ends at y = ±0.5) and unit ball, scaled per instance
  const tubeGeometry = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 16, 1, true), []);
  const jointGeometry = useMemo(() => new THREE.SphereGeometry(1, 16, 12), []);
  useEffect(() => () => tubeGeometry.dispose(), [tubeGeometry]);
  useEffect(() => () => jointGeometry.dispose(), [jointGeometry]);

  useFrame(() => {
    const radius = tubeRadius(poly) * (look === 'glow' ? GLOW_WIDTH : 1);
    const t = tubes.current;
    if (t) {
      poly.edges.forEach(([i, j], k) => {
        const a = poly.vertex(i);
        const b = poly.vertex(j);
        _a.set(a.x, a.y, a.z);
        _b.set(b.x, b.y, b.z);
        _mid.addVectors(_a, _b).multiplyScalar(0.5);
        _dir.subVectors(_b, _a);
        const length = _dir.length();
        _quaternion.setFromUnitVectors(_up, length > 1e-9 ? _dir.divideScalar(length) : _up);
        t.setMatrixAt(k, _matrix.compose(_mid, _quaternion, _scale.set(radius, length, radius)));
      });
      t.instanceMatrix.needsUpdate = true;
    }
    const j = joints.current;
    if (j) {
      _quaternion.identity();
      _scale.setScalar(radius);
      for (let i = 0; i < poly.vertexCount; i++) {
        const v = poly.vertex(i);
        j.setMatrixAt(i, _matrix.compose(_a.set(v.x, v.y, v.z), _quaternion, _scale));
      }
      j.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      {/* keyed by shape, so the instance counts always match */}
      <instancedMesh
        key={`tubes-${poly.shape.id}`}
        ref={tubes}
        args={[tubeGeometry, material, poly.edges.length]}
        frustumCulled={false}
        raycast={() => null}
      />
      <instancedMesh
        key={`joints-${poly.shape.id}`}
        ref={joints}
        args={[jointGeometry, material, poly.vertexCount]}
        frustumCulled={false}
        raycast={() => null}
      />
    </>
  );
}
