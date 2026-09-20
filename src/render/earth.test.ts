import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { gstime } from 'satellite.js';
import { createEarth } from './earth.ts';

/** The globe mesh is the first Mesh in the group's subtree. */
function globeMesh(group: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | undefined;
  group.traverse((o) => { if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh; });
  if (!found) throw new Error('no mesh in earth group');
  return found;
}

/** World-space direction of a point given in the globe mesh's local frame. */
function worldDir(group: THREE.Object3D, local: THREE.Vector3): THREE.Vector3 {
  group.updateMatrixWorld(true);
  return local.clone().applyMatrix4(globeMesh(group).matrixWorld).normalize();
}

describe('createEarth frame alignment', () => {
  it('puts the geometry pole on ECI +Z, not three.js +Y', () => {
    // SphereGeometry's pole is local +Y. ECI's north pole is +Z. If the tilt
    // is ever dropped, the globe sits 90 degrees out from every orbit — and
    // an untextured sphere looks identical, so only this test catches it.
    const earth = createEarth();
    earth.setTime(new Date('2026-09-19T12:00:00Z'));
    const pole = worldDir(earth.group, new THREE.Vector3(0, 1, 0));
    expect(pole.x).toBeCloseTo(0, 6);
    expect(pole.y).toBeCloseTo(0, 6);
    expect(pole.z).toBeCloseTo(1, 6);
  });

  it('keeps the pole fixed as the earth spins', () => {
    const earth = createEarth();
    const at = (iso: string) => {
      earth.setTime(new Date(iso));
      return worldDir(earth.group, new THREE.Vector3(0, 1, 0));
    };
    const a = at('2026-09-19T00:00:00Z');
    const b = at('2026-09-19T18:00:00Z');
    expect(a.distanceTo(b)).toBeCloseTo(0, 6);
  });

  it('rotates the equator by GMST', () => {
    const earth = createEarth();
    const d = new Date('2026-09-19T12:00:00Z');
    earth.setTime(d);
    const p = worldDir(earth.group, new THREE.Vector3(1, 0, 0));

    // The equatorial reference point must sit at GMST radians from the ECI
    // x-axis, measured in the xy-plane.
    expect(p.z).toBeCloseTo(0, 6);
    const angle = Math.atan2(p.y, p.x);
    const expected = Math.atan2(Math.sin(gstime(d)), Math.cos(gstime(d)));
    expect(Math.cos(angle - expected)).toBeCloseTo(1, 6);
  });

  it('advances the equator roughly 15 degrees per hour', () => {
    const earth = createEarth();
    const at = (iso: string) => {
      earth.setTime(new Date(iso));
      return worldDir(earth.group, new THREE.Vector3(1, 0, 0));
    };
    const a = at('2026-09-19T00:00:00Z');
    const b = at('2026-09-19T01:00:00Z');
    const deg = Math.acos(Math.min(1, a.dot(b))) * (180 / Math.PI);
    expect(deg).toBeGreaterThan(14);
    expect(deg).toBeLessThan(16);
  });
});
