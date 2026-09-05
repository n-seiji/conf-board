import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "../../node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js";
const base = new URL(".", import.meta.url);
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("viewer.js", base))],
  bundle: true,
  minify: true,
  write: false,
  format: "iife",
  legalComments: "inline",
});
const model = await readFile(new URL("kurita-miive-animated.glb", base));
const script = bundle.outputFiles[0].text.replaceAll("</script", "<\\/script");
const names = [
  ["Wave", "手を振る"],
  ["Bow", "おじぎ"],
  ["Nod", "うなずく"],
  ["Jump", "ジャンプ"],
  ["Dance", "ダンス"],
];
const buttons = names
  .map(
    ([name, label], i) =>
      `<button data-motion="${name}" aria-pressed="${i === 0}" disabled><span>0${i + 1}</span>${label}</button>`,
  )
  .join("");
await writeFile(
  new URL("viewer.html", base),
  `<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>miive · 5つの動き</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#fff;color:#263733;font:14px system-ui,sans-serif}header{position:absolute;z-index:2;left:30px;top:26px;pointer-events:none}.eyebrow{font-size:11px;letter-spacing:.18em;color:#638b83;font-weight:700}h1{font-size:21px;margin:6px 0 8px;font-weight:650}p{margin:0;color:#7b8783;font-size:12px}#stage{margin-top:70px;height:calc(100svh - 230px);min-height:320px;width:100%;touch-action:none}canvas{display:block}.panel{position:absolute;z-index:2;left:50%;bottom:24px;transform:translateX(-50%);padding:14px;background:#fffffff2;border:1px solid #e0e9e6;border-radius:18px;box-shadow:0 8px 32px #17342d0d;max-width:calc(100% - 28px)}.summary{display:flex;align-items:center;justify-content:space-between;padding:0 3px 12px;gap:26px}#motion-name{font-weight:650}#duration{font-size:11px;color:#85938d}.motions{display:flex;gap:6px}.motions button{min-width:100px;display:flex;gap:9px;align-items:center;text-align:left}.motions span{font-size:10px;opacity:.55;font-variant-numeric:tabular-nums}button{font:inherit;background:#f2f6f4;border:0;border-radius:10px;padding:12px;color:#344a42;cursor:pointer;white-space:nowrap}button:disabled{opacity:.5;cursor:wait}button:hover{background:#e2f3ed}button[aria-pressed=true]{background:#cfeee4;color:#1d5041}.tools{display:flex;justify-content:space-between;gap:10px;border-top:1px solid #edf1ee;margin-top:12px;padding-top:10px}.views{display:flex;gap:4px}.tools button{padding:8px 12px;font-size:12px;background:transparent}.tools #pause{background:#eff4f1;min-width:82px}.tools #download{background:#285347;color:#fff}@media(max-width:640px){header{left:18px;top:18px}h1{font-size:18px}.panel{bottom:14px;padding:10px;min-width:calc(100% - 28px)}.motions{gap:4px}.motions button{padding:10px 5px;min-width:0;flex:1;justify-content:center;font-size:11px;gap:0}.motions span{display:none}.tools button{padding:8px;font-size:11px}.summary{padding-bottom:9px}.tools{margin-top:9px;padding-top:8px}}
</style>
<header><div class="eyebrow">MIIVE / MOTION</div><h1>5つの動き</h1><p id="status">モデルを読み込み中…</p></header>
<main id="stage" aria-label="動く2頭身キャラクター"></main>
<section class="panel" aria-label="アニメーション操作"><div class="summary"><span id="motion-name">手を振る</span><span id="duration"></span></div>
<nav class="motions" aria-label="動きの選択">${buttons}</nav>
<div class="tools"><div class="views"><button data-angle="0">正面</button><button data-angle="25">斜め</button><button data-angle="180">背面</button></div><div><button id="pause" aria-pressed="false" disabled>一時停止</button><button id="download" disabled>GLB保存</button></div></div></section>
<script id="model-data" type="application/octet-stream">${model.toString("base64")}</script><script>${script}</script></html>`,
);
console.log("Wrote offline motion viewer with embedded 5-clip GLB.");
