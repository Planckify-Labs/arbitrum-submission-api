/**
 * On-chain validation of a resolved DepositTarget (spec §3.2, §8.1 — MANDATORY).
 *
 * We route user funds, so a resolver's candidate address is verified against
 * the chain before it is trusted. Any failure (mismatch OR unreadable) →
 * `false` → the caller nulls the target → the pool degrades to manual. We
 * never guess.
 *
 * **Every EVM kind must have an explicit validator.** The old
 * `default: return true` passthrough is gone for EVM kinds (§8.1): a new kind
 * that forgets its validator is REJECTED rather than silently trusted, which is
 * the failure mode that would otherwise ship a family with no Layer-1 check.
 * Non-EVM kinds keep resolver-internal validation and pass through.
 *
 * Toggle with `STRATEGIES_TARGET_VALIDATION=off` for local dev without RPC
 * access (validation is trusted-open only when explicitly disabled). Default
 * is ON.
 */

import {
  type Address,
  encodeAbiParameters,
  erc20Abi,
  keccak256,
  parseAbi,
} from "viem";
import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import {
  findLstVenue,
  isRouterAllowlisted,
  pinnedDestinationFor,
} from "./address-book";
import { getPublicClientForChain } from "./rpc";
import type { DepositTarget, MorphoMarketParams } from "./types";
import {
  eqAddr,
  isEvmTargetKind,
  resolveEvmChainId,
  underlyingOf,
} from "./types";

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

const COMET_ABI = parseAbi([
  "function baseToken() view returns (address)",
  "function totalSupply() view returns (uint256)",
]);

const CTOKEN_ABI = parseAbi([
  "function underlying() view returns (address)",
  "function exchangeRateStored() view returns (uint256)",
]);

const MORPHO_ABI = parseAbi([
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
]);

const CURVE_ABI = parseAbi([
  "function coins(uint256 i) view returns (address)",
]);

const SOLIDLY_POOL_ABI = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function stable() view returns (bool)",
]);

const BALANCER_VAULT_ABI = parseAbi([
  "function getPoolTokens(bytes32 poolId) view returns (address[] tokens, uint256[] balances, uint256 lastChangeBlock)",
]);

const ERC165_ABI = parseAbi([
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
]);

/** ERC-7540 asynchronous-vault interface id (spec §8.1). */
const ERC7540_INTERFACE_ID = "0x2f0a18c5";

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

type Client = NonNullable<ReturnType<typeof getPublicClientForChain>>;

/**
 * Layer-1 "has code" (§11): a target that is an EOA or undeployed is rejected
 * outright. Cheap, and it catches a whole class of resolver mistakes before any
 * protocol-specific read runs.
 */
async function hasCode(client: Client, address: Address): Promise<boolean> {
  try {
    const code = await client.getBytecode({ address });
    return typeof code === "string" && code.length > 2;
  } catch {
    return false;
  }
}

/**
 * Layer-1 "singleton address-book allowlist" (§11, §12 Q7): for kinds whose
 * destination is a singleton/router, the address MUST be one we pinned. Kinds
 * with legitimately per-vault destinations return `null` from
 * `pinnedDestinationFor` and are admitted by on-chain identity instead.
 */
