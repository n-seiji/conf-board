const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
module.exports = async (page) => {
  const expected = ["Bow", "Dance", "Jump", "Nod", "Wave"];
  const model = await page.evaluate(() => window.modelVerification);
  assert.equal(model.animations, 5);
  assert.ok(model.skinnedMeshCount > 0);
  assert.deepEqual((await page.evaluate(() => window.motionVerification.names)).sort(), expected);
  const report = { model, clips: [] };
  for (const [name, time] of [
    ["Wave", 1.3],
    ["Bow", 1.25],
    ["Nod", 1.55],
    ["Jump", 1.3],
    ["Dance", 1.1],
  ]) {
    await page.locator(`[data-motion="${name}"]`).click();
    await page.waitForFunction(
      (n) => window.motionVerification.current === n && window.motionVerification.time > 0.1,
      name,
    );
    const result = await page.evaluate(
      ({ name: clipName, time: clipTime }) => {
        const start = window.motionPreview.sample(clipName, 0);
        const middle = window.motionPreview.sample(clipName, clipTime);
        const end = window.motionPreview.sample(clipName, start.duration);
        const diff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
        window.motionPreview.sample(clipName, clipTime);
        return {
          name: clipName,
          duration: start.duration,
          movement: diff(start.surface, middle.surface),
          loopError: diff(start.surface, end.surface),
        };
      },
      { name, time },
    );
    assert.ok(result.movement > 0.005, `${name} must deform the mesh`);
    assert.ok(result.loopError < 0.0001, `${name} must loop continuously`);
    report.clips.push(result);
    await page.screenshot({ path: path.join(__dirname, `browser-${name.toLowerCase()}.png`) });
  }
  await page.locator('[data-motion="Wave"]').click();
  await page.waitForFunction(() => window.motionVerification.time > 0.2);
  await page.locator("#pause").click();
  const paused = await page.evaluate(() => window.motionVerification.time);
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let count = 0;
        function tick() {
          if (++count === 12) resolve();
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }),
  );
  assert.equal(await page.evaluate(() => window.motionVerification.time), paused);
  await page.locator("#pause").click();
  await page.waitForFunction((t) => window.motionVerification.time > t + 0.1, paused);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.motionPreview.sample("Wave", 1.3));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  for (const name of expected) assert.ok(await page.locator(`[data-motion="${name}"]`).isVisible());
  await page.screenshot({ path: path.join(__dirname, "browser-mobile.png") });
  report.pauseResume = true;
  report.mobile = true;
  fs.writeFileSync(
    path.join(__dirname, "browser-verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
};
