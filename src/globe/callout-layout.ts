/**
 * 吹き出し (speech bubble) オーバーレイの配置計算を担う DOM 非依存の純粋関数群。
 * DOM 管理側 (`createCallouts`) はここから必要な関数・定数を import する。
 */

/** 画面上に同時に表示する吹き出しの最大数。 */
export const MAX_BUBBLES = 8;
/** ピンが縁 (limb) に近づき、まもなく非表示になる dot。この値未満で吹き出しを終了する。 */
export const END_DOT = 0.3;
/**
 * 右半分 (`x >= globeCenterX`、これから縁へ流れていく途中) のピンをリフィル候補にする
 * 最低 dot。左半分より高く設定し、残り表示時間が短い (縁まで秒単位) ピンだけを除外する。
 */
const REFILL_MIN_DOT_RIGHT_HALF = 0.75;
/**
 * 補充候補にする最低の dot (全候補共通)。`END_DOT` ちょうどで補充すると次のフレームで
 * `shouldEndCallout` に消されて出た瞬間に消えるちらつきになるため、少し余裕を持たせる。
 */
const REFILL_MIN_DOT = 0.35;
/** ピンの先端から吹き出しを離す隙間 (px)。 */
export const BUBBLE_GAP_PX = 14;
/**
 * 重なり判定・リフィル候補の事前チェックに使う吹き出しサイズの見積もり (px)。
 * 実際の2行分の吹き出し (約260x99) より小さいと、補充直後に実サイズで重なりが
 * 判定されてすぐ消えてしまう (churn) ため、余裕を持たせた値にしている。
 */
export const ESTIMATED_BUBBLE_W = 260;
export const ESTIMATED_BUBBLE_H = 100;
/** 吹き出し同士が接するのを避けるため、重なり判定の矩形を全方向に広げるマージン (px)。 */
export const OVERLAP_MARGIN_PX = 12;
/**
 * 補充されたばかりの吹き出しが誤って削除されないようにする最小経過時間 (ms)。
 * この時間内の吹き出しは `resolveOverlaps` で「新しい方」として保護され、
 * 重なった場合は代わりに古い方が消える。
 */
const MIN_AGE_BEFORE_OVERLAP_REMOVE_MS = 1500;
/**
 * 吹き出しが消えた (重なり解消・終了判定のいずれか) ピンを、再びリフィル対象にするまで
 * 待つクールダウン時間 (ms)。同じピンが間を置かず何度も再登場するのを防ぐ。
 */
const RESHOW_COOLDOWN_MS = 3000;

export type Rect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

/**
 * globe コンテナ (globeWrap) 基準のピン座標を、overlay (stage 全体) 基準の座標に変換する。
 * `projectPin` は globeWrap 基準、吹き出しカードは overlay (stage) 基準なので、
 * globeWrap が stage 内でオフセットしている分 (見出し用の余白などによる) を補正しないと
 * 吹き出しの位置がピンの位置からずれる。
 */
export const toOverlaySpace = (
  pinX: number,
  pinY: number,
  globeRect: Rect,
  overlayRect: Rect,
): Readonly<{ x: number; y: number }> => ({
  x: pinX + (globeRect.left - overlayRect.left),
  y: pinY + (globeRect.top - overlayRect.top),
});

/**
 * カードを終了 (フェードアウト) させるべきかどうかを判定する。
 * ピンが見つからない・非表示 (裏側) になった・dot が `END_DOT` を割った
 * (まもなく縁を越えて非表示になる)場合に終了する。
 */
export const shouldEndCallout = (
  projectedDot: number | null,
  visible: boolean,
  endDot: number = END_DOT,
): boolean => {
  if (!visible || projectedDot === null) return true;
  return projectedDot < endDot;
};

/** 吹き出しがピンに対してどちら側に配置されるか。 */
export type Side = "top" | "left" | "right" | "bottom";

/** side を試す固定順序 (優先する側を先頭にする)。 */
const FIXED_SIDE_ORDER: readonly Side[] = ["top", "left", "right", "bottom"];

/**
 * ピンの水平位置から、優先して試す side を決める。球の中心から遠ざかる向き
 * (中心より左のピンは左、それ以外は右) を優先することで、吹き出しが球の周りに
 * 放射状に広がり、球本体が隠れにくくなる。
 */
export const preferredSideFor = (pinX: number, globeCenterX: number): Side =>
  pinX < globeCenterX ? "left" : "right";

