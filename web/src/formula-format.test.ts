import { describe, expect, it } from "vitest";

import { formatFormulaText } from "./formula-format.js";

describe("formatFormulaText", () => {
  it("canonicalizes malformed grouping within formulas", () => {
    expect(formatFormulaText("12,34 + salary")).toBe("1,234 + salary");
  });

  it("preserves transient decimal input", () => {
    expect(formatFormulaText("1.")).toBe("1.");
    expect(formatFormulaText(".5")).toBe(".5");
  });

  it("keeps regrouping consistent while typing into formatted content", () => {
    let formula = "";

    for (const character of "900000000") {
      formula = formatFormulaText(`${formula}${character}`);
    }

    expect(formula).toBe("900,000,000");
  });
});
