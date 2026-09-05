import { pinColorHex } from "../shared/colors";
import type { Post } from "../shared/types";
import type { GlobeHandle } from "./index";

const MAX_PER_COLUMN = 3;
const FADE_OUT_MS = 20_000;
const HIDE_TRANSITION_MS = 200;
/** 球の左右端から吹き出しを離すマージン (px)。 */
const COLUMN_MARGIN = 40;
/** 同じ列内のカード間の隙間 (px)。 */
const COLUMN_GAP = 14;

export type Rect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

/**
 * globe コンテナ (globeWrap) 基準のピン座標を、overlay (stage 全体) 基準の座標に変換する。
 * `projectPin` は globeWrap 基準、吹き出しカードと SVG は overlay (stage) 基準なので、
 * globeWrap が stage 内でオフセットしている分 (見出し用の余白などによる) を補正しないと
 * リーダー線の端点がピンの位置からずれる。
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
 * ピンの画面 x 座標 (globeWrap ローカル座標、0..globeWidth) から左右どちらの列に
 * 振り分けるかを決める。`projectPin` はローカル座標を返すので、比較もローカル座標の
 * 中心 (globeWidth/2) に対して行う (ビューポート座標の中心と比べると常に左列判定になる)。
 * projectedX が null (ピンが見つからない等) なら左列にフォールバックする。
 */
export const decideColumn = (projectedX: number | null, globeWidth: number): "left" | "right" =>
  projectedX === null || projectedX <= globeWidth / 2 ? "left" : "right";

/** ピン座標からカードの近い辺の中点まで、水平→斜めに1回折れるリーダー線の path を作る。 */
export const buildLeaderPath = (
  pinX: number,
  pinY: number,
  anchorX: number,
  anchorY: number,
): string => {
  const midX = (pinX + anchorX) / 2;
  return `M ${pinX} ${pinY} L ${midX} ${pinY} L ${anchorX} ${anchorY}`;
};

type CalloutEntry = {
  readonly id: string;
  readonly column: "left" | "right";
  readonly card: HTMLDivElement;
  readonly leader: SVGPathElement;
  fadeTimer: ReturnType<typeof setTimeout> | null;
  /** フェードアウト CSS 完了後に removeEntry するための内側の setTimeout。 */
  hideTimer: ReturnType<typeof setTimeout> | null;
  hiddenForBackside: boolean;
};

