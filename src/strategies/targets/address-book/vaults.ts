/**
 * Pinned single-canonical-vault ERC-4626 deployments (Family A, spec §4).
 *
 * These protocols expose exactly ONE savings vault per token per chain, so
 * there is nothing to disambiguate and no vault list to fetch — the address IS
 * the identity. Multi-vault Family-A protocols (Euler, Fluid, Gearbox,
 * Concrete, Venus wrappers) resolve from their own registries instead and are
 * admitted purely on `validateErc4626` passing (§12 Q1).
 *
 * See ./README.md before editing.
 */

import type { Address } from "../types";

/**
 * One pinned 4626 vault: the vault contract plus the underlying it must report
 * from `asset()`. The validator proves the pairing on-chain; the `asset` here
 * is what the resolver matches the DeFiLlama `underlyingTokens[0]` against, so
 * a pool for a different token can never pick up this vault.
 */
export interface PinnedVault {
  readonly vault: Address;
  readonly asset: Address;
  /** Human label for logs/tests — never used for matching. */
  readonly label: string;
}

/** chainId → the protocol's pinned vaults on that chain. */
export type PinnedVaultBook = Readonly<Record<number, readonly PinnedVault[]>>;

/**
 * Sky Savings / Spark savings. `sUSDS` is the Sky Savings Rate token and
 * `sDAI` the DSR token; Spark surfaces the SAME contracts (docs.spark.fi
 * "ERC-4626 representation of USDS/DAI"), so one book serves both resolvers
 * and the `project` slug only decides which resolver runs.
 */
export const SKY_SAVINGS_VAULTS: PinnedVaultBook = {
  1: [
    {
      vault: "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD",
      asset: "0xdC035D45d973E3EC169d2276DDab16f1e407384F", // USDS
      label: "sUSDS",
    },
    {
      vault: "0x83F20F44975D03b1b09e64809B757c47f942BEeA",
      asset: "0x6B175474E89094C44Da98b954EedeAC495271d0F", // DAI
      label: "sDAI",
    },
  ],
  // Base and Arbitrum are deliberately ABSENT. Sky's L2 `sUSDS` is a bridged
  // token, not an ERC-4626: verified on chain 2026-08-19, Base
  // `0x5875eEE11Cf8398102FdAd704C9E96607675467a` answers `symbol()` = "sUSDS"
  // but REVERTS on `asset()`, `totalAssets()` and `convertToShares()`
  // (Arbitrum `0xdDb46999F8891663a8F2828d25298f70416d7610` behaves the same).
  // Conversion there goes through the PSM, so no `erc4626` target can ever
  // build. The Base entry used to sit here and simply never resolved — a pin
  // that cannot work reads as support we do not have, which is exactly what
  // this book is supposed to prevent (§12 Q7).
};

/**
 * Spark savings.
 *
 * Spark used to be nothing but a second front-end onto Sky's `sUSDS`/`sDAI`,
 * which is why it shared Sky's book. It is not that any more: Spark Vault V2
 * ships its own ERC-4626 vaults for USDC, USDT, ETH and PYUSD, and DeFiLlama's
 * `spark-savings` rows point at those (`app.spark.fi/savings/mainnet/spusdc`),
 * not at anything of Sky's. Sharing one book meant those pools had no vault to
 * match and all seven resolved to Manual.
 *
 * Addresses come from Spark's OWN registry — `sparkdotfi/spark-address-registry`,
 * `src/Ethereum.sol` on `master`, the `SPARK_VAULT_V2_*` constants — and every
 * one was then verified on chain (2026-08-21): `asset()`, `totalAssets()`,
 * `maxDeposit()` and `convertToShares()` all answer, and `symbol()` reads back
 * spUSDC / spUSDT / spETH / spPYUSD.
 *
 * **`sUSDC` (0xBc65ad17c5C0a2A4D159fa5a503f4992c7B545FE) is deliberately
 * absent.** It is a real, working 4626 vault for USDC, but so is `spUSDC`, and
 * a book with two vaults for one asset makes `pinnedVaultResolver` ambiguous —
 * which is a refusal, so listing both would resolve FEWER pools than listing
 * the right one. DeFiLlama's link names `spusdc`, so that is the one pinned.
 *
 * **Sky's `sUSDS`/`sDAI` are NOT repeated here**, even though docs.spark.fi
 * surfaces them, for two reasons that agree: DeFiLlama publishes no
 * `spark-savings` row for either on Ethereum (they live under `sky-lending`,
 * which already resolves them), and duplicating a contract across two books
 * would break the address-book invariant that one address is claimed by one
 * protocol per chain. If such a row ever appears it resolves to Manual, which
 * is visible, rather than to a second claim on Sky's contract, which is not.
 */
