/**
 * The Morpho Blue oracle gate (§12 Q6).
 *
 * These cases are written from the attacker's side: each one is a way to get an
 * oracle we did not review in front of a supplier, and every one of them must
 * end in `ok: false`. The happy path is deliberately the SHORTEST test here —
 * an allowlist is only worth what its rejections are worth.
 *
 * The client is a stub, so this suite is offline. Whether the pinned addresses
 * are the real contracts is a different question, answered by
 * `address-book/address-book-drift.spec.ts` against live chain state.
 */

import {
  CHAINLINK_FEEDS,
  MORPHO_CHAINLINK_ORACLE_FACTORIES,
} from "./address-book";
import {
  isMorphoIrmAllowlisted,
  morphoAllowlistSize,
  verifyMorphoOracle,
} from "./morpho-allowlist";
import type { EvmReadClient } from "./types";

const CHAIN = 8453;
const IRM = "0x46415998764C29aB2a25CbeA6254146D50D22687";
const FACTORY = MORPHO_CHAINLINK_ORACLE_FACTORIES[CHAIN];
const ORACLE = "0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9";
const ZERO = "0x0000000000000000000000000000000000000000";
/** A reviewed feed on Base — BTC / USD, 1200s heartbeat. */
const GOOD_FEED = CHAINLINK_FEEDS[CHAIN][1].address;
const NOW = 1_800_000_000;

interface StubOptions {
  deployed?: boolean;
  feeds?: readonly string[];
  vaults?: readonly string[];
  answer?: bigint;
  updatedAt?: number;
  /** Getters that should revert, simulating a contract that is not the oracle. */
  reverting?: readonly string[];
}

function stub(o: StubOptions = {}): EvmReadClient {
  const feeds = o.feeds ?? [GOOD_FEED, ZERO, ZERO, ZERO];
  const vaults = o.vaults ?? [ZERO, ZERO];
  const wiring: Record<string, string> = {
    BASE_FEED_1: feeds[0] ?? ZERO,
    BASE_FEED_2: feeds[1] ?? ZERO,
    QUOTE_FEED_1: feeds[2] ?? ZERO,
    QUOTE_FEED_2: feeds[3] ?? ZERO,
    BASE_VAULT: vaults[0] ?? ZERO,
    QUOTE_VAULT: vaults[1] ?? ZERO,
  };
  return {
    async readContract({ functionName }) {
      if ((o.reverting ?? []).includes(functionName))
        throw new Error("execution reverted");
      if (functionName === "isMorphoChainlinkOracleV2")
        return o.deployed ?? true;
      if (functionName === "latestRoundData")
        return [
          1n,
          o.answer ?? 100_000n,
          0n,
          BigInt(o.updatedAt ?? NOW - 60),
          1n,
        ] as const;
      const value = wiring[functionName];
      if (value === undefined)
        throw new Error(`unexpected call ${functionName}`);
      return value;
    },
  };
}

const verify = (client: EvmReadClient, oracle = ORACLE, irm = IRM) =>
  verifyMorphoOracle(client, CHAIN, oracle, irm, NOW);

