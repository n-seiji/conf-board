/**
 * 地球テクスチャ (正距円筒図法、2048×1024) の描画。
 * `drawWorld` は純粋関数としてテスト可能にし、ブラウザ用の `createWorldTexture` から呼ぶ。
 */

export type LonLat = readonly [lon: number, lat: number];
export type Ring = readonly LonLat[];
/** 1 ポリゴン = [外周, 穴1, 穴2, ...] */
export type Polygon = readonly Ring[];

export type Palette = Readonly<{
  ocean: string;
  land: string;
  border: string;
  graticule: string;
}>;

export type WorldTextureData = Readonly<{
  /** 陸のポリゴン群 (GeoJSON MultiPolygon の coordinates と同じ形)。 */
  landPolygons: readonly Polygon[];
  /** 隣接セルが異なる国に属する境界線分 (各要素は [lon,lat] の2点)。 */
  borderSegments: readonly (readonly [LonLat, LonLat])[];
  width: number;
  height: number;
  /** 面積がこの値未満のポリゴンは小さな島として描画から除外する (度^2 単位の概算)。 */
  minPolygonArea?: number;
  /** 陸の輪郭を丸めるための stroke 幅 (px)。 */
  roundStrokeWidth?: number;
  /** これより南 (小さい) は最後に海色で塗り潰す。 */
  southClipLat?: number;
  /** これより北 (大きい) は最後に海色で塗り潰す。 */
  northClipLat?: number;
}>;

/** Canvas 2D コンテキストのうち、描画に使うプロパティ・メソッドの部分集合。 */
export type DrawContext = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
  globalAlpha: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(fillRule?: CanvasFillRule): void;
  stroke(): void;
};

const DEFAULT_MIN_AREA = 0.6;
const DEFAULT_ROUND_STROKE = 18;
const DEFAULT_SOUTH_CLIP_LAT = -58;
const DEFAULT_NORTH_CLIP_LAT = 84;
const SOUTH_CLIP_LAT = -60;
/** 隣接点の経度差がこれを超えたら antimeridian をまたいだとみなし、線でつながない。 */
const LON_JUMP_THRESHOLD = 180;

/** 経緯度 (equirectangular) → canvas ピクセル座標。 */
const project = (
  lon: number,
  lat: number,
  width: number,
  height: number,
): readonly [number, number] => [((lon + 180) / 360) * width, ((90 - lat) / 180) * height];

/** シューレース公式によるリングの概算面積 (度^2、符号なし)。 */
const ringArea = (ring: Ring): number => {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const p0 = ring[i];
    const p1 = ring[(i + 1) % ring.length];
    if (!p0 || !p1) continue;
    sum += p0[0] * p1[1] - p1[0] * p0[1];
  }
  return Math.abs(sum) / 2;
};

/**
 * 南極 (緯度 < southLat) を完全に含むポリゴンを除外する。
 * equirectangular の等距円筒図法では antimeridian をまたぐ南極大陸を直線で結ぶと
 * 画面いっぱいの帯として描画されてしまうため、regions と同様に丸ごと落とす。
 */
export const excludePolygonsSouthOf = (
  polygons: readonly Polygon[],
  southLat = SOUTH_CLIP_LAT,
): readonly Polygon[] =>
  polygons.filter((polygon) => {
    const outer = polygon[0];
    if (!outer) return false;
    return outer.some(([, lat]) => lat >= southLat);
  });

/**
 * ポリゴン (外周 + 穴) をまとめて1つの canvas パスとして描く。beginPath はポリゴン全体で
 * 1回だけ呼び、外周と穴の各リングを同じパスに積む (呼び出し側で "evenodd" ルールで fill
 * すれば穴は正しく穴として描かれ、外周が穴の beginPath で握り潰されることもない)。
 * 等距円筒図法では antimeridian (経度 ±180 度線) をまたぐ隣接点を素直に lineTo で結ぶと、
 * 地図を横断する直線 (陸色の帯) になってしまうため、経度差の絶対値が LON_JUMP_THRESHOLD を
 * 超える箇所は lineTo せず moveTo で新しい部分パスに切る。
 * どこにも antimeridian をまたぐ箇所が無いリングだけ、従来どおり closePath で輪を閉じる。
 */
