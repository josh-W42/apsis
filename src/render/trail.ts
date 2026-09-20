import * as THREE from 'three';
import { degreesLat, degreesLong, eciToGeodetic, gstime } from 'satellite.js';
import type { TrailSeries } from '../propagation/core.ts';
import { SCENE_SCALE } from './earth.ts';

export interface TrailHandle {
  set(series: TrailSeries): void;
  clear(): void;
  dispose(): void;
}

const TRAIL_COLOR = 0x8fd6ff;
const TRACK_COLOR = 0x9fe0a8;
/** Lift the ground track clear of the surface so it does not z-fight. */
const TRACK_LIFT = 1.002;
const DEG = Math.PI / 180;

/**
 * Orbit trail and ground track for the selected satellite.
 *
 * The trail is inertial and belongs in the scene. The ground track is
 * geographic and belongs in the spin group, so it stays over the same
 * terrain while the earth turns beneath the orbit.
 */
export function createTrail(
  scene: THREE.Object3D, spinGroup: THREE.Object3D,
): TrailHandle {
  const trailGeometry = new THREE.BufferGeometry();
  const trail = new THREE.Line(
    trailGeometry,
    new THREE.LineBasicMaterial({ color: TRAIL_COLOR, transparent: true, opacity: 0.75 }),
  );
  trail.frustumCulled = false;
  trail.visible = false;
  scene.add(trail);

  const trackGeometry = new THREE.BufferGeometry();
  const track = new THREE.Line(
    trackGeometry,
    new THREE.LineBasicMaterial({ color: TRACK_COLOR, transparent: true, opacity: 0.55 }),
  );
  track.frustumCulled = false;
  track.visible = false;
  spinGroup.add(track);

  return {
    set(series) {
      const n = series.epochMs.length;

      const trailPoints = new Float32Array(n * 3);
      for (let i = 0; i < n * 3; i++) trailPoints[i] = series.samples[i]! * SCENE_SCALE;
      trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPoints, 3));
      trailGeometry.computeBoundingSphere();
      trail.visible = true;

      // Ground track: project each inertial sample to its sub-satellite
      // point using that sample's own GMST, then place it on the sphere in
      // the earth-fixed frame.
      const trackPoints = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const date = new Date(series.epochMs[i]!);
        const geo = eciToGeodetic(
          {
            x: series.samples[i * 3]!,
            y: series.samples[i * 3 + 1]!,
            z: series.samples[i * 3 + 2]!,
          },
          gstime(date),
        );
        const lat = degreesLat(geo.latitude) * DEG;
        const lon = degreesLong(geo.longitude) * DEG;
        // The spin group applies GMST and the tilt group maps the sphere's
        // pole onto +Z, so build the point in that same local frame.
        trackPoints[i * 3 + 0] = TRACK_LIFT * Math.cos(lat) * Math.cos(lon);
        trackPoints[i * 3 + 1] = TRACK_LIFT * Math.cos(lat) * Math.sin(lon);
        trackPoints[i * 3 + 2] = TRACK_LIFT * Math.sin(lat);
      }
      trackGeometry.setAttribute('position', new THREE.BufferAttribute(trackPoints, 3));
      trackGeometry.computeBoundingSphere();
      track.visible = true;
    },
    clear() {
      trail.visible = false;
      track.visible = false;
    },
    dispose() {
      trail.removeFromParent();
      track.removeFromParent();
      trailGeometry.dispose();
      trackGeometry.dispose();
      (trail.material as THREE.Material).dispose();
      (track.material as THREE.Material).dispose();
    },
  };
}
