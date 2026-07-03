/**
 * Resolver bootstrap (spec §5.1). Register the families that (a) appear in
 * scored OpportunityCache and (b) are multi-vault / worth in-app execution.
 * Morpho + Yearn cover the bulk of ERC-4626 TVL; Aave gives single-market
 * venues a target so they badge "Deposit in-app". New protocol = add one
 * `registerResolver(...)` here (+ its one-file resolver). No branch anywhere.
 */

import { AaveResolver } from "./aave.resolver";
import { EmberResolver } from "./ember.resolver";
import { MorphoResolver, YearnResolver } from "./erc4626.resolver";
import { NaviResolver } from "./navi.resolver";
import { registerResolver } from "./registry";
import { ScallopResolver } from "./scallop.resolver";
// SuilendResolver is implemented but NOT registered: Suilend's deposit AND
// withdraw both assert a fresh reserve price (abort code 1), which needs a Pyth
// pull-oracle push in-tx — deferred (see suilend.resolver.ts / suilendSui.ts).
// Registering it would badge Suilend "in-app" and then intermittently fail.

let booted = false;

export function bootTargetResolvers(): void {
  if (booted) return;
  registerResolver(MorphoResolver);
  registerResolver(YearnResolver);
  registerResolver(AaveResolver);
  // Sui — Ember Vaults (generic tokenized-vault family; multi-vault, so the
  // resolver disambiguates siblings by poolMeta ↔ vault name). Emits
  // `{ kind: "ember-vault" }` for the mobile EmberSuiAdapter (Phase 3).
  registerResolver(EmberResolver);
  // Sui — Scallop (single-market-per-asset). Emits `{ kind: "scallop-market" }`
  // for the existing ScallopSuiAdapter, so scallop-lend pools badge "Deposit
  // in-app" instead of resolving to nothing (Phase 3).
  registerResolver(ScallopResolver);
  // Sui — NAVI (single-market-per-asset, coinType-matched via its pools API).
  // Emits `{ kind: "navi-pool" }` for the mobile NaviSuiAdapter (Phase 3).
  registerResolver(NaviResolver);
  // Suilend NOT registered — its deposit + withdraw are both Pyth-gated (see the
  // import note). The resolver + mobile adapter are ready; wire the Pyth push
  // then register here.
  booted = true;
}
