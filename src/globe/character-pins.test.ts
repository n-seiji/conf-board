import {
  AnimationClip,
  Bone,
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  VectorKeyframeTrack,
  Vector3,
} from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { createGopherPins, gopherVariation } from "./gopher-pins";

const asset = (): GLTF => {
  const scene = new Group();
  const material = new MeshStandardMaterial({ color: "#1baec7" });
  material.name = "BodyColor";
  const body = new Mesh(new BoxGeometry(1, 2.844, 1), material);
  body.position.y = 1.422;
  body.name = "Body";
  scene.add(body);
  return {
    scene,
    scenes: [scene],
    animations: [
      new AnimationClip("Wave", 3, [
        new VectorKeyframeTrack("Body.scale", [0, 1.5, 3], [1, 1, 1, 1.2, 1.2, 1.2, 1, 1, 1]),
      ]),
    ],
    cameras: [],
    asset: { version: "2.0" },
    parser: {} as GLTF["parser"],
    userData: {},
  };
};

describe("Gopher pin lifecycle", () => {
  it("leans only the torso, tracks its head, and restores the pose after deselection", async () => {
    const gltf = asset();
    gltf.animations = [];
    gltf.scene.clear();
    const root = new Bone();
    root.name = "Root";
    const body = new Bone();
    body.name = "Body";
    body.position.y = 0.288;
    const foot = new Bone();
    foot.name = "Foot.L";
    foot.position.set(0.57, 0.144, 0);
    root.add(body, foot);
    gltf.scene.add(root);
    const pins = createGopherPins(async () => gltf);
    const object = pins.create("look", 0, "#FF8A80");
    await pins.ready;
    const beforeHead = pins.headPosition("look", new Vector3())!.clone();
    const footObject = object.getObjectByName("Foot.L")!;
    const beforeFoot = footObject.getWorldPosition(new Vector3());
    pins.lookUp("look");
    for (let i = 0; i < 60; i++) pins.update(0.05);
    const bentHead = pins.headPosition("look", new Vector3())!;
    expect(bentHead.z).toBeLessThan(beforeHead.z - 0.15);
    expect(footObject.getWorldPosition(new Vector3()).distanceTo(beforeFoot)).toBeLessThan(1e-6);
    expect(object.quaternion.w).toBe(1);
    const bentAngle = object.getObjectByName("Body")!.rotation.x;
    for (let i = 0; i < 200; i++) pins.update(0.05);
    expect(object.getObjectByName("Body")!.rotation.x).toBeCloseTo(bentAngle, 4);
    pins.lookUp(null);
    for (let i = 0; i < 60; i++) pins.update(0.05);
    expect(pins.headPosition("look", new Vector3())!.distanceTo(beforeHead)).toBeLessThan(1e-4);
    pins.dispose();
  });
  it("applies each assigned clip and face without recoloring the character", async () => {
    const gltf = asset();
    const body = gltf.scene.getObjectByName("Body") as Mesh;
    body.morphTargetDictionary = { Smile: 0, Wink: 1, Surprised: 2 };
    body.morphTargetInfluences = [0, 0, 0];
    gltf.animations = ["Dance", "Wave", "Hop"].map((name, index) => {
      const middle = [1, 1, 1];
      middle[index] = 2;
      return new AnimationClip(name, 3, [
        new VectorKeyframeTrack("Body.scale", [0, 1.5, 3], [1, 1, 1, ...middle, 1, 1, 1]),
      ]);
    });
    const pins = createGopherPins(async () => gltf);
    const objects = Array.from({ length: 24 }, (_, i) => pins.create(`post-${i}`, 0, "#FF8A80"));
    await pins.ready;
    pins.update(0.07);
    objects.forEach((object, i) => {
      const variation = gopherVariation(`post-${i}`);
      const mesh = object.getObjectByName("Body") as Mesh;
      const axis = { Dance: 0, Wave: 1, Hop: 2 }[variation.clip];
      mesh.scale.toArray().forEach((value, index) => {
        if (index === axis) expect(value).toBeGreaterThan(1);
        else expect(value).toBe(1);
      });
      const faces = { Neutral: [0, 0, 0], Smile: [1, 0, 0], Wink: [0, 1, 0], Surprised: [0, 0, 1] };
      expect(mesh.morphTargetInfluences).toEqual(faces[variation.expression]);
      expect((mesh.material as MeshStandardMaterial).color.getHexString()).toBe("ff8a80");
    });
    pins.react("post-0");
    expect((objects[0]!.getObjectByName("Body") as Mesh).morphTargetInfluences).toEqual([1, 0, 0]);
    for (let i = 0; i < 40; i++) pins.update(0.1);
    const restored = (objects[0]!.getObjectByName("Body") as Mesh).morphTargetInfluences;
    const assigned = gopherVariation("post-0").expression;
    expect(restored).toEqual([
      Number(assigned === "Smile"),
      Number(assigned === "Wink"),
      Number(assigned === "Surprised"),
    ]);
    pins.dispose();
  });

  it("stands at the origin at the compact Gopher height", async () => {
    const pins = createGopherPins(async () => ({ ...asset(), animations: [] }));
    const pin = pins.create("size", 0, "#FF8A80");
    await pins.ready;
    const bounds = new Box3().setFromObject(pin, true);
    expect(bounds.min.y).toBeCloseTo(0, 6);
    expect(bounds.max.y).toBeCloseTo(0.24, 6);
    pins.dispose();
  });

  it("animates without interaction and resumes looping after a reaction", async () => {
    const pins = createGopherPins(async () => asset());
    const a = pins.create("a", 0, "#FF8A80");
    const b = pins.create("b", 1, "#FFE082");
    pins.react("a"); // Can arrive while GLB is still loading.
    await pins.ready;
    for (let i = 0; i < 10; i++) pins.update(0.1);
    expect(a.getObjectByName("Body")?.scale.x).toBeGreaterThan(1);
    expect(b.getObjectByName("Body")?.scale.x).toBeGreaterThan(1);
    for (let i = 0; i < 40; i++) pins.update(0.1);
    const before = a.getObjectByName("Body")?.scale.x;
    for (let i = 0; i < 7; i++) pins.update(0.1);
    expect(a.getObjectByName("Body")?.scale.x).not.toBe(before);
    pins.dispose();
  });

  it("assigns reproducible, varied motion, expression and phase from post IDs", () => {
    const variations = Array.from({ length: 60 }, (_, i) => gopherVariation(`post-${i}`));
    expect(new Set(variations.map((v) => v.clip))).toEqual(new Set(["Dance", "Wave", "Hop"]));
    expect(new Set(variations.map((v) => v.expression))).toEqual(
      new Set(["Neutral", "Smile", "Wink", "Surprised"]),
    );
    expect(new Set(variations.map((v) => v.phase)).size).toBeGreaterThan(40);
    expect(gopherVariation("same-post")).toEqual(gopherVariation("same-post"));
    for (const v of variations) {
      expect(v.phase).toBeGreaterThanOrEqual(0);
      expect(v.phase).toBeLessThan(1);
    }
  });

  it("loads once and replaces placeholders without changing placement or post colors", async () => {
    let loads = 0;
    const pins = createGopherPins(async () => {
      loads++;
      return asset();
    });
    const a = pins.create("a", 0, "#FF8A80");
    const b = pins.create("b", 1, "#FFE082");
    a.position.set(1, 2, 3);
    a.rotation.z = 0.5;
    await pins.ready;
    expect(loads).toBe(1);
    expect(a.position.toArray()).toEqual([1, 2, 3]);
    expect(a.rotation.z).toBeCloseTo(0.5);
    expect(a.getObjectByName("pin-needle")).toBeUndefined();
    const bodyA = a.getObjectByName("Body") as Mesh;
    const bodyB = b.getObjectByName("Body") as Mesh;
    expect((bodyA.material as MeshStandardMaterial).color.getHexString()).toBe("ff8a80");
    expect((bodyB.material as MeshStandardMaterial).color.getHexString()).toBe("ffe082");
    expect(bodyA.material).not.toBe(bodyB.material);
    expect(bodyA.geometry).toBe(bodyB.geometry);
    pins.dispose();
  });

  it("does not resurrect removed pins when loading finishes", async () => {
    let resolve!: (value: GLTF) => void;
    const pins = createGopherPins(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pin = pins.create("removed", 0, "#FF8A80");
    pins.remove("removed");
    resolve(asset());
    await pins.ready;
    expect(pin.getObjectByName("Body")).toBeUndefined();
    pins.dispose();
  });

  it("keeps a usable colored fallback when model loading fails", async () => {
    const pins = createGopherPins(() => Promise.reject(new Error("offline")));
    const pin = pins.create("offline", 0, "#FF8A80");
    await pins.ready;
    expect(pin.getObjectByName("pin-head")).toBeDefined();
    pins.react("offline");
    pins.update(0.1);
    pins.dispose();
  });

  it("disposal prevents late attachment and releases the loaded asset", async () => {
    let resolve!: (value: GLTF) => void;
    const pins = createGopherPins(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pin = pins.create("late", 0, "#FF8A80");
    const gltf = asset();
    let released = false;
    (gltf.scene.getObjectByName("Body") as Mesh).geometry.addEventListener("dispose", () => {
      released = true;
    });
    pins.dispose();
    resolve(gltf);
    await pins.ready;
    expect(pin.getObjectByName("Body")).toBeUndefined();
    expect(released).toBe(true);
  });
});
