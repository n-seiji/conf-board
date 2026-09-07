import { COUNTRY_COUNT } from "./countries";
import * as v from "valibot";
import { DEFAULT_PIN_COLOR_ID, PIN_COLORS, type PinColorId } from "./colors";

/** ニックネームの最大文字数 (コードポイント単位)。 */
export const NICKNAME_MAX = 20;
/** 投稿本文の最大文字数 (コードポイント単位)。 */
export const BODY_MAX = 80;

/** コードポイント単位での文字数 (サロゲートペア絵文字等を1文字として数える)。 */
export const codePointLength = (value: string): number => Array.from(value).length;

/** コードポイント単位で `max` 文字に切り詰める。 */
export const clampByCodePoints = (value: string, max: number): string => {
  const chars = Array.from(value);
  return chars.length > max ? chars.slice(0, max).join("") : value;
};

const PIN_COLOR_IDS = PIN_COLORS.map((c) => c.id) as PinColorId[];

/** ピンの色 ID (0-5)。`src/shared/colors.ts` の `PIN_COLORS` から導出する。 */
const pinColorIdSchema = v.picklist(PIN_COLOR_IDS, "色の指定が正しくありません");

export const postSchema = v.object({
  id: v.string(),
  nickname: v.string(),
  body: v.string(),
  countryId: v.number(),
  color: pinColorIdSchema,
  seq: v.number(),
  createdAt: v.number(),
});

const nicknameSchema = v.pipe(
  v.string(),
  v.trim(),
  v.check(
    (value) => codePointLength(value) >= 1 && codePointLength(value) <= NICKNAME_MAX,
    `ニックネームは 1〜${NICKNAME_MAX} 文字で入力してください`,
  ),
);

const bodySchema = v.pipe(
  v.string(),
  v.trim(),
  v.check(
    (value) => codePointLength(value) >= 1 && codePointLength(value) <= BODY_MAX,
    `内容は 1〜${BODY_MAX} 文字で入力してください`,
  ),
);

export const createPostRequestSchema = v.object({
  nickname: nicknameSchema,
  body: bodySchema,
  clientId: v.pipe(v.string(), v.uuid("clientId が正しくありません")),
  color: v.optional(pinColorIdSchema, DEFAULT_PIN_COLOR_ID),
  countryId: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(COUNTRY_COUNT - 1)),
  ),
});

export const createPostResponseSchema = v.object({
  post: postSchema,
  total: v.number(),
  celebrated: v.boolean(),
});

export const listPostsResponseSchema = v.object({
  posts: v.array(postSchema),
  total: v.number(),
  celebrated: v.boolean(),
});

export const apiErrorResponseSchema = v.object({
  error: v.string(),
});

export const serverEventSchema = v.variant("type", [
  v.object({
    type: v.literal("snapshot"),
    posts: v.array(postSchema),
    total: v.number(),
    celebrated: v.boolean(),
  }),
  v.object({
    type: v.literal("post"),
    post: postSchema,
    total: v.number(),
    celebrated: v.boolean(),
  }),
  v.object({
    type: v.literal("delete"),
    id: v.string(),
    total: v.number(),
  }),
  v.object({
    type: v.literal("reset"),
  }),
]);
