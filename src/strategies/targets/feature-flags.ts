/**
 * Tier + per-family rollout flags for the EVM protocol expansion (spec §8.6).
 *
 * Each flag gates BOTH sides of a family: the backend `registerResolver` here
 * and the mobile `registerDefiAdapter` in
 * `mobile-app/constants/configs/featureFlags.ts`. A half-wired family must
 * never badge "Deposit in-app" — if a resolver emits a target the mobile app
 * has no adapter for, the card promises an execution path that does not exist.
 *
 * **Defaults are OFF, and that is a review gate rather than unfinished work.**
 * Every resolver, validator and adapter is present and testable, so turning a
 * tier on in a test environment is purely a config change. Tiers 1-3 are
 * fork-tested (runbook §11.7). What is still missing before production is
 * security sign-off on every pinned address in `address-book/` (§12 Q7): a
 * green fork test proves the calldata is right, not that the address it is sent
 * to is the contract we believe it is.
 *
 * ⚠️ **Read `mobile-app/docs/runbooks/add-defi-pool-resolver.md` §12 before
 * flipping one.** It lists the eight production requirements, what is still
 * blocking, and the device-test procedure — including that the MOBILE flag of
 * the same name must be on too, or the app badges "Deposit in-app" for a target
 * it cannot build (§8.6).
 *
 * A per-family sub-flag rides under each tier so one risky family can be
 * dark-launched (or killed) independently — this is also the hook the §11
 * Layer-3 per-family kill-switch reads.
 */

function flag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "on") return true;
  if (raw === "false" || raw === "0" || raw === "off") return false;
  return defaultValue;
}

/** Tier gates. A family is live only when its tier AND its own flag are on. */
export const TIER_FLAGS = {
  tier1: () => flag("FEATURE_DEFI_EVM_TIER1", false),
  tier2: () => flag("FEATURE_DEFI_EVM_TIER2", false),
  tier3: () => flag("FEATURE_DEFI_EVM_TIER3", false),
  // Tier 4 stays off until the two-phase request/claim interface ships (§7).
  tier4: () => flag("FEATURE_DEFI_EVM_TIER4", false),
} as const;

export type TierKey = keyof typeof TIER_FLAGS;

/**
 * Per-family sub-flags. Key is the resolver `family`; the env var name is
 * derived so adding a family needs no second list to keep in sync.
 * Default ON *within* an enabled tier, so enabling a tier enables its families
 * and a single family can still be pinned off.
 */
export function familyEnabled(tier: TierKey, family: string): boolean {
  if (!TIER_FLAGS[tier]()) return false;
  const envName = `FEATURE_DEFI_EVM_FAMILY_${family
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_")}`;
  return flag(envName, true);
}

/**
 * Layer-3 per-family global kill-switch (§11 Layer-3). Distinct from the
 * rollout flag: ops flips this on an exploit disclosure to stop an ALREADY
 * live family instantly, without touching user state or redeploying the
 * rollout config. Read by the resolver AND the executor.
 *
 * `DEFI_FAMILY_KILL_SWITCH="compound-v3,curve"` — a comma-separated list of
 * resolver families and/or `DepositTarget.kind`s.
 */
export function isFamilyKilled(familyOrKind: string): boolean {
  const raw = process.env.DEFI_FAMILY_KILL_SWITCH?.trim();
  if (!raw) return false;
  const needle = familyOrKind.toLowerCase();
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(needle);
}

/**
 * Per-chain enablement, separate from "supported" (§11 Layer-3). A chain can be
 * in the directory (so balances and transfers work) while DeFi routing on it
 * stays off. Empty ⇒ every directory chain is allowed.
 *
 * `DEFI_ENABLED_CHAIN_IDS="1,8453,42161"`
 */
export function isChainEnabledForDefi(chainId: number): boolean {
  const raw = process.env.DEFI_ENABLED_CHAIN_IDS?.trim();
  if (!raw) return true;
  return raw
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n))
    .includes(chainId);
}
