import { Suspense, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Canvas } from '@react-three/fiber';
import { XR, createXRStore, useXRSessionModeSupported } from '@react-three/xr';
import Scene from './Scene.jsx';
import Icon from './Icon.jsx';
import { MENU_TOGGLE } from './XRMenuPanel.jsx';
import { PHONE_AR_SESSION_INIT } from './PhoneStereo.jsx';
import { CardboardOverlay, canUseCardboard, enterCardboard, exitCardboard } from './Cardboard.jsx';
import { DEFAULT_SHAPE_INDEX, SHAPES, buildPolytope } from './polytopeGeometry.js';
import { MENU_TITLE, menuItems, nextBackground } from './menu.js';

// How the three XR settings work:
//   Background (Solid / Skybox / Passthrough): what is behind the model. Changes live.
//   XR (Off / On): enters or leaves XR. The only thing that starts a session,
//     and only from a tap, as browsers require.
//   XR Mode (Mono / Stereo): one view, or two lens-corrected eyes for a phone
//     viewer. Changes live; never restarts a session.
//
// Headsets: XR On starts an AR session where supported (so every background,
// passthrough included, can be switched live), otherwise VR. Headsets always
// display stereo, so XR Mode does not change them.
// Phones: XR On starts one AR session (tracked by ARCore) that the app draws
// as one view or two. Phones without AR get a view steered by the motion
// sensors instead, with the rear camera for passthrough.

// kept as a reference: the store reads it whenever a session starts
const xrOptions = {
  // controllers and hands get ray / touch pointers by default
  frameRate: 'high',
  // headset emulator on localhost during development only
  emulate: import.meta.env.DEV ? 'metaQuest3' : false,
  foveation: 0.5,
};
const store = createXRStore(xrOptions);

/** The phone AR session: the library's defaults plus raw camera access, for passthrough in stereo. */
function enterPhoneAR() {
  xrOptions.customSessionInit = PHONE_AR_SESSION_INIT;
  try {
    return store.enterAR(); // session options are built synchronously here
  } finally {
    xrOptions.customSessionInit = undefined;
  }
}

/**
 * Phones and tablets, whose WebXR shows a single view. Detected by the
 * device rather than by WebXR support: some phone browsers also report VR.
 */
function isPhone() {
  const ua = navigator.userAgent;
  if (/OculusBrowser|Quest|Pico|Wolvic/i.test(ua)) return false;
  return /Android|iPhone|iPad|Mobile/i.test(ua) && canUseCardboard();
}

const wrap = (i, n) => (i + n) % n;

