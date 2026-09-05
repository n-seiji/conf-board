import type * as v from "valibot";
import type {
  apiErrorResponseSchema,
  countrySchema,
  createPostRequestSchema,
  postSchema,
} from "./schemas";

export type Post = Readonly<v.InferOutput<typeof postSchema>>;

export type Country = Readonly<v.InferOutput<typeof countrySchema>>;

/** クライアントが送信するリクエストの入力型 (color は省略可能)。 */
export type CreatePostRequest = Readonly<v.InferInput<typeof createPostRequestSchema>>;

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

export type ApiErrorResponse = Readonly<v.InferOutput<typeof apiErrorResponseSchema>>;

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
