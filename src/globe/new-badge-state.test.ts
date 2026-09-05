import { describe, expect, it } from "vitest";
import {
  createNewBadgeState,
  advanceNewBadge,
  newBadgePlacement,
  dismissNewBadge,
} from "./new-badge-state";

describe("new Gopher warp and one-turn lifetime", () => {
  it("announces immediately, exactly once, without waiting for a rotation", () => {
    const state = createNewBadgeState();
    expect(advanceNewBadge(state, 0)).toBe(true);
    expect(state.phase).toBe("new");
    expect(advanceNewBadge(state, 0)).toBe(false);
  });
  it("expires after one automatic turn, not paused time or manual rotation", () => {
    const state = createNewBadgeState();
    advanceNewBadge(state, 0);
    for (let i = 0; i < 100; i++) advanceNewBadge(state, 0);
    advanceNewBadge(state, Math.PI);
    expect(state.phase).toBe("new");
    advanceNewBadge(state, Math.PI);
    expect(state.phase).toBe("done");
  });
});

describe("NEW badge placement", () => {
  it("moves to the callout and back without restarting its lifetime", () => {
    const state = createNewBadgeState();
    advanceNewBadge(state, 0);
    expect(newBadgePlacement(state, false)).toBe("head");
    advanceNewBadge(state, Math.PI);
    expect(newBadgePlacement(state, true)).toBe("callout");
    expect(newBadgePlacement(state, false)).toBe("head");
    advanceNewBadge(state, Math.PI);
    expect(newBadgePlacement(state, true)).toBe("none");
    expect(newBadgePlacement(state, false)).toBe("none");
  });

  it("does not label snapshots, removed posts, or models still loading", () => {
    expect(newBadgePlacement(null, true)).toBe("none");
    expect(newBadgePlacement(null, false)).toBe("none");
    expect(newBadgePlacement(createNewBadgeState(), true)).toBe("none");
  });
});

it("dismisses NEW permanently on selection, including the callout", () => {
  const state = createNewBadgeState();
  advanceNewBadge(state, 0);
  dismissNewBadge(state);
  expect(newBadgePlacement(state, false)).toBe("none");
  expect(newBadgePlacement(state, true)).toBe("none");
  expect(advanceNewBadge(state, 0)).toBe(false);
});
