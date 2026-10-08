# 4D Polytope Viewer

Rotating 3D and 4D regular polytopes (tetrahedron through the 120-cell and 600-cell) floating in a space skybox. You can view them on desktop or in WebXR (VR or passthrough AR).

Built with [three.js](https://threejs.org), React, [@react-three/fiber](https://r3f.docs.pmnd.rs) and [@react-three/xr](https://pmndrs.github.io/xr/). Vite is used for development and builds.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173. A Quest 3 emulator stands in for a headset on localhost
npm run dev:xr     # HTTPS on your LAN, so a real headset or phone can connect
```

## Build a static site

```sh
npm run build      # writes dist/ with relative paths, so any static host or subfolder works
npm run preview
```

## Controls

| Action | Desktop | XR |
| --- | --- | --- |
| Next / previous shape | Click shape, `Space`, `←` `→` | Trigger or pinch on the shape, or the panel |
| Orbit / zoom | Drag / scroll | Walk around, left stick moves, right stick snap-turns |
| Shadow on / off | Panel toggle, `2` | Panel |
| Rotate on / off, hide polytope | Panel toggle, `P`; `1` | Panel (Rotate) |
| Background: Solid / Skybox / Passthrough | Panel button; switches live, in XR too (passthrough shows in XR) | Panel |
| XR Mode: Mono / Stereo | One view, or two lens-corrected eyes for a phone viewer. Switches live, without restarting XR | Headsets always display stereo |
| Hands-free | — | Look at a panel button for 1 s (a ring fills, then it clicks) |
| Leave XR | — | Press **XR: On** on the panel |

## Layout

- `src/polytope.js`: vertex, edge, face and cell data for the 11 regular polytopes
- `src/polytopeGeometry.js`: 4D rotation and the projection into three.js buffers
- `src/Scene.jsx`: skybox, polytope and its shadow, XR panel and locomotion
- `src/App.jsx`: app state, keyboard shortcuts, HUD and the XR session buttons
- `src/PhoneStereo.jsx`: split-screen stereo on a phone's WebXR AR session, plus its camera-feed passthrough
- `src/Cardboard.jsx`: motion-sensor stereo/mono view for phones without AR
- `src/CardboardLens.js`: Cardboard v2 lens model (per-eye field of view and warp) for phone stereo
- `src/Gaze.jsx`: gaze reticle and 1-second dwell-to-click
- `src/menu.js`: the options menu (one list of "Name: Value" buttons) shared by both panels
- `src/XRMenuPanel.jsx`: the options panel in XR, the same layout drawn on a canvas
- `src/Icon.jsx`: Lineicons used in the panel
- `public/img/skybox.jpg`: the equirectangular skybox