/** `preferred` を先頭にした、試す順序の side 配列を返す。 */
const sideOrder = (preferred: Side): readonly Side[] => [
  preferred,
  ...FIXED_SIDE_ORDER.filter((side) => side !== preferred),
];

/** 指定した side でのピン基準の矩形を計算する (自由軸方向のみ overlay 内にクランプする)。 */
export const rectForSide = (
  side: Side,
  pinX: number,
  pinY: number,
  width: number,
  height: number,
  gap: number,
  overlaySize: Readonly<{ width: number; height: number }>,
): Rect => {
  if (side === "top" || side === "bottom") {
    const top = side === "top" ? pinY - gap - height : pinY + gap;
    let left = pinX - width / 2;
    if (left < 0) left = 0;
    if (left + width > overlaySize.width) left = overlaySize.width - width;
    return { left, top, width, height };
  }
  const left = side === "left" ? pinX - gap - width : pinX + gap;
  let top = pinY - height / 2;
  if (top < 0) top = 0;
  if (top + height > overlaySize.height) top = overlaySize.height - height;
  return { left, top, width, height };
};

/** side の矩形が、クランプしない主軸方向で overlay 内に収まっているかどうか。 */
const fitsMainAxis = (
  side: Side,
  rect: Rect,
  overlaySize: Readonly<{ width: number; height: number }>,
): boolean => {
  if (side === "top") return rect.top >= 0;
  if (side === "bottom") return rect.top + rect.height <= overlaySize.height;
  if (side === "left") return rect.left >= 0;
  return rect.left + rect.width <= overlaySize.width;
};

/**
 * ピンの周囲 4 方向 (`top`/`left`/`right`/`bottom`) のうち、既存の吹き出しと重ならず
 * overlay 内に収まる最初の side を選んで矩形を返す純粋関数。`preferredSide` を最初に
 * 試し、それ以外は `top`→`left`→`right`→`bottom` の固定順で試す。左右方向はピンの
 * 高さ中央に、上下方向は幅中央に揃え、自由軸 (左右なら縦、上下なら横) は overlay 内に
 * クランプする。どの side も (主軸方向に収まらない、または既存の吹き出しと重なる)
 * 条件で使えない場合は null を返す。
 */
export const placeBubble = (
  pinX: number,
  pinY: number,
  size: Readonly<{ width: number; height: number }>,
  gap: number,
  overlaySize: Readonly<{ width: number; height: number }>,
  existingRects: readonly Rect[],
  preferredSide: Side,
): Readonly<{ rect: Rect; side: Side }> | null => {
  for (const side of sideOrder(preferredSide)) {
    const rect = rectForSide(side, pinX, pinY, size.width, size.height, gap, overlaySize);
    if (!fitsMainAxis(side, rect, overlaySize)) continue;
    const expanded = expandRect(rect, OVERLAP_MARGIN_PX);
    const overlaps = existingRects.some((existing) =>
      rectsIntersect(expanded, expandRect(existing, OVERLAP_MARGIN_PX)),
    );
    if (!overlaps) return { rect, side };
  }
  return null;
};

/** 2 つの矩形が重なっているかどうかを判定する。 */
export const rectsIntersect = (a: Rect, b: Rect): boolean =>
  a.left < b.left + b.width &&
  a.left + a.width > b.left &&
  a.top < b.top + b.height &&
  a.top + a.height > b.top;

/** 矩形を全方向に `margin` だけ広げた矩形を返す (重なり判定を保守的にするため)。 */
export const expandRect = (rect: Rect, margin: number): Rect => ({
  left: rect.left - margin,
  top: rect.top - margin,
  width: rect.width + margin * 2,
  height: rect.height + margin * 2,
});

/**
 * 重なった 2 つの吹き出しのうち、どちらを消すべきかを選ぶ純粋関数。
 * 一方が `MIN_AGE_BEFORE_OVERLAP_REMOVE_MS` 未満しか経過していない場合、
 * それは保守的な見積もりで重ならない位置に置かれたばかりのはずなので保護し、
 * もう一方 (後から重なりに入り込んできた側) を消す。両方とも経過済み、または
 * 両方ともまだ若い場合は、単純に `shownAt` が古い方を消す。
 */
export const pickOverlapLoser = <T extends { readonly shownAt: number }>(
  a: T,
  b: T,
  now: number,
  minAgeMs: number = MIN_AGE_BEFORE_OVERLAP_REMOVE_MS,
): T => {
  const aYoung = now - a.shownAt < minAgeMs;
  const bYoung = now - b.shownAt < minAgeMs;
  if (aYoung && !bYoung) return b;
  if (bYoung && !aYoung) return a;
  return a.shownAt <= b.shownAt ? a : b;
};

