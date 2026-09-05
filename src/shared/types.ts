import type * as v from "valibot";
import type { createPostRequestSchema, postSchema } from "./schemas";

export type Post = Readonly<v.InferOutput<typeof postSchema>>;

/** クライアントが送信するリクエストの入力型 (color は省略可能)。 */
export type CreatePostRequest = Readonly<v.InferInput<typeof createPostRequestSchema>>;

export type CreatePostResponse = Readonly<{
  post: Post;
  total: number;
  celebrated: boolean;
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
