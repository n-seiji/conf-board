// Isolated Chrome/CDP check: never writes posts or touches the user's browser profile.
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const profile = await mkdtemp(join(tmpdir(), "conf-board-message-check-"));
const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let ws;
const deadline = setTimeout(() => {
  chrome.kill();
  process.exitCode = 1;
}, 60000);
try {
  const address = await new Promise((resolve, reject) => {
    let output = "";
    chrome.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) resolve(match[1]);
    });
    chrome.on("error", reject);
    chrome.on("exit", () => reject(new Error("Chrome exited before inspection")));
  });
  ws = new WebSocket(address);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  await page("Runtime.enable");
  await page("Page.enable");
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1400,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const evaluate = async (expression) => {
    const value = await page("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
    return value.result.value;
  };
  await page("Page.navigate", { url: "http://127.0.0.1:5173/display" });
  for (let i = 0; i < 80; i++) {
    if (await evaluate('!!document.querySelector(".display-heading")')) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const safe = await evaluate(`(() => {
    const heading = document.querySelector('.display-heading').getBoundingClientRect();
    const overlay = document.querySelector('.callouts-host').getBoundingClientRect();
    return { top: overlay.top, headingBottom: heading.bottom };
  })()`);
  assert.ok(safe.top >= safe.headingBottom + 15, "Callouts must stay below the heading");
  await page("Page.navigate", {
    url: "http://127.0.0.1:5173/assets/gopher/integration-preview#celebrate",
  });
  for (let i = 0; i < 80; i++) {
    if (
      await evaluate('document.querySelector(".display-view-toggle")?.textContent === "地球に戻る"')
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(
    await evaluate('document.querySelector(".display-view-toggle")?.textContent'),
    "地球に戻る",
  );
  await new Promise((resolve) => setTimeout(resolve, 2300));
  const { data } = await page("Page.captureScreenshot", { format: "png" });
  await writeFile(join(tmpdir(), "conf-board-message-verified.png"), Buffer.from(data, "base64"));
  await evaluate('document.querySelector(".display-view-toggle").click()');
  assert.equal(
    await evaluate('document.querySelector("canvas").getAttribute("aria-label")'),
    "投稿の地球儀",
  );
  assert.equal(
    await evaluate('document.querySelector(".display-view-toggle").textContent'),
    "メッセージを見る",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: 5-second transition, 3D message screenshot, return to globe, no JS exceptions",
  );
  console.log(join(tmpdir(), "conf-board-message-verified.png"));
} finally {
  clearTimeout(deadline);
  ws?.close();
  chrome.kill();
}
