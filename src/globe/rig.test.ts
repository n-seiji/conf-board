import { Mesh, MeshBasicMaterial, SphereGeometry } from "three";
import { describe, expect, it } from "vitest";
import { GlobeRig, latLonToVector3, opacityForDot, pinSpriteRotation } from "./rig";

const BACKSIDE_DOT_THRESHOLD = 0.15;

const makePinMesh = () => new Mesh(new SphereGeometry(0.01, 4, 4), new MeshBasicMaterial());

describe("GlobeRig.setRotationTo (a)", () => {
  const samples: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [0, 90],
    [0, -90],
    [0, 180],
    [40, 0],
    [-40, 0],
    [40, 90],
    [-40, -90],
  ];

  it.each(samples)(
    "lat=%d lon=%d のとき、その地点の world z が最大 (dot=1 相当) かつ world x が球中心の±5%%以内",
    (lat, lon) => {
      const rig = new GlobeRig();
      const mesh = makePinMesh();
      const dir = latLonToVector3(lat, lon, 1);
      mesh.position.copy(dir).multiplyScalar(1.006);
      rig.addPin("p", mesh, dir);

      rig.setRotationTo(lat, lon);

      const projected = rig.projectPin("p", BACKSIDE_DOT_THRESHOLD);
      expect(projected).not.toBeNull();
      // dot (法線・(0,0,1)) が最大値 1 に極めて近い = z が最大。
      expect(projected?.dot).toBeGreaterThan(0.995);
      // world x はほぼ 0 (球半径 1 の ±5% 以内)。
      expect(Math.abs(projected?.normal.x ?? 1)).toBeLessThan(0.05);
    },
  );
});

describe("GlobeRig.tick (b): 自転方向が左→右", () => {
  it("正面 (z最大) にあるピンに tick(0.1) を適用すると world x が増える", () => {
    const rig = new GlobeRig();
    const mesh = makePinMesh();
    // setRotationTo でこの点を正面 (dot=1) に合わせてから検証する。
    const dir = latLonToVector3(0, 90, 1);
    mesh.position.copy(dir).multiplyScalar(1.006);
    rig.addPin("p", mesh, dir);
    rig.setRotationTo(0, 90);

    const before = rig.projectPin("p", BACKSIDE_DOT_THRESHOLD);
    rig.tick(0.1, performance.now());
    const after = rig.projectPin("p", BACKSIDE_DOT_THRESHOLD);

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after?.normal.x ?? 0).toBeGreaterThan(before?.normal.x ?? 0);
  });
});

describe("GlobeRig.focusPin (c)", () => {
  it("現在角から最短方向で目標角に到達し、到達後は通常の自転が続く", () => {
    const rig = new GlobeRig();
    const mesh = makePinMesh();
    const dir = latLonToVector3(0, 90, 1);
    mesh.position.copy(dir).multiplyScalar(1.006);
    rig.addPin("p", mesh, dir);

    // 現在の回転角を大きくずらしておく (最短方向で戻ることを確認するため)。
    rig.setRotationTo(0, -90);

    let arrivedCount = 0;
    const now0 = 1000;
    rig.focusPin("p", now0, 300, () => {
      arrivedCount++;
    });
    expect(rig.isFocusing()).toBe(true);

    // アニメーション中 (途中経過)。
    rig.tick(0.1, now0 + 150);
    expect(rig.isFocusing()).toBe(true);
    expect(arrivedCount).toBe(0);

    // アニメーション完了時刻を過ぎたら onArrived が呼ばれ、focus が終了する。
    rig.tick(0.1, now0 + 300);
    expect(arrivedCount).toBe(1);
    expect(rig.isFocusing()).toBe(false);

    const arrived = rig.projectPin("p", BACKSIDE_DOT_THRESHOLD);
    expect(arrived?.dot).toBeGreaterThan(0.99);

    // 到達後は通常の自転が続く (回転が止まらず動き続ける。向き自体は (b) で検証済み)。
    const afterArrival = rig.projectPin("p", BACKSIDE_DOT_THRESHOLD);
    rig.tick(0.1, now0 + 400);
    const afterAutoRotate = rig.projectPin("p", BACKSIDE_DOT_THRESHOLD);
    expect(afterAutoRotate?.normal.x ?? 0).not.toBeCloseTo(afterArrival?.normal.x ?? 0, 5);
  });

  it("目標角までの回転は常に最短方向 (π を超えない) で行われる", () => {
    const rig = new GlobeRig();
    const mesh = makePinMesh();
    const dir = latLonToVector3(0, 0, 1);
    mesh.position.copy(dir).multiplyScalar(1.006);
    rig.addPin("p", mesh, dir);

    rig.focusPin("p", 0, 900);
    // private だが、動作からの推定: 900ms 経過させて到達させ、回転量が 2π 未満に収まることを
    // spinGroup.rotation.y の総変化量から確認する (単純に |Δrotation| <= π であるはず)。
    const beforeY = rig.spinGroup.rotation.y;
    rig.tick(0.9, 900);
    const afterY = rig.spinGroup.rotation.y;
    const delta = Math.abs(afterY - beforeY);
    expect(delta).toBeLessThanOrEqual(Math.PI + 1e-6);
  });
});

