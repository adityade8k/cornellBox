// main.js (type="module")
import * as THREE from 'three';
// import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'; // no longer needed

// -------------------- Gyro overlay & permissions --------------------
const overlayEl = document.getElementById('sensorOverlay');
const permBtn   = document.getElementById('sensorPermissionBtn');

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

function onMotion(e) {
  const a  = e.acceleration || {};
  const ag = e.accelerationIncludingGravity || {};
  const rr = e.rotationRate || {};
  data.motion.acc.x = a.x;   data.motion.acc.y = a.y;   data.motion.acc.z = a.z;
  data.motion.accG.x = ag.x; data.motion.accG.y = ag.y; data.motion.accG.z = ag.z;
  data.motion.rot.alpha = rr.alpha; data.motion.rot.beta = rr.beta; data.motion.rot.gamma = rr.gamma;
  data.motion.interval  = e.interval;
}

// -------------------- Three.js scene --------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
// original camera pose (keep this as base)
camera.position.set(0, 0, -2.2);
camera.lookAt(0, 0, 0);
const baseQuat   = camera.quaternion.clone();
let   targetQuat = baseQuat.clone();

// Gyro → camera rotation mapping (X/Y only, relative to baseQuat)
const gyroConfig = {
  maxPitchDeg:  8,
  maxYawDeg:    8,
  pitchTiltRangeDeg: 20,
  yawTiltRangeDeg:   20,
  smoothing: 0.12
};

let haveBaseline = false;
let beta0 = 0;
let gamma0 = 0;

function updateTargetFromTilt(beta, gamma) {
  const { maxPitchDeg, maxYawDeg, pitchTiltRangeDeg, yawTiltRangeDeg } = gyroConfig;
  const dBeta  = beta  - beta0;
  const dGamma = gamma - gamma0;

  const pitchDeg = -THREE.MathUtils.clamp((dBeta  / pitchTiltRangeDeg) * maxPitchDeg, -maxPitchDeg, maxPitchDeg);
  const yawDeg   = -THREE.MathUtils.clamp((dGamma / yawTiltRangeDeg)   * maxYawDeg,   -maxYawDeg,   maxYawDeg);

  const pitch = THREE.MathUtils.degToRad(pitchDeg);
  const yaw   = THREE.MathUtils.degToRad(yawDeg);

  const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

  targetQuat.copy(baseQuat).multiply(qy).multiply(qx);
}

function onOrientation(e) {
  data.orientation.alpha = e.alpha;
  data.orientation.beta  = e.beta;
  data.orientation.gamma = e.gamma;
  data.orientation.absolute = e.absolute;

  if (!haveBaseline && e.beta != null && e.gamma != null) {
    beta0  = e.beta;
    gamma0 = e.gamma;
    haveBaseline = true;
  }
  if (haveBaseline) {
    updateTargetFromTilt(e.beta ?? 0, e.gamma ?? 0);
  }
}

// iOS 13+ permissions
async function ensurePermissionsIfNeeded() {
  const iOSNeedsPermission = typeof DeviceMotionEvent !== 'undefined'
    && typeof DeviceMotionEvent.requestPermission === 'function';

  if (!iOSNeedsPermission) {
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
}

// Must be served over HTTPS (or localhost)
ensurePermissionsIfNeeded();

// -------------------- Renderer & shadows --------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.style.margin = '0';
document.body.appendChild(renderer.domElement);

// ----- Double-tap / double-click to toggle Fullscreen -----
function isFullscreen() {
  return document.fullscreenElement || document.webkitFullscreenElement;
}
async function requestFs(el) {
  try {
    if (el.requestFullscreen) return await el.requestFullscreen();
    if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen(); // Safari
  } catch (e) { console.warn('Fullscreen request failed:', e); }
}
async function exitFs() {
  try {
    if (document.exitFullscreen) return await document.exitFullscreen();
    if (document.webkitExitFullscreen) return document.webkitExitFullscreen(); // Safari
  } catch (e) { console.warn('Exit fullscreen failed:', e); }
}
async function toggleFullscreen() {
  if (isFullscreen()) await exitFs();
  else await requestFs(document.documentElement);
}
let _lastTap = 0;
renderer.domElement.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - _lastTap < 300) {
    toggleFullscreen();
    e.preventDefault();
  }
  _lastTap = now;
}, { passive: true });
renderer.domElement.addEventListener('dblclick', () => toggleFullscreen());

// -------------------- Scene objects --------------------

// Cloth "screen"
const screenWidth = 0.8;
const screenHeight = 1.2;
const screenGeo = new THREE.PlaneGeometry(screenWidth, screenHeight);

// Temporary material; gets replaced by portal texture below.
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

// Ambient
scene.add(new THREE.AmbientLight(0xffffff, 0.1));

// Flame + Puppet group
const lightGroup = new THREE.Group();
lightGroup.position.set(0, -0.2, 0);

