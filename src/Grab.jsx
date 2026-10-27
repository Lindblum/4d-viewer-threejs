import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { applyGrips, pulse, readControllers } from './grip.js';

// Touch controller grips and the XR panels, as in grid-game-threejs.
//
// The panels (the options menu and the View panel) dock on a controller,
// stacked upward, the View panel nearest it, tipped toward the eyes. A grip
// pressed while that controller points at a panel, or touches it, takes the
// panel off its dock and holds it rigidly; let go near the other controller
// it docks there, anywhere else it stays put (travelling with the player).
// A double tap of a grip docks the panel it points at on that controller, or,
// at no panel, lets go of the panels docked there, leaving them where they
// are. A triple tap brings every undocked panel to that controller.
//
// Otherwise the grip takes the model: one hand moves it, both scale and turn
// it (see grip.js). While a grip holds something, its thumbstick pushes it
// away along the ray (up) or reels it in (down), and rolls it about the ray
// (left / right), instead of moving or turning the player.
//
// While a controller is inside the model it buzzes softly. Every buzz is as
// strong as Accessibility → Vibration says.
//
// Without controllers (gaze, phones) the menu stands at `home` instead and
// the View panel hides.

const HANDS = ['left', 'right'];
const otherHand = (hand) => (hand === 'left' ? 'right' : 'left');

const BUZZ_STRENGTH = 0.15;
const BUZZ_MS = 60;
const BUZZ_EVERY = 0.05; // seconds between pulses, so they overlap into a steady hum
const PULSE = { grab: [0.6, 50], detach: [0.4, 30], dock: [0.9, 80], zone: [0.25, 20] }; // [strength, ms]

/** Docked on one controller, the panels stand stacked upward in this order (the first nearest it). */
const DOCK_STACK = ['view', 'menu'];
// in the controller's pointing frame (-Z forward, +Y up): the stack stands on
// this point, the first panel's button over the controller, its faces
// tipped up toward the eyes
const DOCK_ANCHOR = new THREE.Vector3(0, 0.05, 0.02);
const DOCK_TILT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.5);
const DOCK_GAP = 0.008; // m between docked panels
const DOCK_SCALE = 0.5; // docked, the panels are half their free size
const DOCK_REACH = 0.12; // m: a held panel let go this near the other controller docks there
const TOUCH_REACH = 0.03; // m: a grip this near a panel's face takes it
const GRIP_TAP_S = 0.3; // a grip pressed no longer than this is a tap...
const GRIP_DOUBLE_TAP_S = 0.35; // ...and pressed again within this, a double tap (once more: a triple tap)
const FLY_S = 0.4; // a panel docked from afar flies there
const GROW_RATE = 12; // per second: a panel in the hand eases to its free size
// a thumbstick while its grip holds something
const PUSH_RATE = 1.5; // per second at full tilt, this share of its distance from the hand...
const PUSH_MIN_M = 0.25; // ...but never slower than at this distance
const PANEL_REEL_MIN_M = 0.05; // a panel reels in no nearer the hand than this
const ROLL_RATE = Math.PI; // radians per second at full tilt

const _world = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _step = new THREE.Matrix4();
const _originInverse = new THREE.Matrix4();
const _gripInverse = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();

function isShown(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** A panel group's visible panel, in its own metres at scale 1: { left, right, top, bottom, button } (set by the panel as userData.bounds). */
const boundsOf = (group) => group.userData.bounds ?? { left: -0.05, right: 0.05, top: 0.05, bottom: -0.05, button: 0 };

/** `m`'s rotation about the line through `origin` along unit `axis`, by `angle`. */
function rotationAbout(origin, axis, angle) {
  return new THREE.Matrix4()
    .makeTranslation(origin.x, origin.y, origin.z)
    .multiply(_step.makeRotationAxis(axis, angle))
    .multiply(new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z));
}

/**
 * Grip controls for the model and the panels. `model` and `origin` (the
 * XROrigin the controllers are tracked relative to, and the panels' parent)
 * are refs; `panels`: { menu, view }, refs to the panels' groups; `home`:
 * the menu's { position, rotation } without controllers, `homeScale` its
 * scale there; `textSize`: Accessibility → Text Size (the panels that much
 * bigger). Returns a ref to which hands' grips hold something now
 * ({ left, right }), whose sticks are then theirs, not the player's.
 */
