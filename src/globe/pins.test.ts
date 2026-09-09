import { describe, expect, it } from "vitest";
import { fnv1a32, pinLatLon } from "./pins";

describe("fnv1a32", () => {
  it("同じ文字列に対して常に同じハッシュを返す", () => {
    expect(fnv1a32("hello")).toBe(fnv1a32("hello"));
  });

  it("異なる文字列は (基本的に) 異なるハッシュを返す", () => {
    expect(fnv1a32("hello")).not.toBe(fnv1a32("world"));
  });
});

describe("pinLatLon", () => {
  it("同じ post に対して常に同じ緯度経度を返す (決定的)", () => {
    const post = { id: "11111111-1111-1111-1111-111111111111", countryId: 3 };
    const a = pinLatLon(post);
    const b = pinLatLon(post);
    expect(a).toEqual(b);
  });

  it("緯度経度が有効な範囲に収まる", () => {
    const post = { id: "22222222-2222-2222-2222-222222222222", countryId: 7 };
    const [lat, lon] = pinLatLon(post);
    expect(lat).toBeGreaterThanOrEqual(-90);
    expect(lat).toBeLessThanOrEqual(90);
    expect(lon).toBeGreaterThanOrEqual(-180);
    expect(lon).toBeLessThanOrEqual(180);
  });
});

import { spacedPinLatLon } from "./pins";
import { latLonToVector3 } from "./rig";
import regions from "./regions.json";

describe("spaced character placement", () => {
  it("keeps the original position on an empty globe", () => {
    const post = { id: "first", countryId: 0 };
    expect(spacedPinLatLon(post, [], 0.12)).toEqual(pinLatLon(post));
  });
  it("avoids an occupied destination and leaves more room around larger characters", () => {
    const post = { id: "crowded", countryId: 0 };
    const occupied = [{ direction: latLonToVector3(...pinLatLon(post), 1), radius: 0.156 }];
    const point = spacedPinLatLon(post, occupied, 0.156);
    expect(latLonToVector3(...point, 1).distanceTo(occupied[0]!.direction)).toBeGreaterThan(0.1);
    expect(spacedPinLatLon(post, occupied, 0.156)).toEqual(point);
  });
  it("keeps 40 characters in their region without duplicate landing positions", () => {
    const occupied: { direction: ReturnType<typeof latLonToVector3>; radius: number }[] = [];
    const points: string[] = [];
    for (let i = 0; i < 40; i++) {
      const point = spacedPinLatLon(
        { id: `crowd-${i}`, countryId: 0 },
        occupied,
        i % 2 ? 0.156 : 0.12,
      );
      const [lat, lon] = point;
      const grid = regions.cells;
      const row = Math.round((lat - grid.lat0) / grid.step),
        col = Math.round((lon - grid.lon0) / grid.step);
      expect(grid.countryByCell[row * grid.cols + col]).toBe(0);
      points.push(point.join(","));
      occupied.push({ direction: latLonToVector3(...point, 1), radius: 0.156 });
    }
    expect(new Set(points).size).toBe(40);
  });
});