export const SPARK_SAVINGS_VAULTS: PinnedVaultBook = {
  1: [
    {
      vault: "0x28B3a8fb53B741A8Fd78c0fb9A6B2393d896a43d",
      asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
      label: "spUSDC",
    },
    {
      vault: "0xe2e7a17dFf93280dec073C995595155283e3C372",
      asset: "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT
      label: "spUSDT",
    },
    {
      vault: "0xfE6eb3b609a7C8352A241f7F3A21CEA4e9209B8f",
      asset: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
      label: "spETH",
    },
    {
      vault: "0x80128DbB9f07b93DDE62A6daeadb69ED14a7D354",
      asset: "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8", // PYUSD
      label: "spPYUSD",
    },
  ],
  // Arbitrum and Base are absent for the same reason they are absent from
  // SKY_SAVINGS_VAULTS: those chains' `sUSDS` is a bridged token whose
  // `asset()` reverts, so no `erc4626` target can build there.
};

/**
 * Origin — the WRAPPED (non-rebasing) receipts are the ERC-4626 ones. `OUSD`
 * and `OETH` themselves rebase and are not 4626, so only the wrappers are
 * listed; a pool that names the rebasing token resolves to nothing → Manual.
 *
 * **Every Origin pool DeFiLlama publishes is currently Manual, and that is
 * correct — do not re-investigate.** Checked 2026-08-21: `origin-ether` OETH
 * and Base `superOETHb` both carry `underlyingTokens: [0x0]` (native ETH), and
 * `origin-dollar` OUSD carries USDC. None of those is the asset of a wrapper
 * here, because the deposit Origin actually wants is a **Vault mint** —
 * `mint(asset, amount, minimumAmount)` on the OUSD/OETH Vault, which takes a
 * caller-supplied minimum-out and is therefore a different execution kind with
 * a slippage policy (§12 Q4), not an `erc4626` target.
 *
 * The wrapper pins stay because they are correct contracts and would match
 * immediately if a `wOETH`/`wOUSD` pool ever appears. They are not the sUSDS
 * case: those addresses work, they simply have no pool today.
 */
export const ORIGIN_VAULTS: PinnedVaultBook = {
  1: [
    {
      vault: "0x9c354503C38481a7A7a51629142963F98eCC12D0",
      asset: "0x2A8e1E676Ec238d8A992307B495b45B3fEAa5e86", // OUSD
      label: "wOUSD",
    },
    {
      vault: "0xDcEe70654261AF21C44c093C300eD3Bb97b78192",
      asset: "0x856c4Efb76C1D1AE02e20CEB03A2A6a08b0b8dC3", // OETH
      label: "wOETH",
    },
  ],
};

/**
 * Avant Protocol — `savBTC` / `savUSD` / `savETH`, the staked (yield-bearing)
 * wrappers over Avant's own `avBTC` / `avUSD` / `avETH`.
 *
 * Was declared `withheld` with "no public vault-list endpoint found". There is
 * no endpoint because there is nothing to enumerate: Avant ships ONE staked
 * vault per asset, DeFiLlama publishes one row per vault (`avant-avbtc`,
 * `avant-avusd`, `avant-aveth` are three separate project slugs), and its own
 * adaptors name the vault as a constant. That is the textbook case for pinning
 * rather than discovering.
 *
 * Addresses transcribed from `yield-server/src/adaptors/avant-{avbtc,avusd,aveth}`
 * (read as documentation; the repo ships no LICENSE) and then VERIFIED ON CHAIN
 * 2026-08-21: each answers `symbol()` = savBTC / savUSD / savETH, `asset()` is
 * the matching av-token, and `totalAssets()` / `convertToShares()` /
 * `maxDeposit()` all respond with `maxDeposit` unbounded.
 *
 * **These pins are correct and the protocol is still WITHHELD** (see
 * protocols.ts). The cooldown is readable — `cooldownDuration()` returns 86400
 * and the contracts carry the Ethena `cooldownAssets` / `cooldownShares` /
 * `unstake` convention, so `readExitTerms` reports an honest `delayed` — but
 * readable is not the same as executable: while the cooldown is non-zero,
 * `withdraw`/`redeem` REVERT with `OperationNotAllowed()` (0xf50a3b52), which
 * a mainnet fork run found after every structural check had passed.
 *
 * They stay pinned anyway, for the same reason ORIGIN_VAULTS does: the
 * addresses are right, and deleting them would mean re-deriving them the day a
 * cooldown-aware exit lands.
 */
