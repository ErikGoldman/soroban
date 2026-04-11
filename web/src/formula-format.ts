import { formatEditableNumberInput } from "./editable-number.js";

const FORMULA_TOKEN_PATTERN = /[A-Za-z_][A-Za-z0-9_]*|[\d,]+(?:\.\d*)?|\.\d+|\s+|./g;
const FORMULA_NUMBER_PATTERN = /^[\d,]+(?:\.\d*)?$|^\.\d+$/;

export function tokenizeFormulaText(formula: string): string[] {
  return formula.match(FORMULA_TOKEN_PATTERN) ?? [];
}

export function isFormulaNumberToken(token: string): boolean {
  return FORMULA_NUMBER_PATTERN.test(token);
}

export function formatFormulaNumberToken(token: string): string {
  return formatEditableNumberInput(token);
}

export function formatFormulaText(formula: string): string {
  return tokenizeFormulaText(formula)
    .map((token) => (isFormulaNumberToken(token) ? formatFormulaNumberToken(token) : token))
    .join("");
}
