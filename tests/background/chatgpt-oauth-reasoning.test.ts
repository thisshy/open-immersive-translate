import { describe, expect, it } from "vitest";

import {
  EFFORT_LADDER,
  clampEffort,
  supportedEfforts,
} from "../../src/background/services/chatgpt-oauth/reasoning";
import type { ReasoningEffort } from "../../src/shared/types";

describe("ChatGPT reasoning effort", () => {
  const legacyExpected: Record<ReasoningEffort, ReasoningEffort> = {
    none: "none",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "xhigh",
  };

  const matrix = [
    ...EFFORT_LADDER.map(
      (level) => [level, "gpt-5.5", legacyExpected[level]] as const,
    ),
    ...EFFORT_LADDER.map((level) => [level, "gpt-5.6-sol", level] as const),
    ...["gpt-6-sol", "gpt-6-luna"].flatMap((model) =>
      EFFORT_LADDER.map((level) => [level, model, level] as const),
    ),
    ...["gpt-6.1-sol", "gpt-6-astra"].flatMap((model) =>
      EFFORT_LADDER.map(
        (level) => [level, model, level === "none" ? "low" : level] as const,
      ),
    ),
    ...EFFORT_LADDER.map(
      (level) => [level, "gpt-5.4-mini", legacyExpected[level]] as const,
    ),
    ...EFFORT_LADDER.map(
      (level) => [level, "unknown-model", legacyExpected[level]] as const,
    ),
  ];

  it.each(matrix)("clamps %s for %s to %s", (level, model, expected) => {
    expect(clampEffort(level, model)).toBe(expected);
  });

  it("exposes max for current models and requires reasoning on Sol 6.1 and Astra", () => {
    expect(supportedEfforts("gpt-5.6-terra")).toContain("max");
    expect(supportedEfforts("gpt-6.1-sol")).toContain("max");
    expect(supportedEfforts("gpt-6.1-sol")).not.toContain("none");
    expect(supportedEfforts("gpt-6-astra")).not.toContain("none");
    expect(supportedEfforts("gpt-6-luna")).toContain("none");
    expect(supportedEfforts("gpt-5.5")).not.toContain("max");
  });
});
