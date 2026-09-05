import { describe, expect, it } from "vitest";
import {
  type Rect,
  type RefillCandidate,
  bubbleRectFor,
  pickOverlapLoser,
  pickRefillCandidate,
  rectsIntersect,
  shouldEndCallout,
  toOverlaySpace,
} from "./callouts";

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

describe("shouldEndCallout (吹き出し終了判定)", () => {
  it("非表示になった場合、終了する", () => {
    expect(shouldEndCallout(0.8, false)).toBe(true);
  });

  it("dot が null の場合、終了する", () => {
    expect(shouldEndCallout(null, true)).toBe(true);
  });

  it("dot が END_DOT (0.3) 未満の場合、終了する", () => {
    expect(shouldEndCallout(0.2, true)).toBe(true);
  });

  it("表示中かつ dot が閾値以上なら終了しない", () => {
    expect(shouldEndCallout(0.5, true)).toBe(false);
  });
});

describe("bubbleRectFor (吹き出しの配置計算)", () => {
  const overlaySize = { width: 1600, height: 900 };

  it("上に十分な余白がある場合、ピンの真上・水平中央に配置する", () => {
    const { rect, placeBelow } = bubbleRectFor(500, 300, 260, 72, 14, overlaySize);
    expect(placeBelow).toBe(false);
    expect(rect.top).toBe(300 - 14 - 72);
    expect(rect.left).toBe(500 - 260 / 2);
  });

  it("画面上端に近く上にはみ出す場合、下側に反転配置する", () => {
    const { rect, placeBelow } = bubbleRectFor(500, 50, 260, 72, 14, overlaySize);
    expect(placeBelow).toBe(true);
    expect(rect.top).toBe(50 + 14);
  });

  it("左端をはみ出す場合、overlay の左端 (0) にクランプする", () => {
    const { rect } = bubbleRectFor(20, 300, 260, 72, 14, overlaySize);
    expect(rect.left).toBe(0);
  });

  it("右端をはみ出す場合、overlay の右端に収まるようクランプする", () => {
    const { rect } = bubbleRectFor(1590, 300, 260, 72, 14, overlaySize);
    expect(rect.left).toBe(overlaySize.width - 260);
  });
});

describe("rectsIntersect (矩形の重なり判定)", () => {
  it("重なっている場合、true を返す", () => {
    const a: Rect = { left: 0, top: 0, width: 100, height: 50 };
    const b: Rect = { left: 50, top: 20, width: 100, height: 50 };
    expect(rectsIntersect(a, b)).toBe(true);
  });

  it("離れている場合、false を返す", () => {
    const a: Rect = { left: 0, top: 0, width: 100, height: 50 };
    const b: Rect = { left: 200, top: 200, width: 100, height: 50 };
    expect(rectsIntersect(a, b)).toBe(false);
  });

  it("辺が接するだけ (重なりが無い) 場合、false を返す", () => {
    const a: Rect = { left: 0, top: 0, width: 100, height: 50 };
    const b: Rect = { left: 100, top: 0, width: 100, height: 50 };
    expect(rectsIntersect(a, b)).toBe(false);
  });
});

