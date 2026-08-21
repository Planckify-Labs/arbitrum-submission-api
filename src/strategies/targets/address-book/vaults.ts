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
