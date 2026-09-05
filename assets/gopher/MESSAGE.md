# 150投稿のメッセージ演出

150件到達時は紙吹雪を5秒再生し、その後約2秒で白い立体文字がmiive色の球面を満たします。
コピーは「働く意味で、世界を満たす。」、土台の色はサイトの `--mint` と同じ `#5FCFBF` です。

文字は正面からの読みやすさを優先して円の輪郭内へ配置し、球面上の薄いレリーフにしています。厚みは0.03（球半径1）、全体を右へ4度回転。文字表面は滑らかな法線で陰影を付け、三角形の模様が出ないようにしています。

- `src/globe/message-globe.ts`: Three.jsのExtrudeGeometryを球面へ変形した13文字。画像テクスチャではありません。
- `src/display/milestone.ts`: 5秒待ち、表示切り替え、149件以下への復帰の状態管理。
- 表示中は通常地球・Gopher・NEW・吹き出しを非表示にし、自転と操作を停止します。投稿データ・受付・カウントは維持します。
- 150件以上で右上の切り替えボタンが現れます。地球に戻ると自転を再開します。
- 再接続・再読込のsnapshotでは達成演出を再生せず、ボタンだけ利用可能にします。
- サンプル: `/assets/gopher/integration-preview#celebrate`。実投稿・達成フラグは変更しません。
- `prefers-reduced-motion` 有効時は、紙吹雪なし・文字の完成状態を表示します。

## フォント

既存依存のM PLUS Rounded 1c 900から、必要な文字の輪郭だけを抽出しています。
ライセンスは `public/models/message-font-LICENSE.txt` (SIL OFL 1.1)。
再生成: `uv run --with fonttools --with brotli assets/gopher/build-message-font.py`
生成後に `pnpm exec oxfmt src/globe/message-font.json` を実行します。
