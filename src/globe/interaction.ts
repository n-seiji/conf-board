/**
 * ディスプレイ画面での地球のドラッグ/ホイール操作とピンのクリック判定を扱うモジュール。
 * DOM/イベントに依存しない純粋関数群と、それらを実際の pointer/wheel イベントに
 * 結びつける `bindGlobeInteraction` だけを持つ (three.js には依存しない)。
 */

/** ドラッグ量からの回転量への変換 (dx/dy → spin/tilt)。 */
export type DragRotation = Readonly<{ spin: number; tilt: number }>;

/** ホイール操作の回転感度 (ドラッグ換算に対する倍率)。トラックパッドの慣性量に合わせて控えめにする。 */
const WHEEL_SCALE = 0.6;

/**
 * ドラッグ量 (px) を回転量 (rad) に変換する。
 * 「球の直径ぶんドラッグすると半周 (π rad) 回る」を基準の感度とする。
 * - 横方向 (dx): 右にドラッグすると spin が正方向 (= 自転と同じ符号、`rig.tick` の
 *   `+= angularSpeed * dtSeconds` で「表面が左→右に流れる」向き) に増え、地表が
 *   指の動きに追随して右へ流れて見える。
 * - 縦方向 (dy): 下にドラッグすると tilt (`tiltGroup.rotation.x`) が正方向に増える。
 *   `rig.ts` では tiltGroup.rotation.x は緯度 (`(lat * Math.PI) / 180`) に対応し、
 *   正の値は北半球 (球上部) をカメラに近づける向きなので、下ドラッグで
 *   「球の上側が手前に傾く」操作感になる。
 */
export const dragDeltaToRotation = (
  dxPx: number,
  dyPx: number,
  globeDiameterPx: number,
): DragRotation => {
  const diameter = globeDiameterPx > 0 ? globeDiameterPx : 1;
  return {
    spin: (dxPx / diameter) * Math.PI,
    tilt: (dyPx / diameter) * Math.PI,
  };
};

/**
 * ホイール/トラックパッドスクロール量 (px 相当) を回転量に変換する。
 * マッピングの向きはドラッグの逆になる。macOS の「ナチュラルスクロール」では、
 * 2本指で右方向にスワイプすると `deltaX` は負の値で届く (コンテンツを指で押し出す
 * 感覚のため)。ドラッグと同じ「指の動きに表面が追随する」操作感にするには、
 * その符号を反転させて `dragDeltaToRotation` に渡す必要がある
 * (反転しないと、右にスワイプしたのに表面が左に流れる「感覚と真逆」の動きになる)。
 * マッピングの大きさはドラッグと同じだが、誤操作で回りすぎないよう `WHEEL_SCALE` で減衰する。
 */
export const wheelDeltaToRotation = (
  deltaX: number,
  deltaY: number,
  globeDiameterPx: number,
): DragRotation => {
  const base = dragDeltaToRotation(-deltaX, -deltaY, globeDiameterPx);
  return { spin: base.spin * WHEEL_SCALE, tilt: base.tilt * WHEEL_SCALE };
};

/** pointerdown から pointerup までの移動量が小さければ「クリック (ピン選択)」とみなす。 */
export const isClick = (
  downX: number,
  downY: number,
  upX: number,
  upY: number,
  maxDistancePx = 6,
): boolean => {
  const dx = upX - downX;
  const dy = upY - downY;
  return Math.sqrt(dx * dx + dy * dy) <= maxDistancePx;
};

export type IdleResumeHandle = Readonly<{
  /** 操作があるたびに呼ぶ。初回呼び出しで `onPause` を一度だけ発火し、以後の呼び出しでアイドルタイマーを再始動する。 */
  touch: () => void;
  /** タイマーを破棄する (アンバインド時に呼ぶ)。 */
  dispose: () => void;
}>;

/**
 * 「操作中は自転を止め、`idleMs` 操作が無ければ自転を再開する」ための状態機械。
 * `touch()` は pointermove/wheel のたびに呼ぶ。最初の `touch()` でだけ `onPause` を呼び、
 * 以後は `idleMs` 経過ごとに `onResume` を呼ぶ (呼んだ後は次の `touch()` でまた一時停止状態に戻る)。
 */
export const createIdleResume = (
  onPause: () => void,
  onResume: () => void,
  idleMs = 5000,
): IdleResumeHandle => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let paused = false;

  const touch = (): void => {
    if (!paused) {
      paused = true;
      onPause();
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      paused = false;
      timer = null;
      onResume();
    }, idleMs);
  };

  const dispose = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return { touch, dispose };
};

