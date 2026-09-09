import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { fallingPosition } from "./arrival";

describe("Gopher arrival path", () => {
  it("falls from above the visible globe and finishes exactly on the surface", () => {
    const surface = new Vector3(0, 0, 1);
    const start = fallingPosition(surface, 0);
    expect(start.y).toBeGreaterThan(2);
    let previousY = start.y;
    for (let i = 1; i <= 20; i++) {
      const p = fallingPosition(surface, i / 20);
      expect(p.y).toBeLessThanOrEqual(previousY);
      expect(p.length()).toBeGreaterThanOrEqual(1 - 1e-8);
      previousY = p.y;
    }
    expect(fallingPosition(surface, 1).distanceTo(surface)).toBeLessThan(1e-8);
  });
  it("does not pass through the globe for southern or queued arrivals", () => {
    for (const surface of [
      new Vector3(0, -0.8, 0.6),
      new Vector3(0, -1, 0),
      new Vector3(1, 0, 0),
    ]) {
      for (let i = 0; i <= 20; i++)
        expect(fallingPosition(surface, i / 20).length()).toBeGreaterThanOrEqual(1 - 1e-8);
      expect(fallingPosition(surface, 1).distanceTo(surface)).toBeLessThan(1e-8);
    }
  });
});
