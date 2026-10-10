import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useXR } from '@react-three/xr';

// The see-through face looks (Glass, Diamond, Water, Soap, Frosted) are
// costly: three.js draws the scene a second time, per eye, for them to
// refract. While one is showing:
//   - that extra render is drawn at half resolution (a quarter of the pixels);
//     the blurred, bent view through the faces looks the same
//   - frames are paced at about 72 per second instead of the display's
//     fastest, so each has more time. In XR the headset is asked for its
//     lowest refresh rate of at least 72 Hz (72 on Quest); missed frames
//     there show as judder. Outside XR, renders are skipped on displays
//     faster than that (120/144 Hz); at 60 Hz nothing changes.

const SEE_THROUGH_FPS = 72;
const TRANSMISSION_SCALE = 0.5;

/** Paces rendering for the current face look; mount inside the Canvas. */
export function FramePacing({ seeThrough }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const setFrameloop = useThree((s) => s.setFrameloop);
  const session = useXR((s) => s.session);

  useEffect(() => {
    gl.transmissionResolutionScale = seeThrough ? TRANSMISSION_SCALE : 1;
  }, [gl, seeThrough]);

  // XR: the headset's refresh rate
  useEffect(() => {
    const rates = session?.supportedFrameRates;
    if (!session?.updateTargetFrameRate || !rates?.length) return;
    const sorted = [...rates].sort((a, b) => a - b);
    const fastest = sorted[sorted.length - 1];
    const target = seeThrough ? (sorted.find((r) => r >= SEE_THROUGH_FPS - 0.5) ?? fastest) : fastest;
    session.updateTargetFrameRate(target).catch((e) => console.warn('[4d-viewer] frame rate not changed:', e?.message ?? e));
  }, [session, seeThrough]);

  // outside XR: render on demand, asking for at most ~72 frames a second
  useEffect(() => {
    if (!seeThrough || session) return;
    setFrameloop('demand');
    const interval = 1000 / SEE_THROUGH_FPS - 2; // slack, so a 60 Hz display still gets every frame
    let last = -Infinity;
    let frame = requestAnimationFrame(function tick(now) {
      if (now - last >= interval) {
        last = now;
        invalidate();
      }
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      setFrameloop('always');
    };
  }, [seeThrough, session, invalidate, setFrameloop]);

  return null;
}
