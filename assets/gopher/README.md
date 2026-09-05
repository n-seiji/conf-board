# Gopher model

追加のターンアラウンド参考画像を基準に、Blender MCPで作成したモデルです。耳と目の縁線をなくし、前版から前後の厚さを1.1倍、高さを0.9倍に調整しました。背面も青い耳、肌色の独立した手・短い足・丸い尻尾を備えています。

## ファイル

- `gopher.blend`: 編集用。`Gopher Studio` シーンが完成モデル。元の `Scene` は保持。
- `../../public/models/gopher.glb`: Three.js用。キャラクターと骨だけを収録。約1.15MB、30,864三角形、6マテリアル、6ボーン。
- `preview-front.png` / `preview-three-quarter.png` / `preview-side.png` / `preview-back.png`: 各方向のレンダリング。
- `preview-wave.png`: 手を振るポーズ。
- `expression-*.png`: 通常・笑顔・ウィンク・びっくりの正面画像。
- `preview.html`: 実際のGLBを読み込む、表情・色・動き・地球配置の確認画面。
- `three-example.js`: 読み込み・個体別の色変更・アニメーション・地球配置の関数。
- `gopher-previous.blend`: 作り直す前のモデルのバックアップ。

参考画像の全表情・全ポーズを実装したものではありません。今回のアニメーションは次の3種類です。

| Clip    | 長さ  | Blenderフレーム（30fps） | 動き                                    |
| ------- | ----- | ------------------------ | --------------------------------------- |
| `Dance` | 3.2秒 | 1–97                     | 左右に揺れ、手と足を交互に動かす        |
| `Wave`  | 3.0秒 | 1–91                     | 片手を上げて振り、元の姿勢に戻る        |
| `Hop`   | 2.4秒 | 1–73                     | 予備動作・跳躍・着地を含む2回のジャンプ |

すべてループ可能。横方向の移動はありません。Hopのみモデル内部のRootボーンが上に動きます。

表情は `Neutral`（通常）、`Smile`（笑顔）、`Wink`（ウィンク）、`Surprised`（びっくり）。シェイプキーで切り替え、3つの動きと独立して組み合わせられます。

## プレビュー

リポジトリのルートで実行（既存の `node_modules` が必要）:

```sh
python3 -m http.server 8766 --bind 127.0.0.1
```

`http://127.0.0.1:8766/assets/gopher/preview.html` を開きます。動き、表情、色の丸、`On Earth` を操作できます。地球上の3体は別々の色・表情・骨を持ち、変更は主役の1体だけに反映されます。

これは独立したプレビューです。サービス側にも `src/globe/characters.ts (character-pins.ts の汎用実装)` 経由で組み込み済みです。表示用地球儀とスマホ到着画面で、投稿の色・位置を引き継ぐ高さ0.336（前版0.42の0.8倍）のGopherを表示します。投稿IDから3種類の動き・4種類の表情・再生開始位置を疑似ランダムに割り当て、常時ループ再生します。同じ投稿は再読み込みしても同じ組み合わせです。

吹き出しはBodyボーン上の頭の位置に追従します。クリック選択中は足を地表に残したまま腰から約60度反り、笑顔で見上げます。自転再開で元の姿勢・動きに戻ります。新規投稿による強制回転・落下は廃止しました。モデルの準備ができ次第、裏側を待たず配置先にGopherがワープ風に登場し、NEWと点滅・回転する星を表示します。登場後の自動回転角が1周（2π）に達したらNEWと星だけ消えます。停止・手動操作・選択用の回転は1周に含めません。スマホの到着画面でも同じ動作です。ページ再読込のsnapshotは通常表示になります。

色はユーザー指定を維持します。ロード中・失敗時は色付きピンにフォールバックします。地球の地形はworld-atlas、海と陸の色・照明はこのプレビューを基準にしています。デプロイはしていません。

開発サーバー上の `assets/gopher/integration-preview.html` は実際の地球モジュールでNEW登場・選択・頭の追従を試す確認ページです。テスト用の表示のみで投稿は保存しません。`arrival.ts` はRenの登場時に使う落下軌道 (`fallingPosition`) のヘルパーで、`src/globe/index.ts` から使用しています。実GLBの腰・足・頭の検証は `node --import tsx assets/gopher/verify-integration.mjs` で実行できます。

