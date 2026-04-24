import type { InvestmentAssetDefinition } from "./finance.js";

export function shouldAvoidEarlyWithdrawalPenalty(
  asset: Pick<InvestmentAssetDefinition, "assetType">,
  customAssetLiquidation: boolean
): boolean {
  if (customAssetLiquidation) {
    return false;
  }

  return asset.assetType === "ira" || asset.assetType === "roth-ira" || asset.assetType === "401k";
}

export function getSimulationSellProportion(
  asset: Pick<InvestmentAssetDefinition, "sellProportion">,
  customAssetLiquidation: boolean
): number {
  return customAssetLiquidation ? asset.sellProportion : 1;
}
