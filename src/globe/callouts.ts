import { pinColorHex } from "../shared/colors";
import type { Post } from "../shared/types";
import type { GlobeHandle } from "./index";

const MAX_PER_COLUMN = 3;
/**
 * 吹き出しの最大寿命 (ms)。球は 24 秒で 1 周するので、2nd phase (裏に隠れて表に戻る) が
 * 正常なら 24 秒程度で `shouldEndSecondPhase` により片付く。これはそれが何らかの理由で
 * 効かなかった場合の安全弁で、1 周 + 余裕分として 30 秒に設定している。
 */
const MAX_LIFETIME_MS = 30_000;
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
 * 中心付近の揺れを吸収するための許容幅 (px)。中心から左にこの距離未満のピンは
 * 「ほぼ中心」とみなし、右列 (最新扱い) に倒す。
 */
export const CENTER_TOLERANCE_PX = 16;

/**
 * ピンの画面 x 座標 (globeWrap ローカル座標、0..globeWidth) から左右どちらの列に
 * 振り分けるかを決める。`projectPin` はローカル座標を返すので、比較もローカル座標の
 * 中心 (globeWidth/2) に対して行う (ビューポート座標の中心と比べると常に左列判定になる)。
 *
 * 球面は画面上で常に左→右に流れているため、到着直後のピンはこの後右へ流れていく。
 * したがって「中心から明確に左に離れている」場合だけ左列 (1 周前の投稿、これから
 * 中心に近づいてくる) とし、それ以外 (中心付近・右側・null) はすべて右列 (最新の投稿、
 * 中心から右限へ流れていく) にする。これにより到着直後の浮動小数点ノイズで列がぶれて
 * リーダー線が球を横切る問題を防ぐ。
 */
export const decideColumn = (projectedX: number | null, globeWidth: number): "left" | "right" =>
  projectedX !== null && projectedX < globeWidth / 2 - CENTER_TOLERANCE_PX ? "left" : "right";

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

/**
 * createdAt の降順 (新しい順) を保ったまま `entry` を `column` に挿入した新しい配列を返す
 * (入力配列は変更しない)。挿入位置は `entry.createdAt` に基づいて決まる。
 */
export const insertByCreatedAt = <T extends { readonly createdAt: number }>(
  column: readonly T[],
  entry: T,
): readonly T[] => {
  const idx = column.findIndex((existing) => existing.createdAt < entry.createdAt);
  const insertAt = idx === -1 ? column.length : idx;
  return [...column.slice(0, insertAt), entry, ...column.slice(insertAt)];
};

/** `column` の先頭 `max` 件を超えた分 (末尾、つまり最も古いもの) を返す。超過がなければ空配列。 */
export const overflow = <T>(column: readonly T[], max: number): readonly T[] =>
  column.length > max ? column.slice(max) : [];

/**
 * 2nd phase (裏から表に戻ってきた吹き出し) を終了させるべきかどうかを判定する。
 * 非表示になった (裏側に回った)、ピンが見つからない、または中心を超えて右半分に
 * 入った (球の右限へ流れ切った)場合に終了する。
 */
export const shouldEndSecondPhase = (
  projectedX: number | null,
  visible: boolean,
  globeWidth: number,
): boolean => !visible || projectedX === null || projectedX >= globeWidth / 2;

type CalloutEntry = {
  readonly id: string;
  readonly createdAt: number;
  column: "left" | "right";
  phase: "first" | "second";
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
 *
 * 各吹き出しは 2 つのフェーズを持つ (`CalloutEntry.phase`):
 * - "first": 到着 (中心) から裏に回るまで。右列 = 最新の投稿 (中心→右限へ流れる)。
 * - "second": 裏から表に戻ってきてから片付くまで。左列 = 1 周前の投稿
 *   (左限→中心へ流れてくる)。表面は常に左→右に流れるため、2nd phase の吹き出しは
 *   中心を通過するとすぐ右半分に入る。そこで `shouldEndSecondPhase` により
 *   「右半分に入ったら」または「再び裏に回ったら」フェードアウトさせ、リーダー線が
 *   球の反対側までずっと伸び続けるのを防いでいる。
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
      createdAt: post.createdAt,
      column,
      phase: "first",
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

  /**
   * 2nd phase で列を移動する必要が生じたエントリを、現在の列から取り除いて
   * `newColumn` に createdAt 順で挿入し直す。溢れた分 (最大件数超過) は削除する。
   */
  const moveEntry = (entry: CalloutEntry, newColumn: "left" | "right"): void => {
    const oldColArr = columnOf(entry.column);
    const idx = oldColArr.indexOf(entry);
    if (idx >= 0) oldColArr.splice(idx, 1);

    entry.card.classList.remove(`callout-card--${entry.column}`);
    entry.card.classList.add(`callout-card--${newColumn}`);
    entry.column = newColumn;

    const newColArr = columnOf(newColumn);
    const reordered = insertByCreatedAt(newColArr, entry);
    newColArr.length = 0;
    newColArr.push(...reordered);

    for (const stale of overflow(newColArr, MAX_PER_COLUMN)) {
      const staleIdx = newColArr.indexOf(stale);
      if (staleIdx >= 0) newColArr.splice(staleIdx, 1);
      removeEntry(stale);
    }

    layoutBothColumns();
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
    const globeWidth = globe.getBounds().width;
    for (const entry of entries.values()) {
      // すでにフェードアウト中 (hideTimer 予約済み) なら、そのタイマーに任せて何もしない。
      if (entry.hideTimer) continue;

      const projected = globe.projectPin(entry.id);
      const visible = !!projected?.visible;

      // 2nd phase (表に戻ってきた 1 周前の吹き出し) は、右半分に流れ切るか再び裏に
      // 回ったら片付ける。これがリーダー線が球を横切り続けるのを防ぐ本体のロジック。
      if (
        entry.phase === "second" &&
        shouldEndSecondPhase(projected?.x ?? null, visible, globeWidth)
      ) {
        fadeOutAndRemove(entry);
        continue;
      }

      if (!projected || !visible) {
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

        // 裏側から表に戻ってきた瞬間: 1st phase なら 2nd phase に移行し、
        // 到着直後の「最新」強調を外して、現在位置で列を再判定する。
        if (entry.phase === "first") {
          entry.phase = "second";
          entry.card.classList.remove("callout-card--latest");
          entry.leader.classList.remove("callout-leader--latest");
          const newColumn = decideColumn(projected.x, globeWidth);
          if (newColumn !== entry.column) moveEntry(entry, newColumn);
        }
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
