import type { SimulationDetailYearRow } from "./simulation.js";
import { formatCurrency } from "./calculator.js";

export interface SimulationDisplayEntry {
  label: string;
  amount: number;
  detail: string;
}

export function getVisibleSimulationFlowEntries(row: SimulationDetailYearRow): Array<[string, number]> {
  return [...row.flowTotals.entries()]
    .filter(([, amount]) => Math.abs(amount) > 0.000001)
    .sort((left, right) => compareSignedAmounts(left[1], right[1]));
}

export function isSimulationSaleFlowEntry(entryName: string): boolean {
  return entryName.endsWith(" sale proceeds") || entryName.endsWith(" realized gain");
}

export function isSimulationTaxFlowEntry(entryName: string): boolean {
  return entryName === "Taxes paid";
}

export function getSimulationSaleEntries(row: SimulationDetailYearRow): SimulationDisplayEntry[] {
  return getVisibleSimulationFlowEntries(row)
    .filter(([entryName]) => isSimulationSaleFlowEntry(entryName))
    .map(([label, amount]) => ({
      label,
      amount,
      detail: "",
    }));
}

export function getSimulationCashFlowEntries(row: SimulationDetailYearRow): SimulationDisplayEntry[] {
  return getVisibleSimulationFlowEntries(row)
    .filter(([entryName]) => !isSimulationSaleFlowEntry(entryName) && !isSimulationTaxFlowEntry(entryName))
    .map(([label, amount]) => ({
      label,
      amount,
      detail: formatFlowPercentageDetail(row.flowPercentages?.get(label)),
    }));
}

export function getSimulationAssetReturnEntries(row: SimulationDetailYearRow): SimulationDisplayEntry[] {
  return [...row.assetReturns.entries()]
    .filter(([, assetReturn]) => Math.abs(assetReturn.amount) > 0.000001 || Math.abs(assetReturn.percentage) > 0.000001)
    .map(([assetName, assetReturn]) => ({
      label: `${assetName} return`,
      amount: assetReturn.amount,
      detail: ` (${formatPercentage(assetReturn.percentage)})`,
    }))
    .sort((left, right) => compareSignedAmounts(left.amount, right.amount));
}

export function getSimulationAssetValueEntries(row: SimulationDetailYearRow): SimulationDisplayEntry[] {
  return [...row.assetValues.entries()]
    .flatMap(([assetName, amount]) => {
      const marketValue = row.assetMarketValues?.get(assetName) ?? amount;
      const startingAmount = row.startingAssetValues?.get(assetName);
      const startingMarketValue = row.startingAssetMarketValues?.get(assetName) ?? startingAmount;
      if (Math.abs(marketValue - amount) <= 0.000001) {
        return [
          {
            label: assetName,
            amount,
            detail: formatCurrencyDeltaDetail(amount, startingAmount),
          },
        ];
      }

      return [
        {
          label: `${assetName} equity`,
          amount,
          detail: formatCurrencyDeltaDetail(amount, startingAmount),
        },
        {
          label: `${assetName} market value`,
          amount: marketValue,
          detail: formatCurrencyDeltaDetail(marketValue, startingMarketValue),
        },
      ];
    })
    .sort((left, right) => right.amount - left.amount);
}

function compareSignedAmounts(leftAmount: number, rightAmount: number): number {
  const leftPositive = leftAmount >= 0;
  const rightPositive = rightAmount >= 0;

  if (leftPositive !== rightPositive) {
    return leftPositive ? -1 : 1;
  }

  if (leftPositive) {
    return rightAmount - leftAmount;
  }

  return leftAmount - rightAmount;
}

function formatPercentage(value: number): string {
  return `${value.toFixed(2)}%`;
}

function formatCurrencyDeltaDetail(currentValue: number, startingValue: number | undefined): string {
  if (startingValue === undefined) {
    return "";
  }

  return ` (${formatSignedCurrency(currentValue - startingValue)})`;
}

function formatSignedCurrency(value: number): string {
  return `${value >= 0 ? "+" : "-"}${formatCurrency(Math.abs(value))}`;
}

function formatFlowPercentageDetail(value: number | undefined): string {
  if (value === undefined || Math.abs(value) <= 0.000001) {
    return "";
  }

  return ` (${formatPercentage(value)})`;
}