describe("verifyMorphoOracle", () => {
  it("accepts a factory-deployed oracle reading only reviewed, live feeds", async () => {
    const verdict = await verify(stub());
    expect(verdict.ok).toBe(true);
    expect(verdict.detail).toContain("BTC / USD");
  });

  it("refuses an oracle the pinned factory never deployed", async () => {
    // The core provenance claim: arbitrary bytecode implementing the same
    // getters must not pass just because it answers them.
    const verdict = await verify(stub({ deployed: false }));
    expect(verdict).toMatchObject({
      ok: false,
      reason: "not-factory-deployed",
    });
  });

  it("refuses a factory oracle pointed at an unreviewed feed", async () => {
    // `createMorphoChainlinkOracleV2` is permissionless, so this is the real
    // attack: a genuine factory oracle whose feed the market creator controls.
    const attacker = "0x00000000000000000000000000000000DeadBeef";
    const verdict = await verify(stub({ feeds: [attacker, ZERO, ZERO, ZERO] }));
    expect(verdict).toMatchObject({ ok: false, reason: "feed-not-reviewed" });
    expect(verdict.detail).toContain(attacker);
  });

  it("refuses when only ONE of several feeds is unreviewed", async () => {
    // A mixed oracle is the easy thing to get wrong: a reviewed base feed makes
    // it look legitimate while the quote leg does the damage.
    const verdict = await verify(
      stub({
        feeds: [
          GOOD_FEED,
          ZERO,
          "0x00000000000000000000000000000000DeadBeef",
          ZERO,
        ],
      }),
    );
    expect(verdict).toMatchObject({ ok: false, reason: "feed-not-reviewed" });
  });

  it("refuses an oracle that prices through an ERC-4626 vault", async () => {
    const verdict = await verify(
      stub({ vaults: ["0x000000000000000000000000000000000000BEEF", ZERO] }),
    );
    expect(verdict).toMatchObject({
      ok: false,
      reason: "routes-through-erc4626-vault",
    });
  });

  it("refuses an all-zero-feed oracle (a constant price, not an oracle)", async () => {
    // `ChainlinkDataFeedLib.getPrice` returns 1 for the zero address, so this
    // contract reports a fixed price forever and never reverts.
    const verdict = await verify(stub({ feeds: [ZERO, ZERO, ZERO, ZERO] }));
    expect(verdict).toMatchObject({ ok: false, reason: "no-price-feed" });
  });

  it("refuses a feed whose price is non-positive", async () => {
    const verdict = await verify(stub({ answer: 0n }));
    expect(verdict).toMatchObject({ ok: false, reason: "feed-stale-or-dead" });
  });

  it("refuses a decommissioned feed past the staleness bound", async () => {
    // BTC/USD on Base: 1200s heartbeat, 2x bound → 2400s.
    const verdict = await verify(stub({ updatedAt: NOW - 5_000 }));
    expect(verdict).toMatchObject({ ok: false, reason: "feed-stale-or-dead" });
  });

  it("tolerates normal jitter inside the staleness bound", async () => {
    // Healthy feeds routinely run past their heartbeat; rejecting there would
    // flip live markets to Manual and back all day.
    const verdict = await verify(stub({ updatedAt: NOW - 1_500 }));
    expect(verdict.ok).toBe(true);
  });

  it("refuses an unreviewed IRM before touching the chain at all", async () => {
    let called = false;
    const client: EvmReadClient = {
      async readContract() {
        called = true;
        return true;
      },
    };
    const verdict = await verify(client, ORACLE, ZERO);
    expect(verdict).toMatchObject({ ok: false, reason: "irm-not-allowlisted" });
    expect(called).toBe(false);
  });

  it("refuses a contract missing the oracle getters", async () => {
    const verdict = await verify(stub({ reverting: ["BASE_FEED_1"] }));
    expect(verdict).toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("fails closed when the RPC cannot answer", async () => {
    // "We could not check" must never be treated as "the check passed".
    const client: EvmReadClient = {
      async readContract() {
        throw new Error("HTTP 503");
      },
    };
    const verdict = await verify(client);
    expect(verdict.ok).toBe(false);
  });

  it("refuses every market on a chain with no pinned factory", async () => {
    const verdict = await verifyMorphoOracle(stub(), 999, ORACLE, IRM, NOW);
    expect(verdict.ok).toBe(false);
  });
});

describe("IRM allowlist", () => {
  it("matches case-insensitively and rejects anything else", () => {
    expect(isMorphoIrmAllowlisted(CHAIN, IRM.toLowerCase())).toBe(true);
    expect(isMorphoIrmAllowlisted(CHAIN, ZERO)).toBe(false);
    expect(isMorphoIrmAllowlisted(999, IRM)).toBe(false);
  });
});

describe("morphoAllowlistSize", () => {
  it("reports a usable book on every supported chain", () => {
    // Guards the regression this rewrite fixed: the old book had zero oracles,
    // so the family was permanently dark and no test noticed.
    for (const chainId of Object.keys(MORPHO_CHAINLINK_ORACLE_FACTORIES)) {
      const size = morphoAllowlistSize(Number(chainId));
      expect(size.factory).toBe(true);
      expect(size.irms).toBeGreaterThan(0);
      expect(size.feeds).toBeGreaterThan(0);
    }
    expect(FACTORY).toBeTruthy();
  });
});
