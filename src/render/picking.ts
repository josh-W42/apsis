import * as THREE from 'three';
import { decodePickId } from './pick-id.ts';
import { HERMITE_ATTRIBUTES, HERMITE_VERTEX_BODY } from './satellites.ts';

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
        ${HERMITE_VERTEX_BODY}
        // Slightly larger than the visible point so thin targets stay clickable.
        gl_PointSize = clamp(uPointSize / max(-mv.z, 0.001), 3.0, 8.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vPickColor;
      void main() {
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

  const target = new THREE.WebGLRenderTarget(1, 1, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
  });
  const pixel = new Uint8Array(4);
  const size = new THREE.Vector2();

  return {
    pick(cssX, cssY) {
      renderer.getSize(size);
      const dpr = renderer.getPixelRatio();
      const fullW = Math.floor(size.x * dpr);
      const fullH = Math.floor(size.y * dpr);
      const px = Math.floor(cssX * dpr);
      const py = Math.floor(cssY * dpr);
      if (px < 0 || py < 0 || px >= fullW || py >= fullH) return null;

      const previousTarget = renderer.getRenderTarget();

      // Render just the one device pixel under the cursor by skewing the
      // projection to that sub-rectangle. setViewOffset takes top-left
      // coordinates, which is what CSS gives us.
      camera.setViewOffset(fullW, fullH, px, py, 1, 1);
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel);

      camera.clearViewOffset();
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(0x05070d, 1);

      return decodePickId(pixel[0]!, pixel[1]!, pixel[2]!);
    },
    dispose() {
      material.dispose();
      target.dispose();
    },
  };
}