export type RefillCandidate = Readonly<{
  id: string;
  createdAt: number;
  /** ピン先端の overlay (stage) 基準座標。既存の吹き出し矩形と同じ座標系で比較する。 */
  projectedX: number | null;
  projectedY: number | null;
  visible: boolean;
  dot: number;
  hasCard: boolean;
  /** 直近で吹き出しが消えた時刻 (ms)。一度も表示されたことが無ければ null。 */
  lastShownAt: number | null;
}>;

/**
 * 空いている 1 枠をリフィルする候補を、プール内の投稿から 1 件選ぶ純粋関数。
 * 対象は「表示中」「まだカードが無い」「dot が `REFILL_MIN_DOT` 以上」のもの。加えて、
 * 画面右半分 (`x >= globeCenterX`、overlay 基準、これから縁へ流れていく途中) のピンは
 * `REFILL_MIN_DOT_RIGHT_HALF` 未満 (まもなく縁を越える) を除外する
 * (追加してすぐ消えるカードを避けるため)。さらに、`lastShownAt` から
 * `RESHOW_COOLDOWN_MS` (3秒) 未満しか経っていない (吹き出しが消えたばかりの) ピンも
 * 除外する (同じピンがすぐ再登場するのを防ぐ)。
 * 残った候補それぞれについて `placeBubble` (`ESTIMATED_BUBBLE_W/H` で見積もった
 * サイズ、優先 side はピンの水平位置から `preferredSideFor` で決める) を試し、
 * 置き場所が無い (どの side も既存の吹き出しと重なる) 候補は除外する。
 * 優先順位は投稿の新しい順 (`createdAt` 降順) のみ。該当が無ければ null を返す。
 * 見つかった場合は、選んだ投稿の id と、そのために決まった side を返す
 * (実際の配置でも同じ side を使うことで、見積もりと実配置の side がずれないようにする)。
 */
export const pickRefillCandidate = (
  candidates: readonly RefillCandidate[],
  globeCenterX: number,
  overlaySize: Readonly<{ width: number; height: number }>,
  existingRects: readonly Rect[],
  now: number,
): Readonly<{ id: string; side: Side }> | null => {
  const eligible: Array<{ candidate: RefillCandidate; side: Side }> = [];
  for (const candidate of candidates) {
    if (candidate.hasCard || !candidate.visible) continue;
    if (candidate.projectedX === null || candidate.projectedY === null) continue;
    if (candidate.dot < REFILL_MIN_DOT) continue;
    if (candidate.projectedX >= globeCenterX && candidate.dot < REFILL_MIN_DOT_RIGHT_HALF) {
      continue;
    }
    if (candidate.lastShownAt !== null && now - candidate.lastShownAt < RESHOW_COOLDOWN_MS) {
      continue;
    }
    const preferred = preferredSideFor(candidate.projectedX, globeCenterX);
    // 尻尾 (ピンとの隙間) の分も見積もりサイズに含める (BUBBLE_GAP_PX 分だけ縦に拡張)。
    const placement = placeBubble(
      candidate.projectedX,
      candidate.projectedY,
      { width: ESTIMATED_BUBBLE_W, height: ESTIMATED_BUBBLE_H + BUBBLE_GAP_PX },
      BUBBLE_GAP_PX,
      overlaySize,
      existingRects,
      preferred,
    );
    if (!placement) continue;
    eligible.push({ candidate, side: placement.side });
  }
  if (eligible.length === 0) return null;

  const best = [...eligible].sort((a, b) => b.candidate.createdAt - a.candidate.createdAt)[0];
  return best ? { id: best.candidate.id, side: best.side } : null;
};

/**
 * 現在の状態からリフィル (空き枠への補充) を試みてよいかどうかを判定する純粋関数。
 * ピンをクリックして 1 件を強調表示している間 (`ambientEnabled: false`) はアンビエントな
 * 補充を止め、他の吹き出しが勝手に増えないようにする (自転が再開するまで)。
 * それ以外は通常どおり、枠が埋まっていなければ補充してよい。
 */
export const shouldRefill = (
  ambientEnabled: boolean,
  entriesCount: number,
  maxBubbles: number = MAX_BUBBLES,
): boolean => ambientEnabled && entriesCount < maxBubbles;
