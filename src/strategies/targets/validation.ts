/**
 * On-chain validation of a resolved DepositTarget (spec §3.2, MANDATORY).
 *
 * We route user funds, so a resolver's candidate address is verified against
 * the chain before it is trusted. Any failure (mismatch OR unreadable) →
 * `false` → the caller nulls the target → the pool degrades to manual. We
 * never guess.
 *
 * Toggle with `STRATEGIES_TARGET_VALIDATION=off` for local dev without RPC
 * access (validation is trusted-open only when explicitly disabled). Default
 * is ON.
 */

import { type Address, erc20Abi, parseAbi } from "viem";
import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import { getPublicClientForChain } from "./rpc";
import type { DepositTarget } from "./types";
import { eqAddr, resolveEvmChainId, underlyingOf } from "./types";

// TVL sanity band (spec §11 Q3): on-chain TVL for a recognised stablecoin
// vault must land within [tvl / FACTOR, tvl * FACTOR] of DeFiLlama's figure.
// A very loose factor catches gross mismatches (wrong vault, dust) without
// false-rejecting on price/timing drift. For non-stables (no reliable
// server-side price) we skip the USD band and rely on asset() + selectors.
const TVL_TOLERANCE_FACTOR = 10;

const STABLE_SYMBOLS = new Set([
  "USDC",
  "USDT",
  "DAI",
  "USDS",
  "PYUSD",
  "USDC.E",
  "GHO",
  "FRAX",
  "LUSD",
  "CRVUSD",
]);

const ERC4626_ABI = parseAbi([
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function convertToShares(uint256 assets) view returns (uint256)",
]);

const AAVE_POOL_ABI = parseAbi([
  // Aave v3 Pool.getReserveData returns a struct; we only need aTokenAddress.
  // Using the packed-config tuple shape would be brittle across versions, so
  // we read the aToken via the reserve-data configuration bitmap check
  // indirectly through getReserveData's aTokenAddress field.
  "function getReserveData(address asset) view returns ((uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))",
]);

const ZERO = "0x0000000000000000000000000000000000000000";

function validationEnabled(): boolean {
  return (
    (process.env.STRATEGIES_TARGET_VALIDATION ?? "on").toLowerCase() !== "off"
  );
}

function isStable(symbol: string): boolean {
  const upper = (symbol ?? "").toUpperCase();
  return [...STABLE_SYMBOLS].some((s) => upper.includes(s));
}

/** Validate an ERC-4626 vault: asset() matches, 4626 selectors respond, TVL sane. */
async function validateErc4626(
  target: Extract<DepositTarget, { kind: "erc4626" }>,
  pool: DeFiLlamaYieldPool,
): Promise<boolean> {
  const chainId = resolveEvmChainId(pool.chain);
  const client = getPublicClientForChain(chainId);
  if (!client) return false;
  try {
    const [asset, totalAssets] = await Promise.all([
      client.readContract({
        address: target.vault,
        abi: ERC4626_ABI,
        functionName: "asset",
      }),
      client.readContract({
        address: target.vault,
        abi: ERC4626_ABI,
        functionName: "totalAssets",
      }),
    ]);

    const expected = target.asset ?? underlyingOf(pool);
    if (expected && !eqAddr(asset, expected)) return false;
    if (totalAssets <= 0n) return false;

    // Prove the 4626 selector set responds (not just a plain ERC-20 at the
    // address). convertToShares(1 unit) must not revert.
    const decimals = await client
      .readContract({
        address: asset as Address,
        abi: erc20Abi,
        functionName: "decimals",
      })
      .catch(() => 18);
    const oneUnit = 10n ** BigInt(decimals);
    await client.readContract({
      address: target.vault,
      abi: ERC4626_ABI,
      functionName: "convertToShares",
      args: [oneUnit],
    });

    // TVL band — stablecoins only (assume ~$1); skip otherwise.
    if (isStable(pool.symbol) && pool.tvlUsd > 0) {
      const onchainUsd = Number(totalAssets) / Number(oneUnit);
      const lo = pool.tvlUsd / TVL_TOLERANCE_FACTOR;
      const hi = pool.tvlUsd * TVL_TOLERANCE_FACTOR;
      if (onchainUsd < lo || onchainUsd > hi) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Validate an Aave v3 reserve: the asset is a listed reserve with an aToken. */
async function validateAaveV3(
  target: Extract<DepositTarget, { kind: "aave-v3" }>,
  pool: DeFiLlamaYieldPool,
): Promise<boolean> {
  const chainId = resolveEvmChainId(pool.chain);
  const client = getPublicClientForChain(chainId);
  if (!client) return false;
  try {
    const data = await client.readContract({
      address: target.pool,
      abi: AAVE_POOL_ABI,
      functionName: "getReserveData",
      args: [target.asset],
    });
    // aTokenAddress non-zero ⇒ the reserve is listed on this Pool.
    return !eqAddr(data.aTokenAddress, ZERO) && data.aTokenAddress !== ZERO;
  } catch {
    return false;
  }
}

/**
 * Validate a resolved target on-chain. Unknown kinds (Sui/Solana/curve/…) are
 * validated inside their own resolver when they land; here they pass through
 * as trusted (their resolver already confirmed identity another way).
 */
export async function validateTarget(
  target: DepositTarget,
  pool: DeFiLlamaYieldPool,
): Promise<boolean> {
  if (!validationEnabled()) return true;
  switch (target.kind) {
    case "erc4626":
      return await validateErc4626(target, pool);
    case "aave-v3":
      return await validateAaveV3(target, pool);
    default:
      // Non-EVM / bespoke families validate within their resolver (§3.2);
      // no generic EVM check applies.
      return true;
  }
}
