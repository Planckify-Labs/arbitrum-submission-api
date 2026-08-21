/**
 * Pinned oracle provenance (spec §11 Layer-1, §12 Q6/Q7). See ./README.md
 * before editing — nothing here is a `tx.to`, but every constant decides
 * whether we route user funds into a market at all.
 *
 * **Why a lender cares.** Supplying to a Morpho Blue isolated market looks like
 * a pure lending position, but the supplier carries the market's bad-debt risk:
 * if the oracle over-reports collateral, borrowers escape liquidation and the
 * shortfall lands on suppliers. The oracle is therefore part of a market's
 * identity, not incidental config.
 *
 * **Why this is a book of factories and feeds rather than a list of oracles.**
 * §12 Q6 originally pinned oracle addresses per market. That is correct and
 * unmaintainable at the same time: Morpho has thousands of markets, each with
 * its own oracle instance, so the list shipped empty and every Morpho Blue pool
 * fell through to Manual. Pinning the two things markets actually SHARE fixes
 * that without weakening the check:
 *
 *   1. `MorphoChainlinkOracleV2Factory` — proves an oracle's *code* is Morpho's
 *      audited implementation rather than arbitrary bytecode. The factory
 *      records every oracle it deploys in a public
 *      `isMorphoChainlinkOracleV2` mapping, and `MorphoChainlinkOracleV2`
 *      stores its entire wiring in immutables, so an oracle that passes can
 *      never be re-pointed afterwards.
 *   2. `CHAINLINK_FEEDS` — proves the *inputs* that code reads are price feeds
 *      we reviewed. This half is not optional: `createMorphoChainlinkOracleV2`
 *      is permissionless, so anyone can mint a genuine factory oracle whose
 *      `baseFeed1` is a contract they control. Factory membership alone would
 *      admit exactly the oracle we are trying to exclude.
 *
 * Both halves are re-read ON CHAIN at resolve time (see ../morpho-allowlist.ts).
 * Morpho's API is used only to enumerate candidate markets; it is never trusted
 * for the wiring, because the wiring is what the check is about (§11 Layer-6).
 *
 * Seeded from each protocol's own canonical source — factories from
 * `morpho-org/sdks` (`packages/morpho-ts/src/addresses.ts`), feeds from
 * Chainlink's reference-data directory — then PINNED here so a silent change on
 * their side cannot widen our exposure without a reviewed diff.
 */

import type { Address } from "../types";

/**
 * `MorphoChainlinkOracleV2Factory` per chain.
 *
 * A chain absent here has NO verifiable oracle provenance, so no Morpho Blue
 * market on it resolves — the family fails closed to Manual rather than
 * accepting an unproven oracle (§8.2). Keys must stay a subset of
 * `MORPHO_BLUE_SINGLETONS`: a chain with markets but no factory pin is a gap,
 * not a green light.
 *
 * Verified 2026-08-19 against `morpho-org/sdks`
 * (`chainlinkOracleFactory`); each entry round-trips through
 * `address-book-drift.spec.ts`, which asserts the contract answers
 * `isMorphoChainlinkOracleV2` and does NOT claim an address we know it never
 * deployed.
 */
export const MORPHO_CHAINLINK_ORACLE_FACTORIES: Readonly<
  Record<number, Address>
> = {
  1: "0x3A7bB36Ee3f3eE32A60e9f2b33c1e5f2E83ad766", // Ethereum
  8453: "0x2DC205F24BCb6B311E5cdf0745B0741648Aebd3d", // Base
};

/** One reviewed Chainlink price feed, with the freshness contract it advertises. */
export interface ChainlinkFeedPin {
  /** The aggregator proxy address a Morpho oracle reads (`AggregatorV3Interface`). */
  readonly address: Address;
  /**
   * The feed's own `description()`. Asserted on chain by the drift spec, so a
   * re-pointed or mis-transcribed address is caught as a failing check rather
   * than by silently pricing a market off the wrong pair.
   */
  readonly pair: string;
  /** Chainlink's published heartbeat: the longest gap between updates in a quiet market. */
  readonly heartbeatSec: number;
  /** Published deviation threshold, in bps. Recorded for review; not enforced. */
  readonly deviationBps: number;
}

