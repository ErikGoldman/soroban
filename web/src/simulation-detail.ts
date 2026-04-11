import type { SimulationDetailYearRow } from "./simulation.js";

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
    .filter(([entryName]) => !isSimulationSaleFlowEntry(entryName))
    .map(([label, amount]) => ({
      label,
      amount,
      detail: "",
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
      if (Math.abs(marketValue - amount) <= 0.000001) {
        return [
          {
            label: assetName,
            amount,
            detail: "",
          },
        ];
      }

      return [
        {
          label: `${assetName} equity`,
          amount,
          detail: "",
        },
        {
          label: `${assetName} market value`,
          amount: marketValue,
          detail: "",
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
