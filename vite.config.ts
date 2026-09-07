import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// Build with the matching Go runtime for dev, build, and environment-specific deploys.
execFileSync(process.execPath, ["scripts/build-wasm.mjs"], { stdio: "inherit" });

export default defineConfig({
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  plugins: [
    {
      name: "local-character-preview",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
          if (!/^\/assets\/gopher\/integration-preview(?:\.html)?$/.test(pathname)) {
            next();
            return;
          }
          try {
            const file = "/assets/gopher/integration-preview.html";
            const html = await readFile(resolve(__dirname, `.${file}`), "utf8");
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.end(await server.transformIndexHtml(file, html));
          } catch (error) {
            next(error);
          }
        });
      },
    },
    cloudflare(),
  ],
  environments: {
    client: {
      build: {
        rollupOptions: {
          input: {
            main: resolve(__dirname, "index.html"),
            display: resolve(__dirname, "display.html"),
            admin: resolve(__dirname, "admin.html"),
          },
        },
      },
    },
  },
});
