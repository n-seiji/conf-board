import { describe, expect, it } from "vitest";
import { loadLandPolygons } from "./land-data";
import {
  CANDIDATE_MAX_LAT,
  CANDIDATE_MIN_LAT,
  type MultiPolygonCoords,
  buildLandTester,
  filterCandidateEligible,
  generateRegions,
} from "./regions-gen";
import regions from "./regions.json";

/** land-110m から実際の陸ポリゴン (MultiPolygonCoords 相当) を取り出す。読み込みは land-data.ts に共通化。 */
const loadRealLandPolygons = (): MultiPolygonCoords => loadLandPolygons() as MultiPolygonCoords;

/** 単純な正方形の陸地 (赤道付近) を持つテスト用ポリゴン。 */
const SQUARE_LAND: MultiPolygonCoords = [
  [
    [
      [-20, -20],
      [20, -20],
      [20, 20],
      [-20, 20],
      [-20, -20],
    ],
  ],
];

describe("buildLandTester", () => {
  it("ポリゴン内部の点を陸と判定する", () => {
    const isLand = buildLandTester(SQUARE_LAND);
    expect(isLand(0, 0)).toBe(true);
    expect(isLand(100, 50)).toBe(false);
  });

  it("antimeridian (経度180度) をまたぐリングでも、ポリゴンの外の点を陸と誤判定しない", () => {
    // 170 → -170 とワープするリング (ロシア/フィジー等を模した陸地)。
    const crossingLand: MultiPolygonCoords = [
      [
        [
          [170, 10],
          [-170, 10],
          [-170, -10],
          [170, -10],
        ],
      ],
    ];
    const isLand = buildLandTester(crossingLand);
    // リングの内側 (経度180度をまたいだ帯の中)。
    expect(isLand(178, 0)).toBe(true);
    expect(isLand(-178, 0)).toBe(true);
    // 帯からはるかに離れた地球の反対側 (誤判定していた「太平洋全体が陸」のような
    // バグが起きていないことを確認する)。
    expect(isLand(0, 0)).toBe(false);
    expect(isLand(-90, 0)).toBe(false);
  });

  it("実データ (land-110m) で太平洋・南大西洋・インド洋の中心が陸と判定されない", () => {
    const isLand = buildLandTester(loadRealLandPolygons());
    // 太平洋中央 (lat 0, lon -150)
    expect(isLand(-150, 0)).toBe(false);
    // 南大西洋 (lat -30, lon -20)
    expect(isLand(-20, -30)).toBe(false);
    // インド洋 (lat -20, lon 80)
    expect(isLand(80, -20)).toBe(false);
  });

  it("実データ (land-110m) で東京・シドニーおよびロシア・フィジー付近の陸地は正しく陸と判定される", () => {
    const isLand = buildLandTester(loadRealLandPolygons());
    expect(isLand(139.7, 35.7)).toBe(true); // 東京
    expect(isLand(151.2, -33.9)).toBe(true); // シドニー
    expect(isLand(100, 60)).toBe(true); // ロシア本土
    expect(isLand(178, -18)).toBe(true); // フィジー付近
  });
});

describe("filterCandidateEligible", () => {
  it(`緯度が [${CANDIDATE_MIN_LAT}, ${CANDIDATE_MAX_LAT}] の範囲外のメンバーを除外する`, () => {
    const members: readonly (readonly [number, number])[] = [
      [80, 0],
      [30, 0],
      [-70, 0],
      [-10, 0],
    ];
    const result = filterCandidateEligible(members);
    expect(result).toEqual([
      [30, 0],
      [-10, 0],
    ]);
  });

  it("範囲内のメンバーが1件もない場合は全メンバーにフォールバックする", () => {
    const members: readonly (readonly [number, number])[] = [
      [80, 0],
      [90, 0],
    ];
    const result = filterCandidateEligible(members);
    expect(result).toEqual(members);
  });
});

describe("generateRegions", () => {
  it("20 か国 (id 0-19) を生成し、それぞれ 30 の候補着地点を持つ", () => {
    const isLand = buildLandTester(SQUARE_LAND);
    const result = generateRegions(isLand, { step: 4, k: 20, seed: 1 });

    expect(result.countries).toHaveLength(20);
    for (const country of result.countries) {
      expect(country.candidates).toHaveLength(30);
      for (const [lat, lon] of country.candidates) {
        expect(lat).toBeGreaterThanOrEqual(-90);
        expect(lat).toBeLessThanOrEqual(90);
        expect(lon).toBeGreaterThanOrEqual(-180);
        expect(lon).toBeLessThanOrEqual(180);
      }
    }
  });

  it("countryByCell はすべて -1 か 0-19 の範囲に収まる", () => {
    const isLand = buildLandTester(SQUARE_LAND);
    const result = generateRegions(isLand, { step: 4, k: 20, seed: 1 });
    for (const value of result.cells.countryByCell) {
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThan(20);
    }
  });

  it("同じ入力に対して決定的である (2 回生成して同一)", () => {
    const isLand = buildLandTester(SQUARE_LAND);
    const a = generateRegions(isLand, { step: 4, k: 20, seed: 42 });
    const b = generateRegions(isLand, { step: 4, k: 20, seed: 42 });
    expect(a).toEqual(b);
  });

  it("すべてのクラスタが少なくとも 1 セルを持つ (空クラスタが残らない)", () => {
    const isLand = buildLandTester(SQUARE_LAND);
    const result = generateRegions(isLand, { step: 4, k: 20, seed: 1 });
    const counts = new Array(20).fill(0);
    for (const c of result.cells.countryByCell) {
      if (c >= 0) counts[c] += 1;
    }
    for (const count of counts) {
      expect(count).toBeGreaterThan(0);
    }
  });
});

describe("regions.json (コミット済み生成結果)", () => {
  it("20 か国、各 30 候補を持つ", () => {
    expect(regions.countries).toHaveLength(20);
    for (const country of regions.countries) {
      expect(country.candidates).toHaveLength(30);
    }
  });

  it(`各国の候補着地点の緯度がすべて [${CANDIDATE_MIN_LAT}, ${CANDIDATE_MAX_LAT}] の範囲に収まる`, () => {
    for (const country of regions.countries) {
      for (const candidate of country.candidates) {
        const [lat] = candidate;
        expect(lat).toBeDefined();
        expect(lat as number).toBeGreaterThanOrEqual(CANDIDATE_MIN_LAT);
        expect(lat as number).toBeLessThanOrEqual(CANDIDATE_MAX_LAT);
      }
    }
  });

  it("各国の候補着地点はすべて実データ上の陸セル中心である (海上ピンが刺さらない)", () => {
    const isLand = buildLandTester(loadRealLandPolygons());
    for (const country of regions.countries) {
      for (const candidate of country.candidates) {
        const [lat, lon] = candidate;
        expect(lat).toBeDefined();
        expect(lon).toBeDefined();
        expect(isLand(lon as number, lat as number)).toBe(true);
      }
    }
  });

  it("太平洋・南大西洋・インド洋の中心セルは陸国に属さない (-1)", () => {
    const { lat0, lon0, step, cols, countryByCell } = regions.cells;
    const cellIndex = (lat: number, lon: number): number => {
      const r = Math.round((lat - lat0) / step);
      const c = Math.round((lon - lon0) / step);
      return r * cols + c;
    };
    expect(countryByCell[cellIndex(0, -150)]).toBe(-1);
    expect(countryByCell[cellIndex(-30, -20)]).toBe(-1);
    expect(countryByCell[cellIndex(-20, 80)]).toBe(-1);
  });
});
