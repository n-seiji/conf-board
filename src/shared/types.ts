import type { PinColorId } from "./colors";

export type Post = Readonly<{
  id: string;
  nickname: string;
  body: string;
  countryId: number;
  color: PinColorId;
  seq: number;
  createdAt: number;
}>;

export type Country = Readonly<{
  id: number;
  name: string;
}>;

export type CreatePostRequest = Readonly<{
  nickname: string;
  body: string;
  /** クライアントが送信ごとに生成する UUID。再送時の冪等化に使う。 */
  clientId: string;
  /** 省略時は 5 (ホワイト)。 */
  color?: PinColorId;
}>;

export type CreatePostResponse = Readonly<{
  post: Post;
  total: number;
  celebrated: boolean;
}>;

export type ListPostsResponse = Readonly<{
  posts: readonly Post[];
  total: number;
  celebrated: boolean;
}>;

export type ApiErrorResponse = Readonly<{
  error: string;
}>;

export type ServerEvent =
  | Readonly<{
      type: "snapshot";
      posts: readonly Post[];
      total: number;
      celebrated: boolean;
    }>
  | Readonly<{ type: "post"; post: Post; total: number; celebrated: boolean }>
  | Readonly<{ type: "delete"; id: string; total: number }>
  | Readonly<{ type: "reset" }>;
