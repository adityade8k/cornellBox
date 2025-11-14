// main.js (type="module")
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
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

// --- Cloth "screen" ---
const screenWidth = 1.4;
const screenHeight = 1.0;
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
screen.position.z = 0;
screen.receiveShadow = true;
scene.add(screen);

scene.add(new THREE.AmbientLight(0xffffff, 0.15));

// --- Flame + Puppet Group ---
const lightGroup = new THREE.Group();
scene.add(lightGroup);
lightGroup.position.set(0, -0.5, 0);

// --- SpotLight ---
const flame = new THREE.SpotLight(0xffb27a, 6.0, 100.0, THREE.MathUtils.degToRad(60), 1, 1.5);
flame.position.set(0, 0, -1.2);
flame.castShadow = true;
flame.shadow.mapSize.set(2048, 2048);
flame.shadow.bias = -0.0001;
flame.shadow.normalBias = 0.02;

// Shadow camera tuning
flame.shadow.camera.near = 0.01;
flame.shadow.camera.far = 10;
flame.shadow.camera.fov = 60; // in degrees (SpotLight angle is separate)
flame.shadow.camera.updateProjectionMatrix();

flame.target.position.set(0, 0, 0);
scene.add(flame.target);

lightGroup.add(flame);

// --- Helpers ---
const flameHelper = new THREE.SpotLightHelper(flame);
scene.add(flameHelper);

const shadowCamHelper = new THREE.CameraHelper(flame.shadow.camera);
scene.add(shadowCamHelper);

// --- Puppet ---
const loader = new THREE.TextureLoader();
loader.load(
  '/textures/test.png',
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

    const puppet = new THREE.Mesh(puppetGeo, puppetMat);
    puppet.scale.set(0.08, 0.08, 0.08);
    puppet.position.set(0, 0.04, -1.1);
    puppet.castShadow = true;
    lightGroup.add(puppet);

    animate();
  },
  undefined,
  (err) => console.error('Failed to load puppet texture:', err)
);

// --- Flicker animation ---
function layeredNoise(t, a1=1, a2=0.5, a3=0.25, s1=1.7, s2=2.9, s3=4.7) {
  return a1 * Math.sin(t * s1) + a2 * Math.sin(t * s2 + 1.3) + a3 * Math.sin(t * s3 + 2.7);
}

let t = 0;
function animate() {
  t += 0.016;
  const flicker = 0.1 + 0.1 * Math.abs(layeredNoise(t * 2.2));
  const warmShift = 0.004 * layeredNoise(t * 1.3);
  const sizeJitter = 0.0015 * layeredNoise(t * 1.8);

  const baseIntensity = 5.0;
  flame.intensity = baseIntensity * (0.65 + 0.35 * flicker);

  const baseColor = new THREE.Color(0xffb27a);
  const altColor  = new THREE.Color(0xffd080);
  flame.color.copy(baseColor).lerp(altColor, 0.5 * (1 + warmShift));

  flame.angle = THREE.MathUtils.degToRad(22 + 6 * (0.5 + 0.5 * sizeJitter));
  flame.penumbra = THREE.MathUtils.clamp(0.5 + 0.4 * sizeJitter, 0.1, 0.9);

  // Always keep flame pointing at screen center
  flame.target.position.copy(screen.position);
  flame.target.updateMatrixWorld();

  // ✅ Update helpers
  flameHelper.update();
  shadowCamHelper.update();

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
