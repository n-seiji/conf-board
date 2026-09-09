const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs");
const assert = require("node:assert/strict");
(async () => {
  const root = require("node:path").resolve("docs/evidence/deploy");
  fs.mkdirSync(root, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  const report = {
    utc: new Date().toISOString(),
    browser: browser.version(),
    scope: "Local built preview; no Cloudflare publish; admin login form only",
    pages: [],
  };
  try {
    for (const [name, path] of [
      ["phone", "/"],
      ["display", "/display"],
      ["admin", "/admin"],
    ]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const response = await page.goto("http://127.0.0.1:4173" + path);
      assert.equal(response.status(), 200);
      if (name === "phone") await page.getByLabel("ニックネーム", { exact: true }).waitFor();
      if (name === "display") await page.locator("canvas").first().waitFor();
      if (name === "admin") await page.locator("input").first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: root + "/" + name + ".png" });
      assert.deepEqual(errors, []);
      report.pages.push({
        path,
        status: response.status(),
        pageErrors: errors,
        screenshot: name + ".png",
      });
      await page.close();
    }
    fs.writeFileSync(root + "/browser.json", JSON.stringify(report, null, 2) + "\n");
    console.log("PASS phone / display / admin: HTTP 200, UI elements visible, no page errors");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
