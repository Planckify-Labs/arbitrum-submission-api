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
  8453: [
    {
      vault: "0x5875eEE11Cf8398102FdAd704C9E96607675467a",
      asset: "0x820C137fa70C8691f0e44Dc420a5e53c168921Dc", // USDS (Base)
      label: "sUSDS",
    },
  ],
};

/**
 * Origin — the WRAPPED (non-rebasing) receipts are the ERC-4626 ones. `OUSD`
 * and `OETH` themselves rebase and are not 4626, so only the wrappers are
 * listed; a pool that names the rebasing token resolves to nothing → Manual.
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