function passesSingletonAllowlist(
  target: DepositTarget,
  chainId: number,
): boolean {
  const pinned = pinnedDestinationFor(target, chainId);
  if (pinned === null) return true; // not a singleton kind
  if (pinned.length === 0) return false; // singleton kind with no pinned entry
  const destination =
    target.kind === "aave-v3"
      ? target.pool
      : target.kind === "compound-v3"
        ? target.comet
        : target.kind === "solidly-lp"
          ? target.router
          : target.kind === "balancer-lp"
            ? target.vault
            : target.kind === "router-call"
              ? undefined // checked per-quote at build time (§6 guardrail 2)
              : undefined;
  if (target.kind === "router-call") return true;
  if (target.kind === "morpho-blue") return true; // `to` is the pinned singleton
  return pinned.some((a) => eqAddr(a, destination));
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
    if (!(await hasCode(client, target.vault))) return false;
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
    const shares = await client.readContract({
      address: target.vault,
      abi: ERC4626_ABI,
      functionName: "convertToShares",
      args: [oneUnit],
    });
    // A vault that prices one whole unit at zero shares is either empty in a
    // way that rounds deposits to nothing, or not really 4626.
    if (shares <= 0n) return false;

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
    if (!(await hasCode(client, target.pool))) return false;
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
 * Comet: `baseToken()` must be the asset we intend to supply, and the market
 * must be non-empty. Supplying a non-base asset to Comet is a COLLATERAL
 * deposit, which is out of scope (supply-side only) and behaves differently —
 * so proving the base asset is what makes this target safe.
 */
async function validateCompoundV3(
  target: Extract<DepositTarget, { kind: "compound-v3" }>,
  pool: DeFiLlamaYieldPool,
): Promise<boolean> {
  const chainId = resolveEvmChainId(pool.chain);
  const client = getPublicClientForChain(chainId);
  if (!client) return false;
  try {
    if (!(await hasCode(client, target.comet))) return false;
    const [baseToken, totalSupply] = await Promise.all([
      client.readContract({
        address: target.comet,
        abi: COMET_ABI,
        functionName: "baseToken",
      }),
      client.readContract({
        address: target.comet,
        abi: COMET_ABI,
        functionName: "totalSupply",
      }),
    ]);
    if (!eqAddr(baseToken, target.asset)) return false;
    return totalSupply > 0n;
  } catch {
    return false;
  }
}

/**
 * Compound-v2 cToken: `underlying()` must equal the asset and the exchange
 * rate must be non-zero (a zero rate makes the share maths meaningless).
 *
 * Native-asset markets (cETH and its fork equivalents) have NO `underlying()`
 * at all — the call reverts. Those are deliberately rejected rather than
 * special-cased: the deposit shape differs (payable `mint()` with no argument),
 * so admitting them here would build a call that cannot succeed.
 */
async function validateCompoundV2(
  target: Extract<DepositTarget, { kind: "compound-v2" }>,
  pool: DeFiLlamaYieldPool,
): Promise<boolean> {
  const chainId = resolveEvmChainId(pool.chain);
  const client = getPublicClientForChain(chainId);
  if (!client) return false;
  try {
    if (!(await hasCode(client, target.cToken))) return false;
    const underlying = await client.readContract({
      address: target.cToken,
      abi: CTOKEN_ABI,
      functionName: "underlying",
    });
    if (!eqAddr(underlying, target.asset)) return false;
    const rate = await client.readContract({
      address: target.cToken,
      abi: CTOKEN_ABI,
      functionName: "exchangeRateStored",
    });
    return rate > 0n;
  } catch {
    return false;
  }
}

/**
 * Re-derive `keccak256(abi.encode(params))` and require it to equal the
 * `marketId` the API claimed. This is the check that closes the "wrong struct"
 * hole (§3.1, §5.2): the id is what identifies the market on-chain, and the
 * struct is what we will actually pass to `supply` — if they disagree, the API
 * is wrong or lying and the target is worthless either way.
 */
export function deriveMorphoMarketId(params: MorphoMarketParams): string {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
      ],
      [
        params.loanToken,
        params.collateralToken,
        params.oracle,
        params.irm,
        BigInt(params.lltv),
      ],
    ),
  );
}

async function validateMorphoBlue(
  target: Extract<DepositTarget, { kind: "morpho-blue" }>,
  pool: DeFiLlamaYieldPool,
): Promise<boolean> {
  const chainId = resolveEvmChainId(pool.chain);
  const client = getPublicClientForChain(chainId);
  if (!client) return false;
  try {
    // 1. The struct must hash to the id. No chain call needed, and it is the
    //    cheapest and most important of the three checks.
    let derived: string;
    try {
      derived = deriveMorphoMarketId(target.params);
    } catch {
      return false; // non-numeric lltv, malformed address
    }
    if (!eqAddr(derived, target.marketId)) return false;

    // 2. The deposited asset is the market's loan token.
    const underlying = underlyingOf(pool);
    if (!eqAddr(target.params.loanToken, target.asset)) return false;
    if (underlying && !eqAddr(target.params.loanToken, underlying))
      return false;

    // 3. The market exists and has a supply side.
    const singleton = pinnedDestinationFor(target, chainId);
    const morpho = singleton?.[0];
    if (!morpho) return false;
    if (!(await hasCode(client, morpho))) return false;
    const market = await client.readContract({
      address: morpho,
      abi: MORPHO_ABI,
      functionName: "market",
      args: [target.marketId],
    });
    return market[0] > 0n;
  } catch {
    return false;
  }
}