/**
 * Reviewed Chainlink feeds per chain — the ONLY inputs a Morpho Blue oracle may
 * read for a market we route into.
 *
 * **Scope of the review.** Seeded from Chainlink's reference-data directory
 * (2026-08-19) restricted to feeds that back a listed Morpho market, then
 * narrowed by hand to majors, fiat, and ETH-LST exchange rates. Deliberately
 * EXCLUDED, and therefore fail-closed to Manual:
 *
 *   - NAV / RWA feeds (`EUTBL NAV`, `EURSAFO NAV`, `PST-USDC`, `APXUSD`…) —
 *     27-hour heartbeats on instruments whose redemption is off-chain. Lending
 *     against those is a product decision, not an address-book entry.
 *   - Anything not in Chainlink's directory at all, including a protocol's own
 *     bespoke rate adapters. They may well be sound; they have not been read.
 *
 * Widening this list is the deliberate, reviewed act §12 Q6 asks for. Adding an
 * entry admits every market that reads it, so add the feed, not the market.
 *
 * Every entry is verified on chain by `address-book-drift.spec.ts`:
 * `description() === pair`, a positive answer, and an update within heartbeat.
 */
export const CHAINLINK_FEEDS: Readonly<
  Record<number, readonly ChainlinkFeedPin[]>
> = {
  // ── Ethereum ────────────────────────────────────────────────────────────
  1: [
    {
      address: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
      pair: "BTC / USD",
      heartbeatSec: 3600,
      deviationBps: 50,
    },
    {
      address: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
      pair: "ETH / USD",
      heartbeatSec: 3600,
      deviationBps: 50,
    },
    {
      address: "0xb49f677943BC038e9857d61E7d053CaA2C1734C1",
      pair: "EUR / USD",
      heartbeatSec: 86400,
      deviationBps: 15,
    },
    {
      address: "0x04F84020Fdf10d9ee64D1dcC2986EDF2F556DA11",
      pair: "EURC / USD",
      heartbeatSec: 86400,
      deviationBps: 30,
    },
    {
      address: "0xE858728eB31a25C4AcCcE17d01B68dCFC3A0ED2C",
      pair: "LsETH / ETH Exchange Rate",
      heartbeatSec: 86400,
      deviationBps: 1,
    },
    {
      address: "0x8f1dF6D7F2db73eECE86a18b4381F4707b918FB1",
      pair: "PYUSD / USD",
      heartbeatSec: 86400,
      deviationBps: 30,
    },
    {
      address: "0x26C46B7aD0012cA71F2298ada567dC9Af14E7f2A",
      pair: "RLUSD / USD",
      heartbeatSec: 86400,
      deviationBps: 30,
    },
    {
      address: "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6",
      pair: "USDC / USD",
      heartbeatSec: 82800,
      deviationBps: 25,
    },
    {
      address: "0xfF30586cD0F29eD462364C7e81375FC0C71219b1",
      pair: "USDS / USD",
      heartbeatSec: 82800,
      deviationBps: 30,
    },
    {
      address: "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D",
      pair: "USDT / USD",
      heartbeatSec: 86400,
      deviationBps: 25,
    },
    {
      address: "0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23",
      pair: "WBTC / BTC",
      heartbeatSec: 86400,
      deviationBps: 50,
    },
    {
      address: "0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6",
      pair: "XAU / USD",
      heartbeatSec: 86400,
      deviationBps: 30,
    },
    {
      address: "0xA027702dbb89fbd58938e4324ac03B58d812b0E1",
      pair: "YFI / USD",
      heartbeatSec: 86400,
      deviationBps: 100,
    },
    {
      address: "0x2665701293fCbEB223D11A08D826563EDcCE423A",
      pair: "cbBTC / USD",
      heartbeatSec: 86400,
      deviationBps: 200,
    },
    {
      address: "0x5c9C449BbC9a6075A2c061dF312a35fd1E05fF22",
      pair: "weETH / ETH",
      heartbeatSec: 86400,
      deviationBps: 50,
    },
  ],
  // ── Base ────────────────────────────────────────────────────────────────
  8453: [
    {
      address: "0x34cD971a092d5411bD69C10a5F0A7EEF72C69041",
      pair: "ADA / USD",
      heartbeatSec: 86400,
      deviationBps: 50,
    },
    {
      address: "0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F",
      pair: "BTC / USD",
      heartbeatSec: 1200,
      deviationBps: 10,
    },
    {
      address: "0x806b4Ac04501c29769051e42783cF04dCE41440b",
      pair: "CBETH / ETH",
      heartbeatSec: 86400,
      deviationBps: 50,
    },
    {
      address: "0xd7818272B9e248357d13057AAb0B417aF31E817d",
      pair: "CBETH / USD",
      heartbeatSec: 1200,
      deviationBps: 15,
    },
    {
      address: "0x8422f3d3CAFf15Ca682939310d6A5e619AE08e57",
      pair: "DOGE / USD",
      heartbeatSec: 86400,
      deviationBps: 50,
    },
    {
      address: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
      pair: "ETH / USD",
      heartbeatSec: 1200,
      deviationBps: 15,
    },
    {
      address: "0xc91D87E81faB8f93699ECf7Ee9B44D11e1D53F0F",
      pair: "EUR / USD",
      heartbeatSec: 3600,
      deviationBps: 10,
    },
    {
      address: "0x206a34e47093125fbf4C75b7c7E88b84c6A77a69",
      pair: "LTC / USD",
      heartbeatSec: 86400,
      deviationBps: 50,
    },
    {
      address: "0x975043adBb80fc32276CbF9Bbcfd4A601a12462D",
      pair: "SOL / USD",
      heartbeatSec: 86400,
      deviationBps: 50,
    },
    {
      address: "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B",
      pair: "USDC / USD",
      heartbeatSec: 86400,
      deviationBps: 30,
    },
    {
      address: "0x43a5C292A453A3bF3606fa856197f09D7B74251a",
      pair: "WSTETH / ETH",
      heartbeatSec: 86400,
      deviationBps: 50,
    },
    {
      address: "0x9f0C1dD78C4CBdF5b9cf923a549A201EdC676D34",
      pair: "XRP / USD",
      heartbeatSec: 86400,
      deviationBps: 50,
    },
    {
      address: "0x868a501e68F3D1E89CfC0D22F6b22E8dabce5F04",
      pair: "cbETH-ETH Exchange Rate",
      heartbeatSec: 86400,
      deviationBps: 50,
    },
    {
      address: "0x35e9D7001819Ea3B39Da906aE6b06A62cfe2c181",
      pair: "weETH / eETH Exchange Rate",
      heartbeatSec: 86400,
      deviationBps: 50,
    },
    {
      address: "0xa669E5272E60f78299F4824495cE01a3923f4380",
      pair: "wstETH-ETH Exchange Rate",
      heartbeatSec: 86400,
      deviationBps: 50,
    },
    {
      address: "0xB88BAc61a4Ca37C43a3725912B1f472c9A5bc061",
      pair: "wstETH-stETH Exchange Rate",
      heartbeatSec: 86400,
      deviationBps: 0,
    },
  ],
};

