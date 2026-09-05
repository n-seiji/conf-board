import { describe, expect, it } from "vitest";
import {
  type Rect,
  type RefillCandidate,
  pickOverlapLoser,
  pickRefillCandidate,
  placeBubble,
  preferredSideFor,
  rectsIntersect,
  shouldEndCallout,
  shouldRefill,
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

describe("preferredSideFor (優先 side の判定)", () => {
  it("ピンが球の中心より左の場合、left を優先する", () => {
    expect(preferredSideFor(200, 450)).toBe("left");
  });

  it("ピンが球の中心より右の場合、right を優先する", () => {
    expect(preferredSideFor(700, 450)).toBe("right");
  });

  it("ピンがちょうど中心の場合、right を優先する", () => {
    expect(preferredSideFor(450, 450)).toBe("right");
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

describe("placeBubble (side 選択と配置計算)", () => {
  const size = { width: 260, height: 72 };
  const gap = 14;
  const overlaySize = { width: 1600, height: 900 };

  it("優先 side が空いている場合、その side に配置する", () => {
    const result = placeBubble(500, 300, size, gap, overlaySize, [], "top");
    expect(result?.side).toBe("top");
    expect(result?.rect.top).toBe(300 - gap - size.height);
    expect(result?.rect.left).toBe(500 - size.width / 2);
  });

  // top/left/right/bottom の4矩形が互いに重ならないよう、gap をバブル寸法より
  // 十分大きく取ったケース (`wideGap`) を使う。gap が小さいとどの側も同じピンの
  // すぐ近くに置かれるため、"top を塞いだら left も一緒に塞がってしまう" という
  // 意図しない重なりが生じてしまう。
  const wideGap = 40;
  const smallSize = { width: 100, height: 20 };
  const rectForSideTest = (
    side: "top" | "left" | "right" | "bottom",
    pinX: number,
    pinY: number,
  ): Rect => {
    if (side === "top") {
      return {
        left: pinX - smallSize.width / 2,
        top: pinY - wideGap - smallSize.height,
        ...smallSize,
      };
    }
    if (side === "bottom") {
      return {
        left: pinX - smallSize.width / 2,
        top: pinY + wideGap,
        ...smallSize,
      };
    }
    if (side === "left") {
      return {
        left: pinX - wideGap - smallSize.width,
        top: pinY - smallSize.height / 2,
        ...smallSize,
      };
    }
    return {
      left: pinX + wideGap,
      top: pinY - smallSize.height / 2,
      ...smallSize,
    };
  };

  it("優先 side の矩形が既存と重なる場合、次の side に落ちる", () => {
    const pinX = 500;
    const pinY = 300;
    // 優先 side ("top") の矩形とちょうど重なる既存矩形だけを用意する。
    const topRect = rectForSideTest("top", pinX, pinY);
    const result = placeBubble(pinX, pinY, smallSize, wideGap, overlaySize, [topRect], "top");
    // 固定順序 top → left → right → bottom で、top が使えないので次は left になる。
    expect(result?.side).toBe("left");
  });

  it("4方向すべてが既存と重なる場合、null を返す", () => {
    const pinX = 500;
    const pinY = 300;
    const blockingRects = (["top", "left", "right", "bottom"] as const).map((side) =>
      rectForSideTest(side, pinX, pinY),
    );
    const result = placeBubble(pinX, pinY, smallSize, wideGap, overlaySize, blockingRects, "top");
    expect(result).toBeNull();
  });

  it("left 配置はピンの高さ中央に揃い、右端がピンから gap 分離れる", () => {
    const result = placeBubble(500, 300, size, gap, overlaySize, [], "left");
    expect(result?.side).toBe("left");
    expect(result?.rect.left).toBe(500 - gap - size.width);
    expect(result?.rect.top).toBe(300 - size.height / 2);
  });

  it("right 配置はピンの高さ中央に揃い、左端がピンから gap 分離れる", () => {
    const result = placeBubble(500, 300, size, gap, overlaySize, [], "right");
    expect(result?.side).toBe("right");
    expect(result?.rect.left).toBe(500 + gap);
    expect(result?.rect.top).toBe(300 - size.height / 2);
  });

  it("left/right 配置が overlay の上端をはみ出す場合、自由軸 (縦方向) をクランプする", () => {
    const result = placeBubble(500, 10, size, gap, overlaySize, [], "left");
    expect(result?.rect.top).toBe(0);
  });

  it("left/right 配置が overlay の下端をはみ出す場合、自由軸 (縦方向) をクランプする", () => {
    const result = placeBubble(500, overlaySize.height - 10, size, gap, overlaySize, [], "right");
    expect(result?.rect.top).toBe(overlaySize.height - size.height);
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
    expect(pickRefillCandidate(candidates, globeCenterX, overlaySize, [], now)?.id).toBe("a");
  });

  it("左半分は dot が 0.35 以上なら (右半分の 0.75 に満たなくても) 候補になる", () => {
    const candidates = [base({ id: "a", projectedX: 200, dot: 0.4 })];
    expect(pickRefillCandidate(candidates, globeCenterX, overlaySize, [], now)?.id).toBe("a");
  });

  it("既存の吹き出しと重なる候補はスキップされる", () => {
    const candidates = [base({ id: "a", projectedX: 200, projectedY: 300 })];
    // 左半分のピンは "left" が優先 side になる。その left 矩形と重なる既存矩形を、
    // かつ top/right/bottom の各矩形とも重なるよう広く用意して 4 方向すべて塞ぐ。
    const existingRects: Rect[] = [{ left: 0, top: 0, width: overlaySize.width, height: 900 }];
    expect(
      pickRefillCandidate(candidates, globeCenterX, overlaySize, existingRects, now),
    ).toBeNull();
  });

  it("優先順位は投稿の新しい順 (createdAt 降順) のみになる", () => {
    const candidates = [base({ id: "older", createdAt: 1 }), base({ id: "newer", createdAt: 2 })];
    expect(pickRefillCandidate(candidates, globeCenterX, overlaySize, [], now)?.id).toBe("newer");
  });

  it("一度も表示されていない (lastShownAt が null) ピンは、いつでも候補になる", () => {
    const candidates = [base({ id: "a", lastShownAt: null })];
    expect(pickRefillCandidate(candidates, globeCenterX, overlaySize, [], now)?.id).toBe("a");
  });

  it("吹き出しが消えてから RESHOW_COOLDOWN_MS (3000ms) 未満のピンはスキップされる", () => {
    const candidates = [base({ id: "a", lastShownAt: now - 2000 })];
    expect(pickRefillCandidate(candidates, globeCenterX, overlaySize, [], now)).toBeNull();
  });

  it("吹き出しが消えてから RESHOW_COOLDOWN_MS (3000ms) 以上経てば再び候補になる", () => {
    const candidates = [base({ id: "a", lastShownAt: now - 3000 })];
    expect(pickRefillCandidate(candidates, globeCenterX, overlaySize, [], now)?.id).toBe("a");
  });

  it("選ばれた候補には、その配置に使う side が付く (中心より左のピンは left)", () => {
    // left 配置に必要な幅 (ESTIMATED_BUBBLE_W + gap) を確保できる位置にする。
    // ピン x=200 のように overlay 左端に近すぎると left 配置が画面外に出て使えず、
    // 次点の side が選ばれてしまうため、ここでは 350 を使う。
    const candidates = [base({ id: "a", projectedX: 350 })];
    expect(pickRefillCandidate(candidates, globeCenterX, overlaySize, [], now)?.side).toBe("left");
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

describe("shouldRefill (アンビエント補充の可否)", () => {
  it("ambientEnabled が true かつ枠に空きがあれば true", () => {
    expect(shouldRefill(true, 3, 8)).toBe(true);
  });

  it("ambientEnabled が false なら枠に空きがあっても false", () => {
    expect(shouldRefill(false, 3, 8)).toBe(false);
  });

  it("枠が埋まっていれば ambientEnabled が true でも false", () => {
    expect(shouldRefill(true, 8, 8)).toBe(false);
  });
});
