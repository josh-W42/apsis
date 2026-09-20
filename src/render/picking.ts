import * as THREE from 'three';
import { nearestHitInWindow, PICK_RADIUS_CSS } from './pick-window.ts';
import { HERMITE_ATTRIBUTES, HERMITE_VERTEX_BODY, POINT_SIZE_EXPR } from './satellites.ts';

export interface PickerDeps {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  /** The satellite point cloud's geometry — picking renders the same buffers. */
  geometry: THREE.BufferGeometry;
  /** The visible material's uniforms, shared so interpolation stays in step. */
  uniforms: Record<string, THREE.IUniform>;
}

export interface PickerHandle {
  /** CSS pixel coordinates relative to the canvas. Null when nothing is hit. */
  pick(cssX: number, cssY: number): number | null;
  /** Widen or narrow the cursor tolerance — touch needs far more than a mouse. */
  setRadiusCss(radiusCss: number): void;
  dispose(): void;
}

/**
 * GPU colour-ID picking.
 *
 * Renders only the points layer into a 1x1 target at the cursor and reads
 * back one pixel. Exact at any density with no spatial index to rebuild as
 * 16,577 objects move.
 *
 * The picking material shares the visible material's uniform objects, so
 * `uAlpha` is identical for both. That is what guarantees the picked
 * position is the drawn position — at 7.6 km/s a separately interpolated
 * copy would disagree within a single frame.
 */
export function createPicker(deps: PickerDeps): PickerHandle {
  const { renderer, camera, geometry, uniforms } = deps;

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${HERMITE_ATTRIBUTES}
      attribute vec3 pickColor;
      varying vec3 vPickColor;
      void main() {
        vPickColor = pickColor;
        vBucket = bucket;
        ${HERMITE_VERTEX_BODY}
        // Identical to the visible pass — see POINT_SIZE_EXPR. Tolerance
        // comes from the readback window, not from a fatter sprite.
        gl_PointSize = ${POINT_SIZE_EXPR};
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uStarlinkMode;
      uniform float uStarlinkBucket;
      varying vec3 vPickColor;
      varying float vBucket;
      void main() {
        // Hidden satellites must not be pickable. Without this, clicking
        // where an invisible Starlink sits selects it — the same class of
        // bug as picking through the earth.
        if (uStarlinkMode > 1.5 && abs(vBucket - uStarlinkBucket) < 0.5) discard;

        vec2 d = gl_PointCoord - vec2(0.5);
        if (dot(d, d) > 0.25) discard;
        gl_FragColor = vec4(vPickColor, 1.0);
      }
    `,
  });

  const scene = new THREE.Scene();
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);

  // An occluder matching the visible earth.
  //
  // Without it the pick pass contains only points, so depth testing cannot
  // hide the far side and clicking the globe selects an invisible satellite
  // behind it. It renders black, which decodes to "nothing here", so the
  // earth correctly reads as empty space while still writing depth.
  //
  // Scene units are earth radii (points are scaled by SCENE_SCALE), so a
  // unit sphere at the origin matches. A sphere needs no rotation.
  const occluder = new THREE.Mesh(
    new THREE.SphereGeometry(1, 128, 64),   // match the visible earth's tessellation
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  );
  scene.add(occluder);

  // Readback window, sized so the cursor tolerance is PICK_RADIUS_CSS
  // regardless of device pixel ratio. Rebuilt only when the ratio changes.
  let windowSize = 0;
  let radiusCss = PICK_RADIUS_CSS;
  let target: THREE.WebGLRenderTarget | null = null;
  let pixels = new Uint8Array(0);
  const size = new THREE.Vector2();

  function ensureWindow(dpr: number) {
    const wanted = Math.max(1, Math.round(radiusCss * dpr) * 2 + 1);
    if (wanted === windowSize && target) return;
    target?.dispose();
    windowSize = wanted;
    target = new THREE.WebGLRenderTarget(windowSize, windowSize, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
    });
    pixels = new Uint8Array(windowSize * windowSize * 4);
  }

  return {
    pick(cssX, cssY) {
      renderer.getSize(size);
      const dpr = renderer.getPixelRatio();
      const fullW = Math.floor(size.x * dpr);
      const fullH = Math.floor(size.y * dpr);
      const px = Math.floor(cssX * dpr);
      const py = Math.floor(cssY * dpr);
      if (px < 0 || py < 0 || px >= fullW || py >= fullH) return null;

      ensureWindow(dpr);
      const half = (windowSize - 1) / 2;
      const previousTarget = renderer.getRenderTarget();

      // Render the window of device pixels around the cursor by skewing the
      // projection to that sub-rectangle. setViewOffset takes top-left
      // coordinates, which is what CSS gives us.
      //
      // The window — not gl_PointSize — is what provides cursor tolerance.
      // setViewOffset scales positions but leaves point size in framebuffer
      // pixels, so widening the sprite alone would not help.
      camera.setViewOffset(fullW, fullH, px - half, py - half, windowSize, windowSize);
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target!, 0, 0, windowSize, windowSize, pixels);

      camera.clearViewOffset();
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(0x05070d, 1);

      return nearestHitInWindow(pixels, windowSize);
    },
    setRadiusCss(next) {
      radiusCss = next;   // ensureWindow rebuilds the target on the next pick
    },
    dispose() {
      material.dispose();
      occluder.geometry.dispose();
      (occluder.material as THREE.Material).dispose();
      target?.dispose();
    },
  };
}
