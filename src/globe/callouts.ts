import { pinColorHex } from "../shared/colors";
import type { Post } from "../shared/types";
import type { GlobeHandle } from "./index";

/** 画面上に同時に表示する吹き出しの最大数。 */
const MAX_BUBBLES = 8;
/**
 * 吹き出しの最大寿命 (ms)。通常は「非表示になった」「dot が閾値を割った」タイミングで
 * fadeOutAndRemove するが、それが何らかの理由で効かなかった場合の安全弁として、
 * 左縁で出た吹き出しが右側で消えるまで (半周弱 ≈ 20 秒) + 余裕分で 30 秒に設定している。
 */
const MAX_LIFETIME_MS = 30_000;
const HIDE_TRANSITION_MS = 200;
/** リフィル (空いた枠への補充) を試みる間隔 (ms)。 */
const REFILL_INTERVAL_MS = 250;
/** ピンが縁 (limb) に近づき、まもなく非表示になる dot。この値未満で吹き出しを終了する。 */
const END_DOT = 0.3;
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
const BUBBLE_GAP_PX = 14;
/**
 * 重なり判定・リフィル候補の事前チェックに使う吹き出しサイズの見積もり (px)。
 * 実際の2行分の吹き出し (約260x99) より小さいと、補充直後に実サイズで重なりが
 * 判定されてすぐ消えてしまう (churn) ため、余裕を持たせた値にしている。
 */
