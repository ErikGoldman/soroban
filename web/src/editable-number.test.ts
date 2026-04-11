import { describe, expect, it } from "vitest";

import {
  formatEditableNumberInput,
  isEditableNumberValid,
  normalizeEditableNumberInput,
  parseEditableNumber,
  parseOptionalEditableNumber,
} from "./editable-number.js";

describe("formatEditableNumberInput", () => {
  it("adds grouping commas without rounding away entered precision", () => {
    expect(formatEditableNumberInput("1234.567")).toBe("1,234.567");
    expect(formatEditableNumberInput("0.001")).toBe("0.001");
  });

  it("preserves transient editing states", () => {
    expect(formatEditableNumberInput("")).toBe("");
    expect(formatEditableNumberInput("-")).toBe("-");
    expect(formatEditableNumberInput(".")).toBe(".");
    expect(formatEditableNumberInput("-.")).toBe("-.");
    expect(formatEditableNumberInput("1.")).toBe("1.");
  });

  it("canonicalizes malformed pasted grouping", () => {
    expect(formatEditableNumberInput("12,34,567.89")).toBe("1,234,567.89");
  });
});

describe("normalizeEditableNumberInput", () => {
  it("keeps the caret aligned when inserting at the end of a grouped value", () => {
    expect(normalizeEditableNumberInput("1234", 4)).toEqual({
      value: "1,234",
      caret: 5,
    });
  });

  it("keeps the caret aligned when editing around a comma boundary", () => {
    expect(normalizeEditableNumberInput("12,34", 4)).toEqual({
      value: "1,234",
      caret: 3,
    });
  });

  it("keeps the caret aligned when deleting digits in the middle", () => {
    expect(normalizeEditableNumberInput("1,24", 2)).toEqual({
      value: "124",
      caret: 1,
    });
  });
});

describe("parseEditableNumber", () => {
  it("parses comma-formatted values", () => {
    expect(parseEditableNumber("1,234.5")).toBe(1234.5);
  });

  it("rejects empty and transient values", () => {
    expect(parseEditableNumber("")).toBeNaN();
    expect(parseEditableNumber("-")).toBeNaN();
    expect(parseEditableNumber(".")).toBeNaN();
    expect(parseEditableNumber("-.")).toBeNaN();
  });
});

describe("parseOptionalEditableNumber", () => {
  it("allows optional blanks", () => {
    expect(parseOptionalEditableNumber("")).toBeNull();
  });
});

describe("isEditableNumberValid", () => {
  it("accepts optional blanks but rejects required blanks", () => {
    expect(isEditableNumberValid("", true)).toBe(true);
    expect(isEditableNumberValid("", false)).toBe(false);
  });
});
