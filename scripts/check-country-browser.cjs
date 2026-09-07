const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  try {
    for (const mode of ["matched", "unmatched", "blocked", "slow"]) {
      const context = await browser.newContext();
      if (mode === "blocked") await context.route("**/*.wasm", (r) => r.abort());
      if (mode === "slow")
        await context.route("**/*.wasm", async (r) => {
          await new Promise((resolve) => setTimeout(resolve, 1800));
          try {
            await r.continue();
          } catch {}
        });
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:4174/");
      await page.getByLabel("ニックネーム", { exact: true }).fill("Wasm test");
      await page
        .getByLabel("内容", { exact: true })
        .fill(mode === "unmatched" ? "働きやすい職場" : "書籍購入を無制限にしたい");
      const request = page.waitForRequest(
        (r) => r.url().endsWith("/api/posts") && r.method() === "POST",
      );
      const response = page.waitForResponse(
        (r) => r.url().endsWith("/api/posts") && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "世界に届ける", exact: true }).click();
      const sent = (await request).postDataJSON();
      const received = await response;
      assert.equal(received.status(), 201);
      const result = await received.json();
      if (mode === "matched") {
        assert.equal(sent.countryId, 3);
        assert.equal(result.post.countryId, 3);
      } else {
        assert.equal(sent.countryId, undefined);
        assert.ok(result.post.countryId >= 0 && result.post.countryId < 20);
      }
      await page.locator(".phone-arrived-heading__country").waitFor();
      if (mode === "matched") await page.screenshot({ path: "/tmp/conf-board-wasm-arrived.png" });
      console.log("PASS", mode);
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
