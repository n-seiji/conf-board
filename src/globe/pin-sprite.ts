import { CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial } from "three";
import type { PinColorId } from "../shared/colors";

const TEXTURE_WIDTH = 128;
const TEXTURE_HEIGHT = 160;

/** マップピン (しずく型) のシルエットを 1 本の path として描く。 */
const tracePinShape = (ctx: CanvasRenderingContext2D): void => {
  const cx = TEXTURE_WIDTH / 2;
  const headRadius = TEXTURE_WIDTH * 0.33;
  const headCenterY = TEXTURE_HEIGHT * 0.31;
  const tipY = TEXTURE_HEIGHT - 8;

  // 円の下側、対称な2点をタップの根本 (接線に近い位置) とし、そこから先端まで直線で結ぶ。
  const tangentAngleDeg = 50;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const leftAngle = toRad(180 - tangentAngleDeg);
  const rightAngle = toRad(tangentAngleDeg);
  const rightPoint: readonly [number, number] = [
    cx + headRadius * Math.cos(rightAngle),
    headCenterY + headRadius * Math.sin(rightAngle),
  ];
  ctx.beginPath();
  ctx.moveTo(cx, tipY);
  ctx.lineTo(rightPoint[0], rightPoint[1]);
  // 円の上側 (先端の反対側) を通る長い方の弧で左の接点まで戻る。
  ctx.arc(cx, headCenterY, headRadius, rightAngle, leftAngle, true);
  ctx.lineTo(cx, tipY);
  ctx.closePath();
};

/** 128×160 のマップピンテクスチャを描く純粋関数。指定色で塗り、白フチと中央の白丸を重ねる。 */
export const drawPinSprite = (ctx: CanvasRenderingContext2D, colorHex: string): void => {
  ctx.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);

  tracePinShape(ctx);
  ctx.fillStyle = colorHex;
  ctx.fill();

  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffffff";
  ctx.lineJoin = "round";
  ctx.stroke();

  const cx = TEXTURE_WIDTH / 2;
  const headCenterY = TEXTURE_HEIGHT * 0.31;
  ctx.beginPath();
  ctx.arc(cx, headCenterY, TEXTURE_WIDTH * 0.11, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
};

const textureCache = new Map<PinColorId, CanvasTexture>();

/** 色ごとにテクスチャを 1 枚だけ生成してキャッシュする (最大 6 色分)。 */
export const getPinTexture = (colorId: PinColorId, colorHex: string): CanvasTexture => {
  const cached = textureCache.get(colorId);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context を取得できませんでした");
  drawPinSprite(ctx, colorHex);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  textureCache.set(colorId, texture);
  return texture;
};

/** マップピンの見た目の高さ (球半径 1 に対する比率)。 */
export const PIN_SPRITE_HEIGHT = 0.09;
export const PIN_SPRITE_WIDTH = PIN_SPRITE_HEIGHT * (TEXTURE_WIDTH / TEXTURE_HEIGHT);

/** 色付きマップピンの Sprite を新規作成する (テクスチャはキャッシュ、マテリアルは毎回新規)。 */
export const createPinSprite = (colorId: PinColorId, colorHex: string): Sprite => {
  const material = new SpriteMaterial({
    map: getPinTexture(colorId, colorHex),
    transparent: true,
  });
  const sprite = new Sprite(material);
  sprite.scale.set(PIN_SPRITE_WIDTH, PIN_SPRITE_HEIGHT, 1);
  // アンカーをテクスチャ下端 (先端) に設定する。これにより position がそのまま
  // 先端の座標になり、rotation も先端を中心に回転する (球面に垂直に立たせるため)。
  sprite.center.set(0.5, 0);
  return sprite;
};
