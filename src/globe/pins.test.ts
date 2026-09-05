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
