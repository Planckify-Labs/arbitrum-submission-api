/**
 * Morpho Blue oracle / IRM gate (spec §11 Layer-1, §12 Q6).
 *
 * **Why a lender needs this.** Supplying to an isolated market looks like a
 * pure lending position, but you inherit the market's bad-debt risk: if the
 * oracle can be manipulated, borrowers escape liquidation and the loss lands on
 * suppliers. A market's `oracle` and `irm` are therefore part of its identity,
 * not incidental config, and a market whose oracle we have not vetted is one we
 * do not route funds into.
 *
 * **What changed, and why.** This gate used to be a per-market address list.
 * The intent was right and the shape was wrong: Morpho has thousands of markets
 * and each one deploys its own oracle instance, so the list could never be kept
 * current and shipped empty — which rejected the entire family, permanently and
 * silently. The check is now on PROVENANCE, which is the property markets
 * actually share, and it is strictly stronger than a list of addresses someone
 * transcribed:
 *
 *   L1. `irm` is a pinned, reviewed interest-rate model.
 *   L2. The oracle was deployed by the pinned `MorphoChainlinkOracleV2Factory`
 *       — its price math is Morpho's audited code, and because that contract
 *       keeps its whole wiring in immutables, an oracle that passes can never
 *       be re-pointed later.
 *   L3. Every feed the oracle actually reads, read back FROM THE ORACLE, is a
 *       reviewed Chainlink feed. This is the half that does the real work:
 *       `createMorphoChainlinkOracleV2` is permissionless, so factory
 *       membership alone would happily admit an oracle whose `baseFeed1` is a
 *       contract the market creator controls.
 *   L4. The oracle does not route through an ERC-4626 vault. A vault in the
 *       pricing path means `convertToAssets` moves the price, which is a second
 *       trust assumption on a contract this book has not reviewed.
 *   L5. Every feed is alive: positive answer, updated within
 *       `FEED_STALENESS_FACTOR × heartbeat`. Morpho's own
 *       `ChainlinkDataFeedLib` documents that it does NOT check staleness, so a
 *       decommissioned feed would otherwise price a market forever.
 *
 * Everything above L1 is read on chain at resolve time. Morpho's API is used
 * only to ENUMERATE candidate markets; its `oracle { address }` is a hint we
 * re-derive from the chain, never evidence (§11 Layer-6). A market that fails
 * any step resolves to `null` → Manual deep-link (§8.2).
 */

import {
  CHAINLINK_FEEDS,
  FEED_STALENESS_FACTOR,
  chainlinkFeed,
  morphoChainlinkOracleFactory,
} from "./address-book";
import type { Address, EvmReadClient } from "./types";
import { eqAddr } from "./types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Morpho's canonical AdaptiveCurveIRM is the only IRM used by curated markets
 * on both live deployments. Verified 2026-08-19 against `morpho-org/sdks`
 * (`adaptiveCurveIrm`). An empty/absent entry rejects every market on that
 * chain.
 */
const IRM_ALLOWLIST: Readonly<Record<number, readonly Address[]>> = {
  1: ["0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC"], // AdaptiveCurveIRM
  8453: ["0x46415998764C29aB2a25CbeA6254146D50D22687"], // AdaptiveCurveIRM (Base)
};

