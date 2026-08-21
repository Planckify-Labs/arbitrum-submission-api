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
  | "payable-submit"
  /** `submit(address _referral)` payable — Lido `stETH`. */
  | "payable-submit-referral"
  /**
   * `stake(uint256 minMETHAmount)` payable — Mantle `Staking`.
   *
   * The first venue whose stake takes a CALLER-SUPPLIED MINIMUM. That makes it
   * a slippage-bearing build (§12 Q4): the device must read the protocol's own
   * preview view at build time and derive the floor from the user's tier. A
   * zero minimum is never acceptable, so a venue on this shape MUST also
   * declare `previewView`.
   */
  | "payable-stake-minout";

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
  /**
   * The protocol's own "how much receipt would I get" view, read on `entry` at
   * build time to derive a min-out. Required for `payable-stake-minout` and
   * meaningless otherwise — `lstVenueConformance` enforces the pairing, since a
   * min-out shape with nothing to quote against could only ship a zero floor.
   */
  readonly previewView?: string;
  /**
   * Smallest stake the contract accepts, in wei. Present when the venue
   * enforces one on chain, so the device can refuse with friendly copy instead
   * of letting the user pay gas for a revert.
   */
  readonly minStakeWei?: bigint;
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
    // Lido — the largest single pool in the whole catalog (~$23B) and, until
    // now, entirely Manual: nothing claimed the `lido` slug, so no target was
    // ever emitted for it.
    //
    // The stake is `submit(address _referral) payable` ON THE stETH TOKEN
    // ITSELF (0xae7a…, the pool contract and the receipt are one address);
    // that is the only new thing here, and it is one `payable-submit-referral`
    // shape. Address confirmed against DeFiLlama's own Lido adaptor, whose
    // pool id is `0xae7ab96520de3a18e5e111b5eaab095312d7fe84-ethereum` with
    // `underlyingTokens: [0x0]` (native ETH).
    //
    // `exit: "queue"` is the honest verdict, so Lido ships DEPOSIT-ONLY (§12
    // Q2): the protocol's own exit is `requestWithdrawals` on the Withdrawal
    // Queue followed by a `claimWithdrawals` once finalised, which is 1-5 days
    // and a two-phase flow `UnsignedCall` cannot express. The device already
    // has that flow implemented end to end in
    // `services/defi/adapters/lido.ts` (buildWithdraw + buildClaim); wiring it
    // to this venue is a Tier-4 job, not a book edit, because the withdraw
    // side has to become two-phase for every queue venue at once.
    key: "lido",
    chainId: 1,
    entry: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", // stETH
    receipt: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
    asset: NATIVE_ASSET_SENTINEL,
    shape: "payable-submit-referral",
    exit: "queue",
    externalSlugs: ["lido", "lido-eth"],
    displayName: "Lido",
  },
  {
    // Mantle mETH — the largest LST that was still Manual (~$562M).
    //
    // It was deferred because `stake(uint256 minMETHAmount)` takes a
    // caller-supplied minimum, which needs the slippage policy rather than a
    // guessed ABI. That is now wired: the device reads `ethToMETH(amount)` on
    // this same contract at build time and derives the floor from the user's
    // tier (LST/native is a CORRELATED pair, so it gets the `stable` budget —
    // 25bp conservative, 50bp balanced).
    //
    // Addresses and the exact ABI are transcribed from DeFiLlama's own
    // meth-protocol adaptor (`stakingAbi.json`) and verified on chain
    // 2026-08-21: the implementation behind this proxy (0x01a36039…) carries
    // `stake(uint256)`, `ethToMETH(uint256)`, `mETHToETH(uint256)` and
    // `unstakeRequest(uint128,uint128)`, `totalControlled()` reads 237,128 ETH
    // (matching DeFiLlama's TVL) and `minimumStakeBound()` is 0.02 ETH.
    //
    // `exit: "queue"` — `unstakeRequest` is nonpayable and mints a claim, so
    // the exit is request → wait → claim. Deposit-only until Tier 4 (§12 Q2).
    key: "mantle-meth",
    chainId: 1,
    entry: "0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8f", // Staking
    receipt: "0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa", // mETH
    asset: NATIVE_ASSET_SENTINEL,
    shape: "payable-stake-minout",
    previewView: "ethToMETH",
    minStakeWei: 20_000_000_000_000_000n, // minimumStakeBound() = 0.02 ETH
    exit: "queue",
    externalSlugs: ["meth-protocol", "mantle-staked-eth", "meth"],
    displayName: "Mantle mETH",
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
 * - **Renzo ezETH** — `RestakeManager` exposes `depositETH()` AND
 *   `depositETH(uint256)` (both present in the implementation behind
 *   0x74a09653…, verified on chain 2026-08-21), which is a stake shape we do
 *   not have. It also mints against a collateral/TVL cap, so a deposit can
 *   revert for reasons the validator cannot see, and its exit is a
 *   request/claim queue. Needs the shape reviewed plus a cap read before the
 *   entry address is treated as authoritative.
 * - **Kelp rsETH** — takes a caller-supplied minimum-out on deposit, like
 *   Mantle did, but its preview view has not been verified on chain. Mantle
 *   mETH SHIPPED on 2026-08-21 once `ethToMETH` was confirmed: the blocker was
 *   never the min-out itself, it was having a quote to derive the floor from.
 *   Kelp needs the same confirmation and then reuses `payable-stake-minout`.
 */
export const LST_VENUES_DEFERRED = [
  "renzo-ezeth",
  "coinbase-cbeth",
  "liquid-collective-lseth",
  "lombard-lbtc",
  "stakewise-v3",
  "kelp-rseth",
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
