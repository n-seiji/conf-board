import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const labels = {
  Wave: "手を振る",
  Bow: "おじぎ",
  Nod: "うなずく",
  Jump: "ジャンプ",
  Dance: "ダンス",
};
const stage = document.querySelector("#stage");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0xffffff);
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0xffffff, 2));
const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
camera.position.set(1.15, 1.65, 8.0);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.6, 0);
controls.enableDamping = true;
controls.minDistance = 4.5;
controls.maxDistance = 13;
controls.minPolarAngle = Math.PI * 0.16;
controls.maxPolarAngle = Math.PI * 0.84;
const clock = new THREE.Clock();
let mixer, model, clips, activeAction;
let current = "Wave",
  playing = true;
const actions = new Map();
const state = { loaded: false, names: [], current, playing, time: 0 };
window.motionVerification = state;

function updateUI() {
  document
    .querySelectorAll("[data-motion]")
    .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.motion === current)));
  const pause = document.querySelector("#pause");
  pause.textContent = playing ? "一時停止" : "再生";
  pause.setAttribute("aria-pressed", String(!playing));
  const clip = clips?.find((c) => c.name === current);
  document.querySelector("#motion-name").textContent = labels[current];
  document.querySelector("#duration").textContent = clip
    ? `${clip.duration.toFixed(1)}秒 / ループ`
    : "";
  Object.assign(state, { current, playing });
}
function choose(name) {
  const action = actions.get(name);
  if (!action) return;
  if (activeAction && activeAction !== action) activeAction.fadeOut(0.2);
  action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(0.2).play();
  action.paused = false;
  activeAction = action;
  current = name;
  playing = true;
  mixer.timeScale = 1;
  updateUI();
}

const buffer = Uint8Array.from(
  atob(document.querySelector("#model-data").textContent.trim()),
  (c) => c.charCodeAt(0),
).buffer;
new GLTFLoader().parse(
  buffer,
  "",
  (gltf) => {
    model = gltf.scene;
    scene.add(model);
    clips = gltf.animations;
    mixer = new THREE.AnimationMixer(model);
    for (const clip of clips)
      actions.set(clip.name, mixer.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity));
    let meshCount = 0,
      skinnedMeshCount = 0;
    model.traverse((o) => {
      if (o.isMesh) meshCount++;
      if (o.isSkinnedMesh) skinnedMeshCount++;
    });
    window.modelVerification = {
      loaded: true,
      meshCount,
      skinnedMeshCount,
      animations: clips.length,
    };
    Object.assign(state, { loaded: true, names: clips.map((c) => c.name) });
    document.querySelector("#status").textContent = "ドラッグで回転 · スクロールで拡大";
    document
      .querySelectorAll("[data-motion], #pause, #download")
      .forEach((b) => (b.disabled = false));
    choose("Wave");
    // Deterministic sampling for verifying the exported clips in a real browser.
    window.motionPreview = {
      sample(name, seconds) {
        mixer.stopAllAction();
        mixer.timeScale = 1;
        const action = actions.get(name);
        action.reset().setEffectiveWeight(1).play();
        action.paused = true;
        action.time = seconds;
        activeAction = action;
        current = name;
        playing = false;
        mixer.update(0);
        model.updateMatrixWorld(true);
        renderer.render(scene, camera);
        const matrices = [],
          surface = [];
        model.traverse((o) => {
          if (o.isBone) matrices.push(...o.matrixWorld.elements);
          if (o.isSkinnedMesh) {
            o.skeleton.update();
            for (const i of [
              0,
              Math.floor(o.geometry.attributes.position.count / 2),
              o.geometry.attributes.position.count - 1,
            ]) {
              const p = o.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(o.matrixWorld);
              surface.push(p.x, p.y, p.z);
            }
          }
        });
        updateUI();
        return { matrices, surface, duration: action.getClip().duration };
      },
    };
  },
  (error) => {
    document.querySelector("#status").textContent = "モデルを読み込めませんでした。";
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
document
  .querySelectorAll("[data-motion]")
  .forEach((b) => b.addEventListener("click", () => choose(b.dataset.motion)));
document.querySelector("#pause").addEventListener("click", () => {
  playing = !playing;
  if (activeAction) activeAction.paused = !playing;
  mixer.timeScale = playing ? 1 : 0;
  updateUI();
});
document.querySelectorAll("[data-angle]").forEach((b) =>
  b.addEventListener("click", () => {
    const a = (Number(b.dataset.angle) * Math.PI) / 180;
    camera.position.set(8.1 * Math.sin(a), 1.65, 8.1 * Math.cos(a));
    controls.target.set(0, 1.6, 0);
    controls.update();
  }),
);
document.querySelector("#download").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([buffer], { type: "model/gltf-binary" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "kurita-miive-animated.glb";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (mixer) mixer.update(dt);
  if (activeAction) state.time = activeAction.time;
  controls.update();
  renderer.render(scene, camera);
});
