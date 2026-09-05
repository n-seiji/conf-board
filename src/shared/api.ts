import * as v from "valibot";
import {
  apiErrorResponseSchema,
  createPostResponseSchema,
  listPostsResponseSchema,
  serverEventSchema,
} from "./schemas";
import type {
  CreatePostRequest,
  CreatePostResponse,
  ListPostsResponse,
  Post,
  ServerEvent,
} from "./types";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** レスポンスが失敗 (`!res.ok`) の場合、body の `{error}` を読み取って `ApiError` を投げる。 */
const throwIfError = async (res: Response): Promise<void> => {
  if (res.ok) return;
  const rawBody: unknown = await res.json().catch(() => undefined);
  const parsed = v.safeParse(apiErrorResponseSchema, rawBody);
  const message = parsed.success ? parsed.output.error : res.statusText;
  throw new ApiError(res.status, message);
};

export const createPost = async (req: CreatePostRequest): Promise<CreatePostResponse> => {
  const res = await fetch("/api/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  await throwIfError(res);
  return v.parse(createPostResponseSchema, await res.json());
};

export const listPosts = async (): Promise<ListPostsResponse> => {
  const res = await fetch("/api/posts");
  await throwIfError(res);
  return v.parse(listPostsResponseSchema, await res.json());
};

export const deletePost = async (id: string, token: string): Promise<void> => {
  const res = await fetch(`/api/posts/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  await throwIfError(res);
};

export const resetBoard = async (token: string): Promise<void> => {
  const res = await fetch("/api/reset", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  await throwIfError(res);
};

export type BoardSocketHandlers = Readonly<{
  /**
   * snapshot は「完全置換」を意味する。呼び出し側はローカル状態を全て破棄し、
   * この posts で置き換えること (差分マージしない)。接続直後および再接続直後に届く。
   */
  onSnapshot?: (posts: readonly Post[], total: number, celebrated: boolean) => void;
  onPost?: (post: Post, total: number, celebrated: boolean) => void;
  onDelete?: (id: string, total: number) => void;
  onReset?: () => void;
  onConnectionChange?: (connected: boolean) => void;
}>;

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 15000;

/** WebSocket クライアント。切断時は指数バックオフ (1s→最大15s) で自動再接続する。 */
export class BoardSocket {
  private ws: WebSocket | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;

  constructor(private readonly handlers: BoardSocketHandlers) {}

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  private open(): void {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}/api/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.reconnectDelay = RECONNECT_MIN_MS;
      this.handlers.onConnectionChange?.(true);
    });

    ws.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });

    ws.addEventListener("close", () => {
      this.handlers.onConnectionChange?.(false);
      this.scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      ws.close();
    });
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let rawEvent: unknown;
    try {
      rawEvent = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = v.safeParse(serverEventSchema, rawEvent);
    if (!parsed.success) return;
    const event: ServerEvent = parsed.output;
    switch (event.type) {
      case "snapshot":
        this.handlers.onSnapshot?.(event.posts, event.total, event.celebrated);
        return;
      case "post":
        this.handlers.onPost?.(event.post, event.total, event.celebrated);
        return;
      case "delete":
        this.handlers.onDelete?.(event.id, event.total);
        return;
      case "reset":
        this.handlers.onReset?.();
        return;
    }
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }
}