export type CalloutsHandle = Readonly<{
  /** 投稿の吹き出しを追加する。既存の同じ列の吹き出しは繰り上がり、4件目は消える。 */
  addCallout: (post: Post) => void;
  /** id の吹き出しがあれば即座に取り除く (投稿削除時に呼ぶ)。 */
  removeCallout: (id: string) => void;
  /** 全ての吹き出しを即座に取り除く (snapshot 置換・reset 時に呼ぶ)。 */
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
 * HTML 吹き出し + SVG リーダー線のオーバーレイ管理。
 * globe の `onFrame`/`projectPin` を使い、毎フレームリーダー線の位置だけを更新する
 * (カード・線の再レイアウト自体は追加・削除・コンテナのリサイズ時のみ行う)。
 */
export const createCallouts = (
  container: HTMLElement,
  svg: SVGSVGElement,
  globe: GlobeHandle,
): CalloutsHandle => {
  const overlay = document.createElement("div");
  overlay.className = "callouts-overlay";
  container.appendChild(overlay);

  const leftColumn: CalloutEntry[] = [];
  const rightColumn: CalloutEntry[] = [];
  const entries = new Map<string, CalloutEntry>();

  const columnOf = (col: "left" | "right"): CalloutEntry[] =>
    col === "left" ? leftColumn : rightColumn;

  const removeEntry = (entry: CalloutEntry): void => {
    if (entry.fadeTimer) clearTimeout(entry.fadeTimer);
    if (entry.hideTimer) clearTimeout(entry.hideTimer);
    entry.card.remove();
    entry.leader.remove();
    entries.delete(entry.id);
    const col = columnOf(entry.column);
    const idx = col.indexOf(entry);
    if (idx >= 0) col.splice(idx, 1);
    layoutColumn(entry.column);
  };

  const removeCallout = (id: string): void => {
    const entry = entries.get(id);
    if (entry) removeEntry(entry);
  };

  const clearAll = (): void => {
    for (const entry of [...entries.values()]) removeEntry(entry);
  };

  const scheduleFade = (entry: CalloutEntry): void => {
    if (entry.fadeTimer) clearTimeout(entry.fadeTimer);
    entry.fadeTimer = setTimeout(() => {
      entry.card.classList.add("callout-card--fade-out");
      entry.hideTimer = setTimeout(() => removeEntry(entry), HIDE_TRANSITION_MS);
    }, FADE_OUT_MS);
  };

  const layoutColumn = (column: "left" | "right"): void => {
    const col = columnOf(column);
    if (col.length === 0) return;
    const globeRect = globe.getBounds();
    const overlayRect = overlay.getBoundingClientRect();
    const centerY = globeRect.top + globeRect.height / 2 - overlayRect.top;

    const heights = col.map((entry) => entry.card.offsetHeight);
    const totalHeight = heights.reduce((sum, h) => sum + h, 0) + COLUMN_GAP * (col.length - 1);
    let y = centerY - totalHeight / 2;

    for (let i = 0; i < col.length; i++) {
      const entry = col[i];
      const h = heights[i];
      if (!entry || h === undefined) continue;
      entry.card.style.top = `${y}px`;
      if (column === "left") {
        const rightEdgeX = globeRect.left - COLUMN_MARGIN - overlayRect.left;
        entry.card.style.left = `${rightEdgeX - entry.card.offsetWidth}px`;
      } else {
        const leftEdgeX = globeRect.right + COLUMN_MARGIN - overlayRect.left;
        entry.card.style.left = `${leftEdgeX}px`;
      }
      y += h + COLUMN_GAP;
    }
  };

  const layoutBothColumns = (): void => {
    layoutColumn("left");
    layoutColumn("right");
  };

  const addCallout = (post: Post): void => {
    if (entries.has(post.id)) return;
    const projected = globe.projectPin(post.id);
    const globeRect = globe.getBounds();
    const column = decideColumn(projected?.x ?? null, globeRect.width);
    const col = columnOf(column);

    for (const existing of col) {
      existing.card.classList.remove("callout-card--latest");
      existing.leader.classList.remove("callout-leader--latest");
    }

    while (col.length >= MAX_PER_COLUMN) {
      const oldest = col[col.length - 1];
      if (!oldest) break;
      removeEntry(oldest);
    }

    const card = createCard(post, true);
    card.classList.add(`callout-card--${column}`);
    overlay.appendChild(card);

    const leader = document.createElementNS("http://www.w3.org/2000/svg", "path");
    leader.setAttribute("class", "callout-leader callout-leader--latest");
    svg.appendChild(leader);

    const entry: CalloutEntry = {
      id: post.id,
      column,
      card,
      leader,
      fadeTimer: null,
      hideTimer: null,
      hiddenForBackside: false,
    };
    entries.set(post.id, entry);
    col.unshift(entry);
    scheduleFade(entry);
    layoutColumn(column);
  };

  const updateLeaderPath = (entry: CalloutEntry, pinX: number, pinY: number): void => {
    const cardRect = entry.card.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    // globe.projectPin は globe コンテナ (globeWrap) 基準の座標を返すが、
    // 吹き出しカードと SVG (leader line) は overlay (stage 全体) 基準なので、
    // globeWrap が stage 内でオフセットしている分 (見出し分の余白など) を補正する。
    const globeRect = globe.getBounds();
    const pin = toOverlaySpace(pinX, pinY, globeRect, overlayRect);

    const cardLeft = cardRect.left - overlayRect.left;
    const cardTop = cardRect.top - overlayRect.top;
    const cardCenterY = cardTop + cardRect.height / 2;
    const anchorX = entry.column === "left" ? cardLeft + cardRect.width : cardLeft;
    const anchorY = cardCenterY;

    entry.leader.setAttribute("d", buildLeaderPath(pin.x, pin.y, anchorX, anchorY));
  };

  const unsubscribe = globe.onFrame(() => {
    // レイアウト (getBoundingClientRect の再計算とリフロー) は追加/削除/リサイズ時だけに
    // 限定し、毎フレームはリーダー線の位置更新だけを行う (パフォーマンス対策)。
    for (const entry of entries.values()) {
      const projected = globe.projectPin(entry.id);
      if (!projected || !projected.visible) {
        if (!entry.hiddenForBackside) {
          entry.hiddenForBackside = true;
          entry.card.classList.add("callout-card--hidden");
          entry.leader.classList.add("callout-leader--hidden");
        }
        continue;
      }
      if (entry.hiddenForBackside) {
        entry.hiddenForBackside = false;
        entry.card.classList.remove("callout-card--hidden");
        entry.leader.classList.remove("callout-leader--hidden");
      }
      updateLeaderPath(entry, projected.x, projected.y);
    }
  });

  const resizeObserver = new ResizeObserver(layoutBothColumns);
  resizeObserver.observe(container);

  const dispose = (): void => {
    unsubscribe();
    resizeObserver.disconnect();
    clearAll();
    overlay.remove();
  };

  return { addCallout, removeCallout, clearAll, dispose };
};
