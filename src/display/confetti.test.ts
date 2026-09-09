import { describe, expect, it } from "vitest";
import { confettiFrame, createConfettiParticles } from "./confetti";

const random = () => {
  let seed = 12345;
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
};

describe("celebration confetti", () => {
  it("staggers emission but launches all 1,600 pieces within the first second", () => {
    const particles = createConfettiParticles(random());
    expect(confettiFrame(0, particles)).toHaveLength(0);
    expect(confettiFrame(0.3, particles).length).toBeGreaterThan(0);
    expect(confettiFrame(0.3, particles).length).toBeLessThan(1600);
    expect(confettiFrame(1, particles)).toHaveLength(1600);
  });
  it("varies launch heights, timings and motion independently", () => {
    const particles = createConfettiParticles(random());
    for (const key of [
      "startY",
      "delay",
      "speedX",
      "speedY",
      "fallSpeed",
      "spin",
      "flutter",
    ] as const) {
      expect(new Set(particles.map((p) => p[key])).size).toBeGreaterThan(1500);
    }
    expect(particles.some((p) => p.side === -1)).toBe(true);
    expect(particles.some((p) => p.side === 1)).toBe(true);
  });

  it("keeps each flight continuous and changes the pattern for a new launch", () => {
    const particles = createConfettiParticles(random());
    const frame = confettiFrame(1, particles);
    expect(confettiFrame(1, particles)).toEqual(frame);
    const next = confettiFrame(1.001, particles);
    expect(
      next.every(
        (p, i) => Math.abs(p.x - frame[i]!.x) < 0.01 && Math.abs(p.y - frame[i]!.y) < 0.01,
      ),
    ).toBe(true);
    expect(
      confettiFrame(
        1,
        createConfettiParticles(() => 0.75),
      ),
    ).not.toEqual(frame);
    expect(confettiFrame(3, particles)[0]!.y).toBeGreaterThan(frame[0]!.y);
  });

  it("fades out and stops at five seconds, with replay starting fresh", () => {
    const particles = createConfettiParticles(random());
    expect(confettiFrame(4.9, particles)).toHaveLength(1600);
    expect(confettiFrame(4.9, particles).every((p) => p.opacity < 0.2)).toBe(true);
    expect(confettiFrame(5, particles)).toEqual([]);
    expect(confettiFrame(6, particles)).toEqual([]);
  });
});