describe("GlobeRig.projectPin (d): 裏側判定", () => {
  it("正面のピンは visible=true", () => {
    const rig = new GlobeRig();
    const mesh = makePinMesh();
    const dir = latLonToVector3(0, 90, 1);
    mesh.position.copy(dir).multiplyScalar(1.006);
    rig.addPin("p", mesh, dir);
    rig.setRotationTo(0, 90);

    const projected = rig.projectPin("p", BACKSIDE_DOT_THRESHOLD);
    expect(projected?.visible).toBe(true);
    expect(projected?.dot).toBeGreaterThan(BACKSIDE_DOT_THRESHOLD);
  });

  it("裏側のピンは visible=false", () => {
    const rig = new GlobeRig();
    const mesh = makePinMesh();
    const dir = latLonToVector3(0, 90, 1);
    mesh.position.copy(dir).multiplyScalar(1.006);
    rig.addPin("p", mesh, dir);
    // 正面 (lon=90) の反対 (lon=-90) を正面にする = このピンは裏側に来る。
    rig.setRotationTo(0, -90);

    const projected = rig.projectPin("p", BACKSIDE_DOT_THRESHOLD);
    expect(projected?.visible).toBe(false);
    expect(projected?.dot).toBeLessThan(BACKSIDE_DOT_THRESHOLD);
  });
});

describe("GlobeRig: focusPin 到達直後に tick を挟まず projectPin できる (staleness 回帰テスト)", () => {
  it("onArrived コールバック内で projectPin しても最新の回転結果が反映されている", () => {
    const rig = new GlobeRig();
    const mesh = makePinMesh();
    const dir = latLonToVector3(0, 90, 1);
    mesh.position.copy(dir).multiplyScalar(1.006);
    rig.addPin("p", mesh, dir);
    rig.setRotationTo(0, -90); // ピンを裏側からスタートさせる

    let dotAtArrival: number | null = null;
    rig.focusPin("p", 0, 900, () => {
      // tick() が onArrived を呼ぶ「その場」で projectPin した値が、
      // 別途 tick 後に呼んだ場合と同じ (= 古い行列を読んでいない) ことを確認する。
      dotAtArrival = rig.projectPin("p", BACKSIDE_DOT_THRESHOLD)?.dot ?? null;
    });
    rig.tick(0.9, 900);

    expect(dotAtArrival).not.toBeNull();
    expect(dotAtArrival as unknown as number).toBeGreaterThan(0.99);
  });
});

