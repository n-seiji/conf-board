import { describe, expect, it } from "vitest";
import { type Rect, buildLeaderPath, decideColumn, toOverlaySpace } from "./callouts";

describe("toOverlaySpace", () => {
  it("globeRect と overlayRect が同じ位置なら座標はそのまま", () => {
    const rect: Rect = { left: 0, top: 0, width: 500, height: 500 };
    const result = toOverlaySpace(100, 200, rect, rect);
    expect(result).toEqual({ x: 100, y: 200 });
  });

  it("globeWrap が stage 内でオフセットしている分だけピン座標がずれて補正される", () => {
    // 実機で報告された値を模したケース: globeWrap が overlay (stage) より
    // 右下に (172, 195) ずれた位置にある。
    const globeRect: Rect = { left: 172, top: 195, width: 900, height: 900 };
    const overlayRect: Rect = { left: 0, top: 0, width: 1600, height: 900 };
    const result = toOverlaySpace(580, 345, globeRect, overlayRect);
    // globe 基準の (580,345) は、overlay 基準では (580+172, 345+195) = (752, 540) になる。
    expect(result).toEqual({ x: 752, y: 540 });
  });

  it("overlayRect が globeRect より右下にある場合は負方向に補正される", () => {
    const globeRect: Rect = { left: 0, top: 0, width: 900, height: 900 };
    const overlayRect: Rect = { left: 50, top: 30, width: 1600, height: 900 };
    const result = toOverlaySpace(200, 200, globeRect, overlayRect);
    expect(result).toEqual({ x: 150, y: 170 });
  });
});

describe("buildLeaderPath", () => {
  it("ピンからカード辺の中点まで、水平→斜めに1回折れる path を作る", () => {
    const path = buildLeaderPath(100, 50, 300, 80);
    // M pin L (中間点、pinY のまま) L anchor
    expect(path).toBe("M 100 50 L 200 50 L 300 80");
  });

  it("ピンとアンカーの y が同じなら実質まっすぐな線になる", () => {
    const path = buildLeaderPath(100, 50, 300, 50);
    expect(path).toBe("M 100 50 L 200 50 L 300 50");
  });
});

describe("decideColumn (列振り分けの座標系バグ回帰テスト)", () => {
  it("globeWrap ローカル座標で中心より右側のピンは右列になる", () => {
    // 実機のバグ: ビューポート座標の中心 (globeRect.left + width/2、常に非常に大きい値) と
    // 比較していたため、ローカル座標のピン x は必ずそれ以下になり全部左列になっていた。
    const globeWidth = 900;
    expect(decideColumn(700, globeWidth)).toBe("right");
  });

  it("中心より左側のピンは左列になる", () => {
    const globeWidth = 900;
    expect(decideColumn(200, globeWidth)).toBe("left");
  });

  it("ちょうど中心は左列 (境界値)", () => {
    expect(decideColumn(450, 900)).toBe("left");
  });

  it("projectedX が null (ピンが見つからない) なら左列にフォールバックする", () => {
    expect(decideColumn(null, 900)).toBe("left");
  });
});
