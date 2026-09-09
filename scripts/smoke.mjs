import assert from "node:assert/strict";

const input = process.argv[2] ?? process.env.DEPLOY_URL;
if (!input) throw new Error("Usage: pnpm smoke https://your-worker.workers.dev");
const base = new URL(input);
if (!["https:", "http:"].includes(base.protocol)) throw new Error("Expected an HTTP(S) URL");

for (const path of ["/", "/display", "/admin", "/api/posts"]) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  if (path === "/api/posts") {
    const result = await response.json();
    assert.ok(Array.isArray(result.posts));
    assert.equal(typeof result.total, "number");
    assert.equal(typeof result.celebrated, "boolean");
  } else {
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await response.text(), /<script\b[^>]*\bsrc=/);
  }
  console.log(`OK ${path}`);
}

// Read the snapshot without creating or deleting any posts.
const socketUrl = new URL("/api/ws", base);
socketUrl.protocol = base.protocol === "https:" ? "wss:" : "ws:";
await new Promise((resolve, reject) => {
  const socket = new WebSocket(socketUrl);
  const timeout = setTimeout(() => finish(new Error("WebSocket snapshot timed out")), 15_000);
  let settled = false;
  const finish = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    socket.close();
    if (error) reject(error);
    else resolve();
  };
  socket.addEventListener(
    "message",
    (event) => {
      try {
        const data = JSON.parse(event.data);
        assert.equal(data.type, "snapshot");
        assert.ok(Array.isArray(data.posts));
        finish();
      } catch (error) {
        finish(error);
      }
    },
    { once: true },
  );
  socket.addEventListener("error", () => finish(new Error("WebSocket connection failed")), {
    once: true,
  });
  socket.addEventListener("close", () => {
    if (!settled) finish(new Error("WebSocket closed before snapshot"));
  });
});
console.log("OK /api/ws (snapshot)");