const FACTORY_ABI = [
  {
    type: "function",
    name: "isMorphoChainlinkOracleV2",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/**
 * The immutable getters on `MorphoChainlinkOracleV2`. A contract that does not
 * answer all six is not one — which is itself a rejection, not an error to
 * swallow.
 */
const ORACLE_ABI = [
  "BASE_FEED_1",
  "BASE_FEED_2",
  "QUOTE_FEED_1",
  "QUOTE_FEED_2",
  "BASE_VAULT",
  "QUOTE_VAULT",
].map((name) => ({
  type: "function" as const,
  name,
  stateMutability: "view" as const,
  inputs: [],
  outputs: [{ name: "", type: "address" }],
}));

const FEED_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

/** The oracle wiring, as read from the oracle itself. */
const FEED_GETTERS = [
  "BASE_FEED_1",
  "BASE_FEED_2",
  "QUOTE_FEED_1",
  "QUOTE_FEED_2",
] as const;
const VAULT_GETTERS = ["BASE_VAULT", "QUOTE_VAULT"] as const;

/**
 * Why a market was refused. Surfaced by `pnpm defi:dry-run` so "this pool is
 * Manual" always has an answer, which is the failure mode the old empty
 * allowlist got wrong — it rejected everything and said nothing.
 */
export type MorphoOracleRejection =
  | "irm-not-allowlisted"
  | "no-factory-pinned"
  | "not-factory-deployed"
  | "not-a-chainlink-oracle-v2"
  | "routes-through-erc4626-vault"
  | "no-price-feed"
  | "feed-not-reviewed"
  | "feed-stale-or-dead"
  | "unreadable";

export interface MorphoOracleVerdict {
  readonly ok: boolean;
  readonly reason?: MorphoOracleRejection;
  /** The offending or accepted feeds, for the dry-run log. */
  readonly detail?: string;
}

function isNonZero(a: unknown): a is string {
  return typeof a === "string" && !eqAddr(a, ZERO_ADDRESS);
}

/** True when `irm` is a reviewed interest-rate model on this chain. */
export function isMorphoIrmAllowlisted(
  chainId: number,
  irm: string | undefined,
): boolean {
  return (IRM_ALLOWLIST[chainId] ?? []).some((a) => eqAddr(a, irm));
}

/**
 * Prove a market's oracle is one we are willing to lend behind.
 *
 * Fails closed on every unexpected condition, including an RPC that will not
 * answer: "we could not check" and "the check failed" get the same verdict,
 * because the alternative is routing funds on the strength of a timeout.
 */
export async function verifyMorphoOracle(
  client: EvmReadClient,
  chainId: number,
  oracle: string | undefined,
  irm: string | undefined,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<MorphoOracleVerdict> {
  if (!isMorphoIrmAllowlisted(chainId, irm))
    return { ok: false, reason: "irm-not-allowlisted", detail: irm };
  if (!isNonZero(oracle))
    return { ok: false, reason: "not-a-chainlink-oracle-v2", detail: oracle };

  const factory = morphoChainlinkOracleFactory(chainId);
  if (!factory) return { ok: false, reason: "no-factory-pinned" };

  const oracleAddress = oracle as Address;

  try {
    // L2 — the oracle's CODE is Morpho's audited implementation.
    const deployed = await client.readContract({
      address: factory,
      abi: FACTORY_ABI,
      functionName: "isMorphoChainlinkOracleV2",
      args: [oracleAddress],
    });
    if (deployed !== true)
      return { ok: false, reason: "not-factory-deployed", detail: oracle };

    // L3/L4 — read the wiring back off the oracle, not out of the API payload.
    const wiring = await Promise.all(
      [...FEED_GETTERS, ...VAULT_GETTERS].map((functionName) =>
        client.readContract({
          address: oracleAddress,
          abi: ORACLE_ABI,
          functionName,
        }),
      ),
    );
    const feeds = wiring.slice(0, FEED_GETTERS.length).filter(isNonZero);
    const vaults = wiring.slice(FEED_GETTERS.length).filter(isNonZero);

    if (vaults.length > 0)
      return {
        ok: false,
        reason: "routes-through-erc4626-vault",
        detail: vaults.join(","),
      };
    // Every feed zero means `getPrice` returns a constant 1 for each leg — a
    // hardcoded price wearing an oracle's interface.
    if (feeds.length === 0) return { ok: false, reason: "no-price-feed" };

    const unreviewed = feeds.filter((f) => !chainlinkFeed(chainId, f));
    if (unreviewed.length > 0)
      return {
        ok: false,
        reason: "feed-not-reviewed",
        detail: unreviewed.join(","),
      };

    // L5 — liveness. Sequential on purpose: this runs after the cheap checks
    // have already excluded the overwhelming majority of markets.
    for (const feed of feeds) {
      const pin = chainlinkFeed(chainId, feed);
      if (!pin) return { ok: false, reason: "feed-not-reviewed", detail: feed };
      const round = (await client.readContract({
        address: pin.address,
        abi: FEED_ABI,
        functionName: "latestRoundData",
      })) as readonly [bigint, bigint, bigint, bigint, bigint];
      const answer = round[1];
      const updatedAt = Number(round[3]);
      if (answer <= 0n || updatedAt <= 0)
        return {
          ok: false,
          reason: "feed-stale-or-dead",
          detail: `${pin.pair} answer=${answer}`,
        };
      const age = nowSec - updatedAt;
      if (age > pin.heartbeatSec * FEED_STALENESS_FACTOR)
        return {
          ok: false,
          reason: "feed-stale-or-dead",
          detail: `${pin.pair} age=${age}s heartbeat=${pin.heartbeatSec}s`,
        };
    }

    return {
      ok: true,
      detail: feeds
        .map((f) => chainlinkFeed(chainId, f)?.pair ?? f)
        .join(" · "),
    };
  } catch {
    // A missing getter (not a MorphoChainlinkOracleV2), a reverting feed, or an
    // unreachable RPC. All of them mean the same thing here.
    return { ok: false, reason: "unreadable", detail: oracle };
  }
}

/** Diagnostics for the boot log / dry run — never used for matching. */
export function morphoAllowlistSize(chainId: number): {
  irms: number;
  feeds: number;
  factory: boolean;
} {
  return {
    irms: (IRM_ALLOWLIST[chainId] ?? []).length,
    feeds: (CHAINLINK_FEEDS[chainId] ?? []).length,
    factory: !!morphoChainlinkOracleFactory(chainId),
  };
}
