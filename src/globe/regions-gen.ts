/**
 * 20 か国の区画データ (regions.json) を生成する純粋関数群。
 * ビルド時に scripts/gen-regions.ts から呼ばれる。ブラウザでは実行しない。
 */

export type LonLat = readonly [lon: number, lat: number];
export type LatLon = readonly [lat: number, lon: number];

/** GeoJSON MultiPolygon の座標 (穴を含む)。 */
export type MultiPolygonCoords = readonly (readonly (readonly LonLat[])[])[];

export type RegionsData = Readonly<{
  version: 1;
  cells: Readonly<{
    lat0: number;
    lon0: number;
    step: number;
    rows: number;
    cols: number;
    /** row-major (row = lat index, col = lon index)。陸でないセルは -1。 */
    countryByCell: readonly number[];
  }>;
  countries: readonly Readonly<{
    id: number;
    candidates: readonly LatLon[];
  }>[];
}>;

const CANDIDATES_PER_COUNTRY = 30;
const MIN_LAT = -60;
const MAX_LAT = 84;
/** 候補着地点 (candidates) の緯度制限。高緯度は正面化しても球の縁に張り付き可視判定ぎりぎりになるため。 */
export const CANDIDATE_MIN_LAT = -50;
export const CANDIDATE_MAX_LAT = 65;

/** mulberry32: 固定シードの決定的 PRNG。 */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const boundsOf = (
  ring: readonly LonLat[],
): Readonly<{
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}> => {
  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, maxLon, minLat, maxLat };
};

/** レイキャスト法によるリング内外判定。 */
const pointInRing = (lon: number, lat: number, ring: readonly LonLat[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i];
    const pj = ring[j];
    if (!pi || !pj) continue;
    const [xi, yi] = pi;
    const [xj, yj] = pj;
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
};

/** 穴 (2 番目以降のリング) を考慮したポリゴン内外判定。 */
const pointInPolygon = (
  lon: number,
  lat: number,
  polygon: readonly (readonly LonLat[])[],
): boolean => {
  const outer = polygon[0];
  if (!outer || !pointInRing(lon, lat, outer)) return false;
  for (let i = 1; i < polygon.length; i++) {
    const hole = polygon[i];
    if (hole && pointInRing(lon, lat, hole)) return false;
  }
  return true;
};

/**
 * リングの経度を「連続」になるよう unwrap する (隣接点の経度差が 180 度を超えないように
 * ±360 を足し引きしていく)。ロシアやフィジーのように経度 ±180 度線をまたぐリングを
 * そのまま ray casting すると、-180→180 の "ワープする辺" が地図全幅を覆う巨大な偽の辺に
 * なり、太平洋の真ん中まで陸と誤判定してしまうため、判定前に必ず連続化しておく。
 */
const unwrapRingLongitude = (ring: readonly LonLat[]): readonly LonLat[] => {
  if (ring.length === 0) return ring;
  const result: LonLat[] = [];
  let offset = 0;
  let prevAdjusted: number | null = null;
  for (const [lon, lat] of ring) {
    let adjusted = lon + offset;
    if (prevAdjusted !== null) {
      while (adjusted - prevAdjusted > 180) {
        adjusted -= 360;
        offset -= 360;
      }
      while (adjusted - prevAdjusted < -180) {
        adjusted += 360;
        offset += 360;
      }
    }
    result.push([adjusted, lat]);
    prevAdjusted = adjusted;
  }
  return result;
};

/**
 * 陸判定器を構築する。判定はセル中心の point-in-polygon (ray casting) のみで行う。
 * ポリゴンは事前に経度を unwrap してから bbox を取るため、antimeridian をまたぐ
 * リングでも太平洋上を陸と誤判定しない。bbox はあくまで高速化用の事前フィルタで、
 * クエリ点は unwrap 後の座標系に合わせて (lon, lon+360, lon-360) の 3 通りを試す。
 */
export const buildLandTester = (
  multiPolygon: MultiPolygonCoords,
): ((lon: number, lat: number) => boolean) => {
  const polygons = multiPolygon.map((polygon) => {
    const unwrapped = polygon.map(unwrapRingLongitude);
    return { polygon: unwrapped, bounds: boundsOf(unwrapped[0] ?? []) };
  });
  return (lon: number, lat: number): boolean => {
    for (const { polygon, bounds } of polygons) {
      if (lat < bounds.minLat || lat > bounds.maxLat) continue;
      for (const candidateLon of [lon, lon + 360, lon - 360]) {
        if (candidateLon < bounds.minLon || candidateLon > bounds.maxLon) continue;
        if (pointInPolygon(candidateLon, lat, polygon)) return true;
      }
    }
    return false;
  };
};

