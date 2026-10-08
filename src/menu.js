// Options menu model shared by the windowed panel (DOM) and the XR panel
// (drawn on a canvas): one list of buttons, each "Name: Value", that cycle
// their setting when pressed.

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
 * Items: { id, label, icon, disabled?, title? }.
 * `env`: { passthroughAvailable, xr: 'on' | 'off' | 'unavailable' | 'checking' }.
 */
export function menuItems(state, env) {
  const items = [
    { id: 'shape', label: `Shape: ${state.shape.name} ${state.shape.schlafli}`, icon: 'shape' },
    { id: 'shadow', label: `Shadow: ${state.showShadow ? 'On' : 'Off'}`, icon: state.showShadow ? 'on' : 'off' },
    { id: 'rotate', label: `Rotate: ${state.paused ? 'Off' : 'On'}`, icon: state.paused ? 'pause' : 'rotate' },
    {
      id: 'background',
      label: `Background: ${BACKGROUND_LABELS[state.background]}`,
      icon: state.background,
      title: env.passthroughAvailable ? undefined : 'Passthrough needs an XR headset or a phone camera',
    },
  ];
  const xrLabel = { on: 'On', off: 'Off', unavailable: 'Unavailable', checking: 'Off' }[env.xr];
  items.push({
    id: 'xr',
    label: `XR: ${xrLabel}`,
    icon: env.xr === 'unavailable' ? 'vrOff' : 'vr',
    disabled: env.xr === 'unavailable' || env.xr === 'checking',
    title: env.xr === 'unavailable' ? "WebXR isn't available here. Open the page in a headset browser over HTTPS." : undefined,
  });
  // Mono: one view. Stereo: two lens-corrected eyes for a phone viewer
  // (headsets always display stereo, whichever is chosen).
  items.push({
    id: 'xrmode',
    label: `XR Mode: ${state.stereo ? 'Stereo' : 'Mono'}`,
    icon: state.stereo ? 'stereo' : 'mono',
    disabled: env.xr === 'unavailable',
  });
  return items;
}