export function useControllerGrips({ model, panels, origin, poly, vibration, textSize, home, homeScale }) {
  const gl = useThree((s) => s.gl);
  const grabs = useRef({}); // hand -> { target: 'model' } | { target: 'panel', key, offset, point, size, grow, zone } | { target: 'none' }
  const docks = useRef({ menu: { dock: 'left' }, view: { dock: 'left' } }); // key -> { dock: hand | null, on, fly }
  const taps = useRef({}); // hand -> { pressedAt, tappedAt, count }
  const pressed = useRef({});
  const lastModel = useRef({}); // positions of the hands holding the model, last frame
  const nextBuzz = useRef({});
  const holding = useRef({});
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const homePose = useMemo(
    () => ({ position: new THREE.Vector3(...home.position), quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(...home.rotation)) }),
    [home],
  );

  useFrame((_, delta, frame) => {
    const dt = Math.min(delta, 0.1);
    const now = performance.now() / 1000;
    const referenceSpace = gl.xr.getReferenceSpace();
    const o = origin.current;
    const controllers = frame && o && referenceSpace ? readControllers(frame, referenceSpace, o) : {};
    const buzz = (hand, [strength, ms]) => pulse(controllers[hand]?.gamepad, strength, ms, vibration);
    const groupOf = (key) => panels[key]?.current ?? null;
    const shownPanels = () => Object.keys(docks.current).filter((key) => groupOf(key) && isShown(groupOf(key)));
    if (o) _originInverse.copy(o.matrixWorld).invert();

    /** Puts panel `key`'s group at world matrix `world` (its parent is the origin). */
    const placeWorld = (key, world) => {
      _local.multiplyMatrices(_originInverse, world).decompose(groupOf(key).position, groupOf(key).quaternion, groupOf(key).scale);
    };

    /** The panel `c` points at or touches (nearest): { key, point (world) } or null. */
    const panelAt = (c) => {
      let best = null;
      raycaster.ray.copy(c.ray);
      for (const key of shownPanels()) {
        const g = groupOf(key);
        const hit = raycaster.intersectObject(g, true)[0];
        if (hit && (!best || hit.distance < best.distance)) best = { key, point: hit.point.clone(), distance: hit.distance };
      }
      if (best) return best;
      for (const key of shownPanels()) {
        const g = groupOf(key);
        const b = boundsOf(g);
        g.updateWorldMatrix(true, false);
        const local = g.worldToLocal(_v.copy(c.position));
        const reach = TOUCH_REACH / g.scale.x;
        if (local.x >= b.left - reach && local.x <= b.right + reach && local.y >= b.bottom - reach && local.y <= b.top + reach && Math.abs(local.z) < reach)
          return { key, point: c.position.clone() };
      }
      return null;
    };

    /** Where held panel `key` would dock if let go now: the other controller when it's within DOCK_REACH, else null. */
    const dockZone = (hand, key) => {
      const c = controllers[otherHand(hand)];
      if (!c) return null;
      const g = groupOf(key);
      const b = boundsOf(g);
      g.updateWorldMatrix(true, false);
      const local = g.worldToLocal(_v.copy(c.position));
      local.set(THREE.MathUtils.clamp(local.x, b.left, b.right), THREE.MathUtils.clamp(local.y, b.bottom, b.top), 0);
      return g.localToWorld(local).distanceTo(c.position) < DOCK_REACH ? otherHand(hand) : null;
    };

    const release = (key) => {
      for (const hand of HANDS) if (grabs.current[hand]?.key === key) grabs.current[hand] = { target: 'none' };
    };

    /** Panel `key` docks on `hand`, flying there from where it is. */
    const dock = (key, hand) => {
      release(key);
      const g = groupOf(key);
      docks.current[key].dock = hand;
      docks.current[key].fly = { t0: now, position: g.position.clone(), quaternion: g.quaternion.clone(), scale: g.scale.x };
    };

    const takePanel = (hand, c, at) => {
      const d = docks.current[at.key];
      buzz(hand, d.dock ? PULSE.detach : PULSE.grab);
      release(at.key); // (the other hand lets go)
      Object.assign(d, { dock: null, on: null, fly: null });
      const g = groupOf(at.key);
      g.updateWorldMatrix(true, false);
      _gripInverse.copy(c.grip).invert();
      grabs.current[hand] = {
        target: 'panel',
        key: at.key,
        offset: _gripInverse.clone().multiply(g.matrixWorld),
        point: at.point.clone().applyMatrix4(_gripInverse),
        size: 1,
        grow: textSize / g.scale.x, // (to its free size)
        zone: null,
      };
    };

    const gripStart = (hand, c) => {
      const tap = (taps.current[hand] ??= { pressedAt: -1, tappedAt: -Infinity, count: 0 });
      tap.count = now - tap.tappedAt < GRIP_DOUBLE_TAP_S ? tap.count + 1 : 1; // (this press: the count-th tap in a row)
      tap.tappedAt = -Infinity;
      tap.pressedAt = now;
      grabs.current[hand] = { target: 'none' };
      if (tap.count >= 3) {
        // every panel not docked flies to this controller
        const free = shownPanels().filter((key) => !docks.current[key].dock);
        for (const key of free) dock(key, hand);
        if (free.length) buzz(hand, PULSE.dock);
        return;
      }
      const at = panelAt(c);
      if (tap.count === 2) {
        if (at) {
          // the panel pointed at docks here
          dock(at.key, hand);
          buzz(hand, PULSE.dock);
          return;
        }
        // no panel: the ones docked here stay where they are, free
        const mine = shownPanels().filter((key) => docks.current[key].on === hand);
        for (const key of mine) Object.assign(docks.current[key], { dock: null, on: null, fly: null });
        if (mine.length) buzz(hand, PULSE.detach);
        return;
      }
      if (at) takePanel(hand, c, at);
      else grabs.current[hand] = { target: 'model' };
    };

    const gripEnd = (hand) => {
      const tap = taps.current[hand];
      if (tap) tap.tappedAt = tap.count < 3 && now - tap.pressedAt <= GRIP_TAP_S ? now : -Infinity; // (a short press: a tap, unless it ended a triple)
      const g = grabs.current[hand];
      delete grabs.current[hand];
      if (g?.target !== 'panel') return;
      // let go near the other controller: it docks there
      const zone = dockZone(hand, g.key);
      if (!zone) return;
      docks.current[g.key].dock = zone;
      buzz(zone, PULSE.dock);
    };

    // grips pressed and let go
    for (const hand of HANDS) {
      const down = Boolean(controllers[hand]?.squeeze);
      if (down && !pressed.current[hand]) gripStart(hand, controllers[hand]);
      else if (!down && pressed.current[hand]) gripEnd(hand);
      pressed.current[hand] = down;
    }

    // what each grip holds, and its stick on it
    const holdingModel = {};
    const modelHands = HANDS.filter((hand) => grabs.current[hand]?.target === 'model');
    for (const hand of HANDS) {
      const c = controllers[hand];
      const g = grabs.current[hand];
      holding.current[hand] = Boolean(c && g && g.target !== 'none');
      if (!c || !g) continue;
      const { x, y } = c.stick;
      if (g.target === 'model') {
        holdingModel[hand] = c.position;
        const m = model.current;
        if (!m) continue;
        if (x) {
          // rolled about the ray, as if it were an axle (right: clockwise, looking along it)
          _q.setFromAxisAngle(c.ray.direction, x * ROLL_RATE * dt);
          m.position.sub(c.ray.origin).applyQuaternion(_q).add(c.ray.origin);
          m.quaternion.premultiply(_q);
        }
        if (y && modelHands.length === 1) {
          // pushed away (up) or reeled in (down) along the ray, faster the further off it is
          const dist = c.position.distanceTo(m.position);
          m.position.addScaledVector(c.ray.direction, Math.max(-y * PUSH_RATE * Math.max(dist, PUSH_MIN_M) * dt, -dist));
        }
        continue;
      }
      if (g.target !== 'panel' || !groupOf(g.key)) continue;
      // a panel: its pose in the hand, and the point it's held by, both shift in the grip's space
      _gripInverse.copy(c.grip).invert();
      _axis.copy(c.ray.direction).transformDirection(_gripInverse);
      if (y) {
        const dist = g.point.length();
        const u = _axis.clone().multiplyScalar(Math.max(-y * PUSH_RATE * Math.max(dist, PUSH_MIN_M) * dt, PANEL_REEL_MIN_M - dist));
        g.offset.premultiply(_step.makeTranslation(u.x, u.y, u.z));
        g.point.add(u);
      }
      if (x) {
        const roll = rotationAbout(c.ray.origin.clone().applyMatrix4(_gripInverse), _axis, x * ROLL_RATE * dt);
        g.offset.premultiply(roll);
        g.point.applyMatrix4(roll);
      }
      // easing to its free size about the point it's held by
      g.size += (g.grow - g.size) * (1 - Math.exp(-GROW_RATE * dt));
      const { x: px, y: py, z: pz } = g.point;
      _local.makeTranslation(px, py, pz).multiply(_step.makeScale(g.size, g.size, g.size));
      _local.multiply(_step.makeTranslation(-px, -py, -pz)).multiply(g.offset);
      placeWorld(g.key, _world.multiplyMatrices(c.grip, _local));
      // a tick as it comes within reach of the other controller's dock
      const zone = dockZone(hand, g.key);
      if (zone && zone !== g.zone) buzz(zone, PULSE.zone);
      g.zone = zone;
    }
    if (model.current) applyGrips(model.current, lastModel.current, holdingModel);
    lastModel.current = holdingModel;

    // the panels not held: docked ones stacked on their controller, or at home without controllers
    const gaze = !controllers.left && !controllers.right;
    const rows = { left: [], right: [] };
    for (const key of DOCK_STACK) {
      const g = groupOf(key);
      const d = docks.current[key];
      if (!g) continue;
      if (key === 'view') g.visible = !gaze; // (it leaves XR: only where a controller can press it)
      if (HANDS.some((hand) => grabs.current[hand]?.key === key) || !d.dock) continue;
      if (gaze) {
        if (key === 'menu') {
          g.position.copy(homePose.position);
          g.quaternion.copy(homePose.quaternion);
          g.scale.setScalar(homeScale * textSize);
        }
        d.on = null;
        continue;
      }
      d.on = controllers[d.dock] ? d.dock : otherHand(d.dock);
      if (g.visible) rows[d.on].push(key);
    }
    for (const hand of HANDS) {
      const keys = rows[hand];
      if (!keys.length) continue;
      const sc = DOCK_SCALE * textSize;
      const first = boundsOf(groupOf(keys[0]));
      const x = -(first.button - first.left) * sc;
      let y = 0;
      keys.forEach((key, i) => {
        const g = groupOf(key);
        const b = boundsOf(g);
        // standing on its bottom edge, left edges in line, each a hair in front of the last
        _pos.set(x - b.left * sc, y - b.bottom * sc, i * 0.0005).applyQuaternion(DOCK_TILT).add(DOCK_ANCHOR);
        _world.compose(_pos, DOCK_TILT, _scale.setScalar(sc)).premultiply(controllers[hand].rayMatrix);
        placeWorld(key, _world);
        const fly = docks.current[key].fly;
        if (fly) {
          // on its way from where it was
          const t = Math.min(1, (now - fly.t0) / FLY_S);
          const k = THREE.MathUtils.smootherstep(t, 0, 1);
          g.position.lerpVectors(fly.position, g.position, k);
          g.quaternion.slerpQuaternions(fly.quaternion, g.quaternion, k);
          g.scale.setScalar(THREE.MathUtils.lerp(fly.scale, g.scale.x, k));
          if (t >= 1) docks.current[key].fly = null;
        }
        y += (b.top - b.bottom) * sc + DOCK_GAP;
      });
    }

    // buzz while a controller is inside the model
    const object = model.current;
    if (!object || !isShown(object) || vibration <= 0) return;
    for (const hand of HANDS) {
      const c = controllers[hand];
      if (!c || now < (nextBuzz.current[hand] ?? 0)) continue;
      // checking at the pulse rate, not every frame, keeps the big polytopes cheap
      nextBuzz.current[hand] = now + BUZZ_EVERY;
      if (!poly.containsPoint(object.worldToLocal(_v.copy(c.position)))) continue;
      pulse(c.gamepad, BUZZ_STRENGTH, BUZZ_MS, vibration);
    }
  });

  return holding;
}
