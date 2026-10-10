import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { applyGrips, readControllers } from './grip.js';

// Touch controller grips. A grip pressed while that controller points at the
// menu panel carries the panel, held rigidly in the hand. Otherwise the grip
// takes the model: one hand moves it, both scale and turn it (see grip.js).
// While a controller is inside the model it buzzes softly.

const HANDS = ['left', 'right'];
const BUZZ_STRENGTH = 0.15;
const BUZZ_MS = 60;
const BUZZ_EVERY = 0.05; // seconds between pulses, so they overlap into a steady hum

const _world = new THREE.Matrix4();
const _parentInverse = new THREE.Matrix4();
const _local = new THREE.Vector3();

function isShown(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/**
 * Grip controls for the model and the menu panel. All arguments are refs
 * except `poly`: `model` and `menu` are the objects to move, `origin` the
 * XROrigin the controllers are tracked relative to.
 */
export function useControllerGrips({ model, menu, origin, poly }) {
  const gl = useThree((s) => s.gl);
  const grabs = useRef({}); // hand -> { target: 'model' } | { target: 'menu', offset }
  const lastModel = useRef({}); // positions of the hands holding the model, last frame
  const nextBuzz = useRef({});
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  useFrame((_, __, frame) => {
    const referenceSpace = gl.xr.getReferenceSpace();
    if (!frame || !origin.current || !referenceSpace) {
      grabs.current = {};
      lastModel.current = {};
      return;
    }
    const controllers = readControllers(frame, referenceSpace, origin.current);
    const holdingModel = {};

    for (const hand of HANDS) {
      const c = controllers[hand];
      if (!c?.squeeze) {
        delete grabs.current[hand];
        continue;
      }
      let grab = grabs.current[hand];
      if (!grab) {
        // a new grip: the menu if this controller is pointing at it, else the model
        raycaster.ray.copy(c.ray);
        const panel = menu.current;
        grab =
          panel && isShown(panel) && raycaster.intersectObject(panel, true).length
            ? { target: 'menu', offset: c.grip.clone().invert().multiply(panel.matrixWorld) }
            : { target: 'model' };
        grabs.current[hand] = grab;
      }
      if (grab.target === 'model') {
        holdingModel[hand] = c.position;
      } else if (menu.current) {
        // the panel keeps its pose relative to the hand
        const panel = menu.current;
        _parentInverse.copy(panel.parent.matrixWorld).invert();
        _world.multiplyMatrices(c.grip, grab.offset).premultiply(_parentInverse);
        _world.decompose(panel.position, panel.quaternion, panel.scale);
      }
    }
    if (model.current) applyGrips(model.current, lastModel.current, holdingModel);
    lastModel.current = holdingModel;

    // buzz while a controller is inside the model
    const object = model.current;
    if (!object || !isShown(object)) return;
    const now = performance.now() / 1000;
    for (const hand of HANDS) {
      const c = controllers[hand];
      const actuator = c?.gamepad.hapticActuators?.[0];
      if (!actuator?.pulse || now < (nextBuzz.current[hand] ?? 0)) continue;
      // checking at the pulse rate, not every frame, keeps the big polytopes cheap
      nextBuzz.current[hand] = now + BUZZ_EVERY;
      if (!poly.containsPoint(object.worldToLocal(_local.copy(c.position)))) continue;
      actuator.pulse(BUZZ_STRENGTH, BUZZ_MS)?.catch?.(() => {});
    }
  });
}
