import { Vector3 } from "three";

/** Screen-up fall, with a small outward arc so the path never cuts through Earth. */
export const fallingPosition = (
  surface: Vector3,
  progress: number,
  target = new Vector3(),
): Vector3 => {
  const t = Math.min(1, Math.max(0, progress));
  const height = 2.6 * (1 - t * t);
  target.copy(surface).multiplyScalar(1 + 0.35 * Math.sin(Math.PI * t));
  target.y += height;
  const minimumRadius = surface.length() + 0.15 * Math.sin(Math.PI * t);
  if (target.lengthSq() < 1e-12) target.copy(surface);
  if (target.length() < minimumRadius) target.setLength(minimumRadius);
  return target;
};
