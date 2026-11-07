// What each input does here, for Options → Controls (controlsGuide.js draws it) and the
// XR Control Guides (ControllerGuide.jsx labels the controllers with XR_CONTROLS).

/** XR controllers: what each part does, by hand; the XR Control Guides' labels too. */
const GRIP = 'Hold: move the shape, or a menu\nBoth grips: scale, turn\nTap twice: dock / undock\nTap 3 times: menus here';
const TRIGGER = 'Point and press\nShape: next one';
export const XR_CONTROLS = {
  left: { 'xr-standard-trigger': TRIGGER, 'xr-standard-squeeze': GRIP, 'xr-standard-thumbstick': 'Move\nGripping: push / pull, roll' },
  right: { 'xr-standard-trigger': TRIGGER, 'xr-standard-squeeze': GRIP, 'xr-standard-thumbstick': 'Turn\nGripping: push / pull, roll' },
};
/** Each input's controls (see controlsGuide.js): no gamepad controls yet. */
export const CONTROLS = {
  mk: {
    mouse: {
      left: 'Drag: orbit\nClick the shape: the next one',
      middle: 'Drag: zoom',
      wheel: 'Zoom',
      right: 'Drag: pan',
    },
    keys: [
      { keys: ['Space', '/', '→'], action: 'Next shape' },
      { keys: ['←'], action: 'Previous shape' },
      { keys: ['1'], action: 'Show / hide the shape' },
      { keys: ['2'], action: 'Shadow on / off' },
      { keys: ['P'], action: 'Rotate on / off' },
      { keys: ['Enter', '/', 'Esc'], action: 'Options' },
    ],
  },
  pad: null,
  xr: XR_CONTROLS,
};
