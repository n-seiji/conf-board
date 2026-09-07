import { execFileSync } from "node:child_process";
import { mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";

const output = resolve("src/phone/generated");
mkdirSync(output, { recursive: true });
execFileSync("go", ["build", "-trimpath", "-ldflags=-s -w", "-o", `${output}/country.wasm`, "."], {
  cwd: "wasm/country",
  env: { ...process.env, GOOS: "js", GOARCH: "wasm" },
  stdio: "inherit",
});
const goroot = execFileSync("go", ["env", "GOROOT"], { encoding: "utf8" }).trim();
copyFileSync(resolve(goroot, "lib/wasm/wasm_exec.js"), `${output}/wasm_exec.js`);
