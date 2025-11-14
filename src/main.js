// main.js (type="module")
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/* -------------------- Gyro overlay + sensors -------------------- */
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
  if (!overlayEl) return;
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

/* -------------------- Three.js scene -------------------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 0, -2);

// keep this as the NEUTRAL camera orientation (phone upright)
const baseQuat = camera.quaternion.clone();
let targetQuat = baseQuat.clone();

// Gyro → camera rotation config
const gyroConfig = {
  maxPitchDeg: 2,         // camera X (up/down)
  maxYawDeg: 2,           // camera Y (left/right)
  pitchTiltRangeDeg: 15,  // Δbeta to hit maxPitchDeg
  yawTiltRangeDeg: 15,    // Δgamma to hit maxYawDeg
  smoothing: 0.15         // slerp factor per frame
};

let haveBaseline = false;
let beta0 = 0;   // neutral beta
let gamma0 = 0;  // neutral gamma

function updateTargetFromTilt(beta, gamma) {
  const { maxPitchDeg, maxYawDeg, pitchTiltRangeDeg, yawTiltRangeDeg } = gyroConfig;
  const dBeta = beta - beta0;
  const dGamma = gamma - gamma0;

  const pitchDeg = THREE.MathUtils.clamp((dBeta / pitchTiltRangeDeg) * maxPitchDeg, -maxPitchDeg, maxPitchDeg);
  const yawDeg   = THREE.MathUtils.clamp((dGamma / yawTiltRangeDeg) * maxYawDeg, -maxYawDeg, maxYawDeg);
  const pitch = THREE.MathUtils.degToRad(pitchDeg);
  const yaw   = THREE.MathUtils.degToRad(yawDeg);

  const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  targetQuat.copy(baseQuat).multiply(qy).multiply(qx);
}

function onOrientation(e) {
  data.orientation.alpha = e.alpha;
  data.orientation.beta = e.beta;
  data.orientation.gamma = e.gamma;
  data.orientation.absolute = e.absolute;

  if (!haveBaseline && e.beta != null && e.gamma != null) {
    beta0 = e.beta;
    gamma0 = e.gamma;
    haveBaseline = true;
  }
  if (haveBaseline) updateTargetFromTilt(e.beta ?? 0, e.gamma ?? 0);

  renderOverlay();
}

// iOS 13+ permission dance
async function ensurePermissionsIfNeeded() {
  const isiOS13Plus =
    typeof DeviceMotionEvent !== 'undefined' &&
    typeof DeviceMotionEvent.requestPermission === 'function';

  if (!isiOS13Plus) {
    attachSensors();
    return;
  }

  if (permBtn) permBtn.style.display = 'inline-block';
  permBtn?.addEventListener('click', async () => {
    try {
      const pm = await DeviceMotionEvent.requestPermission();
      const po = typeof DeviceOrientationEvent?.requestPermission === 'function'
        ? await DeviceOrientationEvent.requestPermission()
        : 'granted';

      if (pm === 'granted' && po === 'granted') {
        if (permBtn) permBtn.style.display = 'none';
        attachSensors();
      } else {
        if (permBtn) permBtn.textContent = 'Motion Permission Denied';
      }
    } catch (err) {
      if (permBtn) permBtn.textContent = 'Enable Motion Failed';
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

/* -------------------- Renderer & lights -------------------- */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.style.margin = '0';
document.body.appendChild(renderer.domElement);

// --- Cloth "screen" ---
const screenWidth = 0.8;
const screenHeight = 1.2;
const screenGeo = new THREE.PlaneGeometry(screenWidth, screenHeight);

const screenMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  roughness: 0.95,
  metalness: 0.0,
  sheen: 1.0,
  sheenRoughness: 0.9,
  side: THREE.DoubleSide,
});

const screen = new THREE.Mesh(screenGeo, screenMat);
screen.position.z = -0.2;
screen.receiveShadow = true;
scene.add(screen);

scene.add(new THREE.AmbientLight(0xffffff, 1));

// --- Flame + Puppet Group ---
const lightGroup = new THREE.Group();
lightGroup.position.set(0, -0.2, 0);

// --- SpotLight ---
const flame = new THREE.SpotLight(0xffb27a, 6.0, 100.0, THREE.MathUtils.degToRad(30), 2, 2.5);
flame.position.set(0, -0.12, -1);
flame.castShadow = true;
flame.shadow.mapSize.set(2048, 2048);
flame.shadow.bias = -0.0001;
flame.shadow.normalBias = 0.02;

flame.shadow.camera.near = 0.01;
flame.shadow.camera.far = 10;
flame.shadow.camera.fov = 60;
flame.shadow.camera.updateProjectionMatrix();

const flameTarget = new THREE.Object3D();
flameTarget.position.set(0, -0.1, 0);
scene.add(flameTarget);
flame.target = flameTarget;

lightGroup.add(flame);
scene.add(lightGroup);

// Directional fill light
const directionalLight = new THREE.DirectionalLight(0xffffff, 20);
directionalLight.position.set(0, 0.1, -5);
directionalLight.castShadow = true;
scene.add(directionalLight);

/* -------------------- Motion constraints & utilities -------------------- */
const constraints = {
  baseZ: -0.9,
  zMin: -1.18,
  zMax: -0.6,

  ampX: 0.04,
  ampY: 0.04,
  ampZ: 0.0,

  rotX: THREE.MathUtils.degToRad(8),
  rotY: THREE.MathUtils.degToRad(14),
  rotZ: THREE.MathUtils.degToRad(10),

  speed: 0.6,
  sx: 1.0,
  sy: 1.3,
  sz: 0.8,
  rx: 1.1,
  ry: 0.9,
  rz: 1.3,
};

