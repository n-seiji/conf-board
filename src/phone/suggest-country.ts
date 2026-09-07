import { COUNTRY_COUNT } from "../shared/countries";

/** Optional, local suggestion. Failure must never prevent a post. */
export const suggestCountry = (body: string): Promise<number | undefined> =>
  new Promise((resolve) => {
    let worker: Worker | undefined;
    const finish = (value?: number): void => {
      clearTimeout(timeout);
      worker?.terminate();
      resolve(value);
    };
    const timeout = setTimeout(() => finish(), 1200);
    try {
      worker = new Worker(new URL("./country-worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const id = event.data;
        finish(
          typeof id === "number" && Number.isInteger(id) && id >= 0 && id < COUNTRY_COUNT
            ? id
            : undefined,
        );
      };
      worker.onerror = () => finish();
      worker.postMessage(body.normalize("NFKC"));
    } catch {
      finish();
    }
  });
