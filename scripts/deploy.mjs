import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [environment, option, ...extra] = process.argv.slice(2);
const names = { staging: "conf-board-staging", production: "conf-board" };
if (!Object.hasOwn(names, environment) || (option && option !== "--dry-run") || extra.length) {
  throw new Error("Usage: pnpm run deploy <staging|production> [--dry-run]");
}
const dryRun = option === "--dry-run";
const run = (file, args, env = process.env) => {
  const result = spawnSync(process.execPath, [file, ...args], { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${file} failed (${result.status ?? result.signal})`);
};

// Vite chooses the Cloudflare environment at BUILD time, not at deploy time.
run("node_modules/vite/bin/vite.js", ["build"], { ...process.env, CLOUDFLARE_ENV: environment });
const configFile = "dist/worker/wrangler.json";
const config = JSON.parse(await readFile(configFile, "utf8"));
if (config.name !== names[environment]) {
  throw new Error(`Refusing to deploy ${config.name}; expected ${names[environment]}`);
}
const binding = config.durable_objects?.bindings?.find((entry) => entry.name === "BOARD");
if (binding?.class_name !== "Board" || binding.script_name) {
  throw new Error("BOARD must belong to this Worker, without a shared script_name");
}

let secretsDirectory;
try {
  const args = ["deploy", "--config", configFile];
  if (dryRun) args.push("--dry-run");
  else if (process.env.ADMIN_TOKEN) {
    // Supply the secret atomically with the deployment, including the first deploy.
    secretsDirectory = await mkdtemp(join(tmpdir(), "conf-board-secrets-"));
    const file = join(secretsDirectory, "secrets.json");
    await writeFile(file, JSON.stringify({ ADMIN_TOKEN: process.env.ADMIN_TOKEN }), {
      mode: 0o600,
    });
    args.push("--secrets-file", file);
  }
  run("node_modules/wrangler/bin/wrangler.js", args);
} finally {
  if (secretsDirectory) await rm(secretsDirectory, { recursive: true, force: true });
}
