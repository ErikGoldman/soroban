export interface EditableNumberNormalizationResult {
  value: string;
  caret: number;
}

function canonicalizeEditableNumber(raw: string): string {
  let sign = "";
  let integerPart = "";
  let fractionPart = "";
  let hasDecimalPoint = false;

  for (const character of raw) {
    if (character >= "0" && character <= "9") {
      if (hasDecimalPoint) {
        fractionPart += character;
      } else {
        integerPart += character;
      }
      continue;
    }

    if (character === "." && !hasDecimalPoint) {
      hasDecimalPoint = true;
      continue;
    }

    if (character === "-" && !sign && integerPart === "" && !hasDecimalPoint && fractionPart === "") {
      sign = "-";
    }
  }

  if (!hasDecimalPoint) {
    return `${sign}${integerPart}`;
  }

  return `${sign}${integerPart}.${fractionPart}`;
}

function groupIntegerDigits(value: string): string {
  if (value.length <= 3) {
    return value;
  }

  const digits = value.split("");
  let grouped = "";

  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) {
      grouped += ",";
    }
    grouped += digits[index];
  }

  return grouped;
}

function formatCanonicalEditableNumber(value: string): string {
  const isNegative = value.startsWith("-");
  const unsigned = isNegative ? value.slice(1) : value;
  const hasDecimalPoint = unsigned.includes(".");
  const [integerPart, fractionPart = ""] = unsigned.split(".");

  if (integerPart === "" && !hasDecimalPoint) {
    return isNegative ? "-" : "";
  }

  const formattedInteger = integerPart === "" ? "" : groupIntegerDigits(integerPart);
  const prefix = isNegative ? "-" : "";

  if (!hasDecimalPoint) {
    return `${prefix}${formattedInteger}`;
  }

  return `${prefix}${formattedInteger}.${fractionPart}`;
}

export function formatEditableNumberInput(raw: string): string {
  return formatCanonicalEditableNumber(canonicalizeEditableNumber(raw));
}

export function normalizeEditableNumberInput(raw: string, caret: number): EditableNumberNormalizationResult {
  const nextValue = formatEditableNumberInput(raw);
  const boundedCaret = Math.max(0, Math.min(caret, raw.length));
  const nextCaret = formatEditableNumberInput(raw.slice(0, boundedCaret)).length;

  return {
    value: nextValue,
    caret: Math.max(0, Math.min(nextCaret, nextValue.length)),
  };
}

export function parseEditableNumber(raw: string): number {
  const normalized = canonicalizeEditableNumber(raw);
  if (normalized === "" || normalized === "-" || normalized === "." || normalized === "-.") {
    return Number.NaN;
  }

  return Number(normalized);
}

export function parseOptionalEditableNumber(raw: string): number | null {
  const normalized = canonicalizeEditableNumber(raw);
  if (normalized === "") {
    return null;
  }

  const parsed = parseEditableNumber(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isEditableNumberValid(raw: string, allowEmpty = false): boolean {
  if (allowEmpty && canonicalizeEditableNumber(raw) === "") {
    return true;
  }

  return Number.isFinite(parseEditableNumber(raw));
}
