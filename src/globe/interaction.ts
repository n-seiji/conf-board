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
 * マッピングはドラッグと同じだが、誤操作で回りすぎないよう `WHEEL_SCALE` で減衰する。
 */
export const wheelDeltaToRotation = (
  deltaX: number,
  deltaY: number,
  globeDiameterPx: number,
): DragRotation => {
  const base = dragDeltaToRotation(deltaX, deltaY, globeDiameterPx);
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
}>;

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

  const onPointerDown = (event: PointerEvent): void => {
    dragging = true;
    downX = event.clientX;
    downY = event.clientY;
    lastX = event.clientX;
    lastY = event.clientY;
    pickedAtDown = handlers.pickPinAt(downX, downY);
    // 指/マウスが触れた瞬間に自転を止める (pointerup まで待つと動いてしまうため)。
    handlers.onActivity();
    // 合成イベントや一部ブラウザでは有効なポインタが無く例外になるため、失敗しても続行する。
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // キャプチャ無しでも要素上のドラッグは動くので無視する
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
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
    if (!dragging) return;
    dragging = false;
    if (isClick(downX, downY, event.clientX, event.clientY) && pickedAtDown) {
      handlers.onPinPicked(pickedAtDown);
    }
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
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
