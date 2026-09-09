const { chromium } = require("/Users/sijis/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const path = require("node:path");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  if (process.argv.includes("--double-sided"))
    await page.addInitScript(() => {
      const original = WebGL2RenderingContext.prototype.enable;
      WebGL2RenderingContext.prototype.enable = function (cap) {
        if (cap !== this.CULL_FACE) return original.call(this, cap);
      };
    });
  if (process.argv.includes("--preview-url")) {
    await require("../gopher/check_preview_url.cjs")(page);
    await browser.close();
    return;
  }
  if (process.argv.includes("--ren-integration")) {
    await require("../kurita-miive-motion/check_integration.cjs")(page);
    await browser.close();
    return;
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    "file://" +
      (process.argv[2] && !process.argv[2].startsWith("--")
        ? process.argv[2]
        : path.join(__dirname, "viewer.html")),
  );
  await page.waitForFunction(() => window.modelVerification?.loaded, { timeout: 20000 });
  await page.getByRole("button", { name: "正面", exact: true }).click();
  await page.screenshot({
    path: path.join(
      __dirname,
      process.argv.includes("--double-sided") ? "browser-double-sided.png" : "browser-front.png",
    ),
  });
  if (process.argv.includes("--motions"))
    await require("../kurita-miive-motion/check_motions.cjs")(page);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    JSON.stringify({ errors, model: await page.evaluate(() => window.modelVerification) }),
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
