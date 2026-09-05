import { DurableObject } from "cloudflare:workers";
import * as v from "valibot";
import { DEFAULT_PIN_COLOR_ID, isPinColorId } from "../shared/colors";
import { COUNTRY_COUNT } from "../shared/countries";
import { createPostRequestSchema } from "../shared/schemas";
import type { Post, ServerEvent } from "../shared/types";

type PostRow = Readonly<{
  id: string;
  nickname: string;
  body: string;
  country_id: number;
  color: number;
  seq: number;
  created_at: number;
}>;

const MAX_BODY_BYTES = 4096;
const CELEBRATION_THRESHOLD = 150;

const rowToPost = (row: PostRow): Post => ({
  id: row.id,
  nickname: row.nickname,
  body: row.body,
  countryId: row.country_id,
  // DB には常にバリデーション済みの 0-5 のみが入る。
  color: isPinColorId(row.color) ? row.color : DEFAULT_PIN_COLOR_ID,
  seq: row.seq,
  createdAt: row.created_at,
});

const jsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const errorResponse = (status: number, message: string): Response =>
  jsonResponse({ error: message }, status);

/**
 * 定数時間での文字列比較。SHA-256 で両者を等長のダイジェストにしてから
 * 全バイトを必ず比較する (early return しない) ことで、トークンの部分一致を
 * タイミングから推測されないようにする。
 */
const timingSafeEqual = async (a: string, b: string): Promise<boolean> => {
  const encoder = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const viewA = new Uint8Array(digestA);
  const viewB = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < viewA.length; i += 1) {
    diff |= (viewA[i] ?? 0) ^ (viewB[i] ?? 0);
  }
  // トークン自体が空文字列の場合は常に不一致とする (空トークンでの認証を防ぐ)。
  return diff === 0 && a.length > 0 && b.length > 0;
};