export type LandGrid = Readonly<{
  lat0: number;
  lon0: number;
  step: number;
  rows: number;
  cols: number;
  /** row-major。陸なら true。 */
  isLand: readonly boolean[];
}>;

/** 2° 格子で陸のサンプル点を作る (南極 lat < -60 は除外)。 */
export const buildLandGrid = (
  isLand: (lon: number, lat: number) => boolean,
  step = 2,
): LandGrid => {
  const lat0 = MIN_LAT;
  const lon0 = -180;
  const rows = Math.floor((MAX_LAT - MIN_LAT) / step) + 1;
  const cols = Math.floor(360 / step);
  const cells = new Array<boolean>(rows * cols);
  for (let r = 0; r < rows; r++) {
    const lat = lat0 + r * step;
    for (let c = 0; c < cols; c++) {
      const lon = lon0 + c * step;
      cells[r * cols + c] = isLand(lon, lat);
    }
  }
  return { lat0, lon0, step, rows, cols, isLand: cells };
};

type Vec3 = readonly [number, number, number];

const toVec3 = (lat: number, lon: number): Vec3 => {
  const phi = (lat * Math.PI) / 180;
  const theta = (lon * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  return [cosPhi * Math.cos(theta), Math.sin(phi), cosPhi * Math.sin(theta)];
};

const toLatLon = (v: Vec3): LatLon => {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  const [x, y, z] = [v[0] / len, v[1] / len, v[2] / len];
  const lat = (Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI;
  const lon = (Math.atan2(z, x) * 180) / Math.PI;
  return [lat, lon];
};

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const normalize = (v: Vec3): Vec3 => {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
};

export type KMeansResult = Readonly<{
  /** 各サンプル点が属するクラスタ id。 */
  assignment: readonly number[];
  centroids: readonly LatLon[];
}>;

/**
 * 球面 k-means。コサイン類似度 (単位ベクトルの内積) を距離指標に使う。
 * 固定シードの PRNG で初期クラスタを選ぶため決定的。
 */
export const sphericalKMeans = (
  points: readonly LatLon[],
  k: number,
  seed: number,
  iterations = 25,
): KMeansResult => {
  const rand = mulberry32(seed);
  const vecs = points.map(([lat, lon]) => toVec3(lat, lon));
  if (vecs.length === 0) {
    return { assignment: [], centroids: [] };
  }

  // 決定的な初期クラスタ選択 (k-means++ 風、固定シード PRNG で選ぶ)。
  const centroidIdx: number[] = [Math.floor(rand() * vecs.length)];
  while (centroidIdx.length < k) {
    let bestIdx = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    // 決定的だが多様性を持たせるため、乱数で重み付けした最遠点法。
    for (let i = 0; i < vecs.length; i++) {
      const v = vecs[i];
      if (!v) continue;
      let minSim = Number.POSITIVE_INFINITY;
      for (const ci of centroidIdx) {
        const c = vecs[ci];
        if (!c) continue;
        const sim = dot(v, c);
        if (sim < minSim) minSim = sim;
      }
      const score = -minSim + rand() * 1e-6;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    centroidIdx.push(bestIdx);
  }

  let centroids: Vec3[] = centroidIdx.map((i) => vecs[i] ?? [1, 0, 0]);
  const assignment = new Array<number>(vecs.length).fill(0);

  for (let iter = 0; iter < iterations; iter++) {
    let changed = false;
    for (let i = 0; i < vecs.length; i++) {
      const v = vecs[i];
      if (!v) continue;
      let best = 0;
      let bestSim = Number.NEGATIVE_INFINITY;
      for (let c = 0; c < centroids.length; c++) {
        const cv = centroids[c];
        if (!cv) continue;
        const sim = dot(v, cv);
        if (sim > bestSim) {
          bestSim = sim;
          best = c;
        }
      }
      if (assignment[i] !== best) changed = true;
      assignment[i] = best;
    }

    const sums: Vec3[] = Array.from({ length: k }, () => [0, 0, 0]);
    const counts = new Array<number>(k).fill(0);
    for (let i = 0; i < vecs.length; i++) {
      const cluster = assignment[i];
      const v = vecs[i];
      if (cluster === undefined || !v) continue;
      const s = sums[cluster];
      if (!s) continue;
      sums[cluster] = [s[0] + v[0], s[1] + v[1], s[2] + v[2]];
      counts[cluster] = (counts[cluster] ?? 0) + 1;
    }
    centroids = sums.map((s, idx) =>
      counts[idx] && counts[idx] > 0 ? normalize(s) : (centroids[idx] ?? s),
    );

    // 空クラスタは、現在の重心群から最も遠い点を新しい重心にして次の反復で再割当てさせる。
    for (let c = 0; c < k; c++) {
      if ((counts[c] ?? 0) > 0) continue;
      let farIdx = 0;
      let farScore = Number.POSITIVE_INFINITY;
      for (let i = 0; i < vecs.length; i++) {
        const v = vecs[i];
        if (!v) continue;
        let maxSim = Number.NEGATIVE_INFINITY;
        for (const cv of centroids) {
          if (!cv) continue;
          const sim = dot(v, cv);
          if (sim > maxSim) maxSim = sim;
        }
        if (maxSim < farScore) {
          farScore = maxSim;
          farIdx = i;
        }
      }
      const chosen = vecs[farIdx];
      if (chosen) {
        centroids[c] = chosen;
        changed = true;
      }
    }

    if (!changed && iter > 0) break;
  }

  return {
    assignment,
    centroids: centroids.map(toLatLon),
  };
};

/** 固定シードでクラスタから重複ありサンプルを抽選する。 */
const pickCandidates = (
  members: readonly LatLon[],
  count: number,
  seed: number,
): readonly LatLon[] => {
  if (members.length === 0) return [];
  const rand = mulberry32(seed);
  const result: LatLon[] = [];
  // まずはシャッフルして重複なしで詰める。
  const shuffled = [...members];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = shuffled[i];
    const swap = shuffled[j];
    if (tmp === undefined || swap === undefined) continue;
    shuffled[i] = swap;
    shuffled[j] = tmp;
  }
  for (const p of shuffled) {
    if (result.length >= count) break;
    result.push(p);
  }
  // 30 未満なら重複可で埋める。
  while (result.length < count) {
    const idx = Math.floor(rand() * members.length);
    const p = members[idx];
    if (p) result.push(p);
  }
  return result;
};

/**
 * 候補着地点の抽選対象を緯度 [CANDIDATE_MIN_LAT, CANDIDATE_MAX_LAT] に制限する。
 * クラスタリング自体は全陸で行うため、制限後に候補が 0 件になる国は
 * (そのクラスタが丸ごと制限範囲外にある場合のみ) 全メンバーにフォールバックする。
 */
export const filterCandidateEligible = (members: readonly LatLon[]): readonly LatLon[] => {
  const eligible = members.filter(([lat]) => lat >= CANDIDATE_MIN_LAT && lat <= CANDIDATE_MAX_LAT);
  return eligible.length > 0 ? eligible : members;
};

export type GenerateRegionsOptions = Readonly<{
  step?: number;
  k?: number;
  seed?: number;
  candidatesPerCountry?: number;
  kmeansIterations?: number;
}>;

/** 陸判定関数から regions.json の中身を組み立てる決定的な純粋関数。 */
export const generateRegions = (
  isLand: (lon: number, lat: number) => boolean,
  options: GenerateRegionsOptions = {},
): RegionsData => {
  const step = options.step ?? 2;
  const k = options.k ?? 20;
  const seed = options.seed ?? 20260904;
  const candidatesPerCountry = options.candidatesPerCountry ?? CANDIDATES_PER_COUNTRY;
  const kmeansIterations = options.kmeansIterations ?? 25;

  const grid = buildLandGrid(isLand, step);
  const landCellIdx: number[] = [];
  const landPoints: LatLon[] = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const idx = r * grid.cols + c;
      if (grid.isLand[idx]) {
        landCellIdx.push(idx);
        landPoints.push([grid.lat0 + r * step, grid.lon0 + c * step]);
      }
    }
  }

  const { assignment } = sphericalKMeans(landPoints, k, seed, kmeansIterations);

  const countryByCell = new Array<number>(grid.rows * grid.cols).fill(-1);
  const membersByCountry: LatLon[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < landCellIdx.length; i++) {
    const cellIdx = landCellIdx[i];
    const cluster = assignment[i];
    const point = landPoints[i];
    if (cellIdx === undefined || cluster === undefined || !point) continue;
    countryByCell[cellIdx] = cluster;
    membersByCountry[cluster]?.push(point);
  }

  const countries = Array.from({ length: k }, (_, id) => ({
    id,
    candidates: pickCandidates(
      filterCandidateEligible(membersByCountry[id] ?? []),
      candidatesPerCountry,
      seed + id + 1,
    ),
  }));

  return {
    version: 1,
    cells: {
      lat0: grid.lat0,
      lon0: grid.lon0,
      step: grid.step,
      rows: grid.rows,
      cols: grid.cols,
      countryByCell,
    },
    countries,
  };
};
