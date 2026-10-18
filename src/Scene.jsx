import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { IfInSessionMode, XROrigin, useXR, useXRControllerLocomotion } from '@react-three/xr';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CameraBackground, CardboardRig } from './Cardboard.jsx';
import { GazeReticle } from './Gaze.jsx';
import { XRMenuPanel } from './XRMenuPanel.jsx';
import { useControllerGrips } from './Grab.jsx';
import { SOLID_BACKGROUND } from './menu.js';
import { advanceWaves, createFaceMaterial, isSeeThrough } from './faceLooks.js';
import { FramePacing } from './FramePacing.jsx';
import { Edges } from './Edges.jsx';
import { PhoneStereoCameraFeed, PhoneStereoXR } from './PhoneStereo.jsx';
import { SideBySide } from './SideBySide.jsx';
import { Interlaced } from './Interlaced.jsx';

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
const SHADOW_Y = 0.1;
// The XR panel starts at waist height, tilted up toward the viewer, and
// travels with the player. Constants, so a re-render never undoes a move.
const MENU_POSITION = [0, 0.95, -0.75];
const MENU_ROTATION = [-0.55, 0, 0];
// a phone's stereo view is blurrier and smaller than a headset's: a bigger panel stays readable
const PHONE_STEREO_MENU_SCALE = 1.5;

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

const _eye = new THREE.Vector3();

/**
 * The solid colour as a sphere around the viewer. In an AR session three.js
 * clears to transparent whatever scene.background says (so passthrough shows),
 * so there the colour has to be drawn, like the skybox is.
 */
function SolidDome() {
  const dome = useRef(null);
  useFrame(({ camera }) => dome.current?.position.copy(camera.getWorldPosition(_eye)));
  return (
    <mesh ref={dome} renderOrder={-1000} frustumCulled={false} raycast={() => null}>
      <sphereGeometry args={[100, 16, 8]} />
      <meshBasicMaterial color={SOLID_BACKGROUND} side={THREE.BackSide} depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** Solid colour or the skybox; passthrough shows the skybox until an AR session hides it. */
function Backdrop({ background }) {
  const scene = useThree((s) => s.scene);
  const inAR = useXR((s) => s.mode === 'immersive-ar');
  const solid = background === 'solid';
  useEffect(() => {
    if (!solid || inAR) return;
    const color = new THREE.Color(SOLID_BACKGROUND);
    scene.background = color;
    return () => {
      if (scene.background === color) scene.background = null;
    };
  }, [solid, inAR, scene]);
  if (solid) return inAR ? <SolidDome /> : null;
  return (
    // own boundary so a slow or failed sky never holds back the polytope
    <AssetBoundary>
      <Suspense fallback={null}>
        <Sky passthrough={background === 'passthrough'} />
      </Suspense>
    </AssetBoundary>
  );
}

function PolytopeBody({ poly, opacity, look = 'glow', ...meshProps }) {
  // Glass, Metal and Frosted: a lit material, see faceLooks.js
  const lit = useMemo(() => (look === 'glow' ? null : createFaceMaterial(look, FACE_ALPHA_MAP)), [look]);
  useEffect(() => () => lit?.dispose(), [lit]);
  if (lit) lit.opacity = Math.min(1, opacity * lit.userData.alpha);
  return (
    <mesh geometry={poly.faceGeometry} material={lit ?? undefined} {...meshProps}>
      {!lit && (
        <meshBasicMaterial
          vertexColors
          alphaMap={FACE_ALPHA_MAP}
          transparent
          opacity={opacity}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      )}
    </mesh>
  );
}

/**
 * What the lit face looks reflect and refract: the skybox when it is
 * showing, otherwise a neutral studio (the stars would look wrong against
 * passthrough or a solid colour).
 */
function FaceEnvironment({ sky }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const environment = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    let target;
    if (sky) {
      sky.mapping = THREE.EquirectangularReflectionMapping;
      sky.colorSpace = THREE.SRGBColorSpace;
      target = pmrem.fromEquirectangular(sky);
    } else {
      const room = new RoomEnvironment();
      target = pmrem.fromScene(room, 0.04);
      room.dispose();
    }
    pmrem.dispose();
    return target;
  }, [gl, sky]);
  useEffect(() => {
    scene.environment = environment.texture;
    return () => {
      if (scene.environment === environment.texture) scene.environment = null;
      environment.dispose();
    };
  }, [scene, environment]);
  return null;
}

function SkyEnvironment() {
  return <FaceEnvironment sky={useLoader(THREE.TextureLoader, SKY_URL)} />;
}

/**
 * The polytope in `model`, a group the grip controls move, turn and scale.
 * Its shadow is the same shape squashed flat onto the floor straight below,
 * in the same Faces and Edges looks at half strength.
 */
