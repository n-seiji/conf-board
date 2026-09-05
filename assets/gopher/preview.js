import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadGopher, createGopher, placeOnGlobe, GOPHER_HEIGHT } from "./three-example.js";

const stage = document.querySelector("#stage");
const scene = new THREE.Scene();
scene.background = new THREE.Color("#f4f2ec");
const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
stage.prepend(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 2;
controls.maxDistance = 12;
controls.maxPolarAngle = Math.PI * 0.51;
scene.add(new THREE.HemisphereLight("#fffdf0", "#778c93", 2));
const key = new THREE.DirectionalLight("#fff5de", 3.3);
key.position.set(-3, 6, 5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -5, right: 5, top: 6, bottom: -5, near: 0.1, far: 20 });
key.shadow.normalBias = 0.025;
key.shadow.bias = -0.0002;
scene.add(key);
const rim = new THREE.DirectionalLight("#d3f5ff", 1.8);
rim.position.set(4, 4, -4);
scene.add(rim);
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: "#eae8df", roughness: 1 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const earthGroup = new THREE.Group();
earthGroup.position.y = 1.85;
earthGroup.visible = false;
scene.add(earthGroup);
let hero,
  friends = [],
  paused = false,
  speed = 1,
  globeMode = false;

function resize() {
  const { width, height } = stage.getBoundingClientRect();
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

async function earthTexture() {
  const response = await fetch("/node_modules/world-atlas/land-110m.json");
  if (!response.ok) throw new Error("Earth data could not be loaded");
  const topology = await response.json();
  const land = globalThis.topojson.feature(topology, topology.objects.land);
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#568c9d";
  ctx.fillRect(0, 0, 2048, 1024);
  ctx.strokeStyle = "#74a2af";
  ctx.lineWidth = 1;
  for (let x = 0; x < 2048; x += 2048 / 24) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 1024);
    ctx.stroke();
  }
  for (let y = 0; y < 1024; y += 1024 / 12) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(2048, y);
    ctx.stroke();
  }
  ctx.fillStyle = "#c9d5ad";
  const features = land.type === "FeatureCollection" ? land.features : [land];
  const polygons = features.flatMap(({ geometry }) =>
    geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates],
  );
  for (const polygon of polygons) {
    ctx.beginPath();
    for (const ring of polygon) {
      ring.forEach(([lon, lat], i) => {
        const x = ((lon + 180) / 360) * 2048,
          y = ((90 - lat) / 180) * 1024;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
    ctx.fill("evenodd");
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function view(globe) {
  globeMode = globe;
  earthGroup.visible = globe;
  if (globe) {
    earthGroup.add(hero.root);
    hero.root.scale.setScalar(0.85 / GOPHER_HEIGHT);
    placeOnGlobe(hero, { lat: 60, lon: -78, radius: 1.65, heading: 0 });
    camera.position.set(4.4, 4.0, 7.5);
    controls.target.set(0, 2.1, 0);
  } else {
    scene.add(hero.root);
    hero.root.position.set(0, 0, 0);
    hero.root.quaternion.identity();
    hero.root.scale.setScalar(1);
    camera.position.set(4, 2.9, 7.5);
    controls.target.set(0, 1.42, 0);
  }
  document.querySelector("#studio").classList.toggle("active", !globe);
  document.querySelector("#globe").classList.toggle("active", globe);
  controls.update();
}

try {
  const asset = await loadGopher("../../public/models/gopher.glb");
  hero = createGopher(asset, { height: GOPHER_HEIGHT });
  scene.add(hero.root);
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1.65, 96, 64),
    new THREE.MeshStandardMaterial({ map: await earthTexture(), roughness: 0.85 }),
  );
  earth.castShadow = true;
  earth.receiveShadow = true;
  earthGroup.add(earth);
  for (const [lat, lon, friendColor, clip] of [
    [12, -30, "#ed98aa", "Wave"],
    [22, -130, "#e9bb69", "Hop"],
  ]) {
    const friend = createGopher(asset, { height: 0.68, color: friendColor, clip });
    earthGroup.add(friend.root);
    placeOnGlobe(friend, { lat, lon, radius: 1.65 });
    friends.push(friend);
  }
  view(false);
  document.querySelector("#status").textContent = "● Ready · GLB loaded";
  document.querySelectorAll("[data-clip]").forEach((button) =>
    button.addEventListener("click", () => {
      hero.play(button.dataset.clip);
      document
        .querySelectorAll("[data-clip]")
        .forEach((b) => b.classList.toggle("active", b === button));
    }),
  );
  document.querySelectorAll("[data-expression]").forEach((button) =>
    button.addEventListener("click", () => {
      hero.setExpression(button.dataset.expression);
      document
        .querySelectorAll("[data-expression]")
        .forEach((b) => b.classList.toggle("active", b === button));
    }),
  );
  function color(value) {
    hero.setColor(value);
    document.querySelector("#color").value = value;
    document.querySelector("#hex").textContent = value.toUpperCase();
  }
  document
    .querySelectorAll("[data-color]")
    .forEach((button) => button.addEventListener("click", () => color(button.dataset.color)));
  document.querySelector("#color").addEventListener("input", (event) => color(event.target.value));
  document.querySelector("#studio").addEventListener("click", () => view(false));
  document.querySelector("#globe").addEventListener("click", () => view(true));
  document.querySelector("#pause").addEventListener("click", (event) => {
    paused = !paused;
    event.target.textContent = paused ? "Play" : "Pause";
  });
  document.querySelector("#speed").addEventListener("input", (event) => {
    speed = Number(event.target.value);
    document.querySelector("#speed-label").textContent = `${speed.toFixed(2).replace(/0$/, "")}×`;
  });
  // Exposed only in this standalone preview for reproducible inspection.
  window.gopherPreview = {
    hero,
    friends,
    asset,
    scene,
    camera,
    renderer,
    view,
    setColor: color,
    get globeMode() {
      return globeMode;
    },
    setPaused(value) {
      paused = value;
      document.querySelector("#pause").textContent = paused ? "Play" : "Pause";
    },
  };
} catch (error) {
  console.error(error);
  document.querySelector("#error").style.display = "block";
  document.querySelector("#error").textContent = `モデルを読み込めませんでした: ${error.message}`;
  document.querySelector("#status").textContent = "Load failed";
}
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!paused) {
    hero?.update(dt * speed);
    if (globeMode) friends.forEach((f) => f.update(dt * speed));
  }
  controls.update();
  renderer.render(scene, camera);
});
