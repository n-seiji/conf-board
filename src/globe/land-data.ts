import * as topojson from "topojson-client";
import land110m from "world-atlas/land-110m.json" with { type: "json" };

export type LonLat = readonly [lon: number, lat: number];
export type LandRing = readonly LonLat[];
/** 1 ポリゴン = [外周, 穴1, 穴2, ...] */
export type LandPolygon = readonly LandRing[];

/**
 * world-atlas の land-110m (TopoJSON) から陸ポリゴン群を取り出す。
 * ブラウザ側 (`world-texture.ts`) とビルド時スクリプト (`scripts/gen-regions.ts`)、
 * テスト (`regions.test.ts`) のいずれからも同じロジックで読み込むための共通化。
 */
export const loadLandPolygons = (): readonly LandPolygon[] => {
  // biome-ignore lint/suspicious/noExplicitAny: world-atlas / topojson-client には型定義が無い。
  const topology = land110m as any;
  const geo = topojson.feature(topology, topology.objects.land) as unknown as {
    features: readonly { geometry: { type: string; coordinates: unknown } }[];
  };
  const polygons: LandPolygon[] = [];
  for (const feature of geo.features) {
    const { type, coordinates } = feature.geometry;
    if (type === "Polygon") {
      polygons.push(coordinates as LandPolygon);
    } else if (type === "MultiPolygon") {
      for (const polygon of coordinates as LandPolygon[]) {
        polygons.push(polygon);
      }
    }
  }
  return polygons;
};