/** `nearestPinWithin` に渡す画面上のピン候補。 */
export type PinScreenCandidate = Readonly<{
  id: string;
  x: number;
  y: number;
  visible: boolean;
}>;

/**
 * 画面座標 (px, y-down) 上のピン候補から、指定座標に最も近いものを選ぶ純粋関数。
 * `visible: false` (裏側) の候補は無視し、`radiusPx` を超える距離のものも無視する。
 * ピンの見た目 (現在は 3D コーン、将来的にキャラクター glTF に差し替え予定) に依存せず、
 * かつタッチ操作でも押しやすいよう画面上の距離だけで判定する。
 */
/**
 * 線分 AB 上で点 P に最も近い点を返す純粋関数。ピンは画面上では「先端 (球面上の点) から
 * 頭までの線分」として見えるので、クリック位置とこの線分の距離でピンを選ぶのに使う
 * (縁に立つピンは頭が先端から大きく突き出すため、先端だけで判定すると頭を押しても外れる)。
 */
export const closestPointOnSegment = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): Readonly<{ x: number; y: number }> => {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq === 0) return { x: ax, y: ay };
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSq));
  return { x: ax + abx * t, y: ay + aby * t };
};

export const nearestPinWithin = (
  candidates: readonly PinScreenCandidate[],
  px: number,
  py: number,
  radiusPx: number,
): string | null => {
  let bestId: string | null = null;
  let bestDistSq = radiusPx * radiusPx;
  for (const candidate of candidates) {
    if (!candidate.visible) continue;
    const dx = candidate.x - px;
    const dy = candidate.y - py;
    const distSq = dx * dx + dy * dy;
    if (distSq <= bestDistSq) {
      bestDistSq = distSq;
      bestId = candidate.id;
    }
  }
  return bestId;
};

export type GlobeInteractionHandlers = Readonly<{
  /** 手動回転を適用する (rig.rotateBy への橋渡し)。 */
  rotateBy: (spin: number, tilt: number) => void;
  /** クライアント座標 (px) にあるピンの id を返す (無ければ null)。 */
  pickPinAt: (clientX: number, clientY: number) => string | null;
  /** ピンがクリックで選ばれたときに呼ぶ。 */
  onPinPicked: (id: string) => void;
  /** 現在の球の直径 (px) を返す。 */
  diameterPx: () => number;
  /** ドラッグ/ホイール操作があるたびに呼ぶ (自転の一時停止/再開の起点)。 */
  onActivity: () => void;
  /** ズーム倍率に `factor` を掛ける (`index.ts` の `setZoom(zoom * factor)` への橋渡し)。 */
  zoomBy: (factor: number) => void;
}>;

/**
 * トラックパッドのピンチ操作を ctrl+wheel として届ける Chrome/Safari の `deltaY` を、
 * ズーム倍率の乗数に変換する純粋関数。指を広げる (ズームイン) と `deltaY` は負になるため、
 * その場合は `factor > 1` (拡大) を返す。
 */
const PINCH_SENSITIVITY = 0.01;
export const pinchDeltaToZoomFactor = (deltaY: number): number =>
  Math.exp(-deltaY * PINCH_SENSITIVITY);

/**
 * タッチのピンチ操作 (2本指の距離の変化) をズーム倍率の乗数に変換する純粋関数。
 * 前回の距離に対する今回の距離の比をそのまま倍率として使う
 * (指が離れる = 距離が伸びる = 拡大)。`prevDist` が 0 以下の異常値なら倍率 1 (変化なし) を返す。
 */
export const pinchZoomFactor = (prevDist: number, dist: number): number =>
  prevDist > 0 ? dist / prevDist : 1;

/** 2 点間のユークリッド距離。 */
const distanceBetween = (
  a: Readonly<{ x: number; y: number }>,
  b: Readonly<{ x: number; y: number }>,
): number => Math.hypot(b.x - a.x, b.y - a.y);

/** カーソル形状 (`[data-hover-pin]` セレクタ) の更新を rAF に合わせて間引くためのフラグ。 */
const scheduleHoverUpdate = (
  element: HTMLElement,
  handlers: GlobeInteractionHandlers,
  clientX: number,
  clientY: number,
  scheduled: { pending: boolean },
): void => {
  if (scheduled.pending) return;
  scheduled.pending = true;
  requestAnimationFrame(() => {
    scheduled.pending = false;
    const id = handlers.pickPinAt(clientX, clientY);
    if (id) {
      element.setAttribute("data-hover-pin", "");
    } else {
      element.removeAttribute("data-hover-pin");
    }
  });
};