// SpotLight (flame)
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

// --- Quad spotlights (UP / DOWN / LEFT / RIGHT) ---
function createQuadSpotsFrom(baseSpot, offset = 0.6) {
  const group = new THREE.Group();
  const makeSpot = () => {
    const s = new THREE.SpotLight(
      baseSpot.color.clone(),
      0.02,
      baseSpot.distance,
      40,
      baseSpot.penumbra,
      baseSpot.decay
    );
    return s;
  };
  const dirs = {
    up:    new THREE.Vector3(0,  1, 0),
    down:  new THREE.Vector3(0, -1, 0),
    right: new THREE.Vector3(1,  0, 0),
    left:  new THREE.Vector3(-1, 0, 0),
  };
  const targets = {};
  Object.entries(dirs).forEach(([name, v]) => {
    const t = new THREE.Object3D();
    t.position.copy(v).multiplyScalar(offset);
    group.add(t);
    targets[name] = t;
  });
  const upSpot    = makeSpot();
  const downSpot  = makeSpot();
  const leftSpot  = makeSpot();
  const rightSpot = makeSpot();
  upSpot.position.set(0, 0, 0);
  downSpot.position.set(0, 0, 0);
  leftSpot.position.set(0, 0, 0);
  rightSpot.position.set(0, 0, 0);
  upSpot.target    = targets.up;
  downSpot.target  = targets.down;
  leftSpot.target  = targets.left;
  rightSpot.target = targets.right;
  group.add(upSpot, downSpot, leftSpot, rightSpot);
  group.userData = { upSpot, downSpot, leftSpot, rightSpot, targets };
  group.position.set(0, 0, -0.6);
  return group;
}
const quadSpots = createQuadSpotsFrom(flame, /* offset */ 0.8);
scene.add(quadSpots);

// Motion constraints
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

// Utilities
const easeInOutSine = (u) => 0.5 - 0.5 * Math.cos(Math.PI * u);
const randRange = (a, b) => a + Math.random() * (b - a);

// -------------------- PORTAL SETUP (replaces GLTF box) --------------------
const portalTarget = new THREE.WebGLRenderTarget(1024, 1024, { depthBuffer: true });
portalTarget.texture.colorSpace = THREE.SRGBColorSpace;

const portalScene = new THREE.Scene();
portalScene.background = new THREE.Color(0x000000);
portalScene.fog = new THREE.Fog(0x000000, 0.1, 6.0);

// Camera we will customize each frame with a custom frustum
const portalCam = new THREE.PerspectiveCamera(45, 1, camera.near, 10);

// Inside-out room (big box) and some “blobs”
const room = new THREE.Mesh(
  new THREE.BoxGeometry(6, 6, 6),
  new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 1, metalness: 0, side: THREE.BackSide })
);
portalScene.add(room);

const pAmbient = new THREE.AmbientLight(0xffffff, 0.25);
portalScene.add(pAmbient);

const pPoint = new THREE.PointLight(0xff8855, 2.0, 20, 2.0);
pPoint.position.set(1.2, 0.8, 1.4);
portalScene.add(pPoint);

// a few emissive “blobs”
const blobMat = new THREE.MeshStandardMaterial({ color: 0x9a1be1, emissive: 0x6b10a6, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.1 });
const blobMat2 = new THREE.MeshStandardMaterial({ color: 0xe19a1b, emissive: 0xa66b10, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.1 });
const blobMat3 = new THREE.MeshStandardMaterial({ color: 0x1be19a, emissive: 0x10a66b, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.1 });

const blobs = [
  new THREE.Mesh(new THREE.SphereGeometry(0.35, 32, 16), blobMat),
  new THREE.Mesh(new THREE.SphereGeometry(0.3,  32, 16), blobMat2),
  new THREE.Mesh(new THREE.SphereGeometry(0.28, 32, 16), blobMat3),
];
blobs[0].position.set( 1.2,  0.9,  1.0);
blobs[1].position.set(-1.0,  0.0, -0.2);
blobs[2].position.set( 1.0, -1.1, -1.1);
blobs.forEach(m => portalScene.add(m));

// Apply the portal texture to your screen
screen.material = new THREE.MeshPhysicalMaterial({
  roughness: 0.95,
  metalness: 0.0,
  sheen: 1.0,
  sheenRoughness: 0.9,
  side: THREE.DoubleSide,
  map: portalTarget.texture
});

// temp vectors to avoid GC
const _screenWorldPos = new THREE.Vector3();

// Puppets (kept as-is, just images on sticks)
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
        const stickMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.1 });
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
  window.shadowPuppet = { constraints, puppets, lightGroup, flame, screen, gyroConfig };
  animate();
}).catch((e) => console.error('Failed to create puppets:', e));

