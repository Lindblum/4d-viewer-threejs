// Options menu model shared by the windowed panel (DOM) and the XR panel
// (drawn on a canvas): one list of buttons, each "Name: Value". A dropdown
// opens a list of choices beneath it (a chevron on its right); the rest
// toggle when pressed.

import { SHAPES } from './polytopeGeometry.js';
import { FACE_LOOKS, FACE_LOOK_LABELS } from './faceLooks.js';
import { EDGE_LOOKS, EDGE_LOOK_LABELS } from './Edges.jsx';

export const MENU_TITLE = '4D Polytope Viewer';

/** Options → Background, in list order (passthrough last). */
export const BACKGROUNDS = ['solid', 'skybox', 'passthrough'];
const BACKGROUND_LABELS = { solid: 'Solid', skybox: 'Skybox', passthrough: 'Passthrough (XR Only)' };

/** The Vite + React starter's page colour, used for the Solid background. */
export const SOLID_BACKGROUND = '#242424';

/**
 * Options → View, in list order. Normal and the 3D views are windowed; the
 * rest are XR sessions. Phones get the phone views, headsets the HMD one.
 */
export const VIEWS = ['normal', 'sbs', 'interlaced', 'hmd', 'phoneAR', 'phoneViewer'];
export const XR_VIEWS = ['hmd', 'phoneAR', 'phoneViewer'];
const VIEW_LABELS = {
  normal: 'Normal',
  sbs: '3D: SBS',
  interlaced: '3D: Interlaced',
  hmd: 'XR: HMD Stereo',
  phoneAR: 'XR: Phone AR',
  phoneViewer: 'XR: Phone Viewer',
};
const VIEW_ICONS = { normal: 'monitor', sbs: 'monitorSbs', interlaced: 'monitorInterlaced', hmd: 'vr', phoneAR: 'phone', phoneViewer: 'phoneViewer' };

/**
 * The views this device can show. `env`: { phone, headset, xrSupported }.
 * A headset browser's own window can't show the 3D views usefully, so not there.
 */
export function availableViews(env) {
  return VIEWS.filter((view) => {
    if (view === 'sbs' || view === 'interlaced') return !env.headset;
    if (view === 'hmd') return !env.phone && env.xrSupported;
    if (view === 'phoneAR' || view === 'phoneViewer') return env.phone;
    return true;
  });
}

/**
 * A label's setting name and its value, split at the first ": ". The panels
 * draw the name on the left and the value against the right edge.
 */
export function splitLabel(label) {
  const at = label.indexOf(': ');
  return at < 0 ? { name: label, value: '' } : { name: label.slice(0, at), value: label.slice(at + 2) };
}

export const PICK_PREFIX = 'pick:';

/**
 * A dropdown: the button shows the current choice, and when it is the open
 * one (`state.dropdown`), lists every choice beneath it. `choices`:
 * [{ value, label, disabled?, title? }]. Choosing one sends "pick:<id>:<index>".
 */
function dropdown(state, id, choices, current) {
  return {
    open: state.dropdown === id,
    options: choices.map((choice, i) => ({ ...choice, id: `${PICK_PREFIX}${id}:${i}`, selected: choice.value === current })),
  };
}

/** The dropdown choice a "pick:<id>:<index>" id names, from `items`: { id, value } or null. */
export function pickedChoice(items, pickId) {
  const [id, index] = pickId.slice(PICK_PREFIX.length).split(':');
  const option = items.find((item) => item.id === id)?.dropdown?.options[Number(index)];
  return option && !option.disabled ? { id, value: option.value } : null;
}

/**
 * Items: { id, label ("Name: Value", see splitLabel), icon, disabled?, title?,
 * dropdown? }. `dropdown`: { open, options: [{ id, label, value, selected,
 * disabled?, title? }] }, drawn with a chevron at the far right and, when
 * open, its options beneath. `env`: { passthroughAvailable, views (available), checking }.
 */
export function menuItems(state, env) {
  const xrMissing = !env.views.some((view) => XR_VIEWS.includes(view));
  return [
    {
      id: 'shape',
      label: `Shape: ${shapeLabel(state.shape)}`,
      icon: 'shape',
      dropdown: dropdown(state, 'shape', SHAPES.map((shape, i) => ({ value: i, label: shapeLabel(shape) })), SHAPES.indexOf(state.shape)),
    },
    {
      id: 'background',
      label: `Background: ${BACKGROUND_LABELS[state.background]}`,
      icon: state.background,
      dropdown: dropdown(
        state,
        'background',
        BACKGROUNDS.map((b) => {
          const unavailable = b === 'passthrough' && !env.passthroughAvailable;
          return {
            value: b,
            label: BACKGROUND_LABELS[b],
            disabled: unavailable,
            title: unavailable ? 'Passthrough needs an XR headset or a phone camera' : undefined,
          };
        }),
        state.background,
      ),
    },
    {
      id: 'view',
      label: `View Mode: ${VIEW_LABELS[state.view]}`,
      icon: VIEW_ICONS[state.view],
      dropdown: dropdown(state, 'view', env.views.map((view) => ({ value: view, label: VIEW_LABELS[view] })), state.view),
      // the 3D views need no XR, so the list works while XR support is still being checked
      disabled: env.views.length < 2,
      title: xrMissing && !env.checking ? "WebXR isn't available here. Open the page in a headset browser over HTTPS for XR." : undefined,
    },
    {
      id: 'faces',
      label: `Faces: ${FACE_LOOK_LABELS[state.faces]}`,
      icon: 'faces',
      dropdown: dropdown(state, 'faces', FACE_LOOKS.map((look) => ({ value: look, label: FACE_LOOK_LABELS[look] })), state.faces),
    },
    {
      id: 'edges',
      label: `Edges: ${EDGE_LOOK_LABELS[state.edges]}`,
      icon: 'edges',
      dropdown: dropdown(state, 'edges', EDGE_LOOKS.map((look) => ({ value: look, label: EDGE_LOOK_LABELS[look] })), state.edges),
    },
    { id: 'shadow', label: `2D Shadow: ${state.showShadow ? 'On' : 'Off'}`, icon: state.showShadow ? 'on' : 'off' },
    { id: 'rotate', label: `Rotate: ${state.paused ? 'Off' : 'On'}`, icon: state.paused ? 'pause' : 'rotate' },
  ];
}

const shapeLabel = (shape) => `${shape.name} ${shape.schlafli}`;

/**
 * Every label the buttons can show in this environment, so both panels can
 * size themselves to the widest one and not change width as values change.
 * (The dropdowns' choices sit two to a row in less room, so they don't set it.)
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
