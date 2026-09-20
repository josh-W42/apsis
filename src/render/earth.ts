import * as THREE from 'three';
import { gstime } from 'satellite.js';
import { TERMINATOR_END, TERMINATOR_START } from './day-night.ts';
import { loadEarthTextures } from './textures.ts';

export const EARTH_RADIUS_KM = 6371;
/** Scene units are Earth radii: keeps depth precision sane at GEO distances. */
export const SCENE_SCALE = 1 / EARTH_RADIUS_KM;

export interface EarthHandle {
  group: THREE.Group;
  /** Resolves once the base day/night textures have been applied (or failed). */
  texturesReady: Promise<void>;
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

  /**
   * The globe is a custom shader rather than MeshStandardMaterial because
   * it has to blend two albedo maps by sun angle — day imagery on the lit
   * side, city lights on the dark side — which a standard material cannot
   * express. With a single directional light, doing the lighting by hand
   * costs nothing.
   *
   * uHasDay/uHasNight let it render before the textures land, and stay
   * sensible if they never do: the flat fallback colour is what the globe
   * used before textures existed.
   */
  const globeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uDayMap: { value: null },
      uNightMap: { value: null },
      uHasDay: { value: 0 },
      uHasNight: { value: 0 },
      uSunDirection: { value: sunDirection },
      uFallback: { value: new THREE.Color(0x1b3a5c) },
      uTerminatorStart: { value: TERMINATOR_START },
      uTerminatorEnd: { value: TERMINATOR_END },
      uLightWrap: { value: 0.35 },
      uAmbient: { value: 0.10 },
      uSunGain: { value: 1.15 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vViewPosition;
      void main() {
        vUv = uv;
        // The globe sits inside the tilt and spin groups, so its normals
        // must be taken to world space to compare against an ECI sun.
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uDayMap;
      uniform sampler2D uNightMap;
      uniform float uHasDay;
      uniform float uHasNight;
      uniform vec3 uSunDirection;
      uniform vec3 uFallback;
      uniform float uTerminatorStart;
      uniform float uTerminatorEnd;
      uniform float uLightWrap;
      uniform float uAmbient;
      uniform float uSunGain;

      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vViewPosition;

      void main() {
        vec3 normal = normalize(vWorldNormal);
        vec3 sun = normalize(uSunDirection);
        float sunDot = dot(normal, sun);

        // Mirrors dayFactor() in day-night.ts, which is the tested twin.
        float day = smoothstep(uTerminatorStart, uTerminatorEnd, sunDot);

        vec3 dayColor = mix(uFallback, texture2D(uDayMap, vUv).rgb, uHasDay);
        vec3 nightColor = mix(vec3(0.012, 0.022, 0.038),
                              texture2D(uNightMap, vUv).rgb * 1.6, uHasNight);

        // Two distinct things, previously conflated: the day factor blends
        // between the two maps across the terminator, while Lambert shades
        // the lit surface by incidence. Multiplying by the day factor twice
        // squared the term and crushed the whole globe dark.
        // NOTE: these were first tuned while the sRGB output conversion was
        // missing, which made everything dark. They were pulled back once
        // <colorspace_fragment> was added — do not raise them to fix
        // darkness without checking the colour space first.
        //
        // Wrap lighting rather than raw Lambert. Strict cosine falloff is
        // physically right but reads as a mostly-black globe: at 60 degrees
        // from the sub-solar point you are already at half brightness, and
        // most of a visible disc sits beyond that. Wrapping lifts the
        // mid-angles and softens the terminator, which is what planet
        // renders and real photographs both look like.
        float wrapped = max(0.0, (sunDot + uLightWrap) / (1.0 + uLightWrap));
        vec3 lit = dayColor * (uAmbient + uSunGain * wrapped);
        vec3 color = mix(nightColor, lit, day);

        // Ocean glint. No water mask exists in the NASA set, so derive one
        // from the day map: sea water is strongly blue-dominant where land
        // and cloud are not.
        vec3 albedo = texture2D(uDayMap, vUv).rgb;
        float water = smoothstep(0.02, 0.12, albedo.b - max(albedo.r, albedo.g)) * uHasDay;
        vec3 viewDir = normalize(vViewPosition);
        vec3 halfway = normalize(sun + viewDir);
        float spec = pow(max(dot(normal, halfway), 0.0), 60.0) * water * day;
        color += vec3(0.6, 0.72, 0.85) * spec * 0.55;

        gl_FragColor = vec4(color, 1.0);

        // Textures are decoded to linear because they are tagged sRGB, so
        // the result has to be encoded back for the output framebuffer. A
        // raw ShaderMaterial does not do this for you, and skipping it
        // renders everything dark — midtones worst of all.
        #include <colorspace_fragment>
      }
    `,
  });

  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), globeMaterial);
  tilt.add(globe);

  function applyTexture(texture: THREE.Texture, slot: 'uDayMap' | 'uNightMap') {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    globeMaterial.uniforms[slot]!.value = texture;
    globeMaterial.uniforms[slot === 'uDayMap' ? 'uHasDay' : 'uHasNight']!.value = 1;
  }

  const loader = new THREE.TextureLoader();
  const texturesReady = loadEarthTextures(loader, (hiResDay) => {
    applyTexture(hiResDay, 'uDayMap');
  }).then(({ day, night }) => {
    if (day) applyTexture(day, 'uDayMap');
    if (night) applyTexture(night, 'uNightMap');
    if (!day && !night) {
      console.warn('[render] earth textures unavailable; using flat shading');
    }
  });

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
          #include <colorspace_fragment>
        }
      `,
    }),
  );
  tilt.add(atmosphere);

  // The globe shades itself from uSunDirection, so no scene lights are
  // needed for it. The atmosphere shell is likewise unlit geometry.

  return {
    group,
    texturesReady,
    spinGroup: spin,
    setSunDirection(d) {
      sunDirection.set(d.x, d.y, d.z).normalize();
    },
    setTime(date) {
      // GMST is the angle between the prime meridian and the ECI x-axis.
      // Rotating the globe by it is what makes geography line up with
      // satellites, and what will make ground tracks correct in phase 2.
      spin.rotation.z = gstime(date);
    },
  };
}
