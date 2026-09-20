import * as THREE from 'three';
import { gstime } from 'satellite.js';

export const EARTH_RADIUS_KM = 6371;
/** Scene units are Earth radii: keeps depth precision sane at GEO distances. */
export const SCENE_SCALE = 1 / EARTH_RADIUS_KM;

export interface EarthHandle {
  group: THREE.Group;
  /** Rotates with GMST. Ground tracks belong here so they stay over their geography. */
  spinGroup: THREE.Group;
  setSunDirection(d: { x: number; y: number; z: number }): void;
  /** Align the globe's geography to the ECI frame for this instant. */
  setTime(date: Date): void;
}

/**
 * Earth sphere plus an atmospheric limb shell.
 *
 * Ships untextured: lighting alone establishes a correct, moving terminator,
 * and the task is not blocked on sourcing imagery.
 */
export function createEarth(): EarthHandle {
  const group = new THREE.Group();
  const sunDirection = new THREE.Vector3(1, 0, 0);

  // Satellite positions are ECI, where +Z is the north pole. three.js's
  // SphereGeometry puts its poles on +Y, so the mesh must be tilted a quarter
  // turn about X or the globe sits 90 degrees out from every orbit. With an
  // untextured sphere this is invisible — which is exactly why it is fixed
  // here rather than discovered when textures land.
  //
  //   spin (about ECI Z, by GMST)  ->  tilt (poles Y->Z)  ->  meshes
  const spin = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.rotation.x = Math.PI / 2;
  spin.add(tilt);
  group.add(spin);

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(1, 128, 64),
    new THREE.MeshStandardMaterial({ color: 0x1b3a5c, roughness: 0.85, metalness: 0.0 }),
  );
  tilt.add(globe);

  // Back-faced shell for the limb glow: an analytic stand-in for Rayleigh
  // scattering. Fragment intensity rises as the view grazes the surface.
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.025, 128, 64),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uSunDirection: { value: sunDirection } },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vWorld;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vWorld  = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDirection;
        varying vec3 vNormal;
        varying vec3 vWorld;
        void main() {
          float rim = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 3.0);
          float lit = clamp(dot(vWorld, normalize(uSunDirection)) + 0.35, 0.0, 1.0);
          gl_FragColor = vec4(vec3(0.30, 0.55, 1.0) * rim * lit, rim * lit);
        }
      `,
    }),
  );
  tilt.add(atmosphere);

  const sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
  group.add(sunLight);
  group.add(new THREE.AmbientLight(0x2a3550, 0.6));

  return {
    group,
    spinGroup: spin,
    setSunDirection(d) {
      sunDirection.set(d.x, d.y, d.z).normalize();
      sunLight.position.copy(sunDirection).multiplyScalar(10);
    },
    setTime(date) {
      // GMST is the angle between the prime meridian and the ECI x-axis.
      // Rotating the globe by it is what makes geography line up with
      // satellites, and what will make ground tracks correct in phase 2.
      spin.rotation.z = gstime(date);
    },
  };
}
