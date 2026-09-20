import * as THREE from 'three';
import type { Frame } from '../propagation/client.ts';
import { SCENE_SCALE } from './earth.ts';

/** Tick interval the shader interpolates across, in seconds. */
export const TICK_SECONDS = 1;

/**
 * Compact the full-catalog array down to just the renderable satellites.
 *
 * `source` is packed [x,y,z] per catalog index; `target` is packed [x,y,z]
 * per live index, in `liveIndices` order.
 */
export function gatherLive(
  source: Float32Array, liveIndices: Uint32Array, target: Float32Array,
): void {
  for (let j = 0; j < liveIndices.length; j++) {
    const i = liveIndices[j]!;
    target[j * 3 + 0] = source[i * 3 + 0]!;
    target[j * 3 + 1] = source[i * 3 + 1]!;
    target[j * 3 + 2] = source[i * 3 + 2]!;
  }
}

export interface SatellitesHandle {
  points: THREE.Points;
  /** Promote the pending frame to current and accept a new pending frame. */
  pushFrame(frame: Frame): void;
  /** Interpolation position between the two held frames, 0..1. */
  setAlpha(alpha: number): void;
  dispose(): void;
}

const vertexShader = /* glsl */ `
  attribute vec3 velA;
  attribute vec3 posB;
  attribute vec3 velB;

  uniform float uAlpha;      // 0..1 between the two frames
  uniform float uH;          // frame interval, seconds
  uniform float uScale;      // km -> scene units
  uniform float uPointSize;

  void main() {
    // Cubic Hermite. Mirrors hermite() in src/math/hermite.ts.
    float s  = uAlpha;
    float s2 = s * s;
    float s3 = s2 * s;
    float h00 =  2.0 * s3 - 3.0 * s2 + 1.0;
    float h10 =        s3 - 2.0 * s2 + s;
    float h01 = -2.0 * s3 + 3.0 * s2;
    float h11 =        s3 -       s2;

    vec3 p = h00 * position + h10 * uH * velA
           + h01 * posB     + h11 * uH * velB;

    vec4 mv = modelViewMatrix * vec4(p * uScale, 1.0);
    gl_Position = projectionMatrix * mv;
    // Attenuate with distance, but keep distant GEO objects visible.
    gl_PointSize = clamp(uPointSize / max(-mv.z, 0.001), 1.0, 5.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    // Round, soft-edged point.
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = dot(d, d);
    if (r > 0.25) discard;
    gl_FragColor = vec4(uColor, smoothstep(0.25, 0.0, r));
  }
`;

/**
 * Build the satellite point cloud.
 *
 * `position` doubles as the "A" endpoint of the Hermite segment, since
 * three.js requires that attribute anyway.
 */
export function createSatellites(liveIndices: Uint32Array): SatellitesHandle {
  const n = liveIndices.length;

  const posA = new Float32Array(n * 3);
  const velA = new Float32Array(n * 3);
  const posB = new Float32Array(n * 3);
  const velB = new Float32Array(n * 3);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(posA, 3));
  geometry.setAttribute('velA', new THREE.BufferAttribute(velA, 3));
  geometry.setAttribute('posB', new THREE.BufferAttribute(posB, 3));
  geometry.setAttribute('velB', new THREE.BufferAttribute(velB, 3));
  // Points are scattered worldwide; a sphere of 12 Earth radii covers GEO.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12);

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uAlpha: { value: 0 },
      uH: { value: TICK_SECONDS },
      uScale: { value: SCENE_SCALE },
      uPointSize: { value: 260 },
      uColor: { value: new THREE.Color(0x8fd6ff) },
    },
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  let hasFirstFrame = false;

  return {
    points,
    pushFrame(frame) {
      // Current B becomes the new A, then B takes the incoming frame.
      posA.set(posB);
      velA.set(velB);
      gatherLive(frame.positions, liveIndices, posB);
      gatherLive(frame.velocities, liveIndices, velB);

      // On the very first frame there is no prior state to slide from, so
      // collapse the segment to a point and avoid a visible sweep from zero.
      if (!hasFirstFrame) {
        posA.set(posB);
        velA.set(velB);
        hasFirstFrame = true;
      }

      geometry.getAttribute('position').needsUpdate = true;
      geometry.getAttribute('velA').needsUpdate = true;
      geometry.getAttribute('posB').needsUpdate = true;
      geometry.getAttribute('velB').needsUpdate = true;
    },
    setAlpha(alpha) {
      material.uniforms.uAlpha!.value = Math.min(1, Math.max(0, alpha));
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
