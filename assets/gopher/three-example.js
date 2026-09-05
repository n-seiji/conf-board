import { AnimationMixer, Group, LoopRepeat, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";

export const GOPHER_HEIGHT = 2.844;
export const CLIPS = ["Dance", "Wave", "Hop"];
export const EXPRESSIONS = ["Neutral", "Smile", "Wink", "Surprised"];

/** Load once, then reuse the result with createGopher for multiple characters. */
export function loadGopher(url = "/models/gopher.glb") {
  return new GLTFLoader().loadAsync(url);
}

/** Each instance owns its skeleton, animation mixer, and BodyColor material. */
export function createGopher(asset, { color = "#1baec7", height = 1, clip = "Dance" } = {}) {
  if (!Number.isFinite(height) || height <= 0) throw new RangeError("height must be positive");
  const model = clone(asset.scene);
  const root = new Group();
  root.name = "GopherPlacement";
  root.scale.setScalar(height / GOPHER_HEIGHT);
  root.add(model);
  const ownedMaterials = new Map();
  const skeletons = new Set();
  model.traverse((object) => {
    if (!object.isMesh) return;
    const recolorable = (material) => {
      if (material.name !== "BodyColor") return material;
      if (!ownedMaterials.has(material)) ownedMaterials.set(material, material.clone());
      return ownedMaterials.get(material);
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(recolorable)
      : recolorable(object.material);
    object.castShadow = true;
    object.receiveShadow = true;
    // Bone motion extends outside bind-pose bounds; avoid incorrect culling.
    if (object.isSkinnedMesh) {
      object.frustumCulled = false;
      skeletons.add(object.skeleton);
    }
  });
  const mixer = new AnimationMixer(model);
  const actions = new Map(asset.animations.map((a) => [a.name, mixer.clipAction(a)]));
  let current;
  function setExpression(name, amount = 1) {
    if (!EXPRESSIONS.includes(name)) throw new Error(`Unknown expression: ${name}`);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1)
      throw new RangeError("amount must be 0…1");
    model.traverse((object) => {
      if (!object.morphTargetDictionary) return;
      for (const expression of EXPRESSIONS.slice(1)) {
        const index = object.morphTargetDictionary[expression];
        if (index !== undefined)
          object.morphTargetInfluences[index] = expression === name ? amount : 0;
      }
    });
  }
  function setColor(value) {
    for (const material of ownedMaterials.values()) material.color.set(value);
  }
  function play(name, fadeSeconds = 0.2) {
    const next = actions.get(name);
    if (!next)
      throw new Error(`Unknown clip: ${name}. Available: ${[...actions.keys()].join(", ")}`);
    if (next === current) return;
    const previous = current;
    next
      .reset()
      .setLoop(LoopRepeat, Infinity)
      .setEffectiveTimeScale(1)
      .setEffectiveWeight(1)
      .play();
    if (previous) {
      if (fadeSeconds > 0) next.crossFadeFrom(previous, fadeSeconds, false);
      else previous.stop();
    }
    current = next;
  }
  setColor(color);
  play(clip, 0);
  return {
    root,
    model,
    mixer,
    actions,
    setColor,
    setExpression,
    play,
    update: (deltaSeconds) => mixer.update(deltaSeconds),
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      root.removeFromParent();
      ownedMaterials.forEach((m) => m.dispose());
      skeletons.forEach((s) => s.dispose());
      // Shared geometry / non-body materials still belong to the loaded asset.
    },
  };
}

/** Matches src/globe/rig.ts latLonToVector3. Coordinates are globe-local. */
export function placeOnGlobe(gopher, { lat, lon, radius = 1, heading = 0, offset = 0 }) {
  if (
    ![lat, lon, radius, heading, offset].every(Number.isFinite) ||
    Math.abs(lat) > 90 ||
    radius <= 0
  ) {
    throw new RangeError("Use finite coordinates, latitude -90…90 and a positive radius");
  }
  const latitude = (lat * Math.PI) / 180;
  const longitude = (lon * Math.PI) / 180;
  const normal = new Vector3(
    Math.cos(latitude) * Math.cos(longitude),
    Math.sin(latitude),
    -Math.cos(latitude) * Math.sin(longitude),
  ).normalize();
  gopher.root.position.copy(normal).multiplyScalar(radius + offset);
  gopher.root.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), normal);
  gopher.root.rotateY((heading * Math.PI) / 180);
  return normal;
}
