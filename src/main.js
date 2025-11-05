// main.js (type="module")
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ----- Gyro overlay (unchanged from yours) -----
const overlayEl = document.getElementById('sensorOverlay');
const permBtn = document.getElementById('sensorPermissionBtn');

const data = {
  orientation: { alpha: null, beta: null, gamma: null, absolute: null },
  motion: {
    acc: { x: null, y: null, z: null },
    accG: { x: null, y: null, z: null },
    rot: { alpha: null, beta: null, gamma: null },
    interval: null
  }
};

const fmt = (v, d = 2) => (v === null || v === undefined ? '—' : Number(v).toFixed(d));
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

// ----- Three.js scene -----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(20, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(0, 0, 14);

// keep this as the NEUTRAL camera orientation (phone upright)
const baseQuat = camera.quaternion.clone();
let targetQuat = baseQuat.clone();

// Gyro → camera rotation config
const gyroConfig = {
  // Max camera rotation (clamps)
  maxPitchDeg: 10,   // up/down (X)
  maxYawDeg: 10,     // left/right (Y)
  // How much physical tilt maps to the max camera rotation
  pitchTiltRangeDeg: 30, // Δbeta needed to hit maxPitchDeg
  yawTiltRangeDeg: 30,   // Δgamma needed to hit maxYawDeg
  smoothing: 0.15        // 0..1 slerp factor per frame
};

let haveBaseline = false;
let beta0 = 0;   // neutral beta (front-back tilt)
let gamma0 = 0;  // neutral gamma (left-right tilt)

// Compute target camera quaternion from device tilt deltas
function updateTargetFromTilt(beta, gamma) {
  const { maxPitchDeg, maxYawDeg, pitchTiltRangeDeg, yawTiltRangeDeg } = gyroConfig;

  const dBeta = beta - beta0;   // front-back tilt delta
  const dGamma = gamma - gamma0; // left-right tilt delta

  // map physical tilt to camera rotation, clamp, convert to radians
  const pitchDeg = THREE.MathUtils.clamp((dBeta / pitchTiltRangeDeg) * maxPitchDeg, -maxPitchDeg, maxPitchDeg);
  const yawDeg   = THREE.MathUtils.clamp((dGamma / yawTiltRangeDeg) * maxYawDeg, -maxYawDeg, maxYawDeg);
  const pitch = THREE.MathUtils.degToRad(pitchDeg);
  const yaw   = THREE.MathUtils.degToRad(yawDeg);

  // Only rotate around X (pitch) then Y (yaw), relative to the neutral camera pose
  const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

  targetQuat.copy(baseQuat).multiply(qy).multiply(qx);
}

// Orientation listener: establish baseline then update target
function onOrientation(e) {
  data.orientation.alpha = e.alpha;
  data.orientation.beta = e.beta;
  data.orientation.gamma = e.gamma;
  data.orientation.absolute = e.absolute;

  if (!haveBaseline && e.beta != null && e.gamma != null) {
    // When phone is upright & facing you, capture neutral offsets
    beta0 = e.beta;
    gamma0 = e.gamma;
    haveBaseline = true;
  }
  if (haveBaseline) updateTargetFromTilt(e.beta ?? 0, e.gamma ?? 0);

  renderOverlay();
}

// iOS permission
async function ensurePermissionsIfNeeded() {
  const isiOS13Plus =
    typeof DeviceMotionEvent !== 'undefined' &&
    typeof DeviceMotionEvent.requestPermission === 'function';

  if (!isiOS13Plus) {
    attachSensors();
    return;
  }

  permBtn.style.display = 'inline-block';
  permBtn.addEventListener('click', async () => {
    try {
      const pm = await DeviceMotionEvent.requestPermission();
      const po = typeof DeviceOrientationEvent?.requestPermission === 'function'
        ? await DeviceOrientationEvent.requestPermission()
        : 'granted';

      if (pm === 'granted' && po === 'granted') {
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

// Must be served over HTTPS (or localhost)
ensurePermissionsIfNeeded();

// ----- Renderer & lights -----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.style.margin = '0';
document.body.appendChild(renderer.domElement);

// Shadow-casting light
const light = new THREE.DirectionalLight(0xffffff, 3.0);
light.position.set(-0.5, 0.5, 7);
light.castShadow = true;
light.shadow.mapSize.set(2048, 2048);
light.shadow.bias = -0.0005;
light.shadow.normalBias = 0.02;
scene.add(light);

scene.add(new THREE.AmbientLight(0xffffff, 1));

// ----- Model -----
const loader = new GLTFLoader();
loader.load(
  '/models/scene.glb',
  (gltf) => {
    const root = gltf.scene || gltf.scenes[0];
    root.traverse((obj) => {
      if (obj.isMesh || obj.isSkinnedMesh || obj.isInstancedMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    root.scale.set(1.5, 1.5, 1.5);
    root.position.set(0, 0, 0.5);
    scene.add(root);
  },
  undefined,
  (err) => console.error('Failed to load GLB:', err)
);

// ----- Resize -----
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ----- Animate -----
const tmpQuat = new THREE.Quaternion();
function animate() {
  // Smoothly slerp camera towards target quaternion
  camera.quaternion.slerp(targetQuat, gyroConfig.smoothing);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

// ----- (Optional) tweak API in console -----
// window.gyroConfig = gyroConfig; // e.g., gyroConfig.maxYawDeg = 20;