function PolytopeView({ model, poly, look, edges, speed, visible, showShadow, inSession, onSelect }) {
  const [hovered, setHovered] = useState(false);
  const shadow = useRef(null);
  const shadowBody = useRef(null);

  useEffect(() => {
    document.body.style.cursor = hovered ? 'pointer' : '';
  }, [hovered]);

  // leaving XR puts the model back where the windowed view looks
  useEffect(() => {
    if (inSession || !model.current) return;
    model.current.position.fromArray(POLY_POSITION);
    model.current.quaternion.identity();
    model.current.scale.setScalar(1);
  }, [inSession, model]);

  // priority -1: turn the shape before anything reads its vertices this frame (the edges)
  useFrame((_, dt) => {
    poly.rotate(Math.min(dt, 0.5) * 0.1 * speed);
    advanceWaves(Math.min(dt, 0.5)); // Water ripples on even when the shape stops turning
    if (!shadow.current || !model.current) return;
    const { position, quaternion, scale } = model.current;
    shadow.current.position.set(position.x, SHADOW_Y, position.z);
    shadowBody.current.quaternion.copy(quaternion);
    shadowBody.current.scale.copy(scale);
  }, -1);

  return (
    <group visible={visible}>
      <group ref={model} position={POLY_POSITION}>
        <PolytopeBody
          poly={poly}
          look={look}
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
        {edges !== 'off' && <Edges poly={poly} look={edges} />}
      </group>
      {showShadow && (
        // flatten the turned and scaled shape onto the floor: a cheap projected shadow
        <group ref={shadow} scale={[1, 0.001, 1]}>
          <group ref={shadowBody}>
            <PolytopeBody poly={poly} look={look} opacity={poly.faceOpacity / 2} raycast={() => null} />
            {edges !== 'off' && <Edges poly={poly} look={edges} opacity={0.5} />}
          </group>
        </group>
      )}
    </group>
  );
}

const _head = new THREE.Vector3();

/**
 * Left thumbstick moves, right thumbstick turns smoothly about the head.
 * The grip buttons move, turn and scale the model, or carry the panel.
 * The panel travels with the player.
 */
function Player({ model, menu, poly, children }) {
  const origin = useRef(null);
  useXRControllerLocomotion(
    (velocity, turn, delta, state) => {
      const o = origin.current;
      if (!o) return;
      o.position.addScaledVector(velocity, delta);
      if (!turn) return;
      // swing the origin around the head so turning doesn't move the viewer
      state.camera.getWorldPosition(_head);
      const dx = o.position.x - _head.x;
      const dz = o.position.z - _head.z;
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      o.position.x = _head.x + dx * c + dz * s;
      o.position.z = _head.z - dx * s + dz * c;
      o.rotation.y += turn;
    },
    { speed: 1.5 },
    { type: 'smooth', speed: 1.5 },
  );
  useControllerGrips({ model, menu, origin, poly });
  return <XROrigin ref={origin}>{children}</XROrigin>;
}

/** `menuOverlay`: the page shows the menu over the scene (Phone AR), so no panel in it. */
export default function Scene({ poly, state, actions, menu, menuOverlay, phone }) {
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
  // the skybox is behind the model: Skybox, or Passthrough before an AR session
  const showsSky = state.background === 'skybox' || (state.background === 'passthrough' && !inAR && !cameraPassthrough);
  useEffect(() => setCameraFailed(false), [cameraPassthrough]);
  useEffect(() => () => poly.dispose(), [poly]);
  const model = useRef(null);
  const menuPanel = useRef(null);
  const polytopeProps = {
    model,
    inSession,
    poly,
    look: state.faces,
    edges: state.edges,
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
      <FramePacing seeThrough={isSeeThrough(state.faces)} />
      {state.view === 'sbs' && !immersive && <SideBySide />}
      {state.view === 'interlaced' && !immersive && <Interlaced />}
      {phoneStereo && <PhoneStereoXR />}
      {phoneStereo && state.passthrough && (
        <PhoneStereoCameraFeed
          onUnavailable={(reason) =>
            console.warn(`[4d-viewer] no per-eye camera image (${reason}); the browser's camera view shows behind instead`)
          }
        />
      )}
      {state.faces !== 'glow' &&
        (showsSky ? (
          <AssetBoundary fallback={<FaceEnvironment />}>
            <Suspense fallback={null}>
              <SkyEnvironment />
            </Suspense>
          </AssetBoundary>
        ) : (
          <FaceEnvironment />
        ))}
      <PolytopeView {...polytopeProps} />
      <Player model={model} menu={menuPanel} poly={poly}>
        {immersive && !menuOverlay && (
          <XRMenuPanel
            {...menu}
            groupRef={menuPanel}
            position={MENU_POSITION}
            rotation={MENU_ROTATION}
            scale={phone && state.stereo ? PHONE_STEREO_MENU_SCALE : 1}
          />
        )}
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