describe("pickRefillCandidate (リフィル候補の選定)", () => {
  const globeCenterX = 450;
  const overlaySize = { width: 1600, height: 900 };
  const now = 100_000;

  const base = (overrides: Partial<RefillCandidate> & { id: string }): RefillCandidate => ({
    createdAt: 0,
    projectedX: 200,
    projectedY: 300,
    visible: true,
    dot: 0.8,
    hasCard: false,
    lastShownAt: null,
    ...overrides,
  });

  it("非表示のピンはスキップされる", () => {
    const candidates = [base({ id: "a", visible: false })];
    expect(pickRefillCandidate(candidates, globeCenterX, overlaySize, [], now)).toBeNull();
  });

  it("既にカードがある投稿はスキップされる", () => {
    const candidates = [base({ id: "a", hasCard: true })];
    expect(pickRefillCandidate(candidates, globeCenterX, overlaySize, [], now)).toBeNull();
  });

  it("右半分 (x >= globeCenterX) で dot が 0.75 未満の投稿はスキップされる (まもなく縁に隠れるため)", () => {
    const candidates = [base({ id: "a", projectedX: 700, dot: 0.5 })];
    expect(pickRefillCandidate(candidates, globeCenterX, overlaySize, [], now)).toBeNull();
  });

  it("左半分でも dot が 0.35 未満 (消える閾値の直前) の投稿はスキップされる (出た瞬間に消えるちらつき防止)", () => {
    const candidates = [base({ id: "a", projectedX: 200, dot: 0.32 })];
    expect(pickRefillCandidate(candidates, globeCenterX, overlaySize, [], now)).toBeNull();
  });

  it("右半分で dot が 0.75 以上なら候補になる", () => {
    const candidates = [base({ id: "a", projectedX: 700, dot: 0.75 })];
    expect(pickRefillCandidate(candidates, globeCenterX, overlaySize, [], now)).toBe("a");
  });

  it("左半分は dot が 0.35 以上なら (右半分の 0.75 に満たなくても) 候補になる", () => {
    const candidates = [base({ id: "a", projectedX: 200, dot: 0.4 })];
    expect(pickRefillCandidate(candidates, globeCenterX, overlaySize, [], now)).toBe("a");
  });

  it("既存の吹き出しと重なる候補はスキップされる", () => {
    const candidates = [base({ id: "a", projectedX: 200, projectedY: 300 })];
    // ピン (200,300) 直上の推定吹き出し矩形と重なる既存矩形を用意する。
    const existingRects: Rect[] = [{ left: 0, top: 150, width: 400, height: 200 }];
    expect(
      pickRefillCandidate(candidates, globeCenterX, overlaySize, existingRects, now),
    ).toBeNull();
  });

  it("推定矩形が既存の吹き出しの OVERLAP_MARGIN_PX (12px) 以内に近づく候補はスキップされる", () => {
    const candidates = [base({ id: "a", projectedX: 200, projectedY: 300 })];
    // candidate (200,300) の推定矩形は概ね left=70,top=172,width=260,height=114
    // (ESTIMATED_BUBBLE_H(100) + BUBBLE_GAP_PX(14))。その直下 5px の位置に既存矩形を
    // 置くと、非拡張では重ならないが、双方を 12px 拡張すると重なる。
    const existingRects: Rect[] = [{ left: 70, top: 291, width: 260, height: 50 }];
    expect(
      pickRefillCandidate(candidates, globeCenterX, overlaySize, existingRects, now),
    ).toBeNull();
  });

  it("優先順位は投稿の新しい順 (createdAt 降順) のみになる", () => {
    const candidates = [base({ id: "older", createdAt: 1 }), base({ id: "newer", createdAt: 2 })];
    expect(pickRefillCandidate(candidates, globeCenterX, overlaySize, [], now)).toBe("newer");
  });

  it("一度も表示されていない (lastShownAt が null) ピンは、いつでも候補になる", () => {
    const candidates = [base({ id: "a", lastShownAt: null })];
    expect(pickRefillCandidate(candidates, globeCenterX, overlaySize, [], now)).toBe("a");
  });

  it("吹き出しが消えてから RESHOW_COOLDOWN_MS (3000ms) 未満のピンはスキップされる", () => {
    const candidates = [base({ id: "a", lastShownAt: now - 2000 })];
    expect(pickRefillCandidate(candidates, globeCenterX, overlaySize, [], now)).toBeNull();
  });

  it("吹き出しが消えてから RESHOW_COOLDOWN_MS (3000ms) 以上経てば再び候補になる", () => {
    const candidates = [base({ id: "a", lastShownAt: now - 3000 })];
    expect(pickRefillCandidate(candidates, globeCenterX, overlaySize, [], now)).toBe("a");
  });

  it("該当する候補が無ければ null を返す", () => {
    expect(pickRefillCandidate([], globeCenterX, overlaySize, [], now)).toBeNull();
  });
});

describe("pickOverlapLoser (重なった吹き出しのどちらを消すか)", () => {
  const now = 10_000;

  it("両方とも十分に経過している場合、shownAt が古い方を消す", () => {
    const a = { shownAt: now - 5000 };
    const b = { shownAt: now - 2000 };
    expect(pickOverlapLoser(a, b, now)).toBe(a);
  });

  it("片方が MIN_AGE_BEFORE_OVERLAP_REMOVE_MS (1500ms) 未満しか経過していない場合、もう片方 (古い方) を消す", () => {
    // b は補充されたばかり (経過 500ms)。a は経過済みだが b より新しい。
    // shownAt だけで見ると a を消すべきだが、b を保護して代わりに a を消す。
    const a = { shownAt: now - 3000 };
    const b = { shownAt: now - 500 };
    expect(pickOverlapLoser(a, b, now)).toBe(a);
  });

  it("両方ともまだ若い場合、shownAt が古い方を消す", () => {
    const a = { shownAt: now - 1000 };
    const b = { shownAt: now - 200 };
    expect(pickOverlapLoser(a, b, now)).toBe(a);
  });
});