/**
 * How far past its heartbeat a feed may drift before we treat it as dead.
 *
 * NOT a tolerance for "the price is a bit old" — Morpho's own
 * `ChainlinkDataFeedLib` documents that it does not check staleness at all, so
 * this is our own guard, and its job is to notice a DECOMMISSIONED feed rather
 * than to police normal jitter.
 *
 * Why a multiple and not the heartbeat itself: measured on 2026-08-19, healthy
 * 24h-heartbeat feeds routinely sit at 79k–86k seconds since their last update
 * (they publish on deviation OR heartbeat, whichever comes first). Rejecting at
 * exactly the heartbeat would flip live markets to Manual and back several
 * times a day — the intermittent-failure behaviour §11.3 exists to avoid — while
 * catching nothing a 2× bound misses.
 */
export const FEED_STALENESS_FACTOR = 2;

/** The reviewed feed pin for an address, or `null` when it was never reviewed. */
export function chainlinkFeed(
  chainId: number,
  address: string | undefined,
): ChainlinkFeedPin | null {
  if (!address) return null;
  const needle = address.toLowerCase();
  return (
    CHAINLINK_FEEDS[chainId]?.find((f) => f.address.toLowerCase() === needle) ??
    null
  );
}

/** The `MorphoChainlinkOracleV2Factory` for a chain, or `null` when unpinned. */
export function morphoChainlinkOracleFactory(chainId: number): Address | null {
  return MORPHO_CHAINLINK_ORACLE_FACTORIES[chainId] ?? null;
}
