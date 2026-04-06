const ANNUAL_RATE = 0.04;

export interface ProjectionInput {
  amount: number;
  years: number;
  annualRate?: number;
}

export function projectValue({ amount, years, annualRate = ANNUAL_RATE }: ProjectionInput): number {
  return amount * Math.pow(1 + annualRate, years);
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export { ANNUAL_RATE };
