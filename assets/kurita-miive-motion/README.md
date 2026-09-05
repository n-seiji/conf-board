# miive・2頭身キャラクターの5つの動き

承認済みの `../kurita-miive-v2/kurita-miive-fixed.glb` に12本のボーンとスキンウェイトを追加。顔・髪・miive Tシャツのテクスチャを引き継いでいます。

## ファイル

- [viewer.html](viewer.html)：ブラウザで開くオフラインビューア。ボタンで動きを切り替え、一時停止・回転・GLB保存ができます。起動時は手を振ります。
- [kurita-miive-animated.glb](kurita-miive-animated.glb)：5つの独立したアニメーションクリップとテクスチャを内蔵。
- [kurita-miive-animated.blend](kurita-miive-animated.blend)：編集用。MiiveRig のアクションから各動きを選択できます。初期状態は Wave。

| 動き           | クリップ名 | 長さ  |
| -------------- | ---------- | ----- |
| 手を振る       | Wave       | 3.2秒 |
| おじぎ         | Bow        | 2.8秒 |
| うなずく       | Nod        | 2.4秒 |
| 喜んでジャンプ | Jump       | 2.8秒 |
| 左右にダンス   | Dance      | 3.2秒 |

すべて30fpsのループ。GLBを使うアプリ側で再生するクリップを指定してください。

## 検証

実際のGLBをChromeで読み込み、5クリップのメッシュ変形、ループ端点の一致、切り替え、一時停止と再開、モバイル表示を確認。両面描画でも顔と服の色を確認しています。マテリアルは KHR_materials_unlit、黒い輪郭シェルは含みません。

詳細は `browser-verification.json`、`export-verification.json`、`rig-report.json`。`browser-*.png` は実際のブラウザ表示、`preview-*.png` はBlenderレンダーです。

## 再生成

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python assets/kurita-miive-motion/build_motion.py
node assets/kurita-miive-motion/build_viewer.mjs
node assets/kurita-miive-v2/check_browser.cjs "$PWD/assets/kurita-miive-motion/viewer.html" --motions
```

## 地球画面への組み込み

- 投稿の `seq >= 150` で `public/models/ren.glb` を使用します。
- renさんはgopherの1.3倍の高さで、地表の法線方向に立ちます。前面への強制描画はせず、通常の奥行き判定を使います。
- クリック時は足元を固定し、画面上で足が下・頭が上の正面向きにそろえ、吹き出しを頭上に出します。選択中の1体だけは周囲に隠れないよう手前に表示し、自転再開時は通常の奥行きと地表に垂直な向きへ戻します。NEWは本体または頭上ラベルのクリックで解除されます。
- 新しい着地点は既存キャラクターとの間隔を調べ、同じ地域の空き場所を優先します。既存キャラクターは移動しません。地域が混雑した場合や見る角度による重なりは残ります。
- `integration-verification.json` は、向き・見上げ・NEW解除・40体の着地点の重複回避を実GLBで確認した結果です。
