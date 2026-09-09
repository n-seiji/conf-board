const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  try {
    for (const mode of ["share", "cancel", "failed", "unsupported"]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.addInitScript((shareMode) => {
        window.testShare = [];
        window.openedUrl = "";
        window.open = (url) => {
          window.openedUrl = url;
          return null;
        };
        Object.defineProperty(navigator, "canShare", {
          configurable: true,
          value: () => shareMode !== "unsupported",
        });
        Object.defineProperty(navigator, "share", {
          configurable: true,
          value: async (data) => {
            window.testShare.push({
              active: navigator.userActivation.isActive,
              name: data.files[0].name,
              type: data.files[0].type,
              size: data.files[0].size,
            });
            if (shareMode === "cancel") throw new DOMException("cancel", "AbortError");
            if (shareMode === "failed") throw new DOMException("blocked", "NotAllowedError");
          },
        });
      }, mode);
      await page.route("**/api/posts", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        const body = route.request().postDataJSON();
        await new Promise((r) => setTimeout(r, 100));
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            post: {
              id: "test-phone-share",
              nickname: body.nickname,
              body: body.body,
              color: body.color,
              countryId: 3,
              seq: 1,
              createdAt: Date.now(),
            },
            total: 1,
            celebrated: false,
          }),
        });
      });
      await page.goto("http://127.0.0.1:4175/");
      await page.getByLabel("ニックネーム", { exact: true }).fill("テスト");
      await page.getByLabel("内容", { exact: true }).fill("書籍購入を無制限にしたい");
      await page.getByRole("button", { name: "世界に届ける", exact: true }).click();
      assert.equal(await page.locator(".phone-sending-caption").count(), 0);
      await page.getByRole("button", { name: "画像を保存", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: /もう一度投稿/ }).count(), 0);
      await page.getByRole("button", { name: "X で投稿", exact: true }).click();
      const text = await page.evaluate(() => new URL(window.openedUrl).searchParams.get("text"));
      assert.equal(
        text,
        "「書籍購入を無制限にしたい」\n#miive のブースで 書籍無制限公国 に新しい福利厚生を作り、働く意味で世界を満たしました! #gocon #gocon26 @miive_jp",
      );
      await page.getByRole("button", { name: "画像を保存", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await page.waitForFunction(() => document.querySelector("dialog img").naturalWidth === 1080);
      if (mode === "unsupported") {
        assert.equal(await page.getByRole("button", { name: "写真に保存・共有" }).count(), 0);
        const download = page.waitForEvent("download");
        await page.getByRole("link", { name: "ダウンロード", exact: true }).click();
        assert.equal((await download).suggestedFilename(), "miive-書籍無制限公国.png");
      } else {
        await page.getByRole("button", { name: "写真に保存・共有" }).click();
        const result = await page.evaluate(() => window.testShare);
        assert.equal(result.length, 1);
        assert.equal(result[0].active, true);
        assert.equal(result[0].type, "image/png");
        assert.ok(result[0].size > 1000);
        const error = await dialog.locator(".phone-error").textContent();
        assert.equal(Boolean(error), mode === "failed");
      }
      if (mode === "share") await page.screenshot({ path: "/tmp/conf-board-phone-sharing.png" });
      await page.getByRole("button", { name: "閉じる", exact: true }).click();
      assert.equal(await page.getByRole("dialog").count(), 0);
      await page.close();
      console.log("PASS", mode);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
