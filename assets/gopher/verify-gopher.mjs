import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Box3, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createGopher, placeOnGlobe, GOPHER_HEIGHT, CLIPS, EXPRESSIONS } from "./three-example.js";

const bytes = await readFile(new URL("../../public/models/gopher.glb", import.meta.url));
const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const asset = await new GLTFLoader().parseAsync(arrayBuffer, "");
assert.deepEqual(asset.animations.map((c) => c.name).sort(), [...CLIPS].sort());
const nodes = [],
  materials = new Set();
let triangles = 0;
asset.scene.traverse((o) => {
  nodes.push(o.name);
  if (o.isMesh) {
    assert.ok(o.isSkinnedMesh, `${o.name}: skin missing`);
    triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m.name);
    assert.equal(o.skeleton.bones.length, 6);
  }
});
assert.ok(!nodes.includes("Cube") && !nodes.includes("Camera"));
assert.ok(materials.has("BodyColor"));
assert.ok(!materials.has("EyeHighlight"), "reference requires solid black pupils");
const rest = new Box3().setFromObject(asset.scene, true);
assert.ok(Math.abs(rest.min.y) < 1e-4, `feet origin: ${rest.min.y}`);
assert.ok(Math.abs(rest.max.y - GOPHER_HEIGHT) < 1e-4);

const a = createGopher(asset, { height: GOPHER_HEIGHT, color: "#ee6688" });
const b = createGopher(asset, { height: GOPHER_HEIGHT, color: "#70cbd9" });
const bodyMaterial = (model) => {
  let found;
  model.traverse((o) => {
    if (o.isMesh)
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.name === "BodyColor") found = m;
      }
  });
  return found;
};
assert.notEqual(bodyMaterial(a.model), bodyMaterial(b.model));
a.setColor("#7856de");
assert.equal(bodyMaterial(a.model).color.getHexString(), "7856de");
assert.equal(bodyMaterial(b.model).color.getHexString(), "70cbd9");
assert.notEqual(a.model.getObjectByName("Root"), b.model.getObjectByName("Root"));

const faces = (model) => {
  const found = [];
  model.traverse((o) => {
    if (o.morphTargetDictionary) found.push(o);
  });
  return found;
};
assert.ok(faces(a.model).length > 0, "expression morph targets missing");
for (const name of EXPRESSIONS.slice(1)) {
  a.setExpression(name, 0.8);
  a.update(0.1);
  let changed = false;
  for (const face of faces(a.model)) {
    const index = face.morphTargetDictionary[name];
    assert.notEqual(index, undefined);
    assert.equal(face.morphTargetInfluences[index], 0.8, "motion overwrites expression");
    changed ||= face.geometry.morphAttributes.position[index].array.some((v) => Math.abs(v) > 1e-5);
  }
  assert.ok(changed, `${name}: empty morph target`);
  for (const face of faces(b.model)) assert.ok(face.morphTargetInfluences.every((v) => v === 0));
}
a.setExpression("Neutral");
for (const face of faces(a.model)) assert.ok(face.morphTargetInfluences.every((v) => v === 0));
assert.throws(() => a.setExpression("Missing"));
assert.throws(() => a.setExpression("Smile", 2));

const report = [];
for (const clip of asset.animations) {
  assert.equal(clip.tracks.length, 18);
  let varying = 0;
  for (const track of clip.tracks) {
    const n = track.getValueSize();
    for (let i = 0; i < n; i++) {
      assert.ok(
        Math.abs(track.values[i] - track.values[track.values.length - n + i]) < 1e-5,
        `${clip.name}: loop seam`,
      );
    }
    if (track.values.some((v, i) => Math.abs(v - track.values[i % n]) > 1e-4)) varying++;
  }
  assert.ok(varying >= 3, `${clip.name}: insufficient movement`);
  a.play(clip.name, 0);
  let maxHeight = 0,
    minFoot = Infinity;
  for (let sample = 0; sample <= 24; sample++) {
    a.mixer.setTime((sample / 24) * clip.duration);
    a.root.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(a.root, true);
    assert.ok(
      [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].every(
        Number.isFinite,
      ),
    );
    assert.ok(bounds.max.x - bounds.min.x < 4 && bounds.max.y < 4, `${clip.name}: exploded mesh`);
    maxHeight = Math.max(maxHeight, bounds.max.y);
    minFoot = Math.min(minFoot, bounds.min.y);
  }
  assert.ok(minFoot > -0.03, `${clip.name}: foot penetrates ground by ${minFoot}`);
  if (clip.name === "Hop") assert.ok(maxHeight > GOPHER_HEIGHT + 0.3, "Hop does not leave ground");
  report.push({
    clip: clip.name,
    seconds: clip.duration,
    varyingTracks: varying,
    minFoot,
    maxHeight,
  });
}
for (const lat of [-90, -45, 0, 35.68, 90]) {
  const normal = placeOnGlobe(a, { lat, lon: 139.69, radius: 2, heading: 30 });
  assert.ok(Math.abs(a.root.position.length() - 2) < 1e-8);
  const up = new Vector3(0, 1, 0).applyQuaternion(a.root.quaternion);
  assert.ok(up.distanceTo(normal) < 1e-8, "up axis not aligned with globe surface");
}
assert.throws(() => a.play("Missing"));
assert.throws(() => placeOnGlobe(a, { lat: 100, lon: 0 }));
a.dispose();
b.dispose();
console.log(
  JSON.stringify(
    {
      status: "PASS",
      bytes: bytes.length,
      triangles,
      materials: [...materials],
      restBounds: { min: rest.min.toArray(), max: rest.max.toArray() },
      clips: report,
      independentColor: true,
      independentSkeleton: true,
      independentExpressions: EXPRESSIONS,
      globePlacement: true,
    },
    null,
    2,
  ),
);
