/**
 * Sui liquid-staking resolver — spec §5, §7.1 / Phase 3.
 *
 * The LST venues (Haedal / Volo / SpringSui / Aftermath) are synthesized into
 * the opportunity feed by `SuiLstSource` (they are absent from DeFiLlama's Sui
 * `/pools`). This resolver turns such a synthesized pool back into a
 * `{ kind: "sui-lst", venue, lstType }` target for the mobile `SuiLstAdapter`,
 * matching on the pool's `project` (the venue's DeFiLlama slug).
 *
 * No on-chain probe: the target names a fixed, pre-verified venue (the pinned
 * package + shared objects live in the mobile adapter's config), not a
 * discovered address — so there is nothing address-shaped to validate here, the
 * same as the single-market Scallop path. Fail closed: unknown project /
 * non-Sui chain → `null` → the pool stays "manual".
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import { lstVenueBySlug } from "./sui-lst.config";
import type { DepositTarget, PoolTargetResolver } from "./types";

export const SuiLstResolver: PoolTargetResolver = {
  family: "sui-lst",
  aliases: ["haedal-protocol", "volo-lst", "springsui", "aftermath-afsui"],
  async resolve(pool): Promise<DepositTarget | null> {
    if ((pool.chain ?? "").toLowerCase() !== "sui") return null;
    const info = lstVenueBySlug(pool.project ?? "");
    if (!info) return null;
    // Fail-safe: a venue flagged non-executable resolves to null → Manual. All
    // four are currently in-app (Haedal/Volo via the executor's scoped
    // version-gate dry-run bypass — see sui-lst.config.ts `inAppDeposit`).
    if (!info.inAppDeposit) return null;
    return { kind: "sui-lst", venue: info.venue, lstType: info.lstType };
  },
};
