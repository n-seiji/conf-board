import { describe, expect, it } from "vitest";
import { loadLandPolygons } from "./land-data";
import { type DrawContext, type WorldTextureData, drawWorld } from "./texture";

const createMockContext = (): DrawContext & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    fillRect(x, y, w, h) {
      calls.push(`fillRect(${x},${y},${w},${h})`);
    },
    beginPath() {
      calls.push("beginPath");
    },
    moveTo(x, y) {
      calls.push(`moveTo(${x},${y})`);
    },
    lineTo(x, y) {
      calls.push(`lineTo(${x},${y})`);
    },
    closePath() {
      calls.push("closePath");
    },
    fill(fillRule?: CanvasFillRule) {
      calls.push(fillRule ? `fill(${fillRule})` : "fill");
    },
    stroke() {
      calls.push("stroke");
    },
  };
};

const palette = {
  ocean: "#7fd9cc",
  land: "#3fb3a3",
  graticule: "rgba(255,255,255,0.12)",
};

describe("drawWorld", () => {
  it("海の fillRect を最初に描く", () => {
    const ctx = createMockContext();
    const data: WorldTextureData = {
      landPolygons: [],
      width: 100,
      height: 50,
    };
    drawWorld(ctx, palette, data);
    expect(ctx.calls[0]).toBe("fillRect(0,0,100,50)");
  });

  it("陸ポリゴンは fill(evenodd) される", () => {
    const ctx = createMockContext();
    const land: WorldTextureData["landPolygons"][number] = [
      [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ],
    ];
    const data: WorldTextureData = {
      landPolygons: [land],
      width: 100,
      height: 50,
    };
    drawWorld(ctx, palette, data);
    expect(ctx.calls.includes("fill(evenodd)")).toBe(true);
  });

  it("antimeridian (経度180度) をまたぐリングは lineTo でつながず、幅の90%以上ジャンプする線を描かない", () => {
    const ctx = createMockContext();
    // 170 → -170 と、経度が地図の右端から左端へワープするリング (ロシア/フィジー等を模す)。
    const crossingRing: WorldTextureData["landPolygons"][number] = [
      [
        [170, 10],
        [-170, 10],
        [-170, -10],
        [170, -10],
      ],
    ];
    const data: WorldTextureData = {
      landPolygons: [crossingRing],
      width: 1000,
      height: 500,
    };
    drawWorld(ctx, palette, data);

    // 陸ポリゴンのトレースに関する呼び出しだけを見る (経緯線は意図的に画面幅いっぱいに線を引くため除外)。
    const landSectionEnd = ctx.calls.indexOf("fill(evenodd)");
    const landCalls = ctx.calls.slice(0, landSectionEnd + 1);

    let prevX: number | null = null;
    let maxJump = 0;
    let lineToCount = 0;
    for (const call of landCalls) {
      const match = /^(?:moveTo|lineTo)\(([-\d.]+),([-\d.]+)\)/.exec(call);
      if (!match) continue;
      const x = Number(match[1]);
      if (call.startsWith("lineTo")) {
        lineToCount++;
        if (prevX !== null) {
          maxJump = Math.max(maxJump, Math.abs(x - prevX));
        }
      }
      prevX = x;
    }
    expect(maxJump).toBeLessThan(data.width * 0.9);
    expect(lineToCount).toBeGreaterThan(0);
  });

  it("antimeridian をまたぐリングは最初のジャンプ直後の点から描き始める", () => {
    const ctx = createMockContext();
    // 170 → -170 でジャンプするリング。ジャンプ直後の点は [-170, 10]。
    const crossingRing: WorldTextureData["landPolygons"][number] = [
      [
        [170, 10],
        [-170, 10],
        [-170, -10],
        [170, -10],
      ],
    ];
    const data: WorldTextureData = {
      landPolygons: [crossingRing],
      width: 1000,
      height: 500,
    };
    drawWorld(ctx, palette, data);

    const firstMoveTo = ctx.calls.find((c) => c.startsWith("moveTo"));
    const [expectedX, expectedY] = [
      ((-170 + 180) / 360) * data.width,
      ((90 - 10) / 180) * data.height,
    ];
    expect(firstMoveTo).toBe(`moveTo(${expectedX},${expectedY})`);
  });

  it("穴を持つポリゴンの場合、外周と穴を1つのパスとして beginPath は1回だけ呼ばれる", () => {
    const ctx = createMockContext();
    const outerFirstPoint: readonly [number, number] = [-10, -10];
    const outer: WorldTextureData["landPolygons"][number][number] = [
      outerFirstPoint,
      [10, -10],
      [10, 10],
      [-10, 10],
    ];
    const hole: WorldTextureData["landPolygons"][number][number] = [
      [-5, -5],
      [-5, 5],
      [5, 5],
      [5, -5],
    ];
    const polygonWithHole: WorldTextureData["landPolygons"][number] = [outer, hole];
    const data: WorldTextureData = {
      landPolygons: [polygonWithHole],
      width: 100,
      height: 50,
    };
    drawWorld(ctx, palette, data);

    const oceanFillRectIdx = ctx.calls.indexOf("fillRect(0,0,100,50)");
    const firstFillIdx = ctx.calls.findIndex((c) => c.startsWith("fill("));
    expect(firstFillIdx).toBeGreaterThan(-1);
    const between = ctx.calls.slice(oceanFillRectIdx + 1, firstFillIdx);

    const beginPathCount = between.filter((c) => c === "beginPath").length;
    expect(beginPathCount).toBe(1);

    const [fx, fy] = [
      ((outerFirstPoint[0] + 180) / 360) * 100,
      ((90 - outerFirstPoint[1]) / 180) * 50,
    ];
    expect(between).toContain(`moveTo(${fx},${fy})`);

    expect(ctx.calls[firstFillIdx]).toBe("fill(evenodd)");
  });
});

describe("drawWorld (実データ)", () => {
  it("実データ (land-110m) で穴を持つアフロユーラシア大陸の外周 (喜望峰付近) が描画される", () => {
    const ctx = createMockContext();
    const data: WorldTextureData = {
      landPolygons: loadLandPolygons(),
      width: 2048,
      height: 1024,
    };
    drawWorld(ctx, palette, data);

    const capOfGoodHope = {
      x: ((18.5 + 180) / 360) * 2048,
      y: ((90 + 34.5) / 180) * 1024,
    };

    // fill() が実際に塗るのは、直前の beginPath から fill までの間に積まれたパスだけなので、
    // その区間内の moveTo/lineTo だけを対象にする (穴の beginPath が外周を握り潰すバグでは、
    // 外周の座標はここに含まれなくなる)。
    let found = false;
    ctx.calls.forEach((call, fillIdx) => {
      if (!call.startsWith("fill")) return;
      const beginPathIdx = ctx.calls.lastIndexOf("beginPath", fillIdx - 1);
      const segment = ctx.calls.slice(beginPathIdx + 1, fillIdx);
      for (const segCall of segment) {
        const match = /^(?:moveTo|lineTo)\(([-\d.]+),([-\d.]+)\)/.exec(segCall);
        if (!match) continue;
        const x = Number(match[1]);
        const y = Number(match[2]);
        if (Math.abs(x - capOfGoodHope.x) <= 10 && Math.abs(y - capOfGoodHope.y) <= 10) {
          found = true;
        }
      }
    });
    expect(found).toBe(true);
  });
});
