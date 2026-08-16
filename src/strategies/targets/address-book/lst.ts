/**
 * Liquid-staking / restaking venues (Family F, spec §6.4).
 *
 * One `LstStakeAdapter` serves every venue; `DepositTarget.venue` is the join
 * key into this book (backend, for resolution + validation) and into the mobile
 * twin `services/defi/adapters/lst.config.ts` (which owns the call shape).
 * Adding a venue is a row here + a row there — never a branch.
 *
 * `exit` is load-bearing UX, not decoration (§12 Q2): most LSTs redeem through
 * a withdrawal queue (days) or a DEX swap, so a venue that cannot honour an
 * instant `"MAX"` withdraw must say so, and the card shows the honest exit path
 * instead of promising something we cannot deliver (§8.3).
 */

import { NATIVE_ASSET_SENTINEL } from "../types";
import type { Address } from "../types";

/**
 * The on-chain call shape for a venue's stake. A closed union so the mobile
 * family adapter is parameterised by CONFIG rather than branching on venue
 * names: a new venue that reuses a shape is pure config; a genuinely new
 * calling convention adds one shape here and one encoder there.
 */
export type LstStakeShape =
  /** `deposit()` payable — Rocket Pool `RocketDepositPool`, ether.fi `LiquidityPool`. */
  | "payable-deposit"
  /** `deposit(address receiver)` payable — Stader `StaderStakePoolsManager`. */
  | "payable-deposit-receiver"
  /** `deposit(address referral)` payable — Binance `WBETH`. */
  | "payable-deposit-referral"
  /** `submit()` payable — Benqi `StakedAvax`. */
  | "payable-submit";

export interface LstVenue {
  /** Stable join key carried on the target. Never displayed raw. */
  readonly key: string;
  readonly chainId: number;
  /** The contract the stake call goes to. */
  readonly entry: Address;
  /** The rate-appreciating receipt token. */
  readonly receipt: Address;
  /** Deposited asset; `NATIVE_ASSET_SENTINEL` for native-coin stakes (§12 Q5). */
  readonly asset: Address;
  readonly shape: LstStakeShape;
  /**
   * How a withdraw is actually serviced. `"queue"` disables in-app withdraw
   * until the Tier-4 request/claim machinery lands (§12 Q2); `"dex"` routes the
   * exit through the swap layer with slippage bounds.
   */
  readonly exit: "queue" | "dex" | "instant";
  /** DeFiLlama `project` slugs this venue fulfils. */
  readonly externalSlugs: readonly string[];
  readonly displayName: string;
}

export const LST_VENUES: readonly LstVenue[] = [
  {
    key: "rocket-pool",
    chainId: 1,
    entry: "0xDD3f50F8A6CafbE9b31a427582963f465E745AF8", // RocketDepositPool
    receipt: "0xae78736Cd615f374D3085123A210448E74Fc6393", // rETH
    asset: NATIVE_ASSET_SENTINEL,
    shape: "payable-deposit",
    // rETH burn is capped by the deposit pool's excess balance, so a full exit
    // is not reliably instant — treat as a DEX exit.
    exit: "dex",
    externalSlugs: ["rocket-pool"],
    displayName: "Rocket Pool",
  },
  {
    key: "etherfi",
    chainId: 1,
    entry: "0x308861A430be4cce5502d0A12724771Fc6DaF216", // LiquidityPool
    receipt: "0x35fA164735182de50811E8e2E824cFb9B6118ac2", // eETH
    asset: NATIVE_ASSET_SENTINEL,
    shape: "payable-deposit",
    exit: "queue", // ether.fi withdraws are NFT-ticketed and queued
    externalSlugs: ["ether.fi-stake", "etherfi", "ether.fi"],
    displayName: "ether.fi",
  },
  {
    key: "stader-ethx",
    chainId: 1,
    entry: "0xcf5EA1b38380f6aF39068375516Daf40Ed70D299", // StaderStakePoolsManager
    receipt: "0xA35b1B31Ce002FBF2058D22F30f95D405200A15b", // ETHx
    asset: NATIVE_ASSET_SENTINEL,
    shape: "payable-deposit-receiver",
    exit: "queue",
    externalSlugs: ["stader", "stader-ethx"],
    displayName: "Stader ETHx",
  },
  {
    key: "binance-wbeth",
    chainId: 1,
    entry: "0xa2E3356610840701BDf5611a53974510Ae27E2e1", // wBETH (mint on the token)
    receipt: "0xa2E3356610840701BDf5611a53974510Ae27E2e1",
    asset: NATIVE_ASSET_SENTINEL,
    shape: "payable-deposit-referral",
    exit: "dex", // redemption is CEX-side; on-chain exit is a swap
    externalSlugs: ["binance-staked-eth", "wbeth"],
    displayName: "Binance Staked ETH",
  },
  {
    key: "benqi-savax",
    chainId: 43114,
    entry: "0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE", // StakedAvax
    receipt: "0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE",
    asset: NATIVE_ASSET_SENTINEL,
    shape: "payable-submit",
    exit: "queue", // 15-day unlock
    externalSlugs: ["benqi-staked-avax", "benqi-liquid-staking"],
    displayName: "BENQI Liquid Staking",
  },
];

/**
 * Venues deliberately NOT in the book yet, with the reason. Kept in code so the
 * gaps read as decisions rather than oversights (§8.2 "never guess"):
 *
 * - **Coinbase cbETH** — no permissionless mint; cbETH is only obtainable on
 *   Coinbase or a DEX, so there is no stake call to build.
 * - **Liquid Collective LsETH** — direct minting is allowlist-gated (KYC), so a
 *   user's deposit would revert. Stays Manual.
 * - **Lombard LBTC** — deposit is a Bitcoin-side flow bridged in, not an EVM
 *   stake call.
 * - **StakeWise v3** — multi-vault: the entry contract is per-vault, so it needs
 *   a registry-driven resolver rather than a pinned singleton. Fits Family A/its
 *   own resolver later.
 * - **Kelp rsETH, Mantle mETH** — both take a caller-supplied minimum-out on
 *   deposit, so they need the slippage policy (§12 Q4) wired into the stake
 *   shape plus a verified preview view. Deferred rather than shipped with a
 *   guessed ABI.
 */
export const LST_VENUES_DEFERRED = [
  "coinbase-cbeth",
  "liquid-collective-lseth",
  "lombard-lbtc",
  "stakewise-v3",
  "kelp-rseth",
  "mantle-meth",
] as const;

export function findLstVenue(key: string): LstVenue | null {
  return LST_VENUES.find((v) => v.key === key) ?? null;
}

export function findLstVenuesForProject(
  project: string | undefined,
  chainId: number,
): LstVenue[] {
  const needle = (project ?? "").toLowerCase();
  if (!needle) return [];
  return LST_VENUES.filter(
    (v) =>
      v.chainId === chainId &&
      (v.key === needle ||
        v.externalSlugs.some((s) => s.toLowerCase() === needle)),
  );
}
