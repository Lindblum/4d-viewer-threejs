// Options menu model shared by the windowed panel (DOM) and the XR panel
// (drawn on a canvas): three groups, Model, Video and Accessibility, each
// opening a list of setting buttons beneath it, each "Name: Value". A
// dropdown opens a list of choices beneath it (a chevron on its right); a
// slider sets a value along its track; the rest toggle when pressed.

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

/** Accessibility → Text Size: a multiplier on the panels' text and icons, 75% to 200% (as in grid-game-threejs). */
export const TEXT_SIZE = Object.freeze({ min: 0.75, max: 2, step: 0.25, default: 1 });
/** Accessibility → Vibration: how strong the controllers' haptics are, 0 (off) to 2 (1: as made; above, every buzz stronger, up to the controller's most). */
export const VIBRATION = Object.freeze({ min: 0, max: 2, step: 0.1, default: 1 });

/** `value` within `spec` ({ min, max, step, default }), snapped to its steps. */
export function snapToSlider(spec, value) {
  const n = Number(value);
  const v = Math.min(spec.max, Math.max(spec.min, Number.isFinite(n) ? n : spec.default));
  return +(Math.round(v / spec.step) * spec.step).toFixed(4);
}

const SLIDE_PREFIX = 'slide:';
/** The id a slider sends to set `value`: "slide:<id>=<value>" (a pointer's press or drag, the gaze's stare). */
export const slideId = (id, value) => `${SLIDE_PREFIX}${id}=${value}`;
/** A "slide:<id>=<value>" id's { id, value }, or null for any other id. */
export function parseSlide(slide) {
  if (!slide?.startsWith(SLIDE_PREFIX)) return null;
  const [id, value] = slide.slice(SLIDE_PREFIX.length).split('=');
  return { id, value: Number(value) };
}

const percent = (v) => `${Math.round(v * 100)}%`;

/**
 * A dropdown: the button shows the current choice, and when it is open
 * (in `state.dropdowns`), lists every choice beneath it. `choices`:
 * [{ value, label, icon?, disabled?, title? }]. Choosing one sends "pick:<id>:<index>".
 */
function dropdown(state, id, choices, current) {
  return {
    open: state.dropdowns.includes(id),
    options: choices.map((choice, i) => ({ ...choice, id: `${PICK_PREFIX}${id}:${i}`, selected: choice.value === current })),
  };
}

/** Every setting in `items`, the ones inside groups included. */
export function settingItems(items) {
  return items.flatMap((item) => (item.group ? item.group.items : [item]));
}

/** The dropdown choice a "pick:<id>:<index>" id names, from `items`: { id, value } or null. */
export function pickedChoice(items, pickId) {
  const [id, index] = pickId.slice(PICK_PREFIX.length).split(':');
  const option = settingItems(items).find((item) => item.id === id)?.dropdown?.options[Number(index)];
  return option && !option.disabled ? { id, value: option.value } : null;
}

/**
 * Items: the groups Model, Video and Accessibility, { id, label, icon, group: { open, items } },
 * which, when open (in `state.groups`), list their settings beneath, indented like
 * a dropdown's choices. Settings: { id, label ("Name: Value", see splitLabel),
 * icon, disabled?, title?, dropdown?, slider? }. `slider`: { min, max, step, value }. `dropdown`: { open, options: [{ id,
 * label, value, selected, icon?, disabled?, title? }] }, drawn with a chevron at the
 * far right and, when open, its options beneath. `env`: { passthroughAvailable,
 * views (available), phone, checking }.
 */
export function menuItems(state, env) {
  const settings = settingsById(state, env);
  const group = (id, label, icon, ids) => ({
    id,
    label,
    icon,
    group: { open: state.groups.includes(id), items: ids.map((setting) => settings[setting]) },
  });
  return [
    group('model', 'Model', 'shape', ['shape', 'faces', 'edges', 'shadow', 'rotate']),
    group('video', 'Video', 'video', ['background', 'view']),
    group('accessibility', 'Accessibility', 'accessibility', ['textSize', 'vibration', 'controllerGuide']),
  ];
}

function settingsById(state, env) {
  const xrMissing = !env.views.some((view) => XR_VIEWS.includes(view));
  const items = [
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
      // every view, the ones this device can't show disabled
      dropdown: dropdown(
        state,
        'view',
        VIEWS.map((view) => {
          const unavailable = !env.views.includes(view);
          return {
            value: view,
            label: VIEW_LABELS[view],
            icon: VIEW_ICONS[view],
            disabled: unavailable,
            title: unavailable ? viewUnavailableReason(view, env) : undefined,
          };
        }),
        state.view,
      ),
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
    {
      id: 'textSize',
      label: `Text Size: ${percent(state.textSize)}`,
      icon: 'textSize',
      slider: { ...TEXT_SIZE, value: state.textSize },
    },
    {
      id: 'vibration',
      label: `Vibration: ${state.vibration > 0 ? percent(state.vibration) : 'Off'}`,
      icon: state.vibration > 0 ? 'vibrationOn' : 'vibrationOff',
      slider: { ...VIBRATION, value: state.vibration },
      title: 'How strongly the XR controllers buzz',
    },
    {
      id: 'controllerGuide',
      label: `Controller Guide: ${state.controllerGuide ? 'On' : 'Off'}`,
      icon: state.controllerGuide ? 'controllerGuideOn' : 'controllerGuideOff',
      title: "In XR, labels beside the controllers' buttons saying what they do",
    },
  ];
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

/** Why this device can't show `view` (see availableViews). */
function viewUnavailableReason(view, env) {
  if (view === 'sbs' || view === 'interlaced') return "A headset's browser can't show the 3D views";
  if (view === 'phoneAR' || view === 'phoneViewer') return 'Needs a phone';
  if (env.phone) return 'Needs a headset';
  return env.checking ? 'Checking for WebXR…' : "WebXR isn't available here. Open the page in a headset browser over HTTPS for XR.";
}

const shapeLabel = (shape) => `${shape.name} ${shape.schlafli}`;

/**
 * Every label the settings can show in this environment, so both panels can
 * size themselves to the widest one and not change width as values change.
 * (The groups' labels are short, so they don't set it; the panels also fit
 * the dropdowns' choices, two to a row.)
 */
export function possibleLabels(env) {
  const labels = new Set();
  const backgrounds = BACKGROUNDS.filter((b) => b !== 'passthrough' || env.passthroughAvailable);
  for (const shape of SHAPES)
    for (const flag of [false, true])
      for (const background of backgrounds)
        for (const view of env.views)
          for (const item of Object.values(settingsById({ shape, showShadow: flag, paused: flag, background, view, faces: 'glow', edges: 'off', dropdowns: [], textSize: 1, vibration: 1, controllerGuide: flag }, env)))
            labels.add(item.label);
  for (const faces of FACE_LOOKS) labels.add(`Faces: ${FACE_LOOK_LABELS[faces]}`);
  for (const edges of EDGE_LOOKS) labels.add(`Edges: ${EDGE_LOOK_LABELS[edges]}`);
  // the sliders' widest values, and Controller Guide both ways
  labels.add(`Text Size: ${percent(TEXT_SIZE.max)}`);
  labels.add(`Vibration: ${percent(VIBRATION.max)}`);
  for (const flag of [false, true]) labels.add(`Controller Guide: ${flag ? 'On' : 'Off'}`);
  return [...labels];
}
