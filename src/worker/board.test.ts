import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { CreatePostResponse, ListPostsResponse, Post, ServerEvent } from "../shared/types";

const ADMIN_TOKEN = "dev-local-token-123";

const post = async (
  nickname: string,
  body: string,
  clientId: string = crypto.randomUUID(),
): Promise<Response> =>
  SELF.fetch("http://example.com/api/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname, body, clientId }),
  });

describe("POST /api/posts", () => {
  it("有効な投稿は 201 で post と total を返し、seq が 1 から始まる", async () => {
    const res = await post("たろう", "有給が欲しい");
    expect(res.status).toBe(201);
    const data = (await res.json()) as CreatePostResponse;
    expect(data.post.nickname).toBe("たろう");
    expect(data.post.body).toBe("有給が欲しい");
    expect(data.post.seq).toBeGreaterThanOrEqual(1);
    expect(data.post.countryId).toBeGreaterThanOrEqual(0);
    expect(data.post.countryId).toBeLessThan(20);
    expect(data.total).toBeGreaterThanOrEqual(1);
    expect(data.celebrated).toBe(false);
  });

  it("2 件目は seq が 1 つ進む", async () => {
    const res1 = await post("A", "1件目");
    const data1 = (await res1.json()) as CreatePostResponse;
    const res2 = await post("B", "2件目");
    const data2 = (await res2.json()) as CreatePostResponse;
    expect(data2.post.seq).toBe(data1.post.seq + 1);
  });

  it("nickname が空の場合 400", async () => {
    const res = await post("", "本文");
    expect(res.status).toBe(400);
  });

  it("nickname が21文字以上の場合 400", async () => {
    const res = await post("あ".repeat(21), "本文");
    expect(res.status).toBe(400);
  });

  it("body が空 (trim後) の場合 400", async () => {
    const res = await post("nick", "   ");
    expect(res.status).toBe(400);
  });

  it("body が81文字以上の場合 400", async () => {
    const res = await post("nick", "あ".repeat(81));
    expect(res.status).toBe(400);
  });

  it("文字数はコードポイント単位で数える (サロゲートペア絵文字は1文字)", async () => {
    // 🎉 はサロゲートペア (JS の .length では 2 だが、コードポイントでは 1)。
    const nickname = "🎉".repeat(20);
    expect(nickname.length).toBeGreaterThan(20);
    const res = await post(nickname, "本文");
    expect(res.status).toBe(201);
  });

  it("clientId が UUID でない場合 400", async () => {
    const res = await SELF.fetch("http://example.com/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: "n",
        body: "b",
        clientId: "not-a-uuid",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("clientId が無い場合 400", async () => {
    const res = await SELF.fetch("http://example.com/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "n", body: "b" }),
    });
    expect(res.status).toBe(400);
  });

  it("同じ clientId の再送は既存の投稿を 201 で返し、新規作成しない", async () => {
    const clientId = crypto.randomUUID();
    const res1 = await post("同じ人", "1回目", clientId);
    const data1 = (await res1.json()) as CreatePostResponse;

    const res2 = await post("同じ人", "1回目", clientId);
    expect(res2.status).toBe(201);
    const data2 = (await res2.json()) as CreatePostResponse;

    expect(data2.post.id).toBe(data1.post.id);
    expect(data2.post.seq).toBe(data1.post.seq);
    expect(data2.total).toBe(data1.total);
  });

  it("JSON でない body は 400", async () => {
    const res = await SELF.fetch("http://example.com/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("4KB を超える body は 400", async () => {
    const res = await SELF.fetch("http://example.com/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: "n",
        body: "b",
        clientId: crypto.randomUUID(),
        padding: "x".repeat(5000),
      }),
    });
    expect(res.status).toBe(400);
  });

  // 150 回の POST は全体実行 (他ファイルと並列) の負荷下で既定の 5 秒を超えることがある。
  // タイムアウトすると投稿ループが裏で走り続け、後続テストの total を狂わせるので余裕を持たせる。
  const CELEBRATION_TEST_TIMEOUT_MS = 60_000;
  it(
    "150 件目の投稿で celebrated が true になる",
    { timeout: CELEBRATION_TEST_TIMEOUT_MS },
    async () => {
      // 他のテストで作られた投稿の影響を受けないよう、まず reset してから 150 件投稿する。
      await SELF.fetch("http://example.com/api/reset", {
        method: "POST",
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });

      let lastData: CreatePostResponse | undefined;
      for (let i = 0; i < 150; i += 1) {
        const res = await post(`祝${i}`, `本文${i}`);
        lastData = (await res.json()) as CreatePostResponse;
        if (i < 149) {
          expect(lastData.celebrated).toBe(false);
        }
      }
      expect(lastData?.celebrated).toBe(true);

      const listRes = await SELF.fetch("http://example.com/api/posts");
      const list = (await listRes.json()) as ListPostsResponse;
      expect(list.celebrated).toBe(true);
    },
  );

  it("color を省略すると 5 (ホワイト) になる", async () => {
    const res = await post("色なし", "本文");
    const data = (await res.json()) as CreatePostResponse;
    expect(data.post.color).toBe(5);
  });

  it("color が範囲外 (0-5 以外) の場合 400", async () => {
    const res = await SELF.fetch("http://example.com/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: "n",
        body: "b",
        clientId: crypto.randomUUID(),
        color: 6,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("color が整数でない場合 400", async () => {
    const res = await SELF.fetch("http://example.com/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: "n",
        body: "b",
        clientId: crypto.randomUUID(),
        color: 1.5,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("指定した color が保存・返却される", async () => {
    const res = await SELF.fetch("http://example.com/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: "色あり",
        body: "本文",
        clientId: crypto.randomUUID(),
        color: 2,
      }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as CreatePostResponse;
    expect(data.post.color).toBe(2);

    const listRes = await SELF.fetch("http://example.com/api/posts");
    const list = (await listRes.json()) as ListPostsResponse;
    const saved = list.posts.find((p) => p.id === data.post.id);
    expect(saved?.color).toBe(2);
  });
});

describe("GET /api/posts", () => {
  it("作成順に posts と total を返す", async () => {
    await post("X", "1つ目");
    await post("Y", "2つ目");
    const res = await SELF.fetch("http://example.com/api/posts");
    expect(res.status).toBe(200);
    const data = (await res.json()) as ListPostsResponse;
    expect(data.posts.length).toBe(data.total);
    const seqs = data.posts.map((p: Post) => p.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });
});

describe("DELETE /api/posts/:id", () => {
  it("トークンなしでは 401", async () => {
    const createRes = await post("Z", "削除対象");
    const created = (await createRes.json()) as CreatePostResponse;
    const res = await SELF.fetch(`http://example.com/api/posts/${created.post.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("存在しない id は 404", async () => {
    const res = await SELF.fetch(`http://example.com/api/posts/${crypto.randomUUID()}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(res.status).toBe(404);
  });

  it("正しいトークンで 204 になり一覧から消え、total が減る", async () => {
    const createRes = await post("W", "削除対象2");
    const created = (await createRes.json()) as CreatePostResponse;

    const beforeRes = await SELF.fetch("http://example.com/api/posts");
    const before = (await beforeRes.json()) as ListPostsResponse;

    const res = await SELF.fetch(`http://example.com/api/posts/${created.post.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(res.status).toBe(204);

    const listRes = await SELF.fetch("http://example.com/api/posts");
    const list = (await listRes.json()) as ListPostsResponse;
    expect(list.posts.some((p: Post) => p.id === created.post.id)).toBe(false);
    expect(list.total).toBe(before.total - 1);
  });

  it("削除しても seq は減らない (次の投稿の seq は削除前より大きい)", async () => {
    const createRes = await post("SeqKeep", "削除対象3");
    const created = (await createRes.json()) as CreatePostResponse;

    await SELF.fetch(`http://example.com/api/posts/${created.post.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });

    const nextRes = await post("SeqKeep2", "削除後の投稿");
    const next = (await nextRes.json()) as CreatePostResponse;
    expect(next.post.seq).toBeGreaterThan(created.post.seq);
  });
});

describe("POST /api/reset", () => {
  it("トークンなしでは 401", async () => {
    const res = await SELF.fetch("http://example.com/api/reset", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("正しいトークンで全件削除され、次の投稿の seq が 1 に戻る", async () => {
    await post("R1", "リセット前1");
    await post("R2", "リセット前2");

    const res = await SELF.fetch("http://example.com/api/reset", {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(res.status).toBe(204);

    const listRes = await SELF.fetch("http://example.com/api/posts");
    const list = (await listRes.json()) as ListPostsResponse;
    expect(list.total).toBe(0);
    expect(list.celebrated).toBe(false);

    const postRes = await post("R3", "リセット後");
    const data = (await postRes.json()) as CreatePostResponse;
    expect(data.post.seq).toBe(1);
  });
});

describe("GET /api/countries", () => {
  it("20か国を返す", async () => {
    const res = await SELF.fetch("http://example.com/api/countries");
    expect(res.status).toBe(200);
    const countries = (await res.json()) as readonly {
      id: number;
      name: string;
    }[];
    expect(countries.length).toBe(20);
  });
});

describe("GET /api/ws", () => {
  it("Upgrade ヘッダの大文字小文字を区別しない", async () => {
    const res = await SELF.fetch("http://example.com/api/ws", {
      headers: { Upgrade: "WebSocket" },
    });
    expect(res.status).toBe(101);
    res.webSocket?.accept();
    res.webSocket?.close();
  });

  it("接続直後に snapshot、投稿・削除・reset でそれぞれイベントが届く", async () => {
    const res = await SELF.fetch("http://example.com/api/ws", {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(101);
    const ws = res.webSocket;
    if (!ws) throw new Error("WebSocket upgrade did not return a webSocket");
    ws.accept();

    const events: ServerEvent[] = [];
    const waitForEvent = () =>
      new Promise<ServerEvent>((resolve) => {
        ws.addEventListener(
          "message",
          (event) => {
            const parsed = JSON.parse(event.data as string) as ServerEvent;
            events.push(parsed);
            resolve(parsed);
          },
          { once: true },
        );
      });

    const snapshot = await waitForEvent();
    expect(snapshot.type).toBe("snapshot");

    const nextPostEvent = waitForEvent();
    const createRes = await post("WS太郎", "WSテスト投稿");
    const created = (await createRes.json()) as CreatePostResponse;
    const postEvent = await nextPostEvent;
    expect(postEvent.type).toBe("post");
    if (postEvent.type === "post") {
      expect(postEvent.post.id).toBe(created.post.id);
      expect(postEvent.total).toBe(created.total);
    }

    const nextDeleteEvent = waitForEvent();
    await SELF.fetch(`http://example.com/api/posts/${created.post.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const deleteEvent = await nextDeleteEvent;
    expect(deleteEvent.type).toBe("delete");
    if (deleteEvent.type === "delete") {
      expect(deleteEvent.id).toBe(created.post.id);
    }

    const nextResetEvent = waitForEvent();
    await SELF.fetch("http://example.com/api/reset", {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const resetEvent = await nextResetEvent;
    expect(resetEvent.type).toBe("reset");

    ws.close();
  });
});
