// main.js (type="module")
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 0, -2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.style.margin = '0';
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(0, 0, 0);

// let AmbientLight = new THREE.AmbientLight(0xffffff, 10);
// scene.add(AmbientLight);

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
flameTarget.position.set(0, -0.1, 0);  // aim at the cloth
scene.add(flameTarget);
flame.target = flameTarget;
lightGroup.add(flame);

scene.add(lightGroup);

let directionalLIght = new THREE.DirectionalLight(0xffffff, 20);
directionalLIght.position.set(0, 0.1, -5);
directionalLIght.castShadow = true;

scene.add(directionalLIght);

// --- Motion constraints (exposed for live tweaks) ---
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

// --- Utilities ---
const easeInOutSine = (u) => 0.5 - 0.5 * Math.cos(Math.PI * u);
const randRange = (a, b) => a + Math.random() * (b - a);

// --- Load scene.glb from public/scene/scene.glb ---
const gltfLoader = new GLTFLoader();
gltfLoader.load(
  '/models/scene.glb',                          // <-- ensure file is at public/scene/scene.glb
  (gltf) => {
    const root = gltf.scene || gltf.scenes[0];
    root.traverse((obj) => {
      if (obj.isMesh || obj.isSkinnedMesh || obj.isInstancedMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    // Place it behind puppets (toward the light) so it doesn’t block shadows on the screen
    root.position.set(0, 0, -1.05);
    root.scale.set(0.4, 0.4, 0.4);
    scene.add(root);
  },
  undefined,
  (err) => console.error('Failed to load scene.glb:', err)
);

// --- Puppet factory (two puppets, different textures, random twirl) ---
const loader = new THREE.TextureLoader();
const puppets = [];

function makePuppet(textureUrl, phase, xOffset) {
  return new Promise((resolve, reject) => {
    loader.load(
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

        // Stick
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

        // Twirl state
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

// Create TWO puppets
Promise.all([
  makePuppet('/textures/test.png', 0, -0.02),
  makePuppet('/textures/test1.png', Math.PI, 0.02),
]).then(() => {
  window.shadowPuppet = { constraints, puppets, lightGroup, flame, screen };
  animate();
}).catch((e) => console.error('Failed to create puppets:', e));

// --- Flicker animation (light only) ---
function layeredNoise(t, a1=1, a2=0.5, a3=0.25, s1=1.7, s2=2.9, s3=4.7) {
  return a1 * Math.sin(t * s1) + a2 * Math.sin(t * s2 + 1.3) + a3 * Math.sin(t * s3 + 2.7);
}

let t = 0;
function animate() {
  t += 0.016 * constraints.speed;

  // Light flicker
  const flicker = 0.5 + 0.5 * Math.abs(layeredNoise(t * 2.2));
  const warmShift = 0.04 * layeredNoise(t * 1.3);
  const sizeJitter = 0.15 * layeredNoise(t * 1.8);

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
    const x = constraints.ampX * Math.sin(t * constraints.sx + ph);
    const y = constraints.ampY * Math.cos(t * constraints.sy + ph * 0.9);
    const zRaw = constraints.baseZ + constraints.ampZ * Math.sin(t * constraints.sz + ph * 1.1);
    const z = THREE.MathUtils.clamp(zRaw, constraints.zMin, constraints.zMax);

    p.position.x = x;
    p.position.y = -0.05 + y;
    p.position.z = z;

    p.rotation.x = constraints.rotX * Math.sin(t * constraints.rx + ph + Math.PI * 0.25);
    const baseY = constraints.rotY * 0.3 * Math.sin(t * constraints.ry + ph);
    p.rotation.z = constraints.rotZ * Math.sin(t * constraints.rz + ph + Math.PI * 0.5);

    const tw = p.userData.twirl;
    if (!tw.active) {
      tw.nextTime -= 0.016 * constraints.speed;
      if (tw.nextTime <= 0) {
        tw.active = true;
        tw.t = 0;
        tw.dur = randRange(0.35, 0.8);
        tw.from = p.rotation.y;
        tw.to = p.rotation.y + Math.PI; // 180°
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

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

// --- Resize ---
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
