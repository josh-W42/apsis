import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createEarth } from './earth.ts';

export interface SceneHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  /** Earth-fixed frame (rotates with GMST) — parent ground tracks here. */
  spinGroup: THREE.Group;
  /**
   * Move the orbit target to a scene-space point, carrying the camera with
   * it so the viewing offset — and therefore the user's chosen angle and
   * zoom — is preserved. Null re-centres on the earth.
   */
  setFollowTarget(point: { x: number; y: number; z: number } | null): void;
  setSunDirection(d: { x: number; y: number; z: number }): void;
  setTime(date: Date): void;
  /** Place the camera so the globe opens on a lit view with a visible terminator. */
  frameSun(sun: { x: number; y: number; z: number }): void;
  onFrame(callback: (dtMs: number) => void): void;
  dispose(): void;
}

export function createScene(container: HTMLElement): SceneHandle {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    45, container.clientWidth / container.clientHeight, 0.01, 1000,
  );
  // ECI has +Z as north, so the camera's up vector must too, or orbiting
  // tumbles around the wrong axis.
  camera.up.set(0, 0, 1);
  camera.position.set(3.2, 0, 1.2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setClearColor(0x05070d, 1);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.15;
  controls.maxDistance = 60;

  const earth = createEarth();
  scene.add(earth.group);

  const callbacks: ((dtMs: number) => void)[] = [];
  let last = performance.now();
  let running = true;

  const loop = () => {
    if (!running) return;
    requestAnimationFrame(loop);
    const now = performance.now();
    const dtMs = now - last;
    last = now;
    for (const cb of callbacks) cb(dtMs);
    controls.update();
    renderer.render(scene, camera);
  };
  requestAnimationFrame(loop);

  const onResize = () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener('resize', onResize);

  // A lost context leaves a frozen canvas unless it is explicitly restored.
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    console.warn('[render] WebGL context lost');
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    console.warn('[render] WebGL context restored');
  });

  const followTarget = new THREE.Vector3();
  const offset = new THREE.Vector3();

  return {
    scene, camera, renderer,
    canvas: renderer.domElement,
    setFollowTarget(point) {
      // Translate target and camera together. Assigning only the target
      // would swing the camera round to face the satellite and fight the
      // user's own orbiting; moving both keeps their angle and distance.
      followTarget.set(point?.x ?? 0, point?.y ?? 0, point?.z ?? 0);
      offset.copy(camera.position).sub(controls.target);
      controls.target.copy(followTarget);
      camera.position.copy(followTarget).add(offset);
      controls.update();
    },
    spinGroup: earth.spinGroup,
    setSunDirection: earth.setSunDirection,
    setTime: earth.setTime,
    frameSun(sun) {
      // The sun moves through the year, so a fixed camera would sometimes
      // open on the night side — a black disc. Offsetting from the current
      // sun direction instead always yields a lit globe, and the 35 degree
      // swing keeps the terminator in frame rather than showing flat noon.
      const dir = new THREE.Vector3(sun.x, sun.y, sun.z).normalize();
      const swing = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(35),
      );
      camera.position.copy(dir).applyQuaternion(swing).multiplyScalar(3.4);
      camera.position.z += 0.9;
      camera.lookAt(0, 0, 0);
      controls.update();
    },
    onFrame(callback) { callbacks.push(callback); },
    dispose() {
      running = false;
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
