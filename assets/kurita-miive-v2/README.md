# miive / 栗田廉さん — 承認イラストから作り直した2頭身モデル

`character-sheet.png` を承認済みのデザインとして、旧モデルとは別に作成した静止3Dモデルです。

黒表示の修正版は `kurita-miive-fixed.glb`、`kurita-miive-fixed.blend`、`viewer-fixed.html` です。GLBでは両面表示時に全体を覆う黒い輪郭用外殻を除外しました。通常表示と強制両面表示をChromeで確認済みです。Blenderファイルは材質プレビューで開きます。

- `viewer.html` — ダブルクリックで開く回転ビューア。モデルと描画ライブラリを内蔵し、サーバー・ネット接続は不要。正面・斜め・横・背面、自動回転、GLB保存に対応。
- `kurita-miive-v2.glb` — 背景やカメラを含まない3Dモデル。テクスチャ内蔵。
- `kurita-miive-v2.blend` — 編集用Blenderファイル。キャラクターと撮影用カメラをコレクションで分離。
- `front.png` / `preview.png` / `side.png` / `back.png` — Blenderで実際のモデルからレンダリングした確認画像。
- `character-sheet.png` — ユーザー承認済みの元イラスト。
- `verification.json` — GLBの再読み込み・形状・材質の検証結果。

顔の表情やmiiveロゴは承認イラストをUVテクスチャとして使用。頭、Tシャツ、手と腕、パンツ、靴は厚みのある閉じたメッシュです。腕と手、肩と袖をそれぞれ一続きの形状にしています。肌の色を照明で濁らせないため、glTFの `KHR_materials_unlit` を使用。目や口を別の球体や立体的な歯にはしていません。

全高は約3.1モデル単位。用途に合わせて全体を等倍で縮小してください。BlenderではZが上・−Yが正面、glTFではYが上・+Zが正面です。リグ・アニメーションは未設定。表情は描画テクスチャで、口や目の形状アニメーションは含みません。

再生成: Blenderで `build_model.py` を実行し、`verify_model.py` で書き出しを検証。ビューアの更新はリポジトリルートで `node assets/kurita-miive-v2/build_viewer.mjs` を実行します。