/** 単一インスタンス (`main`) で全投稿を保持する Durable Object。 */
export class Board extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  /** `PRAGMA user_version` は DO の SQLite storage では使えないため、
   *  `_sql_schema_migrations` テーブルでバージョンを管理する。 */
  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    const currentVersion = this.ctx.storage.sql
      .exec<{ version: number }>(
        "SELECT COALESCE(MAX(id), 0) as version FROM _sql_schema_migrations",
      )
      .one().version;

    // 各バージョンの DDL は transactionSync 内で 1 文ずつ実行する。途中の文が失敗しても
    // トランザクション全体がロールバックされるため、「migrations テーブルにはバージョンが
    // 進んだと記録されているのにカラムは追加されていない」といった不整合で DO が
    // 二度と起動できなくなる事態を防ぐ。
    if (currentVersion < 1) {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(`
          CREATE TABLE IF NOT EXISTS posts (
            id TEXT PRIMARY KEY,
            nickname TEXT NOT NULL,
            body TEXT NOT NULL,
            country_id INTEGER NOT NULL,
            seq INTEGER NOT NULL,
            created_at INTEGER NOT NULL
          )
        `);
        this.ctx.storage.sql.exec(`
          CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          )
        `);
        this.ctx.storage.sql.exec("INSERT INTO _sql_schema_migrations (id) VALUES (1)");
      });
    }
    if (currentVersion < 2) {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec("ALTER TABLE posts ADD COLUMN client_id TEXT");
        this.ctx.storage.sql.exec(
          "CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_client_id ON posts(client_id)",
        );
        this.ctx.storage.sql.exec("INSERT INTO _sql_schema_migrations (id) VALUES (2)");
      });
    }
    if (currentVersion < 3) {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec("ALTER TABLE posts ADD COLUMN color INTEGER NOT NULL DEFAULT 5");
        this.ctx.storage.sql.exec("INSERT INTO _sql_schema_migrations (id) VALUES (3)");
      });
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/ws") {
      return this.handleWebSocketUpgrade(request);
    }
    if (url.pathname === "/api/posts" && request.method === "POST") {
      return this.handleCreatePost(request);
    }
    if (url.pathname === "/api/posts" && request.method === "GET") {
      return this.handleListPosts();
    }
    if (url.pathname.startsWith("/api/posts/") && request.method === "DELETE") {
      const id = decodeURIComponent(url.pathname.slice("/api/posts/".length));
      return this.handleDeletePost(id, request);
    }
    if (url.pathname === "/api/reset" && request.method === "POST") {
      return this.handleReset(request);
    }

    return errorResponse(404, "Not Found");
  }

  private handleWebSocketUpgrade(request: Request): Response {
    if ((request.headers.get("Upgrade") ?? "").toLowerCase() !== "websocket") {
      return errorResponse(426, "Expected WebSocket upgrade");
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);

    const { posts, total } = this.listPostsInternal();
    const snapshot: ServerEvent = {
      type: "snapshot",
      posts,
      total,
      celebrated: this.isCelebrated(),
    };
    server.send(JSON.stringify(snapshot));

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(): Promise<void> {
    // クライアントからのメッセージは現状扱わない (受信専用チャンネル)
  }

  override async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
    void wasClean;
  }

  /** `getWebSockets()` はハイバネート復帰後も Runtime が復元する一覧なので、
   *  メモリ上のキャッシュを持たずに毎回これを走査する。 */
  private broadcast(event: ServerEvent): void {
    const payload = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // 送信失敗は無視 (次回 snapshot で復元される)
      }
    }
  }

  private async isAuthorized(request: Request): Promise<boolean> {
    const header = request.headers.get("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    return timingSafeEqual(token, this.env.ADMIN_TOKEN);
  }

  private async handleCreatePost(request: Request): Promise<Response> {
    const contentLength = request.headers.get("Content-Length");
    if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
      return errorResponse(400, "Request body too large");
    }
    const rawText = await request.text();
    if (new TextEncoder().encode(rawText).length > MAX_BODY_BYTES) {
      return errorResponse(400, "Request body too large");
    }

    let body: unknown;
    try {
      body = JSON.parse(rawText);
    } catch {
      return errorResponse(400, "Invalid JSON body");
    }
    if (typeof body !== "object" || body === null) {
      return errorResponse(400, "Invalid body");
    }

    const result = v.safeParse(createPostRequestSchema, body);
    if (!result.success) {
      return errorResponse(400, result.issues[0]?.message ?? "Invalid body");
    }
    const { nickname, body: text, clientId, color } = result.output;

    const existing = this.ctx.storage.sql
      .exec<PostRow>(
        "SELECT id, nickname, body, country_id, color, seq, created_at FROM posts WHERE client_id = ?",
        clientId,
      )
      .toArray()[0];
    if (existing) {
      const post = rowToPost(existing);
      const total = this.countPosts();
      return jsonResponse({ post, total, celebrated: this.isCelebrated() }, 201);
    }

    const id = crypto.randomUUID();
    const countryId = Math.floor(Math.random() * COUNTRY_COUNT);
    const createdAt = Date.now();

    const { post, total } = this.ctx.storage.transactionSync(() => {
      const seq = this.nextSeqLocked();
      this.ctx.storage.sql.exec(
        "INSERT INTO posts (id, client_id, nickname, body, country_id, color, seq, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        clientId,
        nickname,
        text,
        countryId,
        color,
        seq,
        createdAt,
      );
      const createdPost: Post = {
        id,
        nickname,
        body: text,
        countryId,
        color,
        seq,
        createdAt,
      };
      const currentTotal = this.countPosts();
      if (!this.isCelebrated() && currentTotal >= CELEBRATION_THRESHOLD) {
        this.setCelebrated(true);
      }
      return { post: createdPost, total: currentTotal };
    });

    const celebrated = this.isCelebrated();
    this.broadcast({ type: "post", post, total, celebrated });

    return jsonResponse({ post, total, celebrated }, 201);
  }

  private handleListPosts(): Response {
    const { posts, total } = this.listPostsInternal();
    return jsonResponse({ posts, total, celebrated: this.isCelebrated() });
  }

  private async handleDeletePost(id: string, request: Request): Promise<Response> {
    if (!(await this.isAuthorized(request))) {
      return errorResponse(401, "Unauthorized");
    }
    if (!id) {
      return errorResponse(400, "id is required");
    }
    const existing = this.ctx.storage.sql
      .exec<{ id: string }>("SELECT id FROM posts WHERE id = ?", id)
      .toArray()[0];
    if (!existing) {
      return errorResponse(404, "Post not found");
    }
    this.ctx.storage.sql.exec("DELETE FROM posts WHERE id = ?", id);
    const total = this.countPosts();
    this.broadcast({ type: "delete", id, total });
    return new Response(null, { status: 204 });
  }

  private async handleReset(request: Request): Promise<Response> {
    if (!(await this.isAuthorized(request))) {
      return errorResponse(401, "Unauthorized");
    }
    this.ctx.storage.sql.exec("DELETE FROM posts");
    this.ctx.storage.sql.exec("DELETE FROM meta WHERE key = ?", "seq");
    this.setCelebrated(false);
    this.broadcast({ type: "reset" });
    return new Response(null, { status: 204 });
  }

  private listPostsInternal(): Readonly<{
    posts: readonly Post[];
    total: number;
  }> {
    const rows = this.ctx.storage.sql
      .exec<PostRow>(
        "SELECT id, nickname, body, country_id, color, seq, created_at FROM posts ORDER BY seq ASC",
      )
      .toArray();
    return { posts: rows.map(rowToPost), total: rows.length };
  }

  private countPosts(): number {
    const row = this.ctx.storage.sql.exec<{ c: number }>("SELECT COUNT(*) as c FROM posts").one();
    return row.c;
  }

  /** `transactionSync()` の中でのみ呼ぶ (seq 採番と INSERT を同一トランザクションで確定させる)。 */
  private nextSeqLocked(): number {
    const row = this.ctx.storage.sql
      .exec<{ value: string | null }>("SELECT value FROM meta WHERE key = ?", "seq")
      .toArray()[0];
    const current = row ? Number(row.value) : 0;
    const next = current + 1;
    this.ctx.storage.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      String(next),
    );
    return next;
  }

  private isCelebrated(): boolean {
    const row = this.ctx.storage.sql
      .exec<{ value: string | null }>("SELECT value FROM meta WHERE key = ?", "celebrated")
      .toArray()[0];
    return row?.value === "1";
  }

  private setCelebrated(value: boolean): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('celebrated', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      value ? "1" : "0",
    );
  }
}
