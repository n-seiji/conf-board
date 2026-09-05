import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const stage = document.querySelector("#stage");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0xffffff);
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0xffffff, 2));
const camera = new THREE.PerspectiveCamera(29, 1, 0.01, 100);
camera.position.set(2.6, 1.55, 6.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.55, 0);
controls.enableDamping = true;
controls.minDistance = 3.5;
controls.maxDistance = 12;
controls.minPolarAngle = Math.PI * 0.16;
controls.maxPolarAngle = Math.PI * 0.84;
controls.autoRotateSpeed = 1.3;

const encoded = document.querySelector("#model-data").textContent.trim();
const buffer = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)).buffer;
new GLTFLoader().parse(
  buffer,
  "",
  (gltf) => {
    scene.add(gltf.scene);
    let meshCount = 0;
    gltf.scene.traverse((o) => {
      if (o.isMesh) meshCount++;
    });
    window.modelVerification = { loaded: true, meshCount, animations: gltf.animations.length };
    document.querySelector("#status").textContent = "ドラッグで回転 · スクロールで拡大";
  },
  (error) => {
    document.querySelector("#status").textContent = "モデルの読み込みに失敗しました。";
    console.error(error);
  },
);

function resize() {
  const w = stage.clientWidth,
    h = stage.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
new ResizeObserver(resize).observe(stage);
document.querySelectorAll("[data-angle]").forEach((button) => {
  button.addEventListener("click", () => {
    const angle = (Number(button.dataset.angle) * Math.PI) / 180;
    camera.position.set(6.7 * Math.sin(angle), 1.55, 6.7 * Math.cos(angle));
    controls.target.set(0, 1.55, 0);
    controls.autoRotate = false;
    document.querySelector("#rotate").ariaPressed = "false";
    controls.update();
  });
});
document.querySelector("#rotate").addEventListener("click", (event) => {
  controls.autoRotate = !controls.autoRotate;
  event.currentTarget.ariaPressed = String(controls.autoRotate);
});
document.querySelector("#download").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([buffer], { type: "model/gltf-binary" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "kurita-miive-v2.glb";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
