import { describe, expect, it } from "vitest";
import * as v from "valibot";
import { createPostRequestSchema, serverEventSchema } from "./schemas";

const validUuid = "123e4567-e89b-12d3-a456-426614174000";

describe("createPostRequestSchema", () => {
  it("nickname が20文字 (コードポイント単位) の場合、成功する", () => {
    const nickname = "🎉".repeat(20);
    const result = v.safeParse(createPostRequestSchema, {
      nickname,
      body: "内容",
      clientId: validUuid,
    });
    expect(result.success).toBe(true);
  });

  it("nickname が21文字 (コードポイント単位) の場合、失敗する", () => {
    const nickname = "🎉".repeat(21);
    const result = v.safeParse(createPostRequestSchema, {
      nickname,
      body: "内容",
      clientId: validUuid,
    });
    expect(result.success).toBe(false);
  });

  it("nickname と body の前後の空白は trim される", () => {
    const result = v.safeParse(createPostRequestSchema, {
      nickname: "  たろう  ",
      body: "  有給が欲しい  ",
      clientId: validUuid,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output.nickname).toBe("たろう");
      expect(result.output.body).toBe("有給が欲しい");
    }
  });

  it("body が80文字 (コードポイント単位) の場合、成功する", () => {
    const body = "あ".repeat(80);
    const result = v.safeParse(createPostRequestSchema, {
      nickname: "たろう",
      body,
      clientId: validUuid,
    });
    expect(result.success).toBe(true);
  });

  it("body が81文字 (コードポイント単位) の場合、失敗する", () => {
    const body = "あ".repeat(81);
    const result = v.safeParse(createPostRequestSchema, {
      nickname: "たろう",
      body,
      clientId: validUuid,
    });
    expect(result.success).toBe(false);
  });

  it("color を省略した場合、デフォルト値 5 (ホワイト) になる", () => {
    const result = v.safeParse(createPostRequestSchema, {
      nickname: "たろう",
      body: "有給が欲しい",
      clientId: validUuid,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output.color).toBe(5);
    }
  });

  it("color が範囲外 (0-5 以外) の場合、失敗する", () => {
    const result = v.safeParse(createPostRequestSchema, {
      nickname: "たろう",
      body: "有給が欲しい",
      clientId: validUuid,
      color: 6,
    });
    expect(result.success).toBe(false);
  });

  it("clientId が UUID でない場合、失敗する", () => {
    const result = v.safeParse(createPostRequestSchema, {
      nickname: "たろう",
      body: "有給が欲しい",
      clientId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});

describe("serverEventSchema", () => {
  const post = {
    id: "1",
    nickname: "たろう",
    body: "有給が欲しい",
    countryId: 0,
    color: 5,
    seq: 1,
    createdAt: 0,
  };

  it("snapshot イベントを受理する", () => {
    const result = v.safeParse(serverEventSchema, {
      type: "snapshot",
      posts: [post],
      total: 1,
      celebrated: false,
    });
    expect(result.success).toBe(true);
  });

  it("post イベントを受理する", () => {
    const result = v.safeParse(serverEventSchema, {
      type: "post",
      post,
      total: 1,
      celebrated: false,
    });
    expect(result.success).toBe(true);
  });

  it("delete イベントを受理する", () => {
    const result = v.safeParse(serverEventSchema, {
      type: "delete",
      id: "1",
      total: 0,
    });
    expect(result.success).toBe(true);
  });

  it("reset イベントを受理する", () => {
    const result = v.safeParse(serverEventSchema, { type: "reset" });
    expect(result.success).toBe(true);
  });

  it("未知の type の場合、失敗する", () => {
    const result = v.safeParse(serverEventSchema, { type: "unknown" });
    expect(result.success).toBe(false);
  });
});
