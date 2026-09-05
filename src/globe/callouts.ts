import { pinColorHex } from "../shared/colors";
import type { Post } from "../shared/types";
import {
  BUBBLE_GAP_PX,
  ESTIMATED_BUBBLE_H,
  ESTIMATED_BUBBLE_W,
  MAX_BUBBLES,
  OVERLAP_MARGIN_PX,
  type Rect,
  type RefillCandidate,
  type Side,
  expandRect,
  pickOverlapLoser,
  pickRefillCandidate,
  placeBubble,
  preferredSideFor,
  rectForSide,
  rectsIntersect,
  shouldEndCallout,
  shouldRefill,
  toOverlaySpace,
} from "./callout-layout";
import type { GlobeHandle } from "./index";

/**
 * 吹き出しの最大寿命 (ms)。通常は「非表示になった」「dot が閾値を割った」タイミングで
 * fadeOutAndRemove するが、それが何らかの理由で効かなかった場合の安全弁として、
 * 左縁で出た吹き出しが右側で消えるまで (半周弱 ≈ 20 秒) + 余裕分で 30 秒に設定している。
 */
const MAX_LIFETIME_MS = 30_000;
const HIDE_TRANSITION_MS = 200;
/** リフィル (空いた枠への補充) を試みる間隔 (ms)。 */
const REFILL_INTERVAL_MS = 250;

type CalloutEntry = {
  readonly id: string;
  readonly createdAt: number;
  readonly shownAt: number;
  readonly card: HTMLDivElement;
  readonly newBadge: HTMLSpanElement;
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
  /**
   * `exceptId` 以外の全ての吹き出しをフェードアウトさせる。ピンをクリックした瞬間に、
   * 選んだピン以外の吹き出しを即座に閉じるために使う (`display/main.ts` から呼ぶ)。
   */
  closeAllExcept: (exceptId: string) => void;
  /**
   * アンビエントな自動補充 (`REFILL_INTERVAL_MS` ごとの空き枠補充) の有効/無効を切り替える。
   * false にすると新規の補充を止める (既存の吹き出しは触らない)。ピン選択中は false にし、
   * 自転が再開したら true に戻す想定 (`display/main.ts` の `onAutoRotateChange` 参照)。
   */
  setAmbientEnabled: (enabled: boolean) => void;
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
 *   `pickRefillCandidate` (`./callout-layout`) で選んだものを 1 件ずつ補充する
 *   (優先は投稿の新しい順。ただし直近で消えたばかりのピンはクールダウン中として除外し、
 *   既存の吹き出しと重ならないものだけを選ぶ)。
 * - 吹き出しはピンが非表示になるか `END_DOT` を割ったら消える。
 * - 毎フレーム、吹き出し同士が重なったら基本は `shownAt` が古い方を消すが、補充直後
 *   (`MIN_AGE_BEFORE_OVERLAP_REMOVE_MS` 未満) の吹き出しは保護し、その場合は
 *   後から重なりに入り込んできた古い方を消す (`pickOverlapLoser`)。
 *
 * 配置計算 (矩形計算・重なり判定・リフィル候補選択) は `./callout-layout` の
 * DOM 非依存な純粋関数群に切り出してあり、ここでは DOM 管理のみを行う。
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
  /** false の間はアンビエント補充を止める (`setAmbientEnabled` 参照)。 */
  let ambientEnabled = true;

  const removeEntry = (entry: CalloutEntry): void => {
    if (entry.fadeTimer) clearTimeout(entry.fadeTimer);
    if (entry.hideTimer) clearTimeout(entry.hideTimer);
    entry.card.remove();
    globe.setNewBadgeCallout(entry.id, false);
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

  const closeAllExcept = (exceptId: string): void => {
    for (const entry of [...entries.values()]) {
      if (entry.id !== exceptId && !entry.hideTimer) fadeOutAndRemove(entry);
    }
  };

  const setAmbientEnabled = (enabled: boolean): void => {
    ambientEnabled = enabled;
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
  const positionCard = (
    entry: CalloutEntry,
    pinX: number,
    pinY: number,
    overlayRect: Rect,
  ): void => {
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
    const newBadge = document.createElement("span");
    newBadge.className = "callout-card__new";
    newBadge.textContent = "NEW";
    newBadge.hidden = !globe.setNewBadgeCallout(post.id, true);
    card.appendChild(newBadge);
    card.classList.add(`callout-card--${side}`);
    overlay.appendChild(card);

    const entry: CalloutEntry = {
      id: post.id,
      createdAt: post.createdAt,
      shownAt: Date.now(),
      card,
      newBadge,
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
      positionCard(entry, pin.x, pin.y, overlayRect);
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

  /** 現在の吹き出しの矩形一覧 (overlay 基準)。既存カードと重ならない配置先を選ぶのに使う。 */
  const currentRects = (): Rect[] =>
    [...entries.values()].map(rectOf).filter((rect): rect is Rect => rect !== null);

  /** 新規投稿の到着時: 強調表示の吹き出しを追加する (既存があれば入れ替える)。 */
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
    if (projected?.selected) {
      createEntry(post, true, "top");
      return;
    }
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
    if (!shouldRefill(ambientEnabled, entries.size, MAX_BUBBLES)) return;
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
      // フェード中も期限を同期し、実際にカードを外すまで頭上には戻さない。
      entry.newBadge.hidden = !globe.setNewBadgeCallout(entry.id, true);
      // すでにフェードアウト中 (hideTimer 予約済み) なら、そのタイマーに任せて何もしない。
      if (entry.hideTimer) continue;

      const projected = globe.projectPin(entry.id);
      const visible = !!projected?.visible;

      if (!projected || shouldEndCallout(projected.dot, visible)) {
        fadeOutAndRemove(entry);
        continue;
      }

      const pin = toOverlaySpace(projected.x, projected.y, globeRect, overlayRect);
      positionCard(entry, pin.x, pin.y, overlayRect);
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

  return {
    addCallout,
    trackPost,
    syncPosts,
    removeCallout,
    clearAll,
    closeAllExcept,
    setAmbientEnabled,
    dispose,
  };
};
