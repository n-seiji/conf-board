import { describe, expect, it } from "vitest";
import { createMessageGlobe } from "./message-globe";

describe("three-dimensional message globe", () => {
  it("fills the row with full-size words and reserves only a small edge slot for punctuation", () => {
    const model = createMessageGlobe();
    const horizontalBounds = (index: number) => {
      const p = model.letters[index]!.geometry.getAttribute("position");
      let min = Infinity,
        max = -Infinity;
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i) / Math.hypot(p.getX(i), p.getZ(i));
        min = Math.min(min, u);
        max = Math.max(max, u);
      }
      return { min, max };
    };
    for (const [wordEnd, punctuation] of [
      [4, 5],
      [11, 12],
    ] as const) {
      expect(horizontalBounds(wordEnd).max).toBeGreaterThan(0.8);
      expect(horizontalBounds(punctuation).max).toBeGreaterThan(0.95);
      expect(horizontalBounds(punctuation).min).toBeGreaterThan(horizontalBounds(wordEnd).max);
    }
    model.dispose();
  });
  it("turns only the final row five degrees further right", () => {
    const model = createMessageGlobe();
    for (const letter of model.letters.slice(0, 9)) expect(letter.rotation.y).toBe(0);
    for (const letter of model.letters.slice(9)) {
      expect(letter.rotation.y).toBeCloseTo((5 * Math.PI) / 180);
    }
    model.dispose();
  });
  it("packs 世界を tightly without crossing neighboring glyph outlines", () => {
    const model = createMessageGlobe();
    const bounds = model.letters.slice(6, 9).map((letter) => {
      const p = letter.geometry.getAttribute("position");
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < p.count; i++) {
        // Undo the circular silhouette's varying width to compare glyph columns.
        const u = p.getX(i) / Math.hypot(p.getX(i), p.getZ(i));
        min = Math.min(min, u);
        max = Math.max(max, u);
      }
      return { min, max };
    });
    for (let i = 1; i < bounds.length; i++) {
      const gap = bounds[i]!.min - bounds[i - 1]!.max;
      expect(gap).toBeGreaterThan(0.004);
      expect(gap).toBeLessThan(0.025);
    }
    model.dispose();
  });
  it("keeps neighboring rows separated even with the raised text thickness", () => {
    const model = createMessageGlobe();
    const rows = [
      model.letters.slice(0, 2),
      model.letters.slice(2, 6),
      model.letters.slice(6, 9),
      model.letters.slice(9),
    ];
    const bounds = rows.map((letters) => {
      let min = Infinity;
      let max = -Infinity;
      for (const letter of letters) {
        letter.geometry.computeBoundingBox();
        min = Math.min(min, letter.geometry.boundingBox!.min.y);
        max = Math.max(max, letter.geometry.boundingBox!.max.y);
      }
      return { min, max };
    });
    for (let i = 1; i < bounds.length; i++) {
      expect(bounds[i - 1]!.min - bounds[i]!.max).toBeGreaterThan(0.004);
      expect(bounds[i - 1]!.min - bounds[i]!.max).toBeLessThan(0.027);
    }
    model.dispose();
  });
  it("outlines outer contours and inner holes with mint meshes attached to each letter", () => {
    const model = createMessageGlobe();
    const contours = model.letters[0]!.children;
    expect(contours.length).toBeGreaterThan(1);
    for (const letter of model.letters) {
      expect(letter.children.length).toBeGreaterThan(0);
      for (const outline of letter.children) {
        expect(outline.name).toMatch(/^glyph-outline-(outer|hole)$/);
      }
    }
    expect(contours.some((m) => m.name === "glyph-outline-hole")).toBe(true);
    model.dispose();
  });
  it("has all slogan glyphs as curved, raised geometry on a miive sphere", () => {
    const model = createMessageGlobe();
    expect(model.group.rotation.y).toBeCloseTo((4 * Math.PI) / 180);
    expect(model.base.material.color.getHexString()).toBe("5fcfbf");
    expect(model.letters.map((m) => m.name).join("")).toBe("働く意味で、世界を満たす。");
    for (const mesh of model.letters) {
      const p = mesh.geometry.getAttribute("position");
      let min = Infinity,
        max = 0;
      for (let i = 0; i < p.count; i++) {
        const radius = Math.hypot(p.getX(i), p.getY(i), p.getZ(i));
        min = Math.min(min, radius);
        max = Math.max(max, radius);
      }
      expect(min).toBeGreaterThan(0.99);
      expect(max).toBeGreaterThan(1.03);
      expect(max).toBeLessThan(1.045);
      expect(max - min).toBeGreaterThan(0.025);
    }
    model.update(0);
    expect(model.letters.every((m) => !m.visible)).toBe(true);
    model.update(2);
    expect(model.letters.every((m) => m.visible && m.scale.x === 1)).toBe(true);
    model.dispose();
  });
});
