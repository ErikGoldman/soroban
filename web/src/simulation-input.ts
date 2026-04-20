import type { InvestmentAssetDefinition } from "./finance.js";

export function getSimulationSellProportion(
  asset: Pick<InvestmentAssetDefinition, "sellProportion">,
  customAssetLiquidation: boolean
): number {
  return customAssetLiquidation ? asset.sellProportion : 1;
}
