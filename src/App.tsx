import { useEffect, useRef } from 'react';
import { sunDirectionEci } from './math/sun.ts';
import { createScene } from './render/scene.ts';

export function App() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    let handle: ReturnType<typeof createScene>;
    try {
      handle = createScene(container);
    } catch (error) {
      container.textContent =
        'This page needs WebGL2, which this browser did not provide.';
      console.error(error);
      return;
    }

    const sync = () => {
      const now = new Date();
      handle.setSunDirection(sunDirectionEci(now));
      handle.setTime(now);
    };
    sync();
    handle.frameSun(sunDirectionEci(new Date()));
    // Earth turns 0.25 deg per minute; a 1 s cadence keeps the terminator
    // and the geography visually continuous.
    const sunTimer = setInterval(sync, 1_000);

    return () => { clearInterval(sunTimer); handle.dispose(); };
  }, []);

  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}
