import { describe, expect, it } from "vitest";
import { loadLandPolygons } from "./land-data";
import {
  type DrawContext,
  type WorldTextureData,
  buildBorderSegments,
  drawWorld,
  excludePolygonsSouthOf,
  smoothPolyline,
} from "./texture";

const createMockContext = (): DrawContext & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineJoin: "round",
    lineCap: "round",
    globalAlpha: 1,
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
  border: "rgba(255,255,255,0.45)",
  graticule: "rgba(255,255,255,0.12)",
};

describe("drawWorld", () => {
  it("海の fillRect を最初に描く", () => {
    const ctx = createMockContext();
    const data: WorldTextureData = {
      landPolygons: [],
      borderSegments: [],
      width: 100,
      height: 50,
    };
    drawWorld(ctx, palette, data);
    expect(ctx.calls[0]).toBe("fillRect(0,0,100,50)");
  });

  it("小さすぎるポリゴン (小島) は描画から除外する", () => {
    const ctx = createMockContext();
    const tinyIsland: WorldTextureData["landPolygons"][number] = [
      [
        [0, 0],
        [0.01, 0],
        [0.01, 0.01],
        [0, 0.01],
      ],
    ];
    const data: WorldTextureData = {
      landPolygons: [tinyIsland],
      borderSegments: [],
      width: 100,
      height: 50,
      minPolygonArea: 0.6,
    };
    drawWorld(ctx, palette, data);
    expect(ctx.calls.some((c) => c === "fill")).toBe(false);
  });

  it("十分に大きいポリゴンは fill/stroke される", () => {
    const ctx = createMockContext();
    const bigLand: WorldTextureData["landPolygons"][number] = [
      [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
      ],
    ];
    const data: WorldTextureData = {
      landPolygons: [bigLand],
      borderSegments: [],
      width: 100,
      height: 50,
      minPolygonArea: 0.6,
    };
    drawWorld(ctx, palette, data);
    expect(ctx.calls.includes("fill(evenodd)")).toBe(true);
    expect(ctx.calls.includes("stroke")).toBe(true);
  });

  it("borderSegments を線として描画する", () => {
    const ctx = createMockContext();
    const data: WorldTextureData = {
      landPolygons: [],
      borderSegments: [
        [
          [0, 0],
          [10, 10],
        ],
      ],
      width: 100,
      height: 50,
    };
    drawWorld(ctx, palette, data);
    expect(ctx.calls.filter((c) => c.startsWith("moveTo")).length).toBeGreaterThan(0);
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
      borderSegments: [],
      width: 1000,
      height: 500,
      minPolygonArea: 0,
    };
    drawWorld(ctx, palette, data);

    // 陸ポリゴンのトレースに関する呼び出しだけを見る (経緯線・国境は意図的に画面幅いっぱいに線を引くため除外)。
    const landSectionEnd = ctx.calls.indexOf("stroke");
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
      borderSegments: [],
      width: 100,
      height: 50,
      minPolygonArea: 0,
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

describe("buildBorderSegments", () => {
  it("隣接セルの国が異なる境界のみ線分を作る", () => {
    const cells = {
      lat0: 0,
      lon0: 0,
      step: 2,
      rows: 1,
      cols: 2,
      countryByCell: [0, 1],
    };
    const segments = buildBorderSegments(cells);
    expect(segments.length).toBe(1);
  });

  it("同じ国どうしの隣接セルには線分を作らない", () => {
    const cells = {
      lat0: 0,
      lon0: 0,
      step: 2,
      rows: 1,
      cols: 2,
      countryByCell: [0, 0],
    };
    const segments = buildBorderSegments(cells);
    expect(segments.length).toBe(0);
  });

  it("陸でないセル (-1) は境界を作らない", () => {
    const cells = {
      lat0: 0,
      lon0: 0,
      step: 2,
      rows: 1,
      cols: 2,
      countryByCell: [0, -1],
    };
    const segments = buildBorderSegments(cells);
    expect(segments.length).toBe(0);
  });

  it("L字型の境界は平滑化されて角が増える (階段状にならない)", () => {
    // 2x2 で country 0 が (0,0),(0,1) を占め、country 1 が (1,1) だけを占める L 字境界。
    const cells = {
      lat0: 0,
      lon0: 0,
      step: 2,
      rows: 2,
      cols: 2,
      countryByCell: [0, 0, 0, 1],
    };
    const segments = buildBorderSegments(cells);
    // 平滑化により直角の折れ線 (2 セグメント) より多くのセグメントに分割される。
    expect(segments.length).toBeGreaterThan(2);
  });

  it("海を挟んだ2つの離れた陸地 (異なる国) の間には境界線分を作らない", () => {
    // 1行×5列: [国0の陸, 海, 海, 国1の陸, 海]。0番と3番の間は隣接していないので繋がない。
    const cells = {
      lat0: 0,
      lon0: 0,
      step: 2,
      rows: 1,
      cols: 5,
      countryByCell: [0, -1, -1, 1, -1],
    };
    const segments = buildBorderSegments(cells);
    expect(segments.length).toBe(0);
  });

  it("両側とも陸だが同じ国のセルが海を挟んでいても、隣接しないセル間には線分を作らない", () => {
    // 1行×3列: [国0, 海, 国0] のように同じ国が海を挟んで離れていても、隣接判定は行わない。
    const cells = {
      lat0: 0,
      lon0: 0,
      step: 2,
      rows: 1,
      cols: 3,
      countryByCell: [0, -1, 0],
    };
    const segments = buildBorderSegments(cells);
    expect(segments.length).toBe(0);
  });
});

describe("excludePolygonsSouthOf", () => {
  it("全体が南極域 (南緯60度以南) にあるポリゴンを除外する", () => {
    const antarctica: WorldTextureData["landPolygons"][number] = [
      [
        [-170, -85],
        [170, -85],
        [170, -65],
        [-170, -65],
      ],
    ];
    const result = excludePolygonsSouthOf([antarctica]);
    expect(result.length).toBe(0);
  });

  it("南緯60度より北にまたがるポリゴンは残す", () => {
    const southAmerica: WorldTextureData["landPolygons"][number] = [
      [
        [-70, -55],
        [-50, -55],
        [-50, 0],
        [-70, 0],
      ],
    ];
    const result = excludePolygonsSouthOf([southAmerica]);
    expect(result.length).toBe(1);
  });
});

describe("smoothPolyline", () => {
  it("端点を保持したまま点数を増やす (Chaikin 法)", () => {
    const points: readonly [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    const smoothed = smoothPolyline(points, 2);
    expect(smoothed[0]).toEqual(points[0]);
    expect(smoothed[smoothed.length - 1]).toEqual(points[points.length - 1]);
    expect(smoothed.length).toBeGreaterThan(points.length);
  });

  it("2点以下の折れ線はそのまま返す", () => {
    const points: readonly [number, number][] = [
      [0, 0],
      [10, 0],
    ];
    expect(smoothPolyline(points, 2)).toEqual(points);
  });
});

describe("drawWorld (実データ)", () => {
  it("実データ (land-110m) で穴を持つアフロユーラシア大陸の外周 (喜望峰付近) が描画される", () => {
    const ctx = createMockContext();
    const data: WorldTextureData = {
      landPolygons: loadLandPolygons(),
      borderSegments: [],
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
