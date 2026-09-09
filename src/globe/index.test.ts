import {
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  SphereGeometry,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";
import { GlobeRig, TILT_DEG, frontFacingAngle, latLonToVector3 } from "./rig";

const CAMERA_FOV = 25;

/**
 * setRotationTo と同じ回転 (spinGroup は Y 軸のみ、tiltGroup の X 軸をその地点の緯度に合わせる)
 * を Three.js のオブジェクトグラフで再現するテスト用ヘルパー。
 * 北が上のまま (ロール無し) 対象地点をカメラ正面に合わせたシーンで、
 * 任意の緯度経度の点を同じ回転のもとで投影できるようにする。
 */
const createRotatedScene = (
  lat: number,
  lon: number,
): Readonly<{
  project: (
    pointLat: number,
    pointLon: number,
  ) => Readonly<{ ndcX: number; ndcY: number; dot: number }>;
}> => {
  const tiltGroup = new Group();
  const spinGroup = new Group();
  tiltGroup.add(spinGroup);

  const dir = latLonToVector3(lat, lon, 1).normalize();
  spinGroup.rotation.y = frontFacingAngle(dir);
  tiltGroup.rotation.x = (lat * Math.PI) / 180;
  tiltGroup.updateMatrixWorld(true);

  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const cameraDir = camera.position.clone().normalize();

  const project = (
    pointLat: number,
    pointLon: number,
  ): Readonly<{ ndcX: number; ndcY: number; dot: number }> => {
    const pin = new Object3D();
    const pointDir = latLonToVector3(pointLat, pointLon, 1);
    pin.position.copy(pointDir).multiplyScalar(1.006);
    spinGroup.add(pin);
    tiltGroup.updateMatrixWorld(true);

    const worldPos = pin.getWorldPosition(new Vector3());
    const ndc = worldPos.clone().project(camera);
    const normal = worldPos.clone().normalize();
    spinGroup.remove(pin);

    return { ndcX: ndc.x, ndcY: ndc.y, dot: normal.dot(cameraDir) };
  };

  return { project };
};

describe("setRotationTo が使う回転 (Y軸spin + X軸tilt、北が上のまま正面に合わせる)", () => {
  const samples: ReadonlyArray<readonly [number, number]> = [
    [35, 139],
    [0, 0],
    [-33, -70],
    [60, -100],
    [10, 170],
    [-10, -170],
    [85, 20],
    [-85, 20],
  ];

  it.each(samples)("lat=%d lon=%d のとき対象点が球の中心 (NDC ±10%%) に来る", (lat, lon) => {
    const scene = createRotatedScene(lat, lon);
    const { ndcX, ndcY, dot } = scene.project(lat, lon);
    expect(Math.abs(ndcX)).toBeLessThan(0.1);
    expect(Math.abs(ndcY)).toBeLessThan(0.1);
    expect(dot).toBeGreaterThan(0.99);
  });

  it.each(samples)(
    "lat=%d lon=%d のとき、真北に10度進んだ点の NDC.y が対象点より大きい (=画面で上、北が上)",
    (lat, lon) => {
      const scene = createRotatedScene(lat, lon);
      const center = scene.project(lat, lon);
      const north = scene.project(Math.min(lat + 10, 90), lon);
      expect(north.ndcY).toBeGreaterThan(center.ndcY);
    },
  );
});

/**
 * createGlobe の実際のカメラ設定 (PerspectiveCamera(25, aspect, 0.1, 100), position (0,0,5)、
 * lookAt 無し) と `projectPin` の NDC→px 変換式をそのまま再現し、「正面のピンのスクリーン x が
 * 時間とともに増える (左→右)」という実機での判定基準をテストで固定する。
 * (以前の rig.test.ts の検証は世界座標の法線 x だけを見ており、実際のスクリーン座標変換とは
 * 一致していなかった。ここでは createGlobe と同じ変換式を使うことでその食い違いを無くす。)
 */
describe("createGlobe と同じカメラ/projectPin 変換での自転方向 (実機と同じ計算)", () => {
  const CONTAINER_WIDTH = 593;
  const CONTAINER_HEIGHT = 593;

  const projectToScreen = (
    camera: PerspectiveCamera,
    pinObject: Object3D,
  ): Readonly<{ x: number; y: number }> => {
    const worldPos = pinObject.getWorldPosition(new Vector3());
    const ndc = worldPos.clone().project(camera);
    const x = (ndc.x * 0.5 + 0.5) * CONTAINER_WIDTH;
    const y = (1 - (ndc.y * 0.5 + 0.5)) * CONTAINER_HEIGHT;
    return { x, y };
  };

  it("正面 (dot 最大) のピンのスクリーン x が時間とともに増える", () => {
    const rig = new GlobeRig(TILT_DEG);

    // createGlobe と全く同じカメラ設定 (lookAt を呼ばない default orientation)。
    const camera = new PerspectiveCamera(25, CONTAINER_WIDTH / CONTAINER_HEIGHT, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    const dir = latLonToVector3(35, 139, 1);
    const pinObject = new Mesh(new SphereGeometry(0.018, 12, 12), new MeshBasicMaterial());
    pinObject.position.copy(dir).multiplyScalar(1.006);
    rig.addPin("p", pinObject, dir);
    rig.setRotationTo(35, 139);

    const positions: number[] = [];
    let now = 0;
    for (let i = 0; i < 6; i++) {
      const { x } = projectToScreen(camera, pinObject);
      positions.push(x);
      now += 500;
      rig.tick(0.5, now);
    }

    // 正面から出発して、時間とともにスクリーン x が単調に増えること (=左→右に流れる)。
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1];
      const curr = positions[i];
      expect(prev).toBeDefined();
      expect(curr).toBeDefined();
      expect(curr as number).toBeGreaterThan(prev as number);
    }
  });
});