/**
 * Curve: the pool's `coins[index]` must be exactly the asset we intend to
 * deposit, and the coin count must match what the target claims. A wrong index
 * silently deposits into a different leg of the pool, so this is the check that
 * matters most for the family.
 */
async function validateCurveLp(
  target: Extract<DepositTarget, { kind: "curve-lp" }>,
  pool: DeFiLlamaYieldPool,
): Promise<boolean> {
  const chainId = resolveEvmChainId(pool.chain);
  const client = getPublicClientForChain(chainId);
  if (!client) return false;
  if (target.index < 0 || target.index >= target.nCoins) return false;
  try {
    if (!(await hasCode(client, target.pool))) return false;
    const coin = await client.readContract({
      address: target.pool,
      abi: CURVE_ABI,
      functionName: "coins",
      args: [BigInt(target.index)],
    });
    if (!eqAddr(coin, target.asset)) return false;

    // The claimed arity must be real: coins(nCoins - 1) resolves and
    // coins(nCoins) does not.
    const last = await client
      .readContract({
        address: target.pool,
        abi: CURVE_ABI,
        functionName: "coins",
        args: [BigInt(target.nCoins - 1)],
      })
      .catch(() => null);
    if (!last) return false;
    const beyond = await client
      .readContract({
        address: target.pool,
        abi: CURVE_ABI,
        functionName: "coins",
        args: [BigInt(target.nCoins)],
      })
      .catch(() => null);
    return beyond === null;
  } catch {
    return false;
  }
}

/** Solidly: the pool's own token pair and invariant must match the target. */
async function validateSolidlyLp(
  target: Extract<DepositTarget, { kind: "solidly-lp" }>,
  pool: DeFiLlamaYieldPool,
): Promise<boolean> {
  const chainId = resolveEvmChainId(pool.chain);
  const client = getPublicClientForChain(chainId);
  if (!client) return false;
  try {
    if (!(await hasCode(client, target.pool))) return false;
    if (!(await hasCode(client, target.router))) return false;
    const [token0, token1, stable] = await Promise.all([
      client.readContract({
        address: target.pool,
        abi: SOLIDLY_POOL_ABI,
        functionName: "token0",
      }),
      client.readContract({
        address: target.pool,
        abi: SOLIDLY_POOL_ABI,
        functionName: "token1",
      }),
      client.readContract({
        address: target.pool,
        abi: SOLIDLY_POOL_ABI,
        functionName: "stable",
      }),
    ]);
    return (
      eqAddr(token0, target.token0) &&
      eqAddr(token1, target.token1) &&
      Boolean(stable) === target.stable
    );
  } catch {
    return false;
  }
}

/** Balancer: the Vault must know this poolId, and the pool must hold the asset. */
async function validateBalancerLp(
  target: Extract<DepositTarget, { kind: "balancer-lp" }>,
  pool: DeFiLlamaYieldPool,
): Promise<boolean> {
  const chainId = resolveEvmChainId(pool.chain);
  const client = getPublicClientForChain(chainId);
  if (!client) return false;
  try {
    if (!(await hasCode(client, target.vault))) return false;
    const result = await client.readContract({
      address: target.vault,
      abi: BALANCER_VAULT_ABI,
      functionName: "getPoolTokens",
      args: [target.poolId],
    });
    const tokens = result[0] as readonly string[];
    if (!tokens || tokens.length === 0) return false;
    return tokens.some((t) => eqAddr(t, target.asset));
  } catch {
    return false;
  }
}

/**
 * LST: the venue must be one we pinned, on the chain we pinned it for, and the
 * receipt token must actually be deployed. The stake shape itself is config
 * (address-book), so proving the venue is the identity check that matters.
 */
async function validateLstStake(
  target: Extract<DepositTarget, { kind: "lst-stake" }>,
  pool: DeFiLlamaYieldPool,
): Promise<boolean> {
  const chainId = resolveEvmChainId(pool.chain);
  const client = getPublicClientForChain(chainId);
  if (!client) return false;
  const venue = findLstVenue(target.venue);
  if (!venue) return false;
  if (venue.chainId !== chainId) return false;
  if (!eqAddr(venue.receipt, target.receipt)) return false;
  if (!eqAddr(venue.asset, target.asset)) return false;
  if (venue.exit !== target.exit) return false;
  try {
    return (
      (await hasCode(client, venue.entry)) &&
      (await hasCode(client, venue.receipt))
    );
  } catch {
    return false;
  }
}