const ESTIMATED_BUBBLE_W = 260;
const ESTIMATED_BUBBLE_H = 100;
/** 吹き出し同士が接するのを避けるため、重なり判定の矩形を全方向に広げるマージン (px)。 */
const OVERLAP_MARGIN_PX = 12;
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
const rectForSide = (
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

type CalloutEntry = {
  readonly id: string;
  readonly createdAt: number;
  readonly shownAt: number;
  readonly card: HTMLDivElement;
  /** 作成時に決めた側。ピンに追従する間もずっと同じ側を使い、再判定はしない。 */
  readonly side: Side;
  fadeTimer: ReturnType<typeof setTimeout> | null;
  /** フェードアウト CSS 完了後に removeEntry するための内側の setTimeout。 */
  hideTimer: ReturnType<typeof setTimeout> | null;
  /** 初回配置後にキャッシュしたカードサイズ (毎フレーム offsetWidth/offsetHeight を読まないため)。 */
  size: { width: number; height: number } | null;
};

export type CalloutsHandle = Readonly<{
  /** 投稿の吹き出しを追加する。上限に達していれば強調無しの吹き出しのうち最も古いものが消える。到着時専用 (強調表示)。 */
  addCallout: (post: Post) => void;
  /** 投稿をプールに追加する (リフィル候補になる)。新規投稿到着時に呼ぶ。 */
  trackPost: (post: Post) => void;
  /** 投稿の集合でプールを置き換える (snapshot 反映時に呼ぶ)。存在しなくなった id のカードも消す。 */
  syncPosts: (posts: readonly Post[]) => void;
  /** id の吹き出しがあれば即座に取り除き、プールからも除く (投稿削除時に呼ぶ)。 */
  removeCallout: (id: string) => void;
  /** 全ての吹き出しとプールを即座に取り除く (reset 時に呼ぶ)。 */
  clearAll: () => void;
  dispose: () => void;
}>;

const createCard = (post: Post, isLatest: boolean): HTMLDivElement => {
  const card = document.createElement("div");
  card.className = "callout-card";
  if (isLatest) card.classList.add("callout-card--latest");
  card.style.setProperty("--callout-accent", pinColorHex(post.color));

  const nickname = document.createElement("div");
  nickname.className = "callout-card__nickname";
  nickname.textContent = post.nickname;

  const body = document.createElement("div");
  body.className = "callout-card__body";
  body.textContent = post.body;

  card.appendChild(nickname);
  card.appendChild(body);
  return card;
};

/**
 * 漫画風の吹き出し (speech bubble) オーバーレイ管理 (アンビエント方式)。
 *
 * 各吹き出しは列に属さず、対応するピンのすぐ上 (画面外にはみ出す場合は下) に
 * 毎フレーム追従して表示される。盤面は常に表側にいるピンの吹き出しを最大
 * `MAX_BUBBLES` 件まで表示し続けることを目指す:
 * - 新規投稿の到着時は `addCallout` で強調表示 (`--latest`) の吹き出しを追加する。
 * - それ以外の枠は `REFILL_INTERVAL_MS` ごとに、まだ吹き出しの無いプール内の投稿から
 *   `pickRefillCandidate` で選んだものを 1 件ずつ補充する
 *   (優先は投稿の新しい順。ただし直近で消えたばかりのピンはクールダウン中として除外し、
 *   既存の吹き出しと重ならないものだけを選ぶ)。
 * - 吹き出しはピンが非表示になるか `END_DOT` を割ったら消える。
 * - 毎フレーム、吹き出し同士が重なったら基本は `shownAt` が古い方を消すが、補充直後
 *   (`MIN_AGE_BEFORE_OVERLAP_REMOVE_MS` 未満) の吹き出しは保護し、その場合は
 *   後から重なりに入り込んできた古い方を消す (`pickOverlapLoser`)。
 *
 * globe の `onFrame`/`projectPin` を使い、毎フレーム位置更新と終了判定を行う。
 * カードサイズは初回配置後にキャッシュし (`entry.size`)、以後のフレームで
 * `getBoundingClientRect`/`offsetWidth` を読み直さない (パフォーマンス対策、リサイズ時のみ再計測)。
 */
export const createCallouts = (container: HTMLElement, globe: GlobeHandle): CalloutsHandle => {
  const overlay = document.createElement("div");
  overlay.className = "callouts-overlay";
  container.appendChild(overlay);

  const entries = new Map<string, CalloutEntry>();
  const pool = new Map<string, Post>();
  const lastShownAt = new Map<string, number>();
  let lastRefillAt = 0;

  const removeEntry = (entry: CalloutEntry): void => {
    if (entry.fadeTimer) clearTimeout(entry.fadeTimer);
    if (entry.hideTimer) clearTimeout(entry.hideTimer);
    entry.card.remove();
    entries.delete(entry.id);
    // 吹き出しが消えた時刻を記録する (RESHOW_COOLDOWN_MS の起点)。投稿自体が削除された
    // 場合は removeCallout がこの直後に消すので、クールダウン扱いにはならない。
    lastShownAt.set(entry.id, Date.now());
  };

  const removeCallout = (id: string): void => {
    const entry = entries.get(id);
    if (entry) removeEntry(entry);
    pool.delete(id);
    lastShownAt.delete(id);
  };

  const clearAll = (): void => {
    for (const entry of [...entries.values()]) removeEntry(entry);
    pool.clear();
    lastShownAt.clear();
  };

  const syncPosts = (posts: readonly Post[]): void => {
    const ids = new Set(posts.map((post) => post.id));
    pool.clear();
    for (const post of posts) pool.set(post.id, post);
    for (const id of [...entries.keys()]) {
      if (!ids.has(id)) {
        const entry = entries.get(id);
        if (entry) removeEntry(entry);
      }
    }
    for (const id of [...lastShownAt.keys()]) {
      if (!ids.has(id)) lastShownAt.delete(id);
    }
  };

  const trackPost = (post: Post): void => {
    pool.set(post.id, post);
  };

  const fadeOutAndRemove = (entry: CalloutEntry): void => {
    if (entry.fadeTimer) clearTimeout(entry.fadeTimer);
    entry.fadeTimer = null;
    entry.card.classList.add("callout-card--fade-out");
    entry.hideTimer = setTimeout(() => removeEntry(entry), HIDE_TRANSITION_MS);
  };

  /** 安全弁: MAX_LIFETIME_MS が経過してもまだ残っていればフェードアウトさせる。 */
  const scheduleFade = (entry: CalloutEntry): void => {
    if (entry.fadeTimer) clearTimeout(entry.fadeTimer);
    entry.fadeTimer = setTimeout(() => fadeOutAndRemove(entry), MAX_LIFETIME_MS);
  };

  const rectOf = (entry: CalloutEntry): Rect | null => {
    if (!entry.size) return null;
    const left = Number.parseFloat(entry.card.style.left || "0");
    const top = Number.parseFloat(entry.card.style.top || "0");
    return { left, top, width: entry.size.width, height: entry.size.height };
  };

  /**
   * ピン位置に合わせてカードの style.left/top を更新する。side は作成時に決めた
   * `entry.side` に固定し、ここでは再判定しない (毎フレーム side が変わって
   * 吹き出しが飛び回るのを防ぐため)。自由軸方向のみ overlay 内にクランプする。
   */
  const positionCard = (entry: CalloutEntry, pinX: number, pinY: number): void => {
    const overlayRect = overlay.getBoundingClientRect();
    if (!entry.size) {
      entry.size = {
        width: entry.card.offsetWidth,
        height: entry.card.offsetHeight,
      };
    }
    const rect = rectForSide(
      entry.side,
      pinX,
      pinY,
      entry.size.width,
      entry.size.height,
      BUBBLE_GAP_PX,
      overlayRect,
    );
    entry.card.style.left = `${rect.left}px`;
    entry.card.style.top = `${rect.top}px`;
  };

  const createEntry = (post: Post, isLatest: boolean, side: Side): CalloutEntry => {
    const card = createCard(post, isLatest);
    card.classList.add(`callout-card--${side}`);
    overlay.appendChild(card);

    const entry: CalloutEntry = {
      id: post.id,
      createdAt: post.createdAt,
      shownAt: Date.now(),
      card,
      side,
      fadeTimer: null,
      hideTimer: null,
      size: null,
    };
    entries.set(post.id, entry);
    scheduleFade(entry);

    const projected = globe.projectPin(post.id);
    const globeRect = globe.getBounds();
    const overlayRect = overlay.getBoundingClientRect();
    if (projected) {
      const pin = toOverlaySpace(projected.x, projected.y, globeRect, overlayRect);
      positionCard(entry, pin.x, pin.y);
    }
    return entry;
  };

  /** 上限に達している場合、強調無しの吹き出しのうち最も古いものを取り除く。 */
  const makeRoomIfFull = (): void => {
    if (entries.size < MAX_BUBBLES) return;
    const byAge = (a: CalloutEntry, b: CalloutEntry): number => a.shownAt - b.shownAt;
    const nonLatest = [...entries.values()]
      .filter((entry) => !entry.card.classList.contains("callout-card--latest"))
      .sort(byAge);
    const oldest = nonLatest[0] ?? [...entries.values()].sort(byAge)[0];
    if (oldest) removeEntry(oldest);
  };

  /** 新規投稿の到着時: 強調表示の吹き出しを追加する (既存があれば入れ替える)。 */
  /** 現在の吹き出しの矩形一覧 (overlay 基準)。既存カードと重ならない配置先を選ぶのに使う。 */
  const currentRects = (): Rect[] =>
    [...entries.values()].map(rectOf).filter((rect): rect is Rect => rect !== null);

  const addCallout = (post: Post): void => {
    pool.set(post.id, post);
    const existing = entries.get(post.id);
    if (existing) removeEntry(existing);

    for (const other of entries.values()) {
      other.card.classList.remove("callout-card--latest");
    }

    makeRoomIfFull();

    const globeRect = globe.getBounds();
    const overlayRect = overlay.getBoundingClientRect();
    const globeCenterX = globeRect.left - overlayRect.left + globeRect.width / 2;
    const projected = globe.projectPin(post.id);
    let side: Side = "right";
    if (projected) {
      const pin = toOverlaySpace(projected.x, projected.y, globeRect, overlayRect);
      const preferred = preferredSideFor(pin.x, globeCenterX);
      const placement = placeBubble(
        pin.x,
        pin.y,
        {
          width: ESTIMATED_BUBBLE_W,
          height: ESTIMATED_BUBBLE_H + BUBBLE_GAP_PX,
        },
        BUBBLE_GAP_PX,
        { width: overlayRect.width, height: overlayRect.height },
        currentRects(),
        preferred,
      );
      // どの side も既存と重なる場合は、優先 side のまま出す (重なりは resolveOverlaps に任せる)。
      side = placement?.side ?? preferred;
    }
    createEntry(post, true, side);
  };

  const refillOne = (globeRect: Rect): void => {
    if (entries.size >= MAX_BUBBLES) return;
    const overlayRect = overlay.getBoundingClientRect();
    // 候補の座標は既存の吹き出し矩形 (style.left/top = overlay 基準) と同じ座標系に揃える。
    const globeCenterX = globeRect.left - overlayRect.left + globeRect.width / 2;
    const existingRects = currentRects();

    const candidates: RefillCandidate[] = [...pool.values()].map((post) => {
      const projected = globe.projectPin(post.id);
      const pin = projected
        ? toOverlaySpace(projected.x, projected.y, globeRect, overlayRect)
        : null;
      return {
        id: post.id,
        createdAt: post.createdAt,
        projectedX: pin?.x ?? null,
        projectedY: pin?.y ?? null,
        visible: !!projected?.visible,
        dot: projected?.dot ?? -1,
        hasCard: entries.has(post.id),
        lastShownAt: lastShownAt.get(post.id) ?? null,
      };
    });

    const chosen = pickRefillCandidate(
      candidates,
      globeCenterX,
      { width: overlayRect.width, height: overlayRect.height },
      existingRects,
      Date.now(),
    );
    if (!chosen) return;
    const post = pool.get(chosen.id);
    if (!post) return;

    createEntry(post, false, chosen.side);
  };

  /**
   * 重なっている吹き出しのうち、`pickOverlapLoser` が選んだ方を消す。
   * 補充直後 (`MIN_AGE_BEFORE_OVERLAP_REMOVE_MS` 未満) の吹き出しは保守的な見積もりで
   * 重ならない位置に置かれたばかりのはずなので保護し、後から重なりに入り込んできた
   * 古い方を代わりに消す (churn 防止)。
   */
  const resolveOverlaps = (): void => {
    const now = Date.now();
    const list = [...entries.values()].filter((entry) => !entry.hideTimer);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const aRect = a ? rectOf(a) : null;
      if (!a || !aRect || a.hideTimer) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const bRect = b ? rectOf(b) : null;
        if (!b || !bRect || b.hideTimer) continue;
        if (
          rectsIntersect(expandRect(aRect, OVERLAP_MARGIN_PX), expandRect(bRect, OVERLAP_MARGIN_PX))
        ) {
          fadeOutAndRemove(pickOverlapLoser(a, b, now));
        }
      }
    }
  };

  const unsubscribe = globe.onFrame((elapsedSec) => {
    const globeRect = globe.getBounds();
    const overlayRect = overlay.getBoundingClientRect();
    for (const entry of entries.values()) {
      // すでにフェードアウト中 (hideTimer 予約済み) なら、そのタイマーに任せて何もしない。
      if (entry.hideTimer) continue;

      const projected = globe.projectPin(entry.id);
      const visible = !!projected?.visible;

      if (!projected || shouldEndCallout(projected.dot, visible)) {
        fadeOutAndRemove(entry);
        continue;
      }

      const pin = toOverlaySpace(projected.x, projected.y, globeRect, overlayRect);
      positionCard(entry, pin.x, pin.y);
    }

    resolveOverlaps();

    const nowMs = elapsedSec * 1000;
    if (nowMs - lastRefillAt >= REFILL_INTERVAL_MS) {
      lastRefillAt = nowMs;
      refillOne(globeRect);
    }
  });

  const resizeObserver = new ResizeObserver(() => {
    // リサイズ時はキャッシュ済みサイズを破棄し、次フレームで再計測させる。
    for (const entry of entries.values()) entry.size = null;
  });
  resizeObserver.observe(container);

  const dispose = (): void => {
    unsubscribe();
    resizeObserver.disconnect();
    clearAll();
    overlay.remove();
  };

  return { addCallout, trackPost, syncPosts, removeCallout, clearAll, dispose };
};