/**
 * `element` に pointer/wheel イベントを結びつけ、ドラッグ回転・ホイール回転・
 * ピンのクリック選択・ホバーカーソルを実現する。返り値の関数を呼ぶとイベントを解除する。
 */
export const bindGlobeInteraction = (
  element: HTMLElement,
  handlers: GlobeInteractionHandlers,
): (() => void) => {
  element.style.touchAction = "none";

  let dragging = false;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;
  /**
   * pointerdown 時点でのピック結果。自転が続いているとピンは pointerdown〜pointerup の
   * 間にも画面上を移動するため、pointerup 時点で再ピックすると (特に自転が速く見える
   * ケースで) 的から外れてクリック判定を取りこぼす。pointerdown の瞬間の位置で確定させ、
   * それをそのままクリック成立時に採用する。
   */
  let pickedAtDown: string | null = null;
  const hoverScheduled = { pending: false };

  /**
   * 現在押下中のポインタ (pointerId → 座標)。2 本指がそろったらピンチとみなし、
   * その間は回転もクリックも行わずズームだけを行う。1 本指に減ったら、残った指の
   * 現在位置からドラッグを再開する (瞬間移動して見えないよう `lastX/lastY` をそこに合わせる)。
   */
  const pointers = new Map<number, Readonly<{ x: number; y: number }>>();
  let pinching = false;
  let prevPinchDist = 0;

  const onPointerDown = (event: PointerEvent): void => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // 合成イベントや一部ブラウザでは有効なポインタが無く例外になるため、失敗しても続行する。
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // キャプチャ無しでも要素上のドラッグは動くので無視する
    }

    if (pointers.size === 2) {
      dragging = false;
      pinching = true;
      const [p1, p2] = [...pointers.values()];
      if (p1 && p2) prevPinchDist = distanceBetween(p1, p2);
      handlers.onActivity();
      return;
    }
    if (pointers.size !== 1 || pinching) return;

    dragging = true;
    downX = event.clientX;
    downY = event.clientY;
    lastX = event.clientX;
    lastY = event.clientY;
    pickedAtDown = handlers.pickPinAt(downX, downY);
    // 指/マウスが触れた瞬間に自転を止める (pointerup まで待つと動いてしまうため)。
    handlers.onActivity();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pointers.has(event.pointerId)) {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (pinching) {
      if (pointers.size < 2) return;
      const [p1, p2] = [...pointers.values()];
      if (!p1 || !p2) return;
      const dist = distanceBetween(p1, p2);
      handlers.zoomBy(pinchZoomFactor(prevPinchDist, dist));
      prevPinchDist = dist;
      handlers.onActivity();
      return;
    }

    if (dragging) {
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      const { spin, tilt } = dragDeltaToRotation(dx, dy, handlers.diameterPx());
      handlers.rotateBy(spin, tilt);
      handlers.onActivity();
      return;
    }
    scheduleHoverUpdate(element, handlers, event.clientX, event.clientY, hoverScheduled);
  };

  const onPointerUp = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);

    if (pinching) {
      if (pointers.size >= 2) return; // まだ 2 本以上残っている (3本指以上だった場合)
      pinching = false;
      const [remaining] = [...pointers.values()];
      if (remaining) {
        // 残った指でドラッグを継続する。瞬間移動を避けるため現在位置を基準にし直す。
        dragging = true;
        downX = remaining.x;
        downY = remaining.y;
        lastX = remaining.x;
        lastY = remaining.y;
        pickedAtDown = null; // ピンチ直後の指上げをクリックとして誤検出しない
      }
      return;
    }

    if (!dragging) return;
    dragging = false;
    if (isClick(downX, downY, event.clientX, event.clientY) && pickedAtDown) {
      handlers.onPinPicked(pickedAtDown);
    }
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    // Chrome/Safari はトラックパッドのピンチ操作を ctrl+wheel として届ける
    // (物理的な ctrl キー押下と区別できないが、実用上はピンチとして扱って問題ない)。
    // マウスの ctrl+ホイールでも同様にズームとして扱う。
    if (event.ctrlKey) {
      handlers.zoomBy(pinchDeltaToZoomFactor(event.deltaY));
      handlers.onActivity();
      return;
    }
    const { spin, tilt } = wheelDeltaToRotation(event.deltaX, event.deltaY, handlers.diameterPx());
    handlers.rotateBy(spin, tilt);
    handlers.onActivity();
  };

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("pointercancel", onPointerUp);
  element.addEventListener("wheel", onWheel, { passive: false });

  return (): void => {
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", onPointerUp);
    element.removeEventListener("pointercancel", onPointerUp);
    element.removeEventListener("wheel", onWheel);
  };
};
