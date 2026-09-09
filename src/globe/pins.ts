import type { Vector3 } from "three";
import { latLonToVector3 } from "./rig";
import type { Post } from "../shared/types";
import { CANDIDATE_MAX_LAT, CANDIDATE_MIN_LAT, type RegionsData } from "./regions-gen";
import regionsData from "./regions.json";

const regions = regionsData as unknown as RegionsData;

/** FNV-1a 32bit ハッシュ。 */
export const fnv1a32 = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/**
 * 投稿の id と countryId から着地点 (緯度・経度) を決定的に求める。
 * 周囲にピンがない場合の基準位置。密集時は spacedPinLatLon が空き場所を選ぶ。
 */
export const pinLatLon = (post: Pick<Post, "id" | "countryId">): readonly [number, number] => {
  const country = regions.countries[post.countryId] ?? regions.countries[0];
  if (!country || country.candidates.length === 0) {
    return [0, 0];
  }
  const idx = fnv1a32(post.id) % country.candidates.length;
  return country.candidates[idx] ?? country.candidates[0] ?? [0, 0];
};

/** Character clearance on the unit globe, including room for arm motions. */
export type OccupiedPin = Readonly<{
  direction: Vector3;
  radius: number;
}>;

const spacingCandidates = new Map<number, readonly (readonly [number, number])[]>();
const candidatesFor = (countryId: number): readonly (readonly [number, number])[] => {
  const id = regions.countries[countryId]?.id ?? 0;
  const cached = spacingCandidates.get(id);
  if (cached) return cached;
  const candidates: (readonly [number, number])[] = [...(regions.countries[id]?.candidates ?? [])];
  const grid = regions.cells;
  grid.countryByCell.forEach((country, i) => {
    if (country !== id) return;
    const lat = grid.lat0 + Math.floor(i / grid.cols) * grid.step;
    if (lat < CANDIDATE_MIN_LAT || lat > CANDIDATE_MAX_LAT) return;
    candidates.push([lat, grid.lon0 + (i % grid.cols) * grid.step]);
  });
  spacingCandidates.set(id, candidates);
  return candidates;
};

/** Keep a free original spot; otherwise choose the largest gap in the same region.
 * Existing pins never move. Replaying the same ordered snapshot produces the same layout.
 */
export const spacedPinLatLon = (
  post: Pick<Post, "id" | "countryId">,
  occupied: readonly OccupiedPin[],
  radius: number,
): readonly [number, number] => {
  let best = pinLatLon(post);
  if (!occupied.length) return best;
  const clearance = (point: readonly [number, number]): number => {
    const direction = latLonToVector3(point[0], point[1], 1);
    return Math.min(
      ...occupied.map((pin) => direction.distanceTo(pin.direction) - radius - pin.radius),
    );
  };
  let bestGap = clearance(best);
  if (bestGap >= 0.03) return best;
  const candidates = candidatesFor(post.countryId);
  const offset = fnv1a32(post.id) % Math.max(1, candidates.length);
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[(offset + i) % candidates.length]!;
    const gap = clearance(candidate);
    if (gap > bestGap + 1e-9) {
      best = candidate;
      bestGap = gap;
    }
  }
  return best;
};