const tracePolygon = (ctx: DrawContext, polygon: Polygon, width: number, height: number): void => {
  ctx.beginPath();
  for (const ring of polygon) {
    if (ring.length === 0) continue;
    const first = ring[0];
    if (!first) continue;
    const [fx, fy] = project(first[0], first[1], width, height);
    ctx.moveTo(fx, fy);

    let hasJump = false;
    let prevLon = first[0];
    for (let i = 1; i < ring.length; i++) {
      const p = ring[i];
      if (!p) continue;
      const [x, y] = project(p[0], p[1], width, height);
      if (Math.abs(p[0] - prevLon) > LON_JUMP_THRESHOLD) {
        ctx.moveTo(x, y);
        hasJump = true;
      } else {
        ctx.lineTo(x, y);
      }
      prevLon = p[0];
    }

    // 最後の点から最初の点に戻る「閉じ」の辺も antimeridian をまたぐならスキップする。
    if (Math.abs(first[0] - prevLon) > LON_JUMP_THRESHOLD) {
      hasJump = true;
    } else if (!hasJump) {
      ctx.closePath();
    }
  }
};

/**
 * 海・陸・国境・経緯線を canvas に描く純粋関数。
 * 陸は fill と太い round stroke を重ねてデフォルメし、小さな島は落とす。
 */
export const drawWorld = (ctx: DrawContext, palette: Palette, data: WorldTextureData): void => {
  const { width, height } = data;
  const minArea = data.minPolygonArea ?? DEFAULT_MIN_AREA;
  const strokeWidth = data.roundStrokeWidth ?? DEFAULT_ROUND_STROKE;

  ctx.fillStyle = palette.ocean;
  ctx.fillRect(0, 0, width, height);

  const visiblePolygons = excludePolygonsSouthOf(data.landPolygons).filter((polygon) => {
    const outer = polygon[0];
    return outer !== undefined && ringArea(outer) >= minArea;
  });

  ctx.fillStyle = palette.land;
  ctx.strokeStyle = palette.land;
  ctx.lineWidth = strokeWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const polygon of visiblePolygons) {
    tracePolygon(ctx, polygon, width, height);
    ctx.fill("evenodd");
    ctx.stroke();
  }

  ctx.strokeStyle = palette.graticule;
  ctx.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 30) {
    const [x] = project(lon, 0, width, height);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const [, y] = project(0, lat, width, height);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [a, b] of data.borderSegments) {
    const [ax, ay] = project(a[0], a[1], width, height);
    const [bx, by] = project(b[0], b[1], width, height);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  // 極域の縁で round stroke がにじんで帯状に見えるため、南緯58度以南・北緯84度以北を
  // 最後に海色で塗り潰して隠す (ポリゴン除外だけでは stroke のはみ出しを防げないため)。
  const southClipLat = data.southClipLat ?? DEFAULT_SOUTH_CLIP_LAT;
  const northClipLat = data.northClipLat ?? DEFAULT_NORTH_CLIP_LAT;
  ctx.fillStyle = palette.ocean;
  const [, southY] = project(0, southClipLat, width, height);
  ctx.fillRect(0, southY, width, height - southY);
  const [, northY] = project(0, northClipLat, width, height);
  ctx.fillRect(0, 0, width, northY);
};

const cssColor = (varName: string, fallback: string): string => {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || fallback;
};

/** ブランドトークンから実行時のパレットを読み取る。 */
export const readPalette = (): Palette => ({
  ocean: cssColor("--mint-light", "#7fd9cc"),
  land: cssColor("--mint-deep", "#3fb3a3"),
  border: cssColor("--white-45", "rgba(255,255,255,0.45)"),
  graticule: cssColor("--white-12", "rgba(255,255,255,0.12)"),
});

/** regions.json のセル境界から、隣接セルが異なる国に属する生の (未平滑化) 線分を作る。 */
const buildRawBorderSegments = (
  cells: Readonly<{
    lat0: number;
    lon0: number;
    step: number;
    rows: number;
    cols: number;
    countryByCell: readonly number[];
  }>,
): readonly (readonly [LonLat, LonLat])[] => {
  const { lat0, lon0, step, rows, cols, countryByCell } = cells;
  const segments: (readonly [LonLat, LonLat])[] = [];
  const at = (r: number, c: number): number => countryByCell[r * cols + c] ?? -1;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const here = at(r, c);
      if (here < 0) continue;
      const lat = lat0 + r * step;
      const lon = lon0 + c * step;

      const right = at(r, c + 1);
      if (c + 1 < cols && right >= 0 && right !== here) {
        segments.push([
          [lon + step / 2, lat - step / 2],
          [lon + step / 2, lat + step / 2],
        ]);
      }
      const up = at(r + 1, c);
      if (r + 1 < rows && up >= 0 && up !== here) {
        segments.push([
          [lon - step / 2, lat + step / 2],
          [lon + step / 2, lat + step / 2],
        ]);
      }
    }
  }
  return segments;
};