describe("GlobeRig.focusPin: 連続到着時のキューイング (取りこぼし回帰テスト)", () => {
  it("focus 中に別の focusPin を呼んでも、先発の onArrived が失われず両方とも順番に呼ばれる", () => {
    const rig = new GlobeRig();
    const addPinAt = (id: string, lat: number, lon: number) => {
      const mesh = makePinMesh();
      const dir = latLonToVector3(lat, lon, 1);
      mesh.position.copy(dir).multiplyScalar(1.006);
      rig.addPin(id, mesh, dir);
    };
    addPinAt("a", 0, 90);
    addPinAt("b", 0, -90);

    const arrivedOrder: string[] = [];
    // 投稿 a が届いて focus 開始 (900ms アニメーション)。
    rig.focusPin("a", 0, 900, () => arrivedOrder.push("a"));
    // その 100ms 後、まだ a のアニメーション中に投稿 b が届く (900ms 未満の間隔)。
    rig.focusPin("b", 100, 900, () => arrivedOrder.push("b"));

    // a のアニメーションが完了する時刻まで進める。
    rig.tick(0.1, 100);
    rig.tick(0.8, 900);
    expect(arrivedOrder).toEqual(["a"]);
    expect(rig.isFocusing()).toBe(true); // 続けて b の focus が自動的に始まっている

    // b のアニメーションも完了させる (a 完了時刻 900ms から 900ms 後)。
    rig.tick(0.9, 1800);
    expect(arrivedOrder).toEqual(["a", "b"]);
    expect(rig.isFocusing()).toBe(false);
  });

  it("3件が短間隔で連続到着しても、全件の onArrived が呼ばれる (1件も欠落しない)", () => {
    const rig = new GlobeRig();
    for (const id of ["a", "b", "c"]) {
      const mesh = makePinMesh();
      const dir = latLonToVector3(0, 90, 1);
      mesh.position.copy(dir).multiplyScalar(1.006);
      rig.addPin(id, mesh, dir);
    }

    const arrivedOrder: string[] = [];
    rig.focusPin("a", 0, 900, () => arrivedOrder.push("a"));
    rig.focusPin("b", 30, 900, () => arrivedOrder.push("b"));
    rig.focusPin("c", 60, 900, () => arrivedOrder.push("c"));

    // 3件それぞれの完了時刻を跨いで十分な時間 tick する。
    let now = 60;
    for (let i = 0; i < 40; i++) {
      now += 100;
      rig.tick(0.1, now);
    }

    expect(arrivedOrder).toEqual(["a", "b", "c"]);
  });

  it("キューが上限を超えた分は focus せずその場で即座に onArrived を呼ぶ (自転停止の防止)", () => {
    const rig = new GlobeRig();
    for (const id of ["a", "b", "c", "d", "e"]) {
      const mesh = makePinMesh();
      const dir = latLonToVector3(0, 90, 1);
      mesh.position.copy(dir).multiplyScalar(1.006);
      rig.addPin(id, mesh, dir);
    }

    const arrivedOrder: string[] = [];
    rig.focusPin("a", 0, 900, () => arrivedOrder.push("a")); // 即座に focusAnimation として開始
    rig.focusPin("b", 0, 900, () => arrivedOrder.push("b")); // キューへ (1件目)
    rig.focusPin("c", 0, 900, () => arrivedOrder.push("c")); // キューへ (2件目)
    rig.focusPin("d", 0, 900, () => arrivedOrder.push("d")); // キューへ (3件目、上限)
    rig.focusPin("e", 0, 900, () => arrivedOrder.push("e")); // 上限超過 → 即座に onArrived

    // e はまだ何も tick していない時点で、既に即着地扱いで呼ばれているはず。
    expect(arrivedOrder).toEqual(["e"]);
  });

  it("キューに後続が残っている間は 1 件あたりの所要時間が短縮される", () => {
    const rig = new GlobeRig();
    for (const id of ["a", "b", "c"]) {
      const mesh = makePinMesh();
      const dir = latLonToVector3(0, 90, 1);
      mesh.position.copy(dir).multiplyScalar(1.006);
      rig.addPin(id, mesh, dir);
    }

    const arrivedOrder: string[] = [];
    // a b c を tick 前に一気に積む: a は即座に開始 (キュー長 0)、b・c はキューに残る。
    rig.focusPin("a", 0, 900, () => arrivedOrder.push("a"));
    rig.focusPin("b", 0, 900, () => arrivedOrder.push("b"));
    rig.focusPin("c", 0, 900, () => arrivedOrder.push("c"));

    // a 完了時、キューには [b, c] が残っている (b を取り出した後もキュー長 1 > 0) ので
    // b は 900ms ではなく BACKLOG_DURATION_MS (500ms) で完了するはず。
    rig.tick(0.9, 900); // a 完了、b 開始
    expect(arrivedOrder).toEqual(["a"]);
    rig.tick(0.499, 900 + 499);
    expect(arrivedOrder).toEqual(["a"]); // まだ 500ms 経っていない
    rig.tick(0.001, 900 + 500);
    expect(arrivedOrder).toEqual(["a", "b"]); // 500ms で完了 (900ms 短縮されている)

    // b 完了時点でキューは空 ([c] を取り出した後キュー長 0) になるので、
    // c は短縮されず指定どおり 900ms かかる。
    rig.tick(0.899, 900 + 500 + 899);
    expect(arrivedOrder).toEqual(["a", "b"]); // まだ 900ms 経っていない
    rig.tick(0.001, 900 + 500 + 900);
    expect(arrivedOrder).toEqual(["a", "b", "c"]);
  });
});

