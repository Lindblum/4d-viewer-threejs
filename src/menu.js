// Options menu model shared by the windowed panel (DOM) and the XR panel
// (drawn on a canvas): one list of buttons, each "Name: Value", that cycle
// their setting when pressed.

import { SHAPES } from './polytopeGeometry.js';
import { FACE_LOOKS, FACE_LOOK_LABELS } from './faceLooks.js';
import { EDGE_LOOKS, EDGE_LOOK_LABELS } from './Edges.jsx';

export const MENU_TITLE = '4D Polytope Viewer';

/** Options → Background, in the order the button cycles through them (passthrough last). */
export const BACKGROUNDS = ['solid', 'skybox', 'passthrough'];
const BACKGROUND_LABELS = { solid: 'Solid', skybox: 'Skybox', passthrough: 'Passthrough (XR Only)' };

/** The Vite + React starter's page colour, used for the Solid background. */
export const SOLID_BACKGROUND = '#242424';

/** The next background after `current`, skipping passthrough where the device can't do it. */
export function nextBackground(current, passthroughAvailable) {
  const choices = BACKGROUNDS.filter((b) => b !== 'passthrough' || passthroughAvailable);
  return choices[(choices.indexOf(current) + 1) % choices.length];
}

/**
 * Options → View, in cycling order. Normal and 3D: SBS are windowed; the rest
 * are XR sessions. Phones get the phone views, headsets the HMD one.
 */
export const VIEWS = ['normal', 'sbs', 'hmd', 'phoneAR', 'phoneViewer'];
export const XR_VIEWS = ['hmd', 'phoneAR', 'phoneViewer'];
const VIEW_LABELS = {
  normal: 'Normal',
  sbs: '3D: SBS',
  hmd: 'XR: HMD Stereo',
  phoneAR: 'XR: Phone AR',
  phoneViewer: 'XR: Phone Viewer',
};
const VIEW_ICONS = { normal: 'monitor', sbs: 'monitorSbs', hmd: 'vr', phoneAR: 'phone', phoneViewer: 'phoneViewer' };

/**
 * The views this device can show. `env`: { phone, headset, xrSupported }.
 * A headset browser's own window can't show side-by-side usefully, so no SBS there.
 */
export function availableViews(env) {
  return VIEWS.filter((view) => {
    if (view === 'sbs') return !env.headset;
    if (view === 'hmd') return !env.phone && env.xrSupported;
    if (view === 'phoneAR' || view === 'phoneViewer') return env.phone;
    return true;
  });
}

/** The view after `current` in `available`. */
export function nextView(current, available) {
  return available[(available.indexOf(current) + 1) % available.length];
}

/**
 * A label's setting name and its value, split at the first ": ". The panels
 * draw the name on the left and the value against the right edge.
 */
export function splitLabel(label) {
  const at = label.indexOf(': ');
  return at < 0 ? { name: label, value: '' } : { name: label.slice(0, at), value: label.slice(at + 2) };
}

/**
 * Items: { id, label ("Name: Value", see splitLabel), icon, disabled?, title? }.
 * `env`: { passthroughAvailable, views (available), checking }.
 */
export function menuItems(state, env) {
  const items = [
    { id: 'shape', label: `Shape: ${state.shape.name} ${state.shape.schlafli}`, icon: 'shape' },
    { id: 'faces', label: `Faces: ${FACE_LOOK_LABELS[state.faces]}`, icon: 'faces' },
    { id: 'edges', label: `Edges: ${EDGE_LOOK_LABELS[state.edges]}`, icon: 'edges' },
    { id: 'shadow', label: `2D Shadow: ${state.showShadow ? 'On' : 'Off'}`, icon: state.showShadow ? 'on' : 'off' },
    { id: 'rotate', label: `Rotate: ${state.paused ? 'Off' : 'On'}`, icon: state.paused ? 'pause' : 'rotate' },
    {
      id: 'background',
      label: `Background: ${BACKGROUND_LABELS[state.background]}`,
      icon: state.background,
      title: env.passthroughAvailable ? undefined : 'Passthrough needs an XR headset or a phone camera',
    },
  ];
  const xrMissing = !env.views.some((view) => XR_VIEWS.includes(view));
  items.push({
    id: 'view',
    label: `View Mode: ${VIEW_LABELS[state.view]}`,
    icon: VIEW_ICONS[state.view],
    // SBS needs no XR, so the button works while XR support is still being checked
    disabled: env.views.length < 2,
    title: xrMissing && !env.checking ? "WebXR isn't available here. Open the page in a headset browser over HTTPS for XR." : undefined,
  });
  return items;
}

/**
 * Every label the buttons can show in this environment, so both panels can
 * size themselves to the widest one and not change width as values change.
 */
export function possibleLabels(env) {
  const labels = new Set();
  const backgrounds = BACKGROUNDS.filter((b) => b !== 'passthrough' || env.passthroughAvailable);
  for (const shape of SHAPES)
    for (const flag of [false, true])
      for (const background of backgrounds)
        for (const view of env.views)
          for (const item of menuItems({ shape, showShadow: flag, paused: flag, background, view, faces: 'glow', edges: 'off' }, env))
            labels.add(item.label);
  for (const faces of FACE_LOOKS) labels.add(`Faces: ${FACE_LOOK_LABELS[faces]}`);
  for (const edges of EDGE_LOOKS) labels.add(`Edges: ${EDGE_LOOK_LABELS[edges]}`);
  return [...labels];
}
