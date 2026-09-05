import { CanvasTexture, SRGBColorSpace } from "three";
import { loadLandPolygons } from "./land-data";
import type { RegionsData } from "./regions-gen";
import regionsData from "./regions.json";
import { type WorldTextureData, buildBorderSegments, drawWorld, readPalette } from "./texture";

const TEXTURE_WIDTH = 2048;
const TEXTURE_HEIGHT = 1024;

/** 地球テクスチャ用の CanvasTexture を生成する。起動時に 1 回だけ呼ぶ想定。 */
export const createWorldTexture = (): CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context を取得できませんでした");

  const regions = regionsData as unknown as RegionsData;
  const data: WorldTextureData = {
    landPolygons: loadLandPolygons(),
    borderSegments: buildBorderSegments(regions.cells),
    width: TEXTURE_WIDTH,
    height: TEXTURE_HEIGHT,
  };

  drawWorld(ctx, readPalette(), data);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};
