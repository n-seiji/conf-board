import "./generated/wasm_exec.js";
import wasmUrl from "./generated/country.wasm?url";

type GoRuntime = {
  importObject: WebAssembly.Imports;
  run: (instance: WebAssembly.Instance) => Promise<void>;
};
const runtime = globalThis as unknown as {
  Go: new () => GoRuntime;
  classifyCountry: (text: string) => number;
};

self.onmessage = async (event: MessageEvent<string>) => {
  try {
    const go = new runtime.Go();
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error("Wasm download failed");
    const module = await WebAssembly.compile(await response.arrayBuffer());
    const instance = await WebAssembly.instantiate(module, go.importObject);
    void go.run(instance).catch(() => self.postMessage(-1));
    self.postMessage(runtime.classifyCountry(event.data));
  } catch {
    self.postMessage(-1);
  }
};
