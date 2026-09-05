import { PIN_COLORS } from "../shared/colors";
import type { Post } from "../shared/types";

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      img
        .decode()
        .then(() => resolve(img))
        .catch(() => resolve(img));
    };
    img.onerror = () => reject(new Error(`failed to load image: ${src}`));
    img.src = src;
  });

const roundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

const wrapText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void => {
  const chars = Array.from(text);
  let line = "";
  let cursorY = y;
  for (const ch of chars) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line.length > 0) {
      ctx.fillText(line, x, cursorY);
      line = ch;
      cursorY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line.length > 0) ctx.fillText(line, x, cursorY);
};

const cssColor = (varName: string, fallback: string): string => {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || fallback;
};

export const saveArrivedImage = async (
  post: Post,
  countryName: string,
  globeHost: HTMLElement | null,
): Promise<void> => {
  await document.fonts.ready;
  const gopher = await loadImage("/gopher-surf.png");
  const globeCanvas = globeHost?.querySelector<HTMLCanvasElement>("canvas") ?? null;

  const mint = cssColor("--mint", "#5fcfbf");
  const mintDeep = cssColor("--mint-deep", "#3fb3a3");
  const white = cssColor("--white", "#ffffff");
  const ink = cssColor("--ink", "#1f3a36");

  const size = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("failed to get 2d context");

  ctx.fillStyle = mint;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = white;
  ctx.textAlign = "center";
  ctx.font = "900 56px 'M PLUS Rounded 1c', sans-serif";
  ctx.fillText(`${countryName}に届きました!`, size / 2, 120);

  // 球は canvas の約 75% なので、以前 (420px × 90%) と同じ大きさで描くために広めに取る。
  const globeSize = 500;
  if (globeCanvas) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, 400, globeSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(globeCanvas, size / 2 - globeSize / 2, 400 - globeSize / 2, globeSize, globeSize);
    ctx.restore();
  }

  const cardX = 100;
  const cardY = 660;
  const cardW = size - 200;
  const cardH = 220;
  ctx.fillStyle = white;
  roundRect(ctx, cardX, cardY, cardW, cardH, 24);
  ctx.fill();

  const colorInfo = PIN_COLORS[post.color];
  ctx.fillStyle = colorInfo.hex;
  ctx.beginPath();
  ctx.arc(cardX + 42, cardY + 52, 12, 0, Math.PI * 2);
  ctx.fill();

  ctx.textAlign = "left";
  ctx.fillStyle = mintDeep;
  ctx.font = "900 30px 'M PLUS Rounded 1c', sans-serif";
  ctx.fillText(post.nickname, cardX + 64, cardY + 60);

  ctx.fillStyle = ink;
  ctx.font = "800 34px 'M PLUS Rounded 1c', sans-serif";
  wrapText(ctx, post.body, cardX + 32, cardY + 120, cardW - 64, 44);

  const gopherW = 200;
  const gopherH = (gopher.naturalHeight / gopher.naturalWidth) * gopherW;
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(gopher, size - gopherW - 40, cardY - gopherH + 30, gopherW, gopherH);
  ctx.globalCompositeOperation = "source-over";

  ctx.textAlign = "center";
  ctx.fillStyle = white;
  ctx.globalAlpha = 0.85;
  ctx.font = "900 28px 'M PLUS Rounded 1c', sans-serif";
  ctx.fillText("miive", size / 2, size - 60);
  ctx.globalAlpha = 1;

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("toBlob returned null");

  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = `miive-${countryName}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Safari では click() 直後に revoke するとダウンロードが失敗することがあるため遅延させる。
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};