/**
 * router-call: there is nothing on-chain to verify at RESOLVE time — the
 * calldata does not exist yet. What we can prove is that a pinned router exists
 * for this (protocol, chain) and that the market is a deployed contract. The
 * real gate for this family is at build time: the returned `to` must be on the
 * allowlist, the quote's slippage capped, the call simulated, and the decoded
 * intent asserted (§6 guardrails 1-4).
 */
async function validateRouterCall(
  target: Extract<DepositTarget, { kind: "router-call" }>,
  pool: DeFiLlamaYieldPool,
): Promise<boolean> {
  const chainId = resolveEvmChainId(pool.chain);
  if (chainId !== target.chainId) return false;
  const client = getPublicClientForChain(chainId);
  if (!client) return false;
  const pinned = pinnedDestinationFor(target, chainId);
  if (!pinned || pinned.length === 0) return false;
  try {
    return await hasCode(client, target.market);
  } catch {
    return false;
  }
}

/**
 * ERC-7540 async vault. NO resolver emits this kind yet (§7 — the two-phase
 * request/claim interface has to ship first), so in practice this validator
 * guards against a future resolver landing ahead of the adapter. It proves the
 * vault really is 7540 rather than a sync 4626 that would silently strand a
 * deposit in a request state nothing ever claims.
 */
async function validateAsyncVault(
  target: Extract<DepositTarget, { kind: "async-vault" }>,
  pool: DeFiLlamaYieldPool,
): Promise<boolean> {
  const chainId = resolveEvmChainId(pool.chain);
  const client = getPublicClientForChain(chainId);
  if (!client) return false;
  try {
    if (!(await hasCode(client, target.vault))) return false;
    const supports = await client.readContract({
      address: target.vault,
      abi: ERC165_ABI,
      functionName: "supportsInterface",
      args: [ERC7540_INTERFACE_ID as `0x${string}`],
    });
    if (!supports) return false;
    const asset = await client.readContract({
      address: target.vault,
      abi: ERC4626_ABI,
      functionName: "asset",
    });
    return eqAddr(asset, target.asset);
  } catch {
    return false;
  }
}

/**
 * Validate a resolved target on-chain.
 *
 * EVM kinds are exhaustive by construction: `isEvmTargetKind` drives a
 * `false` default so a new EVM kind without a validator here is REJECTED, per
 * §8.1. Non-EVM kinds (Sui/Solana) validate inside their own resolver and pass
 * through.
 */
export async function validateTarget(
  target: DepositTarget,
  pool: DeFiLlamaYieldPool,
): Promise<boolean> {
  if (!validationEnabled()) return true;

  // Layer-1 singleton allowlist runs before any protocol read: an address we
  // never pinned is rejected without spending an RPC call on it.
  if (isEvmTargetKind(target.kind)) {
    const chainId = resolveEvmChainId(pool.chain);
    if (!chainId) return false;
    if (!passesSingletonAllowlist(target, chainId)) return false;
  }

  switch (target.kind) {
    case "erc4626":
      return await validateErc4626(target, pool);
    case "aave-v3":
      return await validateAaveV3(target, pool);
    case "compound-v3":
      return await validateCompoundV3(target, pool);
    case "compound-v2":
      return await validateCompoundV2(target, pool);
    case "morpho-blue":
      return await validateMorphoBlue(target, pool);
    case "curve-lp":
      return await validateCurveLp(target, pool);
    case "solidly-lp":
      return await validateSolidlyLp(target, pool);
    case "balancer-lp":
      return await validateBalancerLp(target, pool);
    case "lst-stake":
      return await validateLstStake(target, pool);
    case "router-call":
      return await validateRouterCall(target, pool);
    case "async-vault":
      return await validateAsyncVault(target, pool);
    default:
      // Non-EVM / bespoke families validate within their resolver (§3.2). An
      // EVM kind never reaches here — `isEvmTargetKind` above proves the switch
      // is exhaustive for them, so a missing validator fails closed.
      return !isEvmTargetKind(target.kind);
  }
}

/** Re-exported for the router-call build-time guardrail (§6 guardrail 2). */
export { isRouterAllowlisted };
