export type NewGopherState = {
  phase: "pending" | "new" | "done";
  remaining: number;
};

export const newGopherState = (): NewGopherState => ({
  phase: "pending",
  remaining: Math.PI * 2,
});

/** Both renderers share the same lifetime; moving a label never extends it. */
export const newBadgePlacement = (
  state: NewGopherState | null,
  calloutVisible: boolean,
): "head" | "callout" | "none" =>
  state?.phase === "new" ? (calloutVisible ? "callout" : "head") : "none";

/** Returns true exactly once on the first update after the model is ready. */
export const advanceNewGopher = (state: NewGopherState, autoRotation: number): boolean => {
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
export const dismissNewGopher = (state: NewGopherState): void => {
  state.phase = "done";
  state.remaining = 0;
};