const keyOf = (p: LonLat): string => `${p[0].toFixed(6)}|${p[1].toFixed(6)}`;

/**
 * 独立した線分の集合から、次数2のノードのみを辿って連続した折れ線 (chain) に復元する。
 * 3方向以上の分岐点では chain を打ち切る。
 */
const traceChains = (
  edges: readonly (readonly [LonLat, LonLat])[],
): readonly (readonly LonLat[])[] => {
  const nodeEdges = new Map<string, number[]>();
  const nodePoint = new Map<string, LonLat>();
  const endpoints: (readonly [string, string])[] = edges.map(([a, b]) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    nodePoint.set(ka, a);
    nodePoint.set(kb, b);
    return [ka, kb];
  });
  endpoints.forEach(([ka, kb], idx) => {
    nodeEdges.set(ka, [...(nodeEdges.get(ka) ?? []), idx]);
    nodeEdges.set(kb, [...(nodeEdges.get(kb) ?? []), idx]);
  });

  const visited = new Set<number>();
  const chains: LonLat[][] = [];

  const otherEnd = (edgeIdx: number, fromKey: string): string => {
    const pair = endpoints[edgeIdx];
    if (!pair) return fromKey;
    const [ka, kb] = pair;
    return ka === fromKey ? kb : ka;
  };

  for (let i = 0; i < edges.length; i++) {
    if (visited.has(i)) continue;
    visited.add(i);
    const edge = edges[i];
    if (!edge) continue;
    const [a, b] = edge;
    const chain: LonLat[] = [a, b];

    let currentKey = keyOf(b);
    for (;;) {
      const touching = nodeEdges.get(currentKey) ?? [];
      if (touching.length !== 2) break;
      const nextEdge = touching.find((e) => !visited.has(e));
      if (nextEdge === undefined) break;
      visited.add(nextEdge);
      const nextKey = otherEnd(nextEdge, currentKey);
      const nextPoint = nodePoint.get(nextKey);
      if (!nextPoint) break;
      chain.push(nextPoint);
      currentKey = nextKey;
    }

    currentKey = keyOf(a);
    for (;;) {
      const touching = nodeEdges.get(currentKey) ?? [];
      if (touching.length !== 2) break;
      const nextEdge = touching.find((e) => !visited.has(e));
      if (nextEdge === undefined) break;
      visited.add(nextEdge);
      const nextKey = otherEnd(nextEdge, currentKey);
      const nextPoint = nodePoint.get(nextKey);
      if (!nextPoint) break;
      chain.unshift(nextPoint);
      currentKey = nextKey;
    }

    chains.push(chain);
  }
  return chains;
};

/** Chaikin のコーナーカット法 (開いた折れ線、端点は保持する) を 1 回適用する。 */
const chaikinOnce = (points: readonly LonLat[]): readonly LonLat[] => {
  if (points.length < 3) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return points;
  const result: LonLat[] = [first];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    if (!p0 || !p1) continue;
    const q: LonLat = [p0[0] * 0.75 + p1[0] * 0.25, p0[1] * 0.75 + p1[1] * 0.25];
    const r: LonLat = [p0[0] * 0.25 + p1[0] * 0.75, p0[1] * 0.25 + p1[1] * 0.75];
    result.push(q, r);
  }
  result.push(last);
  return result;
};

/** 折れ線を Chaikin 法で `iterations` 回平滑化する。 */
export const smoothPolyline = (points: readonly LonLat[], iterations = 2): readonly LonLat[] => {
  let pts = points;
  for (let i = 0; i < iterations; i++) pts = chaikinOnce(pts);
  return pts;
};

const toSegments = (polyline: readonly LonLat[]): readonly (readonly [LonLat, LonLat])[] => {
  const segs: (readonly [LonLat, LonLat])[] = [];
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    if (a && b) segs.push([a, b]);
  }
  return segs;
};

/**
 * regions.json のセル境界から、隣接セルが異なる国に属する境界を作る。
 * 生の格子境界 (階段状) を連続した折れ線に復元し、Chaikin 法で 2 回平滑化してから
 * 描画用の線分列に戻す。
 */
export const buildBorderSegments = (
  cells: Readonly<{
    lat0: number;
    lon0: number;
    step: number;
    rows: number;
    cols: number;
    countryByCell: readonly number[];
  }>,
): readonly (readonly [LonLat, LonLat])[] => {
  const rawEdges = buildRawBorderSegments(cells);
  const chains = traceChains(rawEdges);
  return chains.flatMap((chain) => toSegments(smoothPolyline(chain, 2)));
};
