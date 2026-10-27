import { Fragment, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Canvas } from '@react-three/fiber';
import { XR, createXRStore, useXRSessionModeSupported } from '@react-three/xr';
import Scene from './Scene.jsx';
import Icon from './Icon.jsx';
import { MENU_TOGGLE } from './XRMenuPanel.jsx';
import { phoneARSessionInit } from './PhoneStereo.jsx';
import { CardboardOverlay, canUseCardboard, enterCardboard, exitCardboard } from './Cardboard.jsx';
import { DEFAULT_SHAPE_INDEX, SHAPES, buildPolytope } from './polytopeGeometry.js';
import { pulse } from './grip.js';
import {
  MENU_TITLE,
  PICK_PREFIX,
  TEXT_SIZE,
  VIBRATION,
  splitLabel,
  XR_VIEWS,
  availableViews,
  menuItems,
  parseSlide,
  pickedChoice,
  possibleLabels,
  settingItems,
  slideId,
  snapToSlider,
} from './menu.js';

// How the display settings work:
//   Background (Solid / Skybox / Passthrough): what is behind the model. Changes live.
//   View: picks from the views this device supports (see menu.js):
//     Normal, 3D: SBS (half side-by-side, for 3D TVs) and 3D: Interlaced
//     (alternate rows, for passive 3D monitors) are windowed.
//     The XR views start a session, only from a tap, as browsers require.
//
// XR: HMD Stereo (headsets) starts an AR session where supported (so every
// background, passthrough included, can be switched live), otherwise VR.
// XR: Phone AR / Phone Viewer start one AR session (tracked by ARCore) that
// the app draws as one view, or two lens-corrected eyes for a phone viewer;
// switching between the two is live. Phones without AR get a view steered by
// the motion sensors instead, with the rear camera for passthrough.

// kept as a reference: the store reads it whenever a session starts
const xrOptions = {
  // controllers and hands get ray / touch pointers by default
  frameRate: 'high',
  // headset emulator on localhost during development only
  emulate: import.meta.env.DEV ? 'metaQuest3' : false,
  foveation: 0.5,
};
const store = createXRStore(xrOptions);

/**
 * The phone AR session: the library's defaults plus raw camera access, for
 * passthrough in stereo, and the store's DOM overlay, for the menu in Phone AR.
 */
function enterPhoneAR() {
  xrOptions.customSessionInit = phoneARSessionInit(store.getState().domOverlayRoot);
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
  if (isHeadsetBrowser()) return false;
  return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) && canUseCardboard();
}

/** A headset's own browser (Quest, Pico, Wolvic). */
function isHeadsetBrowser() {
  return /OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent);
}

const wrap = (i, n) => (i + n) % n;
// `list` with `id` added, or taken out if it was there
const toggleIn = (id) => (list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

// Accessibility settings are remembered in this browser
const ACCESSIBILITY_KEY = '4d-viewer.accessibility';

function loadAccessibility() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(ACCESSIBILITY_KEY)) ?? {};
  } catch {
    // (storage blocked or unreadable: the defaults)
  }
  return {
    textSize: snapToSlider(TEXT_SIZE, saved.textSize),
    vibration: snapToSlider(VIBRATION, saved.vibration),
    controllerGuide: saved.controllerGuide === true,
  };
}