## Three.jsで使う

プロジェクト内の Three.js 0.169 で読み込み・スキニング・クリップ再生を確認しています。GLBは外部テクスチャやDracoデコーダーを必要としません。

```js
import { Clock } from "three";
import { loadGopher, createGopher, placeOnGlobe } from "./assets/gopher/three-example.js";

const asset = await loadGopher("/models/gopher.glb"); // 一度だけロード
const gopher = createGopher(asset, {
  color: "#1baec7", // サービスから受け取った色
  height: 0.12, // 地球と同じ単位で指定する全高
  clip: "Dance",
});

// 地球と同じローカル座標系のグループに追加する。
// conf-boardなら globeRig.pinsGroup に相当。
globeGroup.add(gopher.root);
placeOnGlobe(gopher, {
  lat: 35.68,
  lon: 139.69,
  radius: 1,
  heading: 0, // 地表法線まわりの回転角（度）
});

gopher.setColor("#b09ddd");
gopher.setExpression("Smile"); // Neutral / Smile / Wink / Surprised
// gopher.setExpression('Smile', 0.5); // 強さ0〜1。時間で更新すると滑らかに変化
gopher.play("Wave"); // 0.2秒のクロスフェード

const clock = new Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  gopher.update(dt);
  renderer.render(scene, camera);
});

// 不要になった個体:
// gopher.dispose();
```

`scene`、`renderer`、`camera`、`globeGroup` は呼び出し側の既存Three.jsオブジェクトです。

GLBは **+Yが上、+Zが正面、原点が足元、全高2.844単位**。Blenderでは+Zが上、-Yが正面です。外側の `GopherPlacement` グループが地球上の位置・向き・大きさを担当するため、アニメーションと配置が競合しません。座標変換は `src/globe/rig.ts` と同じです。

複数体を置くときは `createGopher(asset, ...)` を個体ごとに呼びます。`SkeletonUtils.clone` で骨を複製し、`BodyColor` だけ個体用に複製するため、他の個体の色や動きを変更しません。モデル形状と残りの材質は共有します。大量表示では、同時表示数に応じてLODやアニメーション更新頻度の調整を検討してください。

## Blenderで色・表情・動きを編集

1. `gopher.blend` を開き、`Gopher Studio` を選ぶ。
2. 胴体 `Body` を選択。マテリアル `BodyColor` のPrincipled BSDFの「ベースカラー」を変更すると、胴体と両耳が同時に変わる。
3. `GopherRig` を選択。ドープシートをアクションエディターに切り替え、`Dance` / `Wave` / `Hop` を選ぶ。
4. 上表の終了フレームに合わせて再生。NLAには保管用トラックがあるが、ミュートのままアクションを1つずつ編集する。
5. 表情は `FaceExpressions` を選択し、オブジェクトデータプロパティ（緑の三角）→シェイプキー。`Smile` / `Wink` / `Surprised` のうち1つを1、残りを0にする。すべて0で通常顔。中間値も使用可能。

BodyColorの初期色はsRGB `#1BAEC7`。目・歯・手足・尻尾の色は独立しています。

## 再書き出し・再構築

BlenderのScriptingから `export_gopher.py` を開いて実行すると、選択中の完成シーンのキャラクターを一時的に結合したコピーからGLBへ書き出します。編集用パーツは保持され、ライト・カメラ・床・元のCubeはGLBに入りません。現在のスクリプトの `OUTPUT` はこのワークスペースの絶対パスです。他の場所で使う場合は変更してください。

`rebuild_gopher.py` は生成した `Gopher Studio` を置き換え、`build_gopher.py` → `expressions_gopher.py` → `animate_gopher.py` を実行します。手作業で編集した後は、再構築前に別名保存してください。

検証:

```sh
node assets/gopher/verify-gopher.mjs
```

GLBの実読み込み、3クリップのループ端点、動くトラック、アニメーション中の境界、足の接地、個体別の色・表情・骨、表情が動きで上書きされないこと、北極・南極を含む地球配置をチェックします。

参考API: [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)、[SkeletonUtils](https://threejs.org/docs/pages/module-SkeletonUtils.html)、[AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html)。キャラクター原案・参考画像の権利は元の権利者に帰属します。
