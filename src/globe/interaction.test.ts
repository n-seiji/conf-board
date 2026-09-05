import { describe, expect, it, vi } from "vitest";
import {
  createIdleResume,
  dragDeltaToRotation,
  isClick,
  nearestPinWithin,
  wheelDeltaToRotation,
} from "./interaction";

describe("dragDeltaToRotation", () => {
  it("球の直径ぶんドラッグすると spin が π になる", () => {
    const { spin } = dragDeltaToRotation(100, 0, 100);
    expect(spin).toBeCloseTo(Math.PI);
  });

  it("右ドラッグは正、左ドラッグは負の spin になる", () => {
    expect(dragDeltaToRotation(50, 0, 100).spin).toBeGreaterThan(0);
    expect(dragDeltaToRotation(-50, 0, 100).spin).toBeLessThan(0);
  });

  it("下ドラッグは正、上ドラッグは負の tilt になる", () => {
    expect(dragDeltaToRotation(0, 50, 100).tilt).toBeGreaterThan(0);
    expect(dragDeltaToRotation(0, -50, 100).tilt).toBeLessThan(0);
  });
});

describe("wheelDeltaToRotation", () => {
  it("ドラッグ換算に WHEEL_SCALE (0.6) を掛けた値になる", () => {
    const drag = dragDeltaToRotation(100, 40, 200);
    const wheel = wheelDeltaToRotation(100, 40, 200);
    expect(wheel.spin).toBeCloseTo(drag.spin * 0.6);
    expect(wheel.tilt).toBeCloseTo(drag.tilt * 0.6);
  });
});

describe("isClick", () => {
  it("移動距離が閾値以内ならクリックとみなす", () => {
    expect(isClick(0, 0, 3, 4, 6)).toBe(true); // 距離5
  });

  it("移動距離が閾値を超えるとドラッグとみなす", () => {
    expect(isClick(0, 0, 10, 0, 6)).toBe(false);
  });
});

describe("createIdleResume", () => {
  it("最初の touch で onPause を1度だけ呼び、idleMs 経過で onResume を呼ぶ", () => {
    vi.useFakeTimers();
    const onPause = vi.fn();
    const onResume = vi.fn();
    const handle = createIdleResume(onPause, onResume, 5000);

    handle.touch();
    expect(onPause).toHaveBeenCalledTimes(1);
    handle.touch();
    handle.touch();
    expect(onPause).toHaveBeenCalledTimes(1); // 一時停止中は再度呼ばれない

    vi.advanceTimersByTime(4999);
    expect(onResume).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onResume).toHaveBeenCalledTimes(1);

    handle.touch();
    expect(onPause).toHaveBeenCalledTimes(2); // resume 後の touch で再度 pause する

    handle.dispose();
    vi.useRealTimers();
  });

  it("dispose 後はタイマーが発火しない", () => {
    vi.useFakeTimers();
    const onPause = vi.fn();
    const onResume = vi.fn();
    const handle = createIdleResume(onPause, onResume, 1000);
    handle.touch();
    handle.dispose();
    vi.advanceTimersByTime(2000);
    expect(onResume).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("nearestPinWithin", () => {
  it("複数候補があるとき最も近いものを返す", () => {
    const candidates = [
      { id: "far", x: 100, y: 0, visible: true },
      { id: "near", x: 5, y: 0, visible: true },
    ];
    expect(nearestPinWithin(candidates, 0, 0, 18)).toBe("near");
  });

  it("半径の外側にある候補は無視して null を返す", () => {
    const candidates = [{ id: "a", x: 100, y: 0, visible: true }];
    expect(nearestPinWithin(candidates, 0, 0, 18)).toBeNull();
  });

  it("visible: false の候補は無視する", () => {
    const candidates = [
      { id: "hidden", x: 2, y: 0, visible: false },
      { id: "shown", x: 10, y: 0, visible: true },
    ];
    expect(nearestPinWithin(candidates, 0, 0, 18)).toBe("shown");
  });

  it("候補が無ければ null を返す", () => {
    expect(nearestPinWithin([], 0, 0, 18)).toBeNull();
  });
});
