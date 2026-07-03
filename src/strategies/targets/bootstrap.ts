/**
 * Resolver bootstrap (spec §5.1). Register the families that (a) appear in
 * scored OpportunityCache and (b) are multi-vault / worth in-app execution.
 * Morpho + Yearn cover the bulk of ERC-4626 TVL; Aave gives single-market
 * venues a target so they badge "Deposit in-app". New protocol = add one
 * `registerResolver(...)` here (+ its one-file resolver). No branch anywhere.
 */

import { AaveResolver } from "./aave.resolver";
import { MorphoResolver, YearnResolver } from "./erc4626.resolver";
import { registerResolver } from "./registry";

let booted = false;

export function bootTargetResolvers(): void {
  if (booted) return;
  registerResolver(MorphoResolver);
  registerResolver(YearnResolver);
  registerResolver(AaveResolver);
  booted = true;
}
