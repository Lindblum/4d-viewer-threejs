import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { iconSvg } from './Icon.jsx';
import { splitLabel } from './menu.js';
import { useGazeTarget } from './Gaze.jsx';

// The options panel in XR. It draws the same menu model as the windowed
// panel (title, XR status, "Name: Value" buttons, and the shared
// open / collapsed state) onto a canvas, since WebXR can't show page
// elements. Collapsed, it is just the gear button. An open dropdown lists
// its choices beneath it, two to a row. Controller rays, hand pinches and
// gaze pick a control from where they hit the texture.

const W = 1000; // canvas px of the reference width...
const WIDTH_M = 0.44; // ...which is this many metres: sets the text size in XR
const PAD = 40;
const TITLE_Y = 72;
const LINE_H = 40; // the XR status line
const BUTTON_H = 62;
const GAP = 22;
const ICON = 44;
const ICON_GAP = 28; // between icon and text
const TOGGLE = 72; // collapse arrow size
// the collapsed panel: one gear button in the open panel's top-left corner,
// sized like the windowed one (44 px beside a 340 px panel), about 6 cm
const GEAR = Math.round((44 / 340) * W);
const PX_M = WIDTH_M / W; // metres per canvas px
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const MENU_TOGGLE = 'menu:toggle';

