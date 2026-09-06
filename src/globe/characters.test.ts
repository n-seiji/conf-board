import { describe, expect, it, vi } from "vitest";
import {
  Bone,
  Vector3,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Color,
  type WebGLRenderer,
} from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { createRenPins, isRenPost } from "./characters";

describe("Ren pins", () => {
  it("colors each shirt logo independently without changing the shared face material", async () => {
    const scene = new Group();
    const material = new MeshBasicMaterial();
    const shirt = new Mesh(new BoxGeometry(), material);
    shirt.name = "T-shirt_•_continuous_shoulders_and_sleeves";
    const face = new Mesh(shirt.geometry, material);
    face.name = "Face";
    scene.add(shirt, face);
    const pins = createRenPins(async () => ({ scene, animations: [] }) as unknown as GLTF);
    const red = pins.create("red", 0, "#ff0000");
    await pins.ready;
    const blue = pins.create("blue", 3, "#0000ff");
    const logoMaterial = (pin: Group) =>
      (pin.getObjectByName(shirt.name) as Mesh).material as MeshBasicMaterial;
    const redMaterial = logoMaterial(red);
    const blueMaterial = logoMaterial(blue);
    expect(redMaterial).not.toBe(blueMaterial);
    for (const [pin, expected] of [
      [red, "ff0000"],
      [blue, "0000ff"],
    ] as const) {
      expect((pin.getObjectByName("Face") as Mesh).material).toBe(material);
      const shader = {
        uniforms: {},
        fragmentShader: "#include <map_fragment>",
        vertexShader: "",
      } as Parameters<typeof material.onBeforeCompile>[0];
      logoMaterial(pin).onBeforeCompile(shader, {} as WebGLRenderer);
      expect((shader.uniforms.renLogoColor!.value as Color).getHexString()).toBe(expected);
      expect(shader.fragmentShader).toContain("mix(diffuseColor.rgb, renLogoColor, logoMask)");
    }
    const disposeRed = vi.spyOn(redMaterial, "dispose");
    const disposeBlue = vi.spyOn(blueMaterial, "dispose");
    pins.remove("red");
    expect(disposeRed).toHaveBeenCalledOnce();
    expect(disposeBlue).not.toHaveBeenCalled();
    pins.dispose();
    expect(disposeBlue).toHaveBeenCalledOnce();
  });
  it("uses the persistent post sequence starting at 150, including restored posts", () => {
    expect([1, 149, 150, 151, 500].map((seq) => isRenPost(seq))).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
  });
  it("preserves the shirt color, enlarges Ren by 1.3 and uses normal depth rendering", async () => {
    const scene = new Group();
    const material = new MeshBasicMaterial({ color: "#121212" });
    material.name = "BodyColor";
    scene.add(new Mesh(new BoxGeometry(1, 3.083, 1), material));
    const gltf = { scene, animations: [] } as unknown as GLTF;
    const pins = createRenPins(async () => gltf);
    const pin = pins.create("ren", 0, "#ff0000");
    await pins.ready;
    expect(pin.name).toBe("ren-pin");
    const model = pin.children[0]!;
    expect(model.scale.x * 3.083).toBeCloseTo(0.24 * 1.3);
    model.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      expect(o.layers.mask).toBe(1);
      expect((o.material as MeshBasicMaterial).color.getHexString()).toBe("121212");
    });
    pins.dispose();
  });
});

it("leans Ren's spine on selection while keeping his feet planted", async () => {
  const scene = new Group();
  const hips = new Bone();
  hips.name = "Hips";
  hips.position.y = 0.73;
  const spine = new Bone();
  spine.name = "Spine";
  spine.position.y = 0.27;
  const head = new Bone();
  head.name = "Head";
  head.position.y = 0.55;
  const foot = new Bone();
  foot.name = "FootL";
  foot.position.set(-0.25, -0.5, 0);
  scene.add(hips);
  hips.add(spine, foot);
  spine.add(head);
  const pins = createRenPins(async () => ({ scene, animations: [] }) as unknown as GLTF);
  const object = pins.create("selected", 0, "#ffffff");
  await pins.ready;
  const beforeFoot = object.getObjectByName("FootL")!.getWorldPosition(new Vector3());
  const beforeHead = pins.headPosition("selected")!.clone();
  pins.lookUp("selected");
  for (let i = 0; i < 60; i++) pins.update(0.05);
  expect(object.getObjectByName("Spine")!.rotation.x).toBeLessThan(-0.9);
  expect(pins.headPosition("selected")!.z).toBeLessThan(beforeHead.z - 0.1);
  expect(
    object.getObjectByName("FootL")!.getWorldPosition(new Vector3()).distanceTo(beforeFoot),
  ).toBeLessThan(1e-6);
  pins.lookUp(null);
  for (let i = 0; i < 60; i++) pins.update(0.05);
  expect(pins.headPosition("selected")!.distanceTo(beforeHead)).toBeLessThan(1e-4);
  pins.dispose();
});
