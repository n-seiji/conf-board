/**
 * 地球テクスチャ (正距円筒図法、2048×1024) の描画。
 * `drawWorld` は純粋関数としてテスト可能にし、ブラウザ用の `createWorldTexture` から呼ぶ。
 */

import type { LandPolygon, LandRing } from "./land-data";

export type Palette = Readonly<{
  ocean: string;
  land: string;
  graticule: string;
}>;

export type WorldTextureData = Readonly<{
  /** 陸のポリゴン群 (GeoJSON MultiPolygon の coordinates と同じ形)。 */
  landPolygons: readonly LandPolygon[];
  width: number;
  height: number;
}>;

/** Canvas 2D コンテキストのうち、描画に使うプロパティ・メソッドの部分集合。 */
export type DrawContext = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(fillRule?: CanvasFillRule): void;
  stroke(): void;
};

/** 隣接点の経度差がこれを超えたら antimeridian をまたいだとみなし、線でつながない。 */
const LON_JUMP_THRESHOLD = 180;

/** 経緯度 (equirectangular) → canvas ピクセル座標。 */
const project = (
  lon: number,
  lat: number,
  width: number,
  height: number,
): readonly [number, number] => [((lon + 180) / 360) * width, ((90 - lat) / 180) * height];

/**
 * antimeridian をまたぐリングを、最初のジャンプ直後の点から始まるよう回転させる。
 * fill() は moveTo で区切った各サブパスを暗黙に閉じるため、サブパスの境界が
 * ジャンプ箇所とずれていると (=リングの先頭がジャンプの途中にあると)、
 * 先頭側と末尾側の海岸線が別々のサブパスとして閉じられ、閉じ辺が海岸線を
 * 横切って evenodd の塗りが欠けたり穴が開いたりする。ジャンプが無ければそのまま返す。
 */
const startAfterJump = (ring: LandRing): LandRing => {
  let jumpIdx = -1;
  for (let i = 0; i < ring.length; i++) {
    const curr = ring[i];
    const next = ring[(i + 1) % ring.length];
    if (!curr || !next) continue;
    if (Math.abs(next[0] - curr[0]) > LON_JUMP_THRESHOLD) {
      jumpIdx = i;
      break;
    }
  }
  if (jumpIdx === -1) return ring;
  const start = (jumpIdx + 1) % ring.length;
  return [...ring.slice(start), ...ring.slice(0, start)];
};

/**
 * ポリゴン (外周 + 穴) をまとめて1つの canvas パスとして描く。beginPath はポリゴン全体で
 * 1回だけ呼び、外周と穴の各リングを同じパスに積む (呼び出し側で "evenodd" ルールで fill
 * すれば穴は正しく穴として描かれ、外周が穴の beginPath で握り潰されることもない)。
 * 等距円筒図法では antimeridian (経度 ±180 度線) をまたぐ隣接点を素直に lineTo で結ぶと、
 * 地図を横断する直線 (陸色の帯) になってしまうため、経度差の絶対値が LON_JUMP_THRESHOLD を
 * 超える箇所は lineTo せず moveTo で新しい部分パスに切る。
 * どこにも antimeridian をまたぐ箇所が無いリングだけ、従来どおり closePath で輪を閉じる。
 */
const tracePolygon = (
  ctx: DrawContext,
  polygon: LandPolygon,
  width: number,
  height: number,
): void => {
  ctx.beginPath();
  for (const rawRing of polygon) {
    const ring = startAfterJump(rawRing);
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

/** 海・陸・経緯線を canvas に描く純粋関数。 */
export const drawWorld = (ctx: DrawContext, palette: Palette, data: WorldTextureData): void => {
  const { width, height } = data;

  ctx.fillStyle = palette.ocean;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = palette.land;
  for (const polygon of data.landPolygons) {
    tracePolygon(ctx, polygon, width, height);
    ctx.fill("evenodd");
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
};
