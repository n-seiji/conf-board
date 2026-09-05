import { resolve } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [cloudflare()],
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