function useViewerState() {
  const [shapeIndex, setShapeIndex] = useState(DEFAULT_SHAPE_INDEX);
  const [background, setBackground] = useState('skybox'); // 'solid' | 'skybox' | 'passthrough'
  const [xrMode, setXrMode] = useState('stereo'); // 'mono' | 'stereo'
  const [handheld, setHandheld] = useState(false); // the motion-sensor view is showing (phones without AR)
  const [showPolytope, setShowPolytope] = useState(true);
  const [showShadow, setShowShadow] = useState(true);
  const [paused, setPaused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(true); // shared by the windowed and XR panels

  const actions = useMemo(
    () => ({
      setShape: setShapeIndex,
      nextShape: () => setShapeIndex((i) => wrap(i + 1, SHAPES.length)),
      prevShape: () => setShapeIndex((i) => wrap(i - 1, SHAPES.length)),
      setBackground,
      toggleXrMode: () => setXrMode((m) => (m === 'stereo' ? 'mono' : 'stereo')),
      setHandheld,
      togglePolytope: () => setShowPolytope((v) => !v),
      toggleShadow: () => setShowShadow((v) => !v),
      togglePause: () => setPaused((v) => !v),
      toggleMenu: () => setMenuOpen((v) => !v),
    }),
    [],
  );

  const state = {
    shapeIndex,
    shape: SHAPES[shapeIndex],
    background,
    passthrough: background === 'passthrough',
    xrMode,
    stereo: xrMode === 'stereo',
    handheld,
    showPolytope,
    showShadow,
    paused,
    menuOpen,
  };
  return [state, actions];
}

function useKeyboard(actions) {
  useEffect(() => {
    const keymap = {
      Space: actions.nextShape,
      ArrowRight: actions.nextShape,
      ArrowLeft: actions.prevShape,
      Digit1: actions.togglePolytope,
      Digit2: actions.toggleShadow,
      KeyP: actions.togglePause,
      Enter: actions.toggleMenu,
      NumpadEnter: actions.toggleMenu,
      Escape: actions.toggleMenu,
    };
    const onKey = (e) => {
      if (e.repeat || e.target.closest?.('input, select, textarea')) return;
      const action = keymap[e.code];
      if (!action) return;
      e.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);
}

function useXRSupport() {
  const vr = useXRSessionModeSupported('immersive-vr');
  const ar = useXRSessionModeSupported('immersive-ar');
  return { vr, ar, checked: vr !== undefined || ar !== undefined };
}

const getSessionActive = () => store.getState().session != null;
const getSessionMode = () => store.getState().mode ?? null;

const describe = (e) => `${e?.name ?? 'Error'}${e?.message ? ` - ${e.message}` : ''}`;

function MenuButtons({ items, onSelect }) {
  return (
    <div className="menu-items">
      {items.map((item) => (
        <button key={item.id} className="menu-btn" disabled={item.disabled} title={item.title} onClick={() => onSelect(item.id)}>
          <Icon name={item.icon} />
          <span className="label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

/** The windowed panel: draws the shared menu model (see XRMenuPanel for XR). */
function Hud({ menu, error }) {
  const toggle = () => menu.onSelect(MENU_TOGGLE);
  if (!menu.open) {
    return (
      <button className="hud-gear" onClick={toggle} aria-label="Show options" title="Options">
        <Icon name="gear" />
      </button>
    );
  }
  return (
    <aside className="hud">
      <header>
        <button className="collapse" onClick={toggle} aria-label="Hide options">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 9l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1>{menu.title}</h1>
      </header>

      <div>
        {menu.status && <p className="stats">{menu.status}</p>}
        <MenuButtons items={menu.items} onSelect={menu.onSelect} />
        {error && (
          <p className="note error" role="alert">
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}

export default function App() {
  const [state, actions] = useViewerState();
  useKeyboard(actions);
  const poly = useMemo(() => buildPolytope(state.shapeIndex), [state.shapeIndex]);

  const support = useXRSupport();
  const phone = useMemo(isPhone, []);
  const sessionActive = useSyncExternalStore(store.subscribe, getSessionActive);
  const sessionMode = useSyncExternalStore(store.subscribe, getSessionMode);
  const inXR = sessionActive || state.handheld;
  const xrAvailable = Boolean(support.vr || support.ar) || phone;
  const xrStatus = inXR ? 'on' : !support.checked ? 'checking' : xrAvailable ? 'off' : 'unavailable';
  const passthroughAvailable = Boolean(support.ar) || phone;
  const [error, setError] = useState(null);

  // XR: On, straight from the tap
  const enterXR = async () => {
    setError(null);
    let label = 'AR';
    try {
      if (phone && support.ar) await enterPhoneAR();
      else if (phone) {
        enterCardboard({ landscape: state.stereo }).then((sensors) => {
          if (!sensors) console.warn('[4d-viewer] motion sensor access denied; the view will not follow the phone');
        });
        actions.setHandheld(true);
      } else if (support.ar) await store.enterAR();
      else {
        label = 'VR';
        await store.enterVR();
      }
    } catch (e) {
      console.error(`[4d-viewer] could not start ${label}`, e);
      setError(`Couldn't start ${label}: ${describe(e)}`);
    }
  };
  // XR: Off
  const exitXR = () => {
    if (state.handheld) {
      exitCardboard();
      actions.setHandheld(false);
    }
    store.getState().session?.end();
  };

  // the motion-sensor view: stereo wants landscape, mono can be held either way
  useEffect(() => {
    if (!state.handheld) return;
    if (state.stereo) screen.orientation?.lock?.('landscape').catch(() => {});
    else screen.orientation?.unlock?.();
  }, [state.handheld, state.stereo]);
  // leaving fullscreen (back gesture, Esc) also leaves the motion-sensor view
  useEffect(() => {
    if (!state.handheld) return;
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) actions.setHandheld(false);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [state.handheld, actions]);

  // which XR path is running, shown on the panels
  const status = !inXR
    ? null
    : state.handheld
      ? `XR: motion sensors only (no walking), ${state.xrMode}`
      : phone
        ? `XR: phone AR, tracked, ${state.xrMode}`
        : `XR: headset ${sessionMode === 'immersive-ar' ? 'AR' : 'VR'}`;

  const onSelect = (id) => {
    if (id === MENU_TOGGLE) actions.toggleMenu();
    else if (id === 'shape') actions.nextShape();
    else if (id === 'shadow') actions.toggleShadow();
    else if (id === 'rotate') actions.togglePause();
    else if (id === 'background') actions.setBackground(nextBackground(state.background, passthroughAvailable));
    else if (id === 'xrmode') actions.toggleXrMode();
    else if (id === 'xr') {
      if (inXR) exitXR();
      else enterXR();
    }
  };
  const menu = {
    title: MENU_TITLE,
    status,
    open: state.menuOpen,
    items: menuItems(state, { passthroughAvailable, xr: xrStatus }),
    onSelect,
  };

  return (
    <>
      <Canvas flat dpr={[1, 2]} camera={{ position: [0, 1.9, 1.2], fov: 60, near: 0.05, far: 1000 }}>
        <XR store={store}>
          <Suspense fallback={null}>
            <Scene poly={poly} state={state} actions={actions} menu={menu} phone={phone} />
          </Suspense>
        </XR>
      </Canvas>
      {state.handheld ? (
        <CardboardOverlay split={state.stereo} onTap={actions.nextShape} onExit={exitXR} />
      ) : (
        <Hud menu={menu} error={error} />
      )}
    </>
  );
}
