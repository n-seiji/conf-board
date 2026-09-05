import { describe, expect, it } from "vitest";
import {
  newGopherState,
  advanceNewGopher,
  newBadgePlacement,
  dismissNewGopher,
} from "./new-gopher";

describe("new Gopher warp and one-turn lifetime", () => {
  it("announces immediately, exactly once, without waiting for a rotation", () => {
    const state = newGopherState();
    expect(advanceNewGopher(state, 0)).toBe(true);
    expect(state.phase).toBe("new");
    expect(advanceNewGopher(state, 0)).toBe(false);
  });
  it("expires after one automatic turn, not paused time or manual rotation", () => {
    const state = newGopherState();
    advanceNewGopher(state, 0);
    for (let i = 0; i < 100; i++) advanceNewGopher(state, 0);
    advanceNewGopher(state, Math.PI);
    expect(state.phase).toBe("new");
    advanceNewGopher(state, Math.PI);
    expect(state.phase).toBe("done");
  });
});

describe("NEW badge placement", () => {
  it("moves to the callout and back without restarting its lifetime", () => {
    const state = newGopherState();
    advanceNewGopher(state, 0);
    expect(newBadgePlacement(state, false)).toBe("head");
    advanceNewGopher(state, Math.PI);
    expect(newBadgePlacement(state, true)).toBe("callout");
    expect(newBadgePlacement(state, false)).toBe("head");
    advanceNewGopher(state, Math.PI);
    expect(newBadgePlacement(state, true)).toBe("none");
    expect(newBadgePlacement(state, false)).toBe("none");
  });

  it("does not label snapshots, removed posts, or models still loading", () => {
    expect(newBadgePlacement(null, true)).toBe("none");
    expect(newBadgePlacement(null, false)).toBe("none");
    expect(newBadgePlacement(newGopherState(), true)).toBe("none");
  });
});

it("dismisses NEW permanently on selection, including the callout", () => {
  const state = newGopherState();
  advanceNewGopher(state, 0);
  dismissNewGopher(state);
  expect(newBadgePlacement(state, false)).toBe("none");
  expect(newBadgePlacement(state, true)).toBe("none");
  expect(advanceNewGopher(state, 0)).toBe(false);
});
