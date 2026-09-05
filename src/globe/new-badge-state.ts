export type NewBadgeState = {
  phase: "pending" | "new" | "done";
  remaining: number;
};

export const createNewBadgeState = (): NewBadgeState => ({
  phase: "pending",
  remaining: Math.PI * 2,
});

/** Both renderers share the same lifetime; moving a label never extends it. */
export const newBadgePlacement = (
  state: NewBadgeState | null,
  calloutVisible: boolean,
): "head" | "callout" | "none" =>
  state?.phase === "new" ? (calloutVisible ? "callout" : "head") : "none";

/** Returns true exactly once on the first update after the model is ready. */
export const advanceNewBadge = (state: NewBadgeState, autoRotation: number): boolean => {
  if (state.phase === "pending") {
    state.phase = "new";
    return true;
  }
  if (state.phase === "new") {
    state.remaining = Math.max(0, state.remaining - Math.max(0, autoRotation));
    if (state.remaining <= 1e-8) state.phase = "done";
  }
  return false;
};

/** Selection acknowledges the post; NEW must not return after its callout closes. */
export const dismissNewBadge = (state: NewBadgeState): void => {
  state.phase = "done";
  state.remaining = 0;
};
