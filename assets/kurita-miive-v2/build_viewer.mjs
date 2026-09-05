import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "../../node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js";
const base = new URL(".", import.meta.url);
const result = await build({
  entryPoints: [fileURLToPath(new URL("viewer.js", base))],
  bundle: true,
  minify: true,
  write: false,
  format: "iife",
  legalComments: "inline",
});
const model = await readFile(new URL("kurita-miive-v2.glb", base));
const script = result.outputFiles[0].text.replaceAll("</script", "<\\/script");
await writeFile(
  new URL("viewer.html", base),
  `<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>miive — 2頭身キャラクター</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#fff;color:#24282b;font:14px system-ui,sans-serif}header{position:absolute;z-index:2;top:24px;left:28px;pointer-events:none}h1{font-size:19px;margin:0 0 7px;font-weight:650}p{margin:0;color:#757d83;font-size:12px}#stage{height:100svh;min-height:500px;width:100%;touch-action:none}canvas{display:block}nav{position:absolute;z-index:2;left:50%;bottom:28px;transform:translateX(-50%);display:flex;gap:6px;padding:7px;background:#ffffffed;border:1px solid #e4e9e9;border-radius:15px;box-shadow:0 5px 24px #122c2910;white-space:nowrap}button{font:inherit;background:#f3f6f5;border:0;border-radius:9px;padding:10px 15px;color:#344340;cursor:pointer}button:hover,button[aria-pressed=true]{background:#cdeeed}#download{background:#253d3e;color:white}@media(max-width:600px){header{left:18px;top:18px}nav{bottom:18px;gap:4px}button{padding:10px;font-size:12px}}
</style>
<header><h1>miive · 2頭身キャラクター</h1><p id="status">モデルを読み込み中…</p></header>
<main id="stage" aria-label="回転できる3Dモデル"></main>
<nav aria-label="表示操作"><button data-angle="0">正面</button><button data-angle="30">斜め</button><button data-angle="90">横</button><button data-angle="180">背面</button><button id="rotate" aria-pressed="false">自動回転</button><button id="download">GLB保存</button></nav>
<script id="model-data" type="application/octet-stream">${model.toString("base64")}</script>
<script>${script}</script></html>`,
);
console.log("Self-contained viewer.html written; no network or server required.");
