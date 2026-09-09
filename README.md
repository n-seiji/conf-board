# conf-board

Go カンファレンスのブース展示用アプリ (miive)。参加者がスマホから「気に入っている福利厚生や、ほしい福利厚生」を
投稿すると、ブースのディスプレイに表示された自転する地球にピンとして届く。

## セットアップ

```bash
pnpm install
cp .dev.vars.example .dev.vars   # ADMIN_TOKEN を設定
```

## 開発

```bash
pnpm dev
```

`@cloudflare/vite-plugin` により Worker + Durable Object + 静的ページが
`http://localhost:5173` で一括して動く。

## 地球の地域データを再生成する

```bash
pnpm gen:regions
```

`src/globe/regions-gen.ts` (`world-atlas` の陸地データを球面 k-means で 20 か国に
クラスタリングし、各国の着地候補点を計算する) を実行し、結果を
`src/globe/regions.json` に書き出す。計算は起動時ではなくビルド時に 1 回だけ行う
方針のため、`src/shared/countries.ts` の国数や `src/globe/regions-gen.ts` の
パラメータ (格子の粗さ、候補点数など) を変えたときに実行し直す。

## チェック

```bash
pnpm check   # oxlint + oxfmt + tsc + vitest
```

## デプロイ

公開先は本番の `conf-board` のみです。ローカル開発では `conf-board-local` を使います。本番Worker名とDurable Objectの移行タグ `v1` を維持します。

Node.js 24 と `package.json` 指定のpnpmを使用します。

### GitHub Actions の初回設定

1. GitHubの **Settings → Environments** で `production` を作成します。
2. 次のSecretsとVariableを登録します。

| 種類     | 名前                    | 内容                                                      |
| -------- | ----------------------- | --------------------------------------------------------- |
| Secret   | `CLOUDFLARE_API_TOKEN`  | WorkersをデプロイできるAPIトークン                        |
| Secret   | `CLOUDFLARE_ACCOUNT_ID` | CloudflareのAccount ID                                    |
| Secret   | `ADMIN_TOKEN`           | 管理画面用の長いランダムなトークン                        |
| Variable | `DEPLOY_URL`            | 本番URL。例: `https://conf-board.<subdomain>.workers.dev` |

3. workflowを `main` に反映します。手動実行ボタンはdefault branchにworkflowがある場合に表示されます。
4. **Actions → Deploy → Run workflow** で公開するブランチを選びます。公開先はproduction固定です。

PRとmainへのpushでは、CIが整形・Lint・型・テスト・本番のデプロイドライランを実行します。実公開は手動実行のみです。デプロイは直列実行します。

Deployは設定確認・チェック・本番ビルド・公開・HTTP/API/WebSocket疎通を実行します。管理トークンは権限0600の一時ファイルでWranglerに渡し、終了時に削除します。

### ローカルからの実行

```bash
pnpm exec wrangler login
pnpm exec wrangler secret put ADMIN_TOKEN --config wrangler.jsonc --env production
pnpm run deploy production --dry-run
pnpm run deploy:production
pnpm smoke https://conf-board.<subdomain>.workers.dev
```

`pnpm deploy` はpnpm自身のコマンドなので、`pnpm run deploy production` または `pnpm run deploy:production` を使います。

[Cloudflare Vite pluginの環境選択](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/)はビルド時の `CLOUDFLARE_ENV` で決まります。デプロイスクリプトはproductionを指定してビルドし、生成Worker名が `conf-board`、BOARDが自身のクラスを参照することを検査して公開します。

Go/Wasm統合後は `wasm/country/go.mod` を検出してGoをセットアップし、GoテストもCI・Deployで実行します。

### 公開後の確認と復旧

- 投稿ページ・ディスプレイ・管理画面と、投稿のリアルタイム反映を確認します。
- 疎通確認に失敗しても公開自体は完了している場合があります。Actionsのログと本番URLを確認します。
- 不具合時はCloudflareのDeployments画面から正常なバージョンへ戻すか、正常なリビジョンを再デプロイします。コードのロールバックは投稿データの復元ではありません。`/api/reset` は復旧に使用しません。
- SQL変更は `Board.migrate()` に移行処理を追加し、クラスの追加・改名はWranglerの `migrations` に新しいタグを追加します。ローカルで検証してから本番へ適用します。

