// main.js (type="module")
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// --- Gyro overlay (DeviceOrientation + DeviceMotion) ---

const overlayEl = document.getElementById('sensorOverlay');
const permBtn = document.getElementById('sensorPermissionBtn');

// Maintain last readings for a clean overlay
const data = {
  orientation: { alpha: null, beta: null, gamma: null, absolute: null },
  motion: {
    acc: { x: null, y: null, z: null },
    accG: { x: null, y: null, z: null },
    rot: { alpha: null, beta: null, gamma: null },
    interval: null
  }
};

// Helper: format numbers nicely
const fmt = (v, d = 2) => (v === null || v === undefined ? '—' : Number(v).toFixed(d));

// Render overlay text
function renderOverlay() {
  const o = data.orientation;
  const m = data.motion;
  overlayEl.textContent =
`orientation:
  alpha (z): ${fmt(o.alpha)}°
  beta  (x): ${fmt(o.beta)}°
  gamma (y): ${fmt(o.gamma)}°
  absolute:  ${o.absolute === null ? '—' : o.absolute}

motion:
  acc (m/s²):      x=${fmt(m.acc.x)}  y=${fmt(m.acc.y)}  z=${fmt(m.acc.z)}
  accG (m/s²):     x=${fmt(m.accG.x)} y=${fmt(m.accG.y)} z=${fmt(m.accG.z)}
  rotRate (°/s):   a=${fmt(m.rot.alpha)} b=${fmt(m.rot.beta)} g=${fmt(m.rot.gamma)}
  interval (ms):   ${fmt(m.interval, 0)}`;
}

// Listeners
function onOrientation(e) {
  data.orientation.alpha = e.alpha;
  data.orientation.beta = e.beta;
  data.orientation.gamma = e.gamma;
  data.orientation.absolute = e.absolute;
  renderOverlay();
}

function onMotion(e) {
  const a = e.acceleration || {};
  const ag = e.accelerationIncludingGravity || {};
  const rr = e.rotationRate || {};

  data.motion.acc.x = a.x; data.motion.acc.y = a.y; data.motion.acc.z = a.z;
  data.motion.accG.x = ag.x; data.motion.accG.y = ag.y; data.motion.accG.z = ag.z;
  data.motion.rot.alpha = rr.alpha; data.motion.rot.beta = rr.beta; data.motion.rot.gamma = rr.gamma;
  data.motion.interval = e.interval;

  renderOverlay();
}

// iOS permission (shown only if needed)
async function ensurePermissionsIfNeeded() {
  const isiOS13Plus =
    typeof DeviceMotionEvent !== 'undefined' &&
    typeof DeviceMotionEvent.requestPermission === 'function';

  if (!isiOS13Plus) {
    attachSensors();
    return;
  }

  // Show button; must be triggered by a user gesture
  permBtn.style.display = 'inline-block';
  permBtn.addEventListener('click', async () => {
    try {
      const pm = await DeviceMotionEvent.requestPermission();
      const po = typeof DeviceOrientationEvent?.requestPermission === 'function'
        ? await DeviceOrientationEvent.requestPermission()
        : 'granted';

      if (pm === 'granted' && (po === 'granted' || po === 'granted')) {
        permBtn.style.display = 'none';
        attachSensors();
      } else {
        permBtn.textContent = 'Motion Permission Denied';
      }
    } catch (err) {
      permBtn.textContent = 'Enable Motion Failed';
      console.error(err);
    }
  }, { once: true });
}

function attachSensors() {
  window.addEventListener('deviceorientation', onOrientation, true);
  window.addEventListener('devicemotion', onMotion, true);
  renderOverlay();
}

// Must be served over HTTPS (or localhost) for sensor APIs on most browsers.
ensurePermissionsIfNeeded();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(0, 0, 4);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

// ✅ enable shadow rendering
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

document.body.style.margin = '0';
document.body.appendChild(renderer.domElement);

// ✅ shadow-casting light
const light = new THREE.DirectionalLight(0xffffff, 3.0);
light.position.set(-0.5, 0.5, 7);
light.castShadow = true;
light.shadow.mapSize.set(2048, 2048);
light.shadow.bias = -0.0005;
light.shadow.normalBias = 0.02;
scene.add(light);

scene.add(new THREE.AmbientLight(0xffffff, 1));

// Load GLB from /public/model/scene.glb → served at /model/scene.glb
const loader = new GLTFLoader();
loader.load(
  '/models/scene.glb',
  (gltf) => {
    const root = gltf.scene || gltf.scenes[0];

    // ✅ every mesh both casts and receives shadows
    root.traverse((obj) => {
      if (obj.isMesh || obj.isSkinnedMesh || obj.isInstancedMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    root.position.set(0, 0, 0.3)
    scene.add(root);
  },
  undefined,
  (err) => console.error('Failed to load GLB:', err)
);

// Resize
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Loop
function animate() {
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