const iconImages = new Map();
function iconImage(name, onLoad) {
  if (!iconImages.has(name)) {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(name))}`;
    iconImages.set(name, img);
  }
  const img = iconImages.get(name);
  if (!img.complete) img.addEventListener('load', onLoad, { once: true });
  return img;
}

const BUTTON_FONT = `500 34px ${FONT}`;
const TITLE_FONT = `650 46px ${FONT}`;
const INSET = 18; // icon from the button's left edge, text from its right
const VALUE_GAP = 40; // at least this between a setting's name and its value
const TRAILING = 36; // a dropdown's chevron, at the right edge
// a dropdown's choices: two to a row beneath its button, indented
const OPTION_FONT = `400 30px ${FONT}`;
const OPTION_H = 52;
const OPTION_GAP = 12;
const OPTION_INDENT = 54;
const CHECK = 30;

let measureCtx;
function textWidth(text, font) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/** The open panel's width: the widest possible button, or the title row if wider. */
function labelWidth(label) {
  const { name, value } = splitLabel(label);
  return value ? textWidth(`${name}:`, BUTTON_FONT) + VALUE_GAP + textWidth(value, BUTTON_FONT) : textWidth(name, BUTTON_FONT);
}

function panelWidth(title, labels) {
  const button = INSET + ICON + ICON_GAP + Math.max(0, ...labels.map(labelWidth)) + ICON_GAP + TRAILING + INSET;
  const titleRow = TOGGLE + 24 + textWidth(title, TITLE_FONT);
  return Math.ceil(2 * PAD + Math.max(button, titleRow));
}

/**
 * Canvas size and the hit rectangles for this state: { id, x, y, w, h } plus
 * `item` for a button or `option` for a choice in an open dropdown.
 * `lists`: false lays it out as if every dropdown were closed.
 */
function layout(open, items, lines, panelW, lists = true) {
  if (!open) return { width: GEAR, height: GEAR, rects: [{ id: MENU_TOGGLE, x: 0, y: 0, w: GEAR, h: GEAR }] };
  const rects = [{ id: MENU_TOGGLE, x: PAD, y: TITLE_Y - TOGGLE / 2, w: TOGGLE, h: TOGGLE }];
  const w = panelW - 2 * PAD;
  let y = TITLE_Y + 34 + lines * LINE_H + 16;
  for (const item of items) {
    rects.push({ id: item.id, item, x: PAD, y, w, h: BUTTON_H });
    y += BUTTON_H + GAP;
    if (!lists || !item.dropdown?.open) continue;
    const optionW = (w - OPTION_INDENT - OPTION_GAP) / 2;
    item.dropdown.options.forEach((option, i) => {
      rects.push({
        id: option.id,
        option,
        x: PAD + OPTION_INDENT + (i % 2) * (optionW + OPTION_GAP),
        y: y + Math.floor(i / 2) * (OPTION_H + OPTION_GAP),
        w: optionW,
        h: OPTION_H,
      });
    });
    y += Math.ceil(item.dropdown.options.length / 2) * (OPTION_H + OPTION_GAP) + GAP - OPTION_GAP;
  }
  return { width: panelW, height: y - GAP + PAD, rects };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/** Text vertically centred on its ink at `cy`. */
function centredText(ctx, text, x, cy) {
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(text);
  ctx.fillText(text, x, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
}

function drawButtonFrame(ctx, r, { hot, disabled }) {
  roundRect(ctx, r.x, r.y, r.w, r.h, 18);
  ctx.fillStyle = disabled ? 'rgba(255, 255, 255, 0.04)' : hot ? 'rgba(255, 255, 255, 0.24)' : 'rgba(255, 255, 255, 0.10)';
  ctx.fill();
  ctx.strokeStyle = hot ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = hot ? 4 : 2;
  ctx.stroke();
}

export function XRMenuPanel({ title, status, items, labels, open, onSelect, groupRef, ...groupProps }) {
  const mesh = useRef(null);
  const [pointerKey, setPointerKey] = useState(null);
  const [gazeKey, setGazeKey] = useState(null);
  const [iconsLoaded, setIconsLoaded] = useState(0);
  const lines = status ? 1 : 0;
  const panelW = useMemo(() => panelWidth(title, labels ?? items.map((i) => i.label)), [title, labels, items]);
  const { width, height, rects } = useMemo(() => layout(open, items, lines, panelW), [open, items, lines, panelW]);
  // the open panel's height with its dropdowns closed: the top edge stays put
  // as a list opens below, and collapsed, the gear keeps to the top-left corner
  const openHeight = useMemo(() => layout(true, items, lines, panelW, false).height, [items, lines, panelW]);

  const canvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  }, [width, height]);
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [canvas]);
  useEffect(() => () => texture.dispose(), [texture]);

  const hovered = gazeKey ?? pointerKey;
  useEffect(() => {
    const ctx = canvas.getContext('2d');
    const redraw = () => setIconsLoaded((n) => n + 1);
    ctx.clearRect(0, 0, width, height);

    if (!open) {
      // collapsed: only the gear button, styled like the windowed one
      const r = rects[0];
      const hot = hovered === MENU_TOGGLE;
      roundRect(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, 34);
      ctx.fillStyle = hot ? 'rgba(40, 46, 66, 0.95)' : 'rgba(12, 16, 28, 0.9)';
      ctx.fill();
      ctx.strokeStyle = hot ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = hot ? 4 : 3;
      ctx.stroke();
      const img = iconImage('gear', redraw);
      const size = r.w * (18 / 44);
      if (img.complete && img.naturalWidth) ctx.drawImage(img, r.x + (r.w - size) / 2, r.y + (r.h - size) / 2, size, size);
      texture.needsUpdate = true;
      return;
    }

    roundRect(ctx, 4, 4, width - 8, height - 8, 40);
    ctx.fillStyle = 'rgba(12, 16, 28, 0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = TITLE_FONT;
    centredText(ctx, fit(ctx, title, width - 2 * PAD - TOGGLE - 24), PAD + TOGGLE + 24, TITLE_Y);
    if (status) {
      ctx.fillStyle = 'rgba(232, 236, 246, 0.6)';
      ctx.font = `400 26px ${FONT}`;
      centredText(ctx, fit(ctx, status, width - 2 * PAD), PAD, TITLE_Y + 34 + LINE_H / 2);
    }

    for (const r of rects) {
      if (r.id === MENU_TOGGLE) {
        // collapse arrow, top left
        drawButtonFrame(ctx, r, { hot: hovered === MENU_TOGGLE });
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(r.x + r.w * 0.32, r.y + r.h * 0.58);
        ctx.lineTo(r.x + r.w * 0.5, r.y + r.h * 0.4);
        ctx.lineTo(r.x + r.w * 0.68, r.y + r.h * 0.58);
        ctx.stroke();
        continue;
      }
      if (r.option) {
        // a choice in an open dropdown: smaller, the current one lit and ticked
        const { option } = r;
        roundRect(ctx, r.x, r.y, r.w, r.h, 14);
        const hot = option.id === hovered;
        ctx.fillStyle = hot ? 'rgba(255, 255, 255, 0.24)' : option.selected ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.05)';
        ctx.fill();
        ctx.strokeStyle = hot || option.selected ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = hot ? 4 : 2;
        ctx.stroke();
        ctx.globalAlpha = option.disabled ? 0.4 : 1;
        ctx.fillStyle = '#ffffff';
        ctx.font = OPTION_FONT;
        const room = r.w - 2 * INSET - (option.selected ? CHECK + 10 : 0);
        centredText(ctx, fit(ctx, option.label, room), r.x + INSET, r.y + r.h / 2);
        if (option.selected) {
          const check = iconImage('check', redraw);
          if (check.complete && check.naturalWidth) ctx.drawImage(check, r.x + r.w - INSET - CHECK, r.y + (r.h - CHECK) / 2, CHECK, CHECK);
        }
        ctx.globalAlpha = 1;
        continue;
      }
      const { item } = r;
      drawButtonFrame(ctx, r, { hot: item.id === hovered && !item.disabled, disabled: item.disabled });
      ctx.globalAlpha = item.disabled ? 0.4 : 1;
      const img = iconImage(item.icon, redraw);
      if (img.complete && img.naturalWidth) ctx.drawImage(img, r.x + INSET, r.y + (r.h - ICON) / 2, ICON, ICON);
      ctx.fillStyle = '#ffffff';
      ctx.font = BUTTON_FONT;
      // the name on the left, the value against the right edge, then a dropdown's chevron
      const tx = r.x + INSET + ICON + ICON_GAP;
      let right = r.x + r.w - INSET;
      if (item.dropdown) {
        const icon = iconImage(item.dropdown.open ? 'dropdownOpen' : 'dropdown', redraw);
        if (icon.complete && icon.naturalWidth) ctx.drawImage(icon, right - TRAILING, r.y + (r.h - TRAILING) / 2, TRAILING, TRAILING);
        right -= TRAILING + ICON_GAP;
      }
      const { name, value } = splitLabel(item.label);
      const nameText = value ? `${name}:` : name;
      centredText(ctx, fit(ctx, nameText, right - tx), tx, r.y + r.h / 2);
      if (value) {
        const room = right - tx - ctx.measureText(nameText).width - VALUE_GAP;
        ctx.textAlign = 'right';
        centredText(ctx, fit(ctx, value, room), right, r.y + r.h / 2);
        ctx.textAlign = 'left';
      }
      ctx.globalAlpha = 1;
    }
    texture.needsUpdate = true;
  }, [canvas, texture, width, height, rects, open, title, status, hovered, iconsLoaded]);

  const pick = (hit) => {
    if (!hit?.uv) return null;
    const px = hit.uv.x * width;
    const py = (1 - hit.uv.y) * height;
    const r = rects.find((q) => px >= q.x && px <= q.x + q.w && py >= q.y && py <= q.y + q.h);
    return r && !r.item?.disabled && !r.option?.disabled ? r.id : null;
  };
  useGazeTarget(mesh, onSelect, setGazeKey, pick);

  return (
    <group ref={groupRef} {...groupProps}>
      <mesh
        ref={mesh}
        position={[((width - panelW) / 2) * PX_M, ((openHeight - height) / 2) * PX_M, 0]}
        onPointerMove={(e) => setPointerKey(pick(e))}
        onPointerOut={() => setPointerKey(null)}
        onClick={(e) => {
          const key = pick(e);
          if (key == null) return;
          e.stopPropagation();
          onSelect(key);
        }}
      >
        <planeGeometry args={[width * PX_M, height * PX_M]} />
        <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}