## 画面

| path       | 用途                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`        | スマホ投稿ページ。form (ニックネーム・本文・ピンの色を入力) → sending (送信アニメーション) → arrived (到着した国と地球のプレビュー、X 共有・画像保存) の3画面 |
| `/display` | ブースのディスプレイ。自転する地球 (Three.js) に投稿がピンとして着地し、吹き出し・QR コード・カウンター (`n / 150`) を表示                                    |
| `/admin`   | スタッフ用管理画面。トークン入力 (localStorage に保存、`?token=` クエリでも可) → 投稿一覧をライブ表示、行ごとに削除、全体リセット                             |

## モジュール構成 (`src/`)

- `globe/` — Three.js の地球 (回転・ピン・吹き出し・キャラクター・波紋等)
- `display/` — ディスプレイ画面 (地球ホスト・150 件達成演出・メッセージ球への切り替え)
- `phone/` — スマホ投稿ページ (フォーム・送信アニメーション・到着画像の生成)
- `admin/` — 管理画面 (投稿一覧・削除・リセット)
- `shared/` — API クライアント・スキーマ・定数・localStorage ヘルパー等、複数画面で共有するもの
- `worker/` — Cloudflare Worker のエントリと投稿を保持する Durable Object (`Board`)

## API

Worker がすべての `/api/*` を単一インスタンス (`main`) の Durable Object `Board`
に転送する。DO は SQLite (`ctx.storage.sql`) で投稿を保持し、WebSocket
Hibernation API でリアルタイム配信する。

- `POST /api/posts` `{nickname, body, clientId, color?}` → 201 `{post, total, celebrated}`
  - `clientId` はクライアントが送信ごとに生成する UUID。同じ `clientId` の再送は
    新規作成せず、既存の投稿を 201 で返す (冪等)。
  - `color` は 0〜5 の整数 (`src/shared/colors.ts` の `PinColorId`)。省略時は
    5 (ホワイト)。範囲外・非整数は 400。
  - JSON でない body、4KB 超、型不正 (nickname/body が文字列でない、clientId が
    UUID でない、color が 0〜5 の整数でない) は 400。
- `GET /api/posts` → `{posts, total, celebrated}` (各 `Post` に `color` を含む)
- `DELETE /api/posts/:id` (要 `Authorization: Bearer <ADMIN_TOKEN>`) → 204。
  存在しない id は 404。
- `POST /api/reset` (要トークン) → 204 (全削除、`seq`・`celebrated` も初期値に戻る)
- `GET /api/ws` → WebSocket (`snapshot` / `post` / `delete` / `reset` イベント)。
  `snapshot` は完全置換の意味を持つ (受信したらローカル状態を全て `snapshot.posts`
  で置き換える。差分マージしない)。接続直後と再接続直後に届く。`snapshot`・`post`
  の `Post` は `color` を含む。
- ピンの色 (`src/shared/colors.ts`): `PIN_COLORS` (id 0-5、コーラル/レモン/
  ラベンダー/スカイ/ピーチ/ホワイト)。`isPinColorId()` でバリデーション、
  `pinColorHex()` で表示用の16進カラーを取得する。

### 用語

- `total`: 現存する投稿数。削除すると減る。
- `seq`: 投稿の通算番号。削除しても減らない。`reset` で 0 に戻る。
- `celebrated`: `total` が初めて 150 に達したら true になるフラグ (DO の `meta`
  に保持)。`reset` で false に戻る。`snapshot`・`post` イベント、および
  `POST /api/posts` `GET /api/posts` のレスポンスに含まれる。

## 設計判断・仕様からの変更点

- `@cloudflare/vitest-pool-workers` は仕様策定時点では 0.8 系を想定していたが、
  インストール時点の最新 (0.22 系, vitest 4 系) を採用した。0.8 系は
  `defineWorkersConfig` (from `@cloudflare/vitest-pool-workers/config`) を使う旧 API
  だが、0.22 系では Vitest plugin 形式 (`cloudflareTest()` を `vitest/config` の
  `defineConfig` に渡す) に変わっている。`vitest.config.ts` は新 API で記述済み。
- `@cloudflare/workers-types` は入れず、`wrangler types` が生成する
  `worker-configuration.d.ts` (実行時型) を使う方針にした。wrangler 自体が
  現在この移行を推奨している。`wrangler.jsonc` を変更したら
  `npx wrangler types` を再実行すること。
- DO の REST API と WebSocket アップグレードは、DO 内の `fetch()` ハンドラで
  パスにより分岐する 1 本の実装にした (RPC メソッドにしなかった)。WebSocket
  アップグレードは `fetch()` からしか処理できないため、REST も同じ入口に揃えた。
  `Upgrade` ヘッダの値比較は大文字小文字を無視する。
- 文字数制限 (nickname 1-20、body 1-80) は JS の `.length` ではなくコードポイント数
  (`Array.from(str).length`) で数える。サロゲートペアの絵文字を 1 文字として扱うため。
- seq 採番と投稿の INSERT は `ctx.storage.transactionSync()` の中で行い、確定後にのみ
  WebSocket へブロードキャストする。ブロードキャストは `ctx.getWebSockets()` を毎回
  走査する (ハイバネート復帰後もこの一覧に頼れるため、メモリ上のキャッシュを持たない)。
- スキーマ移行 (`Board.migrate()`) はバージョンごとに `transactionSync()` で 1 文ずつ
  実行する。DDL とマイグレーション記録の INSERT を同一トランザクションにまとめることで、
  途中の文が失敗してもロールバックされ、「バージョンだけ進んでカラムが無い」ような
  不整合で DO が二度と起動できなくなる事態を防ぐ。
- 管理者トークンの比較 (`isAuthorized`) は SHA-256 でダイジェスト化してから全バイトを
  比較する定数時間比較にしている (`===` や `startsWith` の早期リターンによる
  タイミング攻撃を避けるため)。
- `wrangler.jsonc` の `assets` に `run_worker_first: ["/api/*"]` と
  `html_handling: "auto-trailing-slash"` を設定した。前者で `/api/*` は常に Worker
  (→ DO) が先に処理し、後者で `/display` → `display.html`、`/admin` → `admin.html`
  のように拡張子なしのパスが対応する `.html` に解決される。`vite dev` (ローカル)・
  `wrangler dev`・本番デプロイのいずれでも同じ挙動になることを確認済み。
- `compatibility_flags` の `nodejs_compat` は使っていない。Node 組み込みモジュール
  (`node:*` や `Buffer`) を利用しているコードが無く、トークン比較も Web Crypto
  (`crypto.subtle.digest`) だけで実装できるため不要と判断した。

## ブランドトークン

`src/styles/tokens.css` に集約 (ハードコード禁止)。

- 色: `--mint` `#5FCFBF`、`--mint-deep` `#3FB3A3`、`--mint-light` `#7FD9CC`、
  `--white` `#FFFFFF`、`--ink` `#1F3A36` (エラー表示用に `--danger` `--danger-ink`
  `--warning` を追加)
- フォント: `"M PLUS Rounded 1c"` (fallback `"Hiragino Maru Gothic ProN", sans-serif`)。
  `@fontsource/m-plus-rounded-1c` の weight 800/900 を自前ホスト (Google Fonts への
  ランタイム依存はしない。会場回線対策)
- 角丸: カード `--radius-card` (24px)、ボタン `--radius-button` (999px)
- 影: `--shadow-soft` (`0 10px 24px rgba(31,58,54,0.12)`)
- 絵文字は UI に使わない。アイコンは inline SVG
- ピンの色 (6色、`src/shared/colors.ts` の `PIN_COLORS`): コーラル `#FF8A80` /
  レモン `#FFE082` / ラベンダー `#B39DDB` / スカイ `#81D4FA` / ピーチ `#FFAB91` /
  ホワイト `#FFFFFF` (デフォルト)。投稿者がスマホで選び、ピン・吹き出し・到着画面・
  保存画像に反映される

## フロントエンドの規約

- ユーザー入力 (ニックネーム・本文など) を DOM に描画するときは、必ず `textContent`
  を使う。`innerHTML` へユーザー入力を直接差し込むことは禁止 (XSS 対策)。