describe("opacityForDot: ピン Sprite の limb 付近フェード (はみ出し回帰テスト)", () => {
  it("正面 (dot が十分大きい) では完全に不透明", () => {
    expect(opacityForDot(1)).toBe(1);
    expect(opacityForDot(0.35)).toBe(1);
  });

  it("limb 付近 (dot が低い) では完全に透明になる", () => {
    expect(opacityForDot(0.2)).toBe(0);
    expect(opacityForDot(0.1)).toBe(0);
    expect(opacityForDot(-0.5)).toBe(0);
  });

  it("フェード区間の中間では 0 と 1 の間の値になる (突然消えない)", () => {
    const mid = opacityForDot(0.275); // 0.35 と 0.2 のちょうど中間
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeCloseTo(0.5, 5);
  });
});

describe("pinSpriteRotation: ピン Sprite を球面法線に垂直に立たせる回転 (垂直立て回帰テスト)", () => {
  it("法線が真上 (0,1) の場合、回転なし (直立) になる", () => {
    expect(pinSpriteRotation(0, 1)).toBeCloseTo(0, 10);
  });

  it("法線が右 (1,0) の場合、上方向が +x を向くよう -π/2 回転する", () => {
    expect(pinSpriteRotation(1, 0)).toBeCloseTo(-Math.PI / 2, 10);
  });

  it("法線が左 (-1,0) の場合、上方向が -x を向くよう +π/2 回転する", () => {
    expect(pinSpriteRotation(-1, 0)).toBeCloseTo(Math.PI / 2, 10);
  });

  it("法線が真下 (0,-1) の場合、回転量の絶対値が π になる", () => {
    expect(Math.abs(pinSpriteRotation(0, -1))).toBeCloseTo(Math.PI, 10);
  });

  it("法線がほぼ 0 (中央、真正面向き) の場合、回転なしになる", () => {
    expect(pinSpriteRotation(0, 0)).toBe(0);
  });

  it("任意の法線について、回転後の上方向ベクトルが法線と同じ向きに揃う", () => {
    const samples: ReadonlyArray<readonly [number, number]> = [
      [0.3, 0.7],
      [-0.6, 0.2],
      [0.9, -0.1],
      [-0.4, -0.5],
      [0.05, -0.99],
    ];
    for (const [nx, ny] of samples) {
      const r = pinSpriteRotation(nx, ny);
      const upX = -Math.sin(r);
      const upY = Math.cos(r);
      const dot = upX * nx + upY * ny;
      const normalLen = Math.hypot(nx, ny);
      // 単位ベクトル同士の内積が 1 に近い = ほぼ同じ向き。
      expect(dot / normalLen).toBeCloseTo(1, 5);
    }
  });
});
