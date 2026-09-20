import * as THREE from 'three';
import type { Frame } from '../propagation/client.ts';
import { SCENE_SCALE } from './earth.ts';
import { bucketIndex, classifyConstellation } from '../catalog/constellation.ts';
import type { CatalogIndexEntry } from '../catalog/types.ts';
import { BUCKET_COLOR_LIST, BUCKET_SIZE_LIST } from '../ui/theme.ts';
import { encodePickId } from './pick-id.ts';

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

export type StarlinkMode = 'show' | 'dim' | 'hide';

/**
 * One bucket index per renderable satellite, in live-index order.
 *
 * Indexed by live index, not catalog index — the render buffers are
 * compacted, and writing this in catalog order would colour the wrong dots.
 */
export function buildBucketAttribute(
  index: CatalogIndexEntry[], liveIndices: Uint32Array,
): Float32Array {
  const out = new Float32Array(liveIndices.length);
  for (let j = 0; j < liveIndices.length; j++) {
    const entry = index[liveIndices[j]!];
    if (!entry) continue;
    out[j] = bucketIndex(
      classifyConstellation(entry.name, entry.apogeeKm, entry.perigeeKm),
    );
  }
  return out;
}

const STARLINK_BUCKET = bucketIndex('starlink');
const MODE_VALUE: Record<StarlinkMode, number> = { show: 0, dim: 1, hide: 2 };

export interface SatellitesHandle {
  points: THREE.Points;
  /** Exposed so the picker can build a parallel material over the same buffers. */
  geometry: THREE.BufferGeometry;
  /** Shared with the picker so interpolation cannot drift between them. */
  uniforms: Record<string, THREE.IUniform>;
  /** Promote the pending frame to current and accept a new pending frame. */
  pushFrame(frame: Frame): void;
  /** Interpolation position between the two held frames, 0..1. */
  setAlpha(alpha: number): void;
  setStarlinkMode(mode: StarlinkMode): void;
  dispose(): void;
}

/**
 * Attribute and uniform declarations shared by the visible material and the
 * picking material.
 */
export const HERMITE_ATTRIBUTES = /* glsl */ `
  attribute vec3 velA;
  attribute vec3 posB;
  attribute vec3 velB;

  uniform float uAlpha;      // 0..1 between the two frames
  uniform float uH;          // frame interval, seconds
  uniform float uScale;      // km -> scene units
  uniform float uPointSize;

  attribute float bucket;
  varying float vBucket;
  uniform float uSizeScale[5];
`;

/**
 * The Hermite position computation, shared verbatim between the visible
 * material and the picking material. Picking against a separately written
 * copy of this would disagree with the screen within a frame at 7.6 km/s
 * and select the wrong satellite.
 *
 * Declares `mv` for the caller to use in gl_PointSize.
 */
export const HERMITE_VERTEX_BODY = /* glsl */ `
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
`;

const vertexShader = /* glsl */ `
  ${HERMITE_ATTRIBUTES}
  void main() {
    vBucket = bucket;
    ${HERMITE_VERTEX_BODY}
    // Attenuate with distance, but keep distant GEO objects visible.
    // The per-bucket scale is how Starlink recedes without going dark.
    float scale = uSizeScale[int(bucket + 0.5)];
    gl_PointSize = clamp(uPointSize / max(-mv.z, 0.001), 1.0, 5.0) * scale;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uPalette[5];
  uniform float uStarlinkMode;    // 0 show, 1 dim, 2 hide
  uniform float uStarlinkBucket;
  varying float vBucket;

  void main() {
    float isStarlink = step(abs(vBucket - uStarlinkBucket), 0.5);
    if (isStarlink > 0.5 && uStarlinkMode > 1.5) discard;

    // Round, soft-edged point.
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = dot(d, d);
    if (r > 0.25) discard;

    vec3 color = uPalette[int(vBucket + 0.5)];
    float alpha = smoothstep(0.25, 0.0, r);
    if (isStarlink > 0.5 && uStarlinkMode > 0.5) alpha *= 0.18;
    gl_FragColor = vec4(color, alpha);
  }
`;

/**
 * Build the satellite point cloud.
 *
 * `position` doubles as the "A" endpoint of the Hermite segment, since
 * three.js requires that attribute anyway.
 */
export function createSatellites(
  liveIndices: Uint32Array, buckets: Float32Array,
): SatellitesHandle {
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

  // Per-point pick id, written once — live indices never change after ready.
  const pickColor = new Float32Array(n * 3);
  for (let j = 0; j < n; j++) {
    const [r, g, b] = encodePickId(j);
    pickColor[j * 3 + 0] = r / 255;
    pickColor[j * 3 + 1] = g / 255;
    pickColor[j * 3 + 2] = b / 255;
  }
  geometry.setAttribute('pickColor', new THREE.BufferAttribute(pickColor, 3));
  geometry.setAttribute('bucket', new THREE.BufferAttribute(buckets, 1));
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
      uPalette: { value: BUCKET_COLOR_LIST.map((hex) => new THREE.Color(hex)) },
      uSizeScale: { value: BUCKET_SIZE_LIST },
      uStarlinkMode: { value: MODE_VALUE.show },
      uStarlinkBucket: { value: STARLINK_BUCKET },
    },
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  let hasFirstFrame = false;

  return {
    points,
    geometry,
    uniforms: material.uniforms,
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
    setStarlinkMode(mode) {
      material.uniforms.uStarlinkMode!.value = MODE_VALUE[mode];
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
