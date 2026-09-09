import { CanvasTexture, SRGBColorSpace } from "three";
import { loadLandPolygons } from "./land-data";
import { type WorldTextureData, drawWorld } from "./texture";

const TEXTURE_WIDTH = 2048;
const TEXTURE_HEIGHT = 1024;

/** 地球テクスチャ用の CanvasTexture を生成する。起動時に 1 回だけ呼ぶ想定。 */
export const createWorldTexture = (): CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context を取得できませんでした");

  const data: WorldTextureData = {
    landPolygons: loadLandPolygons(),
    width: TEXTURE_WIDTH,
    height: TEXTURE_HEIGHT,
  };

  drawWorld(
    ctx,
    {
      ocean: "#568c9d",
      land: "#c9d5ad",
      graticule: "rgba(210,235,240,0.18)",
    },
    data,
  );

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};
