import { afterEach, describe, expect, it, vi } from "vitest";
import { createPinSprite, drawPinSprite } from "./pin-sprite";

type MockCtx = CanvasRenderingContext2D & { calls: string[] };

const createMockContext = (): MockCtx => {
  const calls: string[] = [];
  const ctx = {
    calls,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineJoin: "round",
    clearRect(x: number, y: number, w: number, h: number) {
      calls.push(`clearRect(${x},${y},${w},${h})`);
    },
    beginPath() {
      calls.push("beginPath");
    },
    moveTo(x: number, y: number) {
      calls.push(`moveTo(${x.toFixed(1)},${y.toFixed(1)})`);
    },
    lineTo(x: number, y: number) {
      calls.push(`lineTo(${x.toFixed(1)},${y.toFixed(1)})`);
    },
    arc(x: number, y: number, r: number, start: number, end: number, ccw?: boolean) {
      calls.push(`arc(${x.toFixed(1)},${y.toFixed(1)},${r.toFixed(1)},ccw=${Boolean(ccw)})`);
    },
    closePath() {
      calls.push("closePath");
    },
    fill() {
      calls.push(`fill(fillStyle=${ctx.fillStyle})`);
    },
    stroke() {
      calls.push(`stroke(strokeStyle=${ctx.strokeStyle},lineWidth=${ctx.lineWidth})`);
    },
    // biome-ignore lint/suspicious/noExplicitAny: テスト用の最小モックのため CanvasRenderingContext2D 全体は実装しない。
  } as any as MockCtx;
  return ctx;
};

describe("drawPinSprite", () => {
  it("最初に clearRect でクリアする", () => {
    const ctx = createMockContext();
    drawPinSprite(ctx, "#ff8a80");
    expect(ctx.calls[0]).toBe("clearRect(0,0,128,160)");
  });

  it("指定した色でピンの本体を fill する", () => {
    const ctx = createMockContext();
    drawPinSprite(ctx, "#ff8a80");
    expect(ctx.calls.some((c) => c === "fill(fillStyle=#ff8a80)")).toBe(true);
  });

  it("白 3px でフチを stroke する", () => {
    const ctx = createMockContext();
    drawPinSprite(ctx, "#81d4fa");
    expect(ctx.calls.some((c) => c === "stroke(strokeStyle=#ffffff,lineWidth=3)")).toBe(true);
  });

  it("中央に白い円を追加で fill する (本体の fill の後)", () => {
    const ctx = createMockContext();
    drawPinSprite(ctx, "#81d4fa");
    const fillCalls = ctx.calls.filter((c) => c.startsWith("fill(fillStyle="));
    expect(fillCalls).toEqual(["fill(fillStyle=#81d4fa)", "fill(fillStyle=#ffffff)"]);
  });

  it("しずく型のパス (moveTo → lineTo → arc → lineTo → closePath) を1本描く", () => {
    const ctx = createMockContext();
    drawPinSprite(ctx, "#ffffff");
    const pathCalls = ctx.calls.slice(1, 6); // clearRect の直後
    expect(pathCalls[0]).toBe("beginPath");
    expect(pathCalls[1]?.startsWith("moveTo")).toBe(true);
    expect(pathCalls[2]?.startsWith("lineTo")).toBe(true);
    expect(pathCalls[3]?.startsWith("arc")).toBe(true);
    expect(pathCalls[3]).toContain("ccw=true");
  });
});

describe("createPinSprite", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("先端 (テクスチャ下端) をアンカーにする center (0.5, 0) を持つ", () => {
    // このワーカー環境には document/canvas が無いため、getPinTexture が使う
    // document.createElement("canvas") だけを最小限にモックする (テクスチャの中身は検証対象外)。
    const mockCtx = createMockContext();
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: () => mockCtx,
    };
    vi.stubGlobal("document", {
      createElement: () => mockCanvas,
    });

    const sprite = createPinSprite(0, "#ff8a80");
    expect(sprite.center.x).toBe(0.5);
    expect(sprite.center.y).toBe(0);
  });
});