// Flicker
function layeredNoise(t, a1=1, a2=0.5, a3=0.25, s1=1.7, s2=2.9, s3=4.7) {
  return a1 * Math.sin(t * s1) + a2 * Math.sin(t * s2 + 1.3) + a3 * Math.sin(t * s3 + 2.7);
}

let t = 0;
function animate() {
  t += 0.016 * constraints.speed;

  // Smoothly slerp the camera towards the target quat (gyro)
  camera.quaternion.slerp(targetQuat, gyroConfig.smoothing);

  // Animate blobs in the portal scene
  blobs[0].position.y =  0.9 + 0.25 * Math.sin(t * 1.7);
  blobs[1].position.x = -1.0 + 0.22 * Math.cos(t * 1.1);
  blobs[2].position.z = -1.1 + 0.28 * Math.sin(t * 1.4);

  // Light flicker
  const flicker = 0.5 + 0.5 * Math.abs(layeredNoise(t * 2.2));
  const warmShift = 0.04 * layeredNoise(t * 1.3);
  const sizeJitter = 0.15 * layeredNoise(t * 1.8);

  const baseIntensity = 5.0;
  flame.intensity = baseIntensity * (0.65 + 0.35 * flicker);

  const baseColor = new THREE.Color(0xffb27a);
  const altColor  = new THREE.Color(0xffd080);
  flame.color.copy(baseColor).lerp(altColor, 0.5 * (1 + warmShift));

  flame.angle    = THREE.MathUtils.degToRad(22 + 6 * (0.5 + 0.5 * sizeJitter));
  flame.penumbra = THREE.MathUtils.clamp(0.5 + 0.4 * sizeJitter, 0.1, 0.9);

  // Puppet motion + twirl
  for (const p of puppets) {
    const ph = p.userData.phase || 0;
    const x = constraints.ampX * Math.sin(t * constraints.sx + ph);
    const y = constraints.ampY * Math.cos(t * constraints.sy + ph * 0.9);
    const zRaw = constraints.baseZ + constraints.ampZ * Math.sin(t * constraints.sz + ph * 1.1);
    const z = THREE.MathUtils.clamp(zRaw, constraints.zMin, constraints.zMax);

    p.position.x = x;
    p.position.y = -0.05 + y;
    p.position.z = z;

    p.rotation.x = constraints.rotX * Math.sin(t * constraints.rx + ph + Math.PI * 0.25);
    const baseY  = constraints.rotY * 0.3 * Math.sin(t * constraints.ry + ph);
    p.rotation.z = constraints.rotZ * Math.sin(t * constraints.rz + ph + Math.PI * 0.5);

    const tw = p.userData.twirl;
    if (!tw.active) {
      tw.nextTime -= 0.016 * constraints.speed;
      if (tw.nextTime <= 0) {
        tw.active = true;
        tw.t = 0;
        tw.dur = randRange(0.35, 0.8);
        tw.from = p.rotation.y;
        tw.to   = p.rotation.y + Math.PI; // 180°
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

  // Keep light aimed at screen
  flame.target.position.copy(screen.position);
  flame.target.updateMatrixWorld();

  // --- PORTAL RENDER STEP ---
  // 1) Place portal cam at the viewer, orient like the screen plane
  portalCam.position.copy(camera.position);
  screen.getWorldQuaternion(portalCam.quaternion);

  // 2) Compute screen plane in portalCam space
  screen.getWorldPosition(_screenWorldPos);
  portalCam.updateMatrixWorld();
  const portalPosCamSpace = _screenWorldPos.clone().applyMatrix4(new THREE.Matrix4().copy(portalCam.matrixWorldInverse));

  const near = portalCam.near; // same as main near (0.1)
  const halfW = screenWidth * 0.5;
  const halfH = screenHeight * 0.5;

  const left   = portalPosCamSpace.x - halfW;
  const right  = portalPosCamSpace.x + halfW;
  const top    = portalPosCamSpace.y + halfH;
  const bottom = portalPosCamSpace.y - halfH;

  const dist   = Math.abs(portalPosCamSpace.z);
  const scale  = near / Math.max(dist, 1e-4);

  portalCam.projectionMatrix.makePerspective(
    left   * scale,
    right  * scale,
    top    * scale,
    bottom * scale,
    near,
    10
  );

  // 3) Render the portal scene to the target
  renderer.setRenderTarget(portalTarget);
  renderer.clear();
  renderer.render(portalScene, portalCam);
  renderer.setRenderTarget(null);

  // 4) Render main scene
  renderer.render(scene, camera);

  requestAnimationFrame(animate);
}

// Resize
function resizeRT() {
  const dpr = renderer.getPixelRatio();
  const w = Math.max(1, Math.floor(innerWidth * dpr));
  const h = Math.max(1, Math.floor(innerHeight * dpr));
  portalTarget.setSize(w, h);
}
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  resizeRT();
});
// prime RT size
resizeRT();
