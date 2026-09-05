import type { Post } from "../shared/types";
import type { RegionsData } from "./regions-gen";
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
 * 同じ投稿は常に同じ位置に着地する (リロードやスマホの到着画面でも一致)。
 */
export const pinLatLon = (post: Pick<Post, "id" | "countryId">): readonly [number, number] => {
  const country = regions.countries[post.countryId] ?? regions.countries[0];
  if (!country || country.candidates.length === 0) {
    return [0, 0];
  }
  const idx = fnv1a32(post.id) % country.candidates.length;
  return country.candidates[idx] ?? country.candidates[0] ?? [0, 0];
};
