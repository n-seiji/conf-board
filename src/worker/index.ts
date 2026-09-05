import { COUNTRIES } from "../shared/countries";
import { Board } from "./board";

export { Board };

const BOARD_INSTANCE_NAME = "main";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/countries") {
      return new Response(JSON.stringify(COUNTRIES), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname.startsWith("/api/")) {
      const stub = env.BOARD.getByName(BOARD_INSTANCE_NAME);
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
