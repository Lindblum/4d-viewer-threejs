import sun from 'lineicons/assets/svgs/regular/sun-1.svg?raw';
import ban from 'lineicons/assets/svgs/regular/ban-2.svg?raw';
import globe from 'lineicons/assets/svgs/regular/globe-1.svg?raw';
import picture from 'lineicons/assets/svgs/regular/gallery.svg?raw';
import eye from 'lineicons/assets/svgs/regular/eye.svg?raw';
import gear from 'lineicons/assets/svgs/regular/gear-1.svg?raw';
import rotate from 'lineicons/assets/svgs/regular/refresh-circle-1-clockwise.svg?raw';
import pause from 'lineicons/assets/svgs/regular/pause.svg?raw';

// Lineicons ship with a fixed fill; recolour to follow the surrounding text
// and size to the font.
const recolour = (svg) =>
  svg
    .replace(/fill="#323544"/g, 'fill="currentColor"')
    .replace(/\swidth="\d+"\sheight="\d+"/, ' width="1.25em" height="1.25em" aria-hidden="true"');

// The free Lineicons set has no VR headset (its "oculus" icon is the brand
// wordmark) and no cube, so these are drawn to match: 24px grid, 1.5px
// rounded strokes.
const headset = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M5.5 7h13A2.5 2.5 0 0 1 21 9.5v5a2.5 2.5 0 0 1-2.5 2.5h-3.13a1.5 1.5 0 0 1-1.3-.76l-.77-1.35a1.5 1.5 0 0 0-2.6 0l-.77 1.35a1.5 1.5 0 0 1-1.3.76H5.5A2.5 2.5 0 0 1 3 14.5v-5A2.5 2.5 0 0 1 5.5 7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
<path d="M3 11.5H1.75M21 11.5h1.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

const cube = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M12 2.75 20.25 7.25v9.5L12 21.25 3.75 16.75v-9.5L12 2.75Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
<path d="M3.75 7.25 12 11.75l8.25-4.5M12 11.75v9.5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

// Solid background: a filled rectangle, as in grid-game-threejs
const solid = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<rect x="2.75" y="5" width="18.5" height="14" rx="1.5" fill="currentColor" fill-opacity="0.35" stroke="currentColor" stroke-width="1.5"/>
</svg>`;

// Stereo: a pair of eyes (one-eye Mono is Lineicons' eye)
const eyes = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M1.75 12C3.5 9 9 9 10.75 12 9 15 3.5 15 1.75 12Z M13.25 12C15 9 20.5 9 22.25 12 20.5 15 15 15 13.25 12Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
<circle cx="6.25" cy="12" r="1.4" fill="currentColor"/>
<circle cx="17.75" cy="12" r="1.4" fill="currentColor"/>
</svg>`;

// XR unavailable: the headset, struck through
const headsetOff = headset.replace(
  '</svg>',
  `<path d="M3.5 3.5 20.5 20.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`,
);

const ICONS = {
  mono: recolour(eye),
  stereo: eyes,
  vr: headset,
  vrOff: headsetOff,
  on: recolour(sun),
  off: recolour(ban),
  solid,
  gear: recolour(gear),
  skybox: recolour(globe),
  passthrough: recolour(picture),
  rotate: recolour(rotate),
  pause: recolour(pause),
  shape: cube,
};

/** An icon as a standalone SVG in a fixed colour, for drawing onto a canvas. */
export function iconSvg(name, color = '#ffffff') {
  return (ICONS[name] ?? '')
    .replace(/currentColor/g, color)
    .replace(/width="1\.25em" height="1\.25em"/, 'width="96" height="96"');
}

export default function Icon({ name }) {
  return <span className="icon" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;
}