function useViewerState() {
  const [shapeIndex, setShapeIndex] = useState(DEFAULT_SHAPE_INDEX);
  const [background, setBackground] = useState('skybox'); // 'solid' | 'skybox' | 'passthrough'
  const [screenView, setScreenView] = useState('normal'); // outside XR: 'normal' | 'sbs' | 'interlaced'
  const [phoneStereo, setPhoneStereo] = useState(true); // phone XR: two lens-corrected eyes
  const [handheld, setHandheld] = useState(false); // the motion-sensor view is showing (phones without AR)
  const [showPolytope, setShowPolytope] = useState(true);
  const [showShadow, setShowShadow] = useState(true);
  const [faces, setFaces] = useState('glow'); // see faceLooks.js
  const [edges, setEdges] = useState('off'); // see Edges.jsx
  const [paused, setPaused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(true); // shared by the windowed and XR panels
  const [groups, setGroups] = useState([]); // the groups (Model / Video / Accessibility) whose settings are open, likewise
  const [dropdowns, setDropdowns] = useState([]); // the dropdowns whose lists are open, likewise
  const [accessibility, setAccessibility] = useState(loadAccessibility); // { textSize, vibration, controllerGuide }
  useEffect(() => {
    try {
      localStorage.setItem(ACCESSIBILITY_KEY, JSON.stringify(accessibility));
    } catch {
      // (not remembered)
    }
  }, [accessibility]);
  // Text Size: the windowed panel's text and icons (styles.css --text-scale)
  useEffect(() => {
    document.documentElement.style.setProperty('--text-scale', String(accessibility.textSize));
  }, [accessibility.textSize]);

  const actions = useMemo(
    () => ({
      setShape: setShapeIndex,
      nextShape: () => setShapeIndex((i) => wrap(i + 1, SHAPES.length)),
      prevShape: () => setShapeIndex((i) => wrap(i - 1, SHAPES.length)),
      setBackground,
      setScreenView,
      setPhoneStereo,
      setHandheld,
      togglePolytope: () => setShowPolytope((v) => !v),
      toggleShadow: () => setShowShadow((v) => !v),
      setFaces,
      setEdges,
      togglePause: () => setPaused((v) => !v),
      toggleMenu: () => {
        setMenuOpen((v) => !v);
        setGroups([]);
        setDropdowns([]);
      },
      // each opens and closes on its own, leaving the others as they are
      toggleGroup: (id) => setGroups(toggleIn(id)),
      toggleDropdown: (id) => setDropdowns(toggleIn(id)),
      closeDropdown: (id) => setDropdowns((list) => list.filter((x) => x !== id)),
      setTextSize: (v) => setAccessibility((a) => ({ ...a, textSize: snapToSlider(TEXT_SIZE, v) })),
      setVibration: (v) => setAccessibility((a) => ({ ...a, vibration: snapToSlider(VIBRATION, v) })),
      toggleControllerGuide: () => setAccessibility((a) => ({ ...a, controllerGuide: !a.controllerGuide })),
    }),
    [],
  );

  const state = {
    shapeIndex,
    shape: SHAPES[shapeIndex],
    background,
    passthrough: background === 'passthrough',
    screenView,
    stereo: phoneStereo,
    handheld,
    showPolytope,
    showShadow,
    faces,
    edges,
    paused,
    menuOpen,
    groups,
    dropdowns,
    ...accessibility,
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
// the browser granted the session's DOM overlay (some don't)
const getDomOverlay = () => store.getState().session?.domOverlayState != null;

const describe = (e) => `${e?.name ?? 'Error'}${e?.message ? ` - ${e.message}` : ''}`;

/** "Name: Value": the name on the left, the value against the right edge. */
function Label({ text }) {
  const { name, value } = splitLabel(text);
  return (
    <span className="label">
      <span className="name">{value ? `${name}:` : name}</span>
      {value && <span className="value">{value}</span>}
    </span>
  );
}

function MenuButtons({ items, labels, onSelect }) {
  return (
    <div className="menu-items">
      <MenuList items={items} onSelect={onSelect} />
      {/* invisible, zero-height copies of every possible label and dropdown
          choice, indented like the settings in a group: they set the panel's width */}
      <div className="menu-sizer menu-group" aria-hidden="true">
        {labels.map((label) => (
          <div key={label} className="menu-btn">
            <Icon name="shape" />
            <Label text={label} />
            <Icon name="dropdown" />
          </div>
        ))}
        <div className="menu-options">
          {settingItems(items).flatMap((item) =>
            (item.dropdown?.options ?? []).map((option) => (
              <div key={option.id} className="menu-option">
                {option.icon && <Icon name={option.icon} />}
                <span className="option-label">{option.label}</span>
                <Icon name="check" />
              </div>
            )),
          )}
        </div>
      </div>
    </div>
  );
}

/** Buttons, each followed when open by its group's settings or its dropdown's choices. */
function MenuList({ items, onSelect }) {
  return items.map((item) => {
    const open = (item.group ?? item.dropdown)?.open;
    if (item.slider) {
      // a slider: its button's look, the track beneath the label when there's no room beside it
      const { min, max, step, value } = item.slider;
      return (
        <label key={item.id} className="menu-btn menu-slider" title={item.title}>
          <Icon name={item.icon} />
          <Label text={item.label} />
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            aria-label={splitLabel(item.label).name}
            onChange={(e) => onSelect(slideId(item.id, Number(e.target.value)))}
          />
        </label>
      );
    }
    return (
      <Fragment key={item.id}>
        <button
          className="menu-btn"
          disabled={item.disabled}
          title={item.title}
          aria-expanded={item.group || item.dropdown ? open : undefined}
          onClick={() => onSelect(item.id)}
        >
          <Icon name={item.icon} />
          <Label text={item.label} />
          {(item.group || item.dropdown) && <Icon name={open ? 'dropdownOpen' : 'dropdown'} />}
        </button>
        {item.group?.open && (
          <div className="menu-group">
            <MenuList items={item.group.items} onSelect={onSelect} />
          </div>
        )}
        {item.dropdown?.open && (
          <div className="menu-options" role="listbox">
            {item.dropdown.options.map((option) => (
              <button
                key={option.id}
                className={`menu-option${option.selected ? ' selected' : ''}`}
                role="option"
                aria-selected={option.selected}
                disabled={option.disabled}
                title={option.title}
                onClick={() => onSelect(option.id)}
              >
                {option.icon && <Icon name={option.icon} />}
                <span className="option-label">{option.label}</span>
                {option.selected && <Icon name="check" />}
              </button>
            ))}
          </div>
        )}
      </Fragment>
    );
  });
}

/**
 * Calls `onOutside` for a click or tap outside `ref`'s element while
 * `active`. A drag (orbiting the view) isn't a click, so it leaves the
 * menu open. The click still reaches what was under it.
 */
function useClickOutside(ref, active, onOutside) {
  const latest = useRef(onOutside);
  latest.current = onOutside;
  useEffect(() => {
    if (!active) return;
    let down = null;
    const onDown = (e) => {
      down = ref.current?.contains(e.target) ? null : { x: e.clientX, y: e.clientY };
    };
    const onUp = (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) latest.current();
      down = null;
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
    };
  }, [ref, active]);
}

/**
 * Page elements shown over a phone's AR session, in the store's DOM overlay
 * (the rest of the page is hidden while it runs). A tap on them stays with
 * them: it doesn't also select in the scene.
 */
function XROverlay({ children }) {
  const wrapper = useRef(null);
  useEffect(() => {
    const el = wrapper.current;
    const keep = (e) => e.preventDefault();
    el?.addEventListener('beforexrselect', keep);
    return () => el?.removeEventListener('beforexrselect', keep);
  }, []);
  const root = store.getState().domOverlayRoot;
  return root ? createPortal(<div ref={wrapper}>{children}</div>, root) : null;
}

/**
 * The windowed panel: draws the shared menu model (see XRMenuPanel for XR).
 * In 3D: SBS each eye gets its own copy, squeezed into its half like the
 * scene, so the display stretches both back into one panel at screen depth.
 * 3D: Interlaced needs nothing: a flat panel already lies on both eyes' rows.
 * `resizable`: a handle at the bottom-right corner sets its width and the
 * height it may grow to (double-click it to fit the buttons again).
 */
function Hud({ menu, error, sbs, resizable }) {
  const panel = useRef(null);
  const [size, setSize] = useState(null); // { width, height } dragged to, in px
  useClickOutside(panel, menu.open, () => menu.onSelect(MENU_TOGGLE));
  const panelProps = { menu, error, size: resizable ? size : null, onResize: resizable ? setSize : null };
  if (!sbs) return <HudPanel {...panelProps} panelRef={panel} />;
  return (
    // one element around both copies: a click in either is inside the menu
    <div className="sbs-eyes" ref={panel}>
      {[0, 1].map((eye) => (
        <div key={eye} className="sbs-eye" aria-hidden={eye === 1 || undefined}>
          <HudPanel {...panelProps} stretch={2} />
        </div>
      ))}
    </div>
  );
}

const HUD_MIN_WIDTH = 200;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const HUD_MIN_HEIGHT = 120;

/**
 * The bottom-right corner: dragging it resizes the panel. `stretch`: screen
 * px per panel px across, 2 for a copy squeezed into half the screen.
 */
function ResizeHandle({ stretch = 1, onResize }) {
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const hud = handle.closest('.hud');
    const start = { x: e.clientX, y: e.clientY, width: hud.offsetWidth, height: hud.offsetHeight };
    handle.setPointerCapture(e.pointerId);
    const onMove = (m) =>
      onResize({
        width: clamp(start.width + (m.clientX - start.x) * stretch, HUD_MIN_WIDTH, window.innerWidth - 24),
        height: clamp(start.height + m.clientY - start.y, HUD_MIN_HEIGHT, window.innerHeight - 24),
      });
    const onEnd = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  };
  return <div className="hud-resize" onPointerDown={onPointerDown} onDoubleClick={() => onResize(null)} title="Resize (double-click to fit)" />;
}

function HudPanel({ menu, error, panelRef, size, onResize, stretch }) {
  const toggle = () => menu.onSelect(MENU_TOGGLE);
  // collapsed, the panel keeps only its gear button, which stays where it was
  if (!menu.open) {
    return (
      <aside className="hud collapsed">
        <header>
          <button className="collapse" onClick={toggle} aria-label="Show options" aria-expanded="false" title="Options">
            <Icon name="gear" />
          </button>
        </header>
      </aside>
    );
  }
  return (
    <aside className="hud" ref={panelRef} style={size ? { '--hud-width': `${size.width}px`, '--hud-height': `${size.height}px` } : undefined}>
      <header>
        <button className="collapse" onClick={toggle} aria-label="Hide options" aria-expanded="true" title="Options">
          <Icon name="gear" />
        </button>
        <h1>{menu.title}</h1>
      </header>

      <div className="hud-body">
        {menu.status && <p className="stats">{menu.status}</p>}
        <MenuButtons items={menu.items} labels={menu.labels} onSelect={menu.onSelect} />
        {error && (
          <p className="note error" role="alert">
            {error}
          </p>
        )}
      </div>
      {onResize && <ResizeHandle stretch={stretch} onResize={onResize} />}
    </aside>
  );
}

export default function App() {
  const [viewerState, actions] = useViewerState();
  useKeyboard(actions);
  const poly = useMemo(() => buildPolytope(viewerState.shapeIndex), [viewerState.shapeIndex]);

  const support = useXRSupport();
  const phone = useMemo(isPhone, []);
  const headset = useMemo(isHeadsetBrowser, []);
  const sessionActive = useSyncExternalStore(store.subscribe, getSessionActive);
  const sessionMode = useSyncExternalStore(store.subscribe, getSessionMode);
  const domOverlay = useSyncExternalStore(store.subscribe, getDomOverlay);
  const inXR = sessionActive || viewerState.handheld;
  const xrSupported = Boolean(support.vr || support.ar);
  const views = useMemo(() => availableViews({ phone, headset, xrSupported }), [phone, headset, xrSupported]);
  // derived from the session, so the panel can never disagree with what is showing
  const view = inXR ? (phone ? (viewerState.stereo ? 'phoneViewer' : 'phoneAR') : 'hmd') : viewerState.screenView;
  const state = { ...viewerState, view };
  const passthroughAvailable = Boolean(support.ar) || phone;
  // Phone AR's single view shows the windowed panel over the scene rather than
  // a panel in it: the motion-sensor view is the page itself, an AR session
  // needs its DOM overlay
  const menuOverlay = phone && inXR && !viewerState.stereo && (viewerState.handheld || domOverlay);
  const [error, setError] = useState(null);

  // into an XR view, straight from the tap
  const enterXR = async (stereo) => {
    setError(null);
    let label = 'AR';
    try {
      if (phone && support.ar) await enterPhoneAR();
      else if (phone) {
        enterCardboard({ landscape: stereo }).then((sensors) => {
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
  // out of XR
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
      ? `XR: motion sensors only (no walking), ${state.stereo ? 'stereo' : 'mono'}`
      : phone
        ? `XR: phone AR, tracked, ${state.stereo ? 'stereo' : 'mono'}`
        : `XR: headset ${sessionMode === 'immersive-ar' ? 'AR' : 'VR'}`;

  const items = menuItems(state, { passthroughAvailable, views, phone, checking: !support.checked && !phone });
  const onSelect = (id) => {
    const slide = parseSlide(id);
    if (slide) slideTo(slide.id, slide.value);
    else if (id.startsWith(PICK_PREFIX)) {
      // a choice from an open dropdown's list, which then closes
      const choice = pickedChoice(items, id);
      if (!choice) return;
      actions.closeDropdown(choice.id);
      choose(choice.id, choice.value);
    } else if (id === MENU_TOGGLE) actions.toggleMenu();
    else if (items.find((item) => item.id === id)?.group) actions.toggleGroup(id);
    else if (settingItems(items).find((item) => item.id === id)?.dropdown) actions.toggleDropdown(id);
    else if (id === 'shadow') actions.toggleShadow();
    else if (id === 'rotate') actions.togglePause();
    else if (id === 'controllerGuide') actions.toggleControllerGuide();
  };
  const slideTo = (id, value) => {
    if (id === 'textSize') actions.setTextSize(value);
    else if (id === 'vibration') {
      const v = snapToSlider(VIBRATION, value);
      if (v === state.vibration) return;
      actions.setVibration(v);
      // a buzz at the new strength, to feel it
      for (const source of store.getState().session?.inputSources ?? []) pulse(source.gamepad, 0.6, 60, v);
    }
  };
  const choose = (id, value) => {
    if (id === 'shape') actions.setShape(value);
    else if (id === 'faces') actions.setFaces(value);
    else if (id === 'edges') actions.setEdges(value);
    else if (id === 'background') actions.setBackground(value);
    else if (id === 'view') selectView(value);
  };
  const selectView = (next) => {
    if (next === view) return;
    const toXR = XR_VIEWS.includes(next);
    if (toXR) actions.setPhoneStereo(next === 'phoneViewer');
    if (toXR && !inXR) {
      // if the session fails to start, the panel shows Normal
      actions.setScreenView('normal');
      enterXR(next === 'phoneViewer');
    } else if (!toXR) {
      if (inXR) exitXR();
      actions.setScreenView(next);
    }
  };
  const labels = useMemo(() => possibleLabels({ passthroughAvailable, views }), [passthroughAvailable, views]);
  const menu = {
    title: MENU_TITLE,
    labels,
    status,
    open: state.menuOpen,
    items,
    onSelect,
  };

  return (
    <>
      <Canvas flat dpr={[1, 2]} camera={{ position: [0, 1.9, 1.2], fov: 60, near: 0.05, far: 1000 }}>
        <XR store={store}>
          <Suspense fallback={null}>
            <Scene poly={poly} state={state} actions={actions} menu={menu} menuOverlay={menuOverlay} phone={phone} onExitXR={exitXR} />
          </Suspense>
        </XR>
      </Canvas>
      {state.handheld ? (
        <>
          <CardboardOverlay split={state.stereo} onTap={actions.nextShape} onExit={exitXR} />
          {menuOverlay && <Hud menu={menu} error={error} />}
        </>
      ) : sessionActive ? (
        menuOverlay && (
          <XROverlay>
            <Hud menu={menu} error={error} />
          </XROverlay>
        )
      ) : (
        <Hud menu={menu} error={error} sbs={state.view === 'sbs'} resizable />
      )}
    </>
  );
}
