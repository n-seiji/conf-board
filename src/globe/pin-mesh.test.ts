import { Box3, Group, Mesh, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createPinObject, orientPinToNormal, PIN_HEIGHT, pinQuaternionFor } from "./pin-mesh";

describe("pinQuaternionFor: 法線方向にローカル +Y を向ける quaternion を求める", () => {
  it("法線が (0,1,0) の場合、回転なし (単位 quaternion) になる", () => {
    const q = pinQuaternionFor(new Vector3(0, 1, 0));
    expect(q.x).toBeCloseTo(0, 6);
    expect(q.y).toBeCloseTo(0, 6);
    expect(q.z).toBeCloseTo(0, 6);
    expect(q.w).toBeCloseTo(1, 6);
  });

  it.each([[new Vector3(1, 0, 0)], [new Vector3(0, 0, 1)], [new Vector3(1, 1, 1).normalize()]])(
    "法線 %o に回転後、ローカル +Y がその法線と同じ向きになる",
    (normal) => {
      const q = pinQuaternionFor(normal);
      const rotatedUp = new Vector3(0, 1, 0).applyQuaternion(q);
      expect(rotatedUp.x).toBeCloseTo(normal.x, 6);
      expect(rotatedUp.y).toBeCloseTo(normal.y, 6);
      expect(rotatedUp.z).toBeCloseTo(normal.z, 6);
    },
  );
});

describe("orientPinToNormal: オブジェクトの姿勢を法線方向に揃える", () => {
  it("法線 (1,0,0) を渡すと、object のローカル +Y が world +X を向く", () => {
    const object = new Group();
    orientPinToNormal(object, new Vector3(1, 0, 0));
    const rotatedUp = new Vector3(0, 1, 0).applyQuaternion(object.quaternion);
    expect(rotatedUp.x).toBeCloseTo(1, 6);
    expect(rotatedUp.y).toBeCloseTo(0, 6);
    expect(rotatedUp.z).toBeCloseTo(0, 6);
  });
});

describe("createPinObject: ピンの 3D オブジェクトを生成する", () => {
  it("名前が pin の Group を返し、pin-needle と pin-head の 2 つの子を持つ", () => {
    const object = createPinObject(0, "#FF8A80");
    expect(object).toBeInstanceOf(Group);
    expect(object.name).toBe("pin");
    const names = object.children.map((child) => child.name).sort();
    expect(names).toEqual(["pin-head", "pin-needle"]);
  });

  it("先端が原点にあり、全体の高さがおよそ PIN_HEIGHT になる", () => {
    const object = createPinObject(0, "#FF8A80");
    const box = new Box3().setFromObject(object);
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.max.y).toBeCloseTo(PIN_HEIGHT, 2);
  });

  it("同じ colorId で 2 回作成すると、マテリアルインスタンスが共有される", () => {
    const a = createPinObject(1, "#FFE082");
    const b = createPinObject(1, "#FFE082");
    const materialOf = (object: typeof a): unknown => {
      const mesh = object.children.find((child) => child.name === "pin-needle") as Mesh;
      return mesh.material;
    };
    expect(materialOf(a)).toBe(materialOf(b));
  });
});
