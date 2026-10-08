import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { iconSvg } from './Icon.jsx';
import { useGazeTarget } from './Gaze.jsx';

// The options panel in XR. It draws the same menu model as the windowed
// panel (title, XR status, "Name: Value" buttons, and the shared
// open / collapsed state) onto a canvas, since WebXR can't show page
// elements. Collapsed, it is just the gear button. Controller rays, hand
// pinches and gaze pick a control from where they hit the texture.

const WIDTH_M = 0.44;
const W = 1000; // canvas px
const PAD = 40;
const TITLE_Y = 72;
const LINE_H = 40; // the XR status line
const BUTTON_H = 62;
const GAP = 22;
const ICON = 44;
const ICON_GAP = 28; // between icon and text
const TOGGLE = 72; // collapse arrow size
const GEAR = 250; // the collapsed panel: one gear button about 11 cm across
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

/** Canvas height and the hit rectangles ({ id, x, y, w, h }) for this state. */
function layout(open, items, lines) {
  if (!open) return { height: GEAR, rects: [{ id: MENU_TOGGLE, x: (W - GEAR) / 2, y: 0, w: GEAR, h: GEAR }] };
  const first = TITLE_Y + 34 + lines * LINE_H + 16;
  const rects = [{ id: MENU_TOGGLE, x: PAD, y: TITLE_Y - TOGGLE / 2, w: TOGGLE, h: TOGGLE }];
  items.forEach((item, i) => rects.push({ id: item.id, item, x: PAD, y: first + i * (BUTTON_H + GAP), w: W - 2 * PAD, h: BUTTON_H }));
  return { height: first + items.length * (BUTTON_H + GAP) - GAP + PAD, rects };
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

export function XRMenuPanel({ title, status, items, open, onSelect, ...groupProps }) {
  const mesh = useRef(null);
  const [pointerKey, setPointerKey] = useState(null);
  const [gazeKey, setGazeKey] = useState(null);
  const [iconsLoaded, setIconsLoaded] = useState(0);
  const lines = status ? 1 : 0;
  const { height, rects } = useMemo(() => layout(open, items, lines), [open, items, lines]);

  const canvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = height;
    return c;
  }, [height]);
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
    ctx.clearRect(0, 0, W, height);

    if (!open) {
      // collapsed: only the gear button, like the windowed panel
      const r = rects[0];
      roundRect(ctx, r.x + 4, r.y + 4, r.w - 8, r.h - 8, 44);
      ctx.fillStyle = 'rgba(12, 16, 28, 0.9)';
      ctx.fill();
      drawButtonFrame(ctx, { x: r.x + 24, y: r.y + 24, w: r.w - 48, h: r.h - 48 }, { hot: hovered === MENU_TOGGLE });
      const img = iconImage('gear', redraw);
      const size = r.w * 0.45;
      if (img.complete && img.naturalWidth) ctx.drawImage(img, r.x + (r.w - size) / 2, r.y + (r.h - size) / 2, size, size);
      texture.needsUpdate = true;
      return;
    }

    roundRect(ctx, 4, 4, W - 8, height - 8, 40);
    ctx.fillStyle = 'rgba(12, 16, 28, 0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = `650 46px ${FONT}`;
    centredText(ctx, fit(ctx, title, W - 2 * PAD - TOGGLE - 24), PAD + TOGGLE + 24, TITLE_Y);
    if (status) {
      ctx.fillStyle = 'rgba(232, 236, 246, 0.6)';
      ctx.font = `400 26px ${FONT}`;
      centredText(ctx, fit(ctx, status, W - 2 * PAD), PAD, TITLE_Y + 34 + LINE_H / 2);
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
      const { item } = r;
      drawButtonFrame(ctx, r, { hot: item.id === hovered && !item.disabled, disabled: item.disabled });
      ctx.globalAlpha = item.disabled ? 0.4 : 1;
      const img = iconImage(item.icon, redraw);
      if (img.complete && img.naturalWidth) ctx.drawImage(img, r.x + 18, r.y + (r.h - ICON) / 2, ICON, ICON);
      ctx.fillStyle = '#ffffff';
      ctx.font = `500 34px ${FONT}`;
      const tx = r.x + 18 + ICON + ICON_GAP;
      centredText(ctx, fit(ctx, item.label, r.x + r.w - 18 - tx), tx, r.y + r.h / 2);
      ctx.globalAlpha = 1;
    }
    texture.needsUpdate = true;
  }, [canvas, texture, height, rects, open, title, status, hovered, iconsLoaded]);

  const pick = (hit) => {
    if (!hit?.uv) return null;
    const px = hit.uv.x * W;
    const py = (1 - hit.uv.y) * height;
    const r = rects.find((q) => px >= q.x && px <= q.x + q.w && py >= q.y && py <= q.y + q.h);
    return r && !r.item?.disabled ? r.id : null;
  };
  useGazeTarget(mesh, onSelect, setGazeKey, pick);

  return (
    <group {...groupProps}>
      <mesh
        ref={mesh}
        onPointerMove={(e) => setPointerKey(pick(e))}
        onPointerOut={() => setPointerKey(null)}
        onClick={(e) => {
          const key = pick(e);
          if (key == null) return;
          e.stopPropagation();
          onSelect(key);
        }}
      >
        <planeGeometry args={[WIDTH_M, (WIDTH_M * height) / W]} />
        <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}
