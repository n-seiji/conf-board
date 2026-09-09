const assert = require("node:assert/strict");
module.exports = async (page) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await page.goto("http://127.0.0.1:5173/assets/gopher/integration-preview?new=2");
  assert.equal(response.status(), 200);
  await page.waitForSelector("#globe canvas");
  await page.locator("#arrive").click();
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.startsWith("NEWで登場："),
  );
  await page.locator("#look").click();
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.startsWith("中央："),
  );
  assert.deepEqual(errors, []);
  await page.screenshot({ path: require("node:path").join(__dirname, "preview-url-verified.png") });
  console.log(
    JSON.stringify({
      url: page.url(),
      status: response.status(),
      canvas: true,
      arrival: true,
      selection: true,
      errors,
    }),
  );
};