const easeInOutSine = (u) => 0.5 - 0.5 * Math.cos(Math.PI * u);
const randRange = (a, b) => a + Math.random() * (b - a);

/* -------------------- Load scene.glb -------------------- */
const gltfLoader = new GLTFLoader();
gltfLoader.load(
  '/models/scene.glb',
  (gltf) => {
    const root = gltf.scene || gltf.scenes[0];
    root.traverse((obj) => {
      if (obj.isMesh || obj.isSkinnedMesh || obj.isInstancedMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    root.position.set(0, 0, -1.05);
    root.scale.set(0.4, 0.4, 0.4);
    scene.add(root);
  },
  undefined,
  (err) => console.error('Failed to load scene.glb:', err)
);

/* -------------------- Puppets -------------------- */
const texLoader = new THREE.TextureLoader();
const puppets = [];

function makePuppet(textureUrl, phase, xOffset) {
  return new Promise((resolve, reject) => {
    texLoader.load(
      textureUrl,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;

        const aspect = tex.image.width / tex.image.height;
        const puppetH = 0.9;
        const puppetW = puppetH * aspect;
        const puppetGeo = new THREE.PlaneGeometry(puppetW, puppetH);

        const puppetMat = new THREE.MeshStandardMaterial({
          map: tex,
          transparent: true,
          alphaTest: 0.5,
          side: THREE.DoubleSide,
        });

        const p = new THREE.Mesh(puppetGeo, puppetMat);
        p.scale.set(0.1, 0.1, 0.1);
        p.position.set(xOffset, 0.01, constraints.baseZ);
        p.castShadow = true;
        p.userData.phase = phase;

        const stickGeo = new THREE.CylinderGeometry(0.003, 0.003, 5, 12);
        const stickMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.8,
          metalness: 0.1,
        });
        const stick = new THREE.Mesh(stickGeo, stickMat);
        stick.position.set(0, -2.5, 0);
        stick.castShadow = true;
        p.add(stick);

        p.userData.twirl = {
          active: false,
          t: 0,
          dur: 0.5,
          from: 0,
          to: 0,
          nextTime: randRange(1.5, 4.0),
        };

        lightGroup.add(p);
        puppets.push(p);
        resolve(p);
      },
      undefined,
      (err) => reject(err)
    );
  });
}

Promise.all([
  makePuppet('/textures/test.png', 0, -0.02),
  makePuppet('/textures/test1.png', Math.PI, 0.02),
]).then(() => {
  window.shadowPuppet = { constraints, puppets, lightGroup, flame, screen };
}).catch((e) => console.error('Failed to create puppets:', e));

/* -------------------- Animate -------------------- */
function layeredNoise(t, a1=1, a2=0.5, a3=0.25, s1=1.7, s2=2.9, s3=4.7) {
  return a1 * Math.sin(t * s1) + a2 * Math.sin(t * s2 + 1.3) + a3 * Math.sin(t * s3 + 2.7);
}

let tSim = 0;
function animate() {
  tSim += 0.016 * constraints.speed;

  // Light flicker
  const flicker = 0.5 + 0.5 * Math.abs(layeredNoise(tSim * 2.2));
  const warmShift = 0.04 * layeredNoise(tSim * 1.3);
  const sizeJitter = 0.15 * layeredNoise(tSim * 1.8);

  const baseIntensity = 5.0;
  flame.intensity = baseIntensity * (0.65 + 0.35 * flicker);

  const baseColor = new THREE.Color(0xffb27a);
  const altColor  = new THREE.Color(0xffd080);
  flame.color.copy(baseColor).lerp(altColor, 0.5 * (1 + warmShift));

  flame.angle = THREE.MathUtils.degToRad(22 + 6 * (0.5 + 0.5 * sizeJitter));
  flame.penumbra = THREE.MathUtils.clamp(0.5 + 0.4 * sizeJitter, 0.1, 0.9);

  // Puppet motion + twirl
  for (const p of puppets) {
    const ph = p.userData.phase || 0;
    const x = constraints.ampX * Math.sin(tSim * constraints.sx + ph);
    const y = constraints.ampY * Math.cos(tSim * constraints.sy + ph * 0.9);
    const zRaw = constraints.baseZ + constraints.ampZ * Math.sin(tSim * constraints.sz + ph * 1.1);
    const z = THREE.MathUtils.clamp(zRaw, constraints.zMin, constraints.zMax);

    p.position.set(x, -0.05 + y, z);
    p.rotation.x = constraints.rotX * Math.sin(tSim * constraints.rx + ph + Math.PI * 0.25);
    const baseY = constraints.rotY * 0.3 * Math.sin(tSim * constraints.ry + ph);
    p.rotation.z = constraints.rotZ * Math.sin(tSim * constraints.rz + ph + Math.PI * 0.5);

    const tw = p.userData.twirl;
    if (!tw.active) {
      tw.nextTime -= 0.016 * constraints.speed;
      if (tw.nextTime <= 0) {
        tw.active = true;
        tw.t = 0;
        tw.dur = randRange(0.35, 0.8);
        tw.from = p.rotation.y;
        tw.to = p.rotation.y + Math.PI;
      }
    } else {
      tw.t += 0.016 * constraints.speed;
      const u = THREE.MathUtils.clamp(tw.t / tw.dur, 0, 1);
      const k = easeInOutSine(u);
      p.rotation.y = THREE.MathUtils.lerp(tw.from, tw.to, k);
      if (u >= 1) {
        tw.active = false;
        tw.nextTime = randRange(1.2, 4.0);
      }
    }
    p.rotation.y += baseY;
  }

  flame.target.position.copy(screen.position);
  flame.target.updateMatrixWorld();

  // Apply gyro camera rotation
  camera.quaternion.slerp(targetQuat, gyroConfig.smoothing);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

/* -------------------- Resize -------------------- */
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