export const AVANT_VAULTS: PinnedVaultBook = {
  1: [
    {
      vault: "0xDA06eE2dACF9245Aa80072a4407deBDea0D7e341",
      asset: "0x9469470C9878bf3d6d0604831d9A3A366156f7EE", // avETH
      label: "savETH",
    },
  ],
  43114: [
    {
      vault: "0x649342c6bff544d82DF1B2bA3C93e0C22cDeBa84",
      asset: "0xfd2c2A98009d0cBed715882036e43d26C4289053", // avBTC
      label: "savBTC",
    },
    {
      vault: "0x06d47F3fb376649c3A9Dafe069B3D6E35572219E",
      asset: "0x24dE8771bC5DdB3362Db529Fc3358F2df3A0E346", // avUSD
      label: "savUSD",
    },
  ],
};

/**
 * 40 Acres — a small fixed set of ERC-4626 USDC vaults.
 *
 * Also previously `withheld` for a missing endpoint. DeFiLlama's own adaptor
 * calls `utils.getERC4626Info(address, ...)` on four hardcoded addresses, i.e.
 * the aggregator itself treats these as pinned 4626 vaults. Verified on chain
 * 2026-08-21: the Base vault is 4626 over USDC with `maxDeposit` unbounded, and
 * a bytecode scan finds `deposit`/`redeem`/`withdraw`/`maxRedeem` with **no**
 * request/queue/cooldown selectors, so `instant` is an honest exit verdict.
 *
 * **Avalanche is deliberately absent even though two vaults exist there.**
 * `0x124D00b1…` and `0xC0485C4b…` are BOTH USDC vaults on the same chain, and
 * `pinnedVaultResolver` requires exactly one match per (chain, asset) — two is
 * an ambiguity, and ambiguity is a refusal (§8.2). Listing them would resolve
 * nothing while looking like coverage. Splitting them needs an exact key
 * (DeFiLlama labels them `40avax-USDC-Vault` and `40avax-blackhole-USDC-Vault`,
 * but `poolMeta` is not what the pinned resolver matches on), so they stay
 * Manual until the resolver can disambiguate by label.
 *
 * Note the Base and Optimism addresses are different contracts: `0x08dCDBf7…`
 * ALSO exists on Base, as an empty vault (`totalAssets() == 0`) that DeFiLlama
 * publishes no row for. Pinning per chain keeps them apart — pin the Base
 * address on Base only, and the Optimism one on Optimism only.
 */
export const FORTY_ACRES_VAULTS: PinnedVaultBook = {
  10: [
    {
      vault: "0x08dCDBf7baDe91Ccd42CB2a4EA8e5D199d285957",
      asset: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", // USDC (native)
      label: "40op-USDC-Vault",
    },
  ],
  8453: [
    {
      vault: "0xB99B6dF96d4d5448cC0a5B3e0ef7896df9507Cf5",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
      label: "40base-USDC-Vault",
    },
  ],
};

/**
 * Avantis — the `avUSDC` liquidity vault on Base. One vault, one asset, so it
 * pins rather than discovers.
 *
 * Address from `yield-server/src/adaptors/avantis` (`ADDRESSES.base.AvantisVault`)
 * and verified on chain 2026-08-21: `symbol()` = avUSDC, `asset()` = Base USDC,
 * `maxDeposit` unbounded. It is an EIP-1967 proxy, so the shape check was run
 * against the implementation (0xbd1a1896…) too — plain 4626, no request,
 * queue or cooldown selectors.
 *
 * **What this vault IS matters more than its ABI.** It is the counterparty
 * side of a perps venue: depositors underwrite trader PnL, so the share price
 * can fall on trading losses in a way a lending vault's cannot. The 4626
 * machinery executes it correctly either way; whether it belongs in a
 * conservative tier is a scoring decision, not a resolver one.
 */
export const AVANTIS_VAULTS: PinnedVaultBook = {
  8453: [
    {
      vault: "0x944766f715b51967E56aFdE5f0Aa76cEaCc9E7f9",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
      label: "avUSDC",
    },
  ],
};
