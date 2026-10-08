import { Component, Suspense, useEffect, useRef, useState } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { IfInSessionMode, XROrigin, useXR, useXRControllerLocomotion } from '@react-three/xr';
import * as THREE from 'three';
import { CameraBackground, CardboardRig } from './Cardboard.jsx';
import { GazeReticle } from './Gaze.jsx';
import { XRMenuPanel } from './XRMenuPanel.jsx';
import { SOLID_BACKGROUND } from './menu.js';
import { PhoneStereoCameraFeed, PhoneStereoXR } from './PhoneStereo.jsx';

const BASE = import.meta.env.BASE_URL;

const SKY_URL = `${BASE}img/skybox.jpg`;

/** Renders `fallback` if a child throws, e.g. a texture that failed to download. */
class AssetBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.warn('[4d-viewer] asset failed to load, continuing without it:', error.message);
  }
  render() {
    return this.state.failed ? this.props.fallback ?? null : this.props.children;
  }
}

// Face opacity from centre (v=0) to rim (v=1), copied from the original
// viewer's facealpha.bmp: faint across the face, rising steeply to a bright,
// cell-coloured rim so neighbouring cells stay distinguishable.
const FACE_ALPHA = [...Array(24).fill(45), 58, 73, 88, 107, 126, 148, 174, 224];

function createFaceAlphaMap() {
  const data = new Uint8Array(FACE_ALPHA.length * 4);
  FACE_ALPHA.forEach((a, i) => data.set([a, a, a, 255], i * 4)); // alphaMap reads green
  const texture = new THREE.DataTexture(data, 1, FACE_ALPHA.length);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const FACE_ALPHA_MAP = createFaceAlphaMap();

// Eye level, a couple of metres ahead. The shadow lands just above the floor.
const POLY_POSITION = [0, 1.6, -2.5];
const SHADOW_DROP = -1.5;

function Sky({ passthrough }) {
  const texture = useLoader(THREE.TextureLoader, SKY_URL);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  // passthrough only exists inside an AR session; elsewhere keep the sky
  const hidden = useXR((s) => passthrough && s.mode === 'immersive-ar');

  useEffect(() => {
    if (hidden) return;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = gl.capabilities.getMaxAnisotropy();
    scene.background = texture;
    return () => {
      if (scene.background === texture) scene.background = null;
    };
  }, [texture, scene, gl, hidden]);

  return null;
}

/** Solid colour or the skybox; passthrough shows the skybox until an AR session hides it. */
function Backdrop({ background }) {
  const scene = useThree((s) => s.scene);
  const passthroughShowing = useXR((s) => background === 'passthrough' && s.mode === 'immersive-ar');
  const solid = background === 'solid' && !passthroughShowing;
  useEffect(() => {
    if (!solid) return;
    const color = new THREE.Color(SOLID_BACKGROUND);
    scene.background = color;
    return () => {
      if (scene.background === color) scene.background = null;
    };
  }, [solid, scene]);
  if (background === 'solid') return null;
  return (
    // own boundary so a slow or failed sky never holds back the polytope
    <AssetBoundary>
      <Suspense fallback={null}>
        <Sky passthrough={background === 'passthrough'} />
      </Suspense>
    </AssetBoundary>
  );
}

function PolytopeBody({ poly, opacity, ...meshProps }) {
  return (
    <>
      <mesh geometry={poly.faceGeometry} {...meshProps}>
        <meshBasicMaterial
          vertexColors
          alphaMap={FACE_ALPHA_MAP}
          transparent
          opacity={opacity}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </>
  );
}

function PolytopeView({ poly, speed, visible, showShadow, onSelect }) {
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    document.body.style.cursor = hovered ? 'pointer' : '';
  }, [hovered]);

  useFrame((_, dt) => poly.rotate(Math.min(dt, 0.5) * 0.1 * speed));

  return (
    <group position={POLY_POSITION} visible={visible}>
      <PolytopeBody
        poly={poly}
        opacity={poly.faceOpacity}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      />
      {showShadow && (
        // flatten the same geometry onto a plane below: a cheap projected shadow
        <group position={[0, SHADOW_DROP, 0]} scale={[1, 0.001, 1]}>
          <PolytopeBody
            poly={poly}
            opacity={poly.faceOpacity / 2}
            raycast={() => null}
          />
        </group>
      )}
    </group>
  );
}

/** Left thumbstick moves, right thumbstick snap-turns. The panel travels with the player. */
function Player({ children }) {
  const origin = useRef(null);
  useXRControllerLocomotion(origin, { speed: 1.5 }, { type: 'snap', degrees: 30 });
  return <XROrigin ref={origin}>{children}</XROrigin>;
}

export default function Scene({ poly, state, actions, menu, phone }) {
  const inSession = useXR((s) => s.mode === 'immersive-vr' || s.mode === 'immersive-ar');
  const inAR = useXR((s) => s.mode === 'immersive-ar');
  // a phone's AR session drawn as two lens-corrected eyes
  const phoneStereo = phone && inAR && state.stereo;
  // the 1-second stare is for hands-free use: controllers point and click instead
  const hasControllers = useXR((s) => s.inputSourceStates.some((input) => input.type === 'controller'));
  const immersive = inSession || state.handheld;
  // the motion-sensor view has no AR session: passthrough is the rear camera
  const cameraPassthrough = state.handheld && state.passthrough;
  const [cameraFailed, setCameraFailed] = useState(false);
  useEffect(() => setCameraFailed(false), [cameraPassthrough]);
  useEffect(() => () => poly.dispose(), [poly]);
  const polytopeProps = {
    poly,
    speed: state.paused ? 0 : 1,
    visible: state.showPolytope,
    showShadow: state.showShadow,
    onSelect: actions.nextShape,
  };
  return (
    <>
      {cameraPassthrough && !cameraFailed ? (
        <CameraBackground
          split={state.stereo}
          onError={(e) => {
            console.warn('[4d-viewer] camera unavailable, showing the skybox instead:', e?.message ?? e);
            setCameraFailed(true);
          }}
        />
      ) : (
        <Backdrop background={state.background} />
      )}
      {phoneStereo && <PhoneStereoXR />}
      {phoneStereo && state.passthrough && (
        <PhoneStereoCameraFeed
          onUnavailable={(reason) =>
            console.warn(`[4d-viewer] no per-eye camera image (${reason}); the browser's camera view shows behind instead`)
          }
        />
      )}
      <PolytopeView {...polytopeProps} />
      <Player>
        {/* waist height, tilted up toward the viewer; travels with the player */}
        {immersive && <XRMenuPanel {...menu} position={[0, 0.95, -0.75]} rotation={[-0.55, 0, 0]} />}
      </Player>
      {immersive && !hasControllers && <GazeReticle />}
      {state.handheld ? (
        <CardboardRig split={state.stereo} />
      ) : (
        <IfInSessionMode deny={['immersive-vr', 'immersive-ar']}>
          <OrbitControls makeDefault target={POLY_POSITION} enableDamping minDistance={0.5} maxDistance={20} />
        </IfInSessionMode>
      )}
    </>
  );
}
