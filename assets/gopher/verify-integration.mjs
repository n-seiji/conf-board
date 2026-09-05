import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createGopherPins } from "../../src/globe/gopher-pins.ts";

const bytes = await readFile(new URL("../../public/models/gopher.glb", import.meta.url));
const asset = await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  "",
);
const pins = createGopherPins(async () => asset);
const object = pins.create("look-verification", 0, "#ff8a80");
await pins.ready;
pins.lookUp("look-verification");
pins.update(0.001);
const foot = object.getObjectByName("FootL");
const initialFoot = foot.getWorldPosition(new Vector3());
const initialHead = pins.headPosition("look-verification", new Vector3());
for (let i = 0; i < 60; i++) pins.update(0.05);
const bentHead = pins.headPosition("look-verification", new Vector3());
assert.ok(foot.getWorldPosition(new Vector3()).distanceTo(initialFoot) < 1e-5);
assert.ok(bentHead.z < initialHead.z - 0.15);
assert.ok(Math.abs(object.getObjectByName("Body").rotation.x + Math.PI / 3) < 1e-4);
assert.deepEqual(object.position.toArray(), [0, 0, 0]);
pins.lookUp(null);
for (let i = 0; i < 60; i++) pins.update(0.05);
const normalHead = pins.headPosition("look-verification", new Vector3());
assert.ok(normalHead.z > bentHead.z + 0.1);
pins.dispose();
console.log(
  JSON.stringify(
    {
      status: "PASS",
      realGLB: true,
      groundedFeet: true,
      waistLeanDegrees: 60,
      headTracksPose: true,
      returnsToLoop: true,
    },
    null,
    2,
  ),
);
