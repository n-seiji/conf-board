import { describe, expect, it } from "vitest";
import { MilestoneState } from "./milestone";

describe("milestone presentation", () => {
  it("unlocks at 150 and waits five seconds before showing the message", () => {
    const state = new MilestoneState();
    state.sync(149);
    expect(state.available).toBe(false);
    state.sync(150);
    state.celebrate(100);
    state.tick(5099);
    expect(state.message).toBe(false);
    state.tick(5100);
    expect(state.message).toBe(true);
    state.sync(151);
    expect(state.message).toBe(true);
  });
  it("manual toggle cancels pending transition and reset removes the button", () => {
    const state = new MilestoneState();
    state.sync(150);
    state.celebrate(0);
    state.toggle();
    expect(state.message).toBe(true);
    state.toggle();
    state.tick(6000);
    expect(state.message).toBe(false);
    state.sync(0);
    state.toggle();
    expect(state.available).toBe(false);
    expect(state.message).toBe(false);
  });
  it("snapshot unlocks without replaying the celebration", () => {
    const state = new MilestoneState();
    state.sync(180);
    state.tick(10000);
    expect(state.available).toBe(true);
    expect(state.message).toBe(false);
  });
});
