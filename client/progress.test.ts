import { describe, expect, it } from "vitest";
import type { Progress } from "../shared/rpc";
import { progressLabel, progressEvidence } from "./progress-logic";

const base: Progress = {
  kind: "estimate",
  percent: 50,
  phase: "Implementing",
  source: "checklist",
  confidence: "medium",
  detail: "1 of 2 checklist items complete",
  updatedAt: 1000,
};

describe("progress presentation", () => {
  it("labels an exact workflow position as progress rather than an estimate", () => {
    expect(
      progressLabel({
        ...base,
        kind: "exact",
        source: "workflow",
        detail: "1 of 3 children finished",
        percent: 33,
      }),
    ).toBe("33% · 1 of 3 children finished");
    expect(
      progressEvidence({ ...base, kind: "exact", source: "workflow" }),
    ).toBe("Exact · workflow");
  });
  it("labels checklist progress with its confidence and evidence source", () => {
    expect(progressLabel(base)).toBe("50% · 1 of 2 checklist items complete");
    expect(progressEvidence(base)).toBe(
      "Estimated · medium confidence · checklist",
    );
  });
  it("does not invent a percentage when no denominator exists", () => {
    const progress: Progress = {
      kind: "indeterminate",
      phase: "Exploring",
      source: "activity",
      confidence: "low",
      detail: "No reliable denominator",
    };
    expect(progressLabel(progress)).toBe("Exploring · No reliable denominator");
    expect(progressEvidence(progress)).toBe("No reliable estimate · activity");
  });
});
