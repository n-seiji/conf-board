const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
module.exports = async (page) => {
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
  const root = path.resolve(__dirname, "../..");
  const { buildSync } = require(
    path.join(root, "node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js"),
  );
  const bundle = buildSync({
    stdin: {
      contents: fs
        .readFileSync(path.join(__dirname, "integration-preview.js"), "utf8")
        .replaceAll("/src/", "../../src/"),
      resolveDir: __dirname,
      loader: "js",
    },
    bundle: true,
    write: false,
    format: "iife",
    define: { "import.meta.env.BASE_URL": '"/"' },
  }).outputFiles[0].text;
  await page.route("http://ren-test.local/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(".glb"))
      return route.fulfill({
        contentType: "model/gltf-binary",
        body: fs.readFileSync(path.join(root, "public", url.pathname)),
      });
    if (url.pathname.endsWith(".js"))
      return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname.endsWith(".css"))
      return route.fulfill({
        contentType: "text/css",
        body: fs.readFileSync(path.join(root, "src/display/display.css"), "utf8"),
      });
    return route.fulfill({
      contentType: "text/html",
      body: fs.readFileSync(path.join(__dirname, "integration-preview.html"), "utf8"),
    });
  });
  await page.goto("http://ren-test.local/");
  await page.waitForFunction(() => window.renLanded, null, { timeout: 30000 });
  await page.screenshot({ path: path.join(__dirname, "integration-debug.png") });
  const report = await page.evaluate(() => {
    const models = [];
    window.testScene.traverse((o) => {
      if (o.name === "gopher-pin" || o.name === "ren-pin") {
        let meshes = 0,
          skins = 0,
          layer;
        o.traverse((c) => {
          if (c.isMesh) {
            meshes++;
            layer = c.layers.mask;
            if (c.isSkinnedMesh) skins++;
          }
        });
        models.push({ name: o.name, meshes, skins, layer, visible: o.visible });
      }
    });
    return {
      models,
      passes: window.passes,
      landed: window.renLanded,
      projected: window.globe.projectPin("ren-front"),
    };
  });
  assert.deepEqual(report.models.map((m) => m.name).sort(), ["gopher-pin", "ren-pin"]);
  assert.equal(report.models.find((m) => m.name === "ren-pin").layer, 1);
  assert.ok(report.models.find((m) => m.name === "ren-pin").skins > 0);
  assert.ok(report.projected.visible);
  const alignment = await page.evaluate(() => {
    let ren;
    window.testScene.traverse((o) => {
      if (o.name === "ren-pin") ren = o;
    });
    const normal = ren.getWorldPosition(ren.position.clone()).normalize();
    const up = ren.up
      .clone()
      .applyQuaternion(ren.getWorldQuaternion(ren.quaternion.clone()))
      .normalize();
    return up.dot(normal);
  });
  assert.ok(alignment > 0.99999, `Ren must stand normal to Earth: ${alignment}`);
  report.surfaceAlignment = alignment;

  assert.ok(!report.passes.includes(256), "Characters share the same depth buffer");
  await page.screenshot({ path: path.join(__dirname, "integration-front.png") });
  // Both characters now share normal scene depth when they overlap.
  await page.evaluate(() => {
    let ren, gopher;
    window.testScene.traverse((o) => {
      if (o.name === "ren-pin") ren = o;
      if (o.name === "gopher-pin") gopher = o;
    });
    gopher.position.copy(ren.position).multiplyScalar(1.03);
    gopher.quaternion.copy(ren.quaternion);
  });
  await page.screenshot({ path: path.join(__dirname, "integration-overlap.png") });
  const badgePoint = await page.evaluate(() => {
    let label;
    window.testScene.traverse((o) => {
      if (o.isSprite && o.material.map.image.width === 256) label = o;
    });
    const p = label.getWorldPosition(label.position.clone()).project(window.testCamera);
    return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (0.5 - p.y * 0.5) * innerHeight };
  });
  await page.mouse.click(badgePoint.x, badgePoint.y);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  assert.equal(
    await page.evaluate(() => window.globe.setNewBadgeCallout("ren-front", true)),
    false,
    "Clicking the NEW label must acknowledge the character",
  );
  await page.waitForFunction(() => window.picked === "ren-front");
  assert.equal(
    await page.evaluate(() => window.globe.setNewBadgeCallout("ren-front", true)),
    false,
  );
  assert.equal(
    await page.evaluate(() => {
      let n = 0;
      window.testScene.traverse((o) => {
        if (o.isSprite) n++;
      });
      return n;
    }),
    0,
  );
  await page.waitForFunction(() => {
    let ren;
    window.testScene.traverse((o) => {
      if (o.name === "ren-pin") ren = o;
    });
    const world = ren.getWorldQuaternion(ren.quaternion.clone());
    return Math.abs(world.w) > 0.9999;
  });
  assert.ok((await page.locator(".callout-card--top").count()) > 0);
  report.selectedUpright = true;
  const selectedLayer = await page.evaluate(() => {
    let layer;
    window.testScene.traverse((o) => {
      if (o.name === "ren-pin")
        o.traverse((m) => {
          if (m.isMesh) layer = m.layers.mask;
        });
    });
    return layer;
  });
  assert.equal(selectedLayer, 2, "Only the selected character must render in front of neighbors");
  await page.screenshot({ path: path.join(__dirname, "integration-selected.png") });
  assert.equal(await page.locator(".callout-card__new:visible").count(), 0);
  report.clickDismissesNew = true;
  await page.evaluate(() => {
    window.globe.clear();
    window.globe.addPin(window.renPost, { animate: false });
    window.globe.render();
  });
  assert.equal(
    await page.evaluate(() => {
      let count = 0;
      window.testScene.traverse((o) => {
        if (o.name === "ren-pin") count++;
      });
      return count;
    }),
    1,
  );
  await page.evaluate(() => {
    window.globe.clear();
    window.picked = null;
    window.gopherLanded = false;
    window.globe.addPin({ ...window.renPost, seq: 149 }, { animate: true });
    window.globe.onPinArrived("ren-front", () => (window.gopherLanded = true));
  });
  await page.waitForFunction(() => window.gopherLanded);
  const gp = await page.evaluate(() => window.globe.projectPin("ren-front"));
  await page.mouse.click(gp.x, gp.y);
  await page.waitForFunction(() => window.picked === "ren-front");
  assert.equal(
    await page.evaluate(() => window.globe.setNewBadgeCallout("ren-front", true)),
    false,
  );
  assert.equal(
    await page.evaluate(() => {
      let n = 0;
      window.testScene.traverse((o) => {
        if (o.isSprite) n++;
      });
      return n;
    }),
    0,
  );
  report.gopherClickDismissesNew = true;
  await page.waitForFunction(() => {
    let gopher;
    window.testScene.traverse((o) => {
      if (o.name === "gopher-pin") gopher = o;
    });
    return Math.abs(gopher.getWorldQuaternion(gopher.quaternion.clone()).w) > 0.9999;
  });
  assert.ok((await page.locator(".callout-card--top").count()) > 0);
  await page.screenshot({ path: path.join(__dirname, "integration-gopher-selected.png") });
  const restoredAlignment = await page.evaluate(() => {
    window.globe.setAutoRotate(true);
    let gopher;
    window.testScene.traverse((o) => {
      if (o.name === "gopher-pin") gopher = o;
    });
    const normal = gopher.getWorldPosition(gopher.position.clone()).normalize();
    return gopher.up
      .clone()
      .applyQuaternion(gopher.getWorldQuaternion(gopher.quaternion.clone()))
      .dot(normal);
  });
  assert.ok(restoredAlignment > 0.99999);
  report.gopherSelectedUpright = true;
  report.deselectionRestoresNormal = true;

  const crowd = await page.evaluate(() => {
    window.callouts.clearAll();
    window.globe.clear();
    for (let i = 0; i < 40; i++)
      window.globe.addPin(
        { ...window.renPost, id: `crowd-${i}`, seq: 130 + i },
        { animate: false },
      );
    const points = [];
    window.testScene.traverse((o) => {
      if (o.name === "ren-pin" || o.name === "gopher-pin") points.push(o.position.toArray());
    });
    return { count: points.length, unique: new Set(points.map((p) => p.join(","))).size };
  });
  assert.deepEqual(crowd, { count: 40, unique: 40 });
  report.crowd = crowd;
  await page.screenshot({ path: path.join(__dirname, "integration-spacing.png") });
  await page.evaluate(() => {
    window.callouts.dispose();
    window.globe.dispose();
  });
  assert.deepEqual(errors, []);
  report.errors = errors;
  report.restored = true;
  fs.writeFileSync(
    path.join(__dirname, "integration-verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
};
