/**
 * EVM protocol-expansion resolvers (docs/defi-evm-protocol-expansion-spec.md).
 *
 * The behaviour under test is almost entirely **refusal**: §8.2 makes
 * fail-closed the property that lets this system route user funds at all, so
 * these cases assert that an ambiguous, unpinned or unverifiable pool resolves
 * to `null` (→ Manual) rather than to a plausible-looking address.
 *
 * Network and on-chain reads are stubbed through a fake `ResolverContext`, so
 * what's exercised is the matching logic, not an RPC.
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import { SparkLendResolver, aaveForkResolver } from "./aave-fork.resolver";
import { resetCandidateVaultCache } from "./candidates/onchain.source";
import {
  registerCandidateSource,
  resetCandidateSources,
} from "./candidates/registry";
import { loadChainDirectory } from "./chain-directory";
import { CompoundV3Resolver, VenusResolver } from "./compound.resolver";
import { CurveResolver } from "./curve.resolver";
import {
  PoolsOldCandidateSource,
  resetPoolAddressIndex,
} from "./defillama-pool-address";
import {
  EulerResolver,
  SkySavingsResolver,
  SparkSavingsResolver,
} from "./erc4626-family.resolver";
import { MorphoResolver } from "./erc4626.resolver";
import { LstStakeResolver } from "./lst.resolver";
import { MorphoBlueResolver } from "./morpho-blue.resolver";
import type { EvmReadClient, ResolverContext } from "./types";
import { deriveMorphoMarketId } from "./validation";

const UNDERLYING = "0x1111111111111111111111111111111111111111";
const CANDIDATE = "0x2222222222222222222222222222222222222222";
const USDS = "0xdC035D45d973E3EC169d2276DDab16f1e407384F";

/** Chains are data — load the directory the same way the service does. */
beforeAll(() => {
  loadChainDirectory([
    {
      chainId: 1,
      name: "Ethereum",
      chainSlug: "ethereum",
      rpcUrl: "https://rpc.example/eth",
      family: "EVM",
      isTestnet: false,
    },
    {
      chainId: 8453,
      name: "Base",
      chainSlug: "base",
      rpcUrl: "https://rpc.example/base",
      family: "EVM",
      isTestnet: false,
    },
    {
      chainId: null,
      name: "Sui",
      chainSlug: "sui",
      rpcUrl: "https://rpc.example/sui",
      family: "MOVE_VM",
      isTestnet: false,
    },
  ]);
});

beforeEach(() => {
  resetPoolAddressIndex();
  resetCandidateVaultCache();
  // Candidate addresses come from a registry of sources now (the on-chain
  // protocol registries first, DeFiLlama's `/poolsOld` as the generic
  // fallback). These specs exercise the `/poolsOld` path with a fixture, so
  // that one source is registered here — the on-chain sources need a live
  // chain and belong in the fork tests, not here.
  resetCandidateSources();
  registerCandidateSource(PoolsOldCandidateSource);
});

function pool(overrides: Partial<DeFiLlamaYieldPool> = {}): DeFiLlamaYieldPool {
  return {
    pool: "pool-uuid-1",
    chain: "Ethereum",
    project: "euler-v2",
    symbol: "USDC",
    tvlUsd: 5_000_000,
    apy: 5,
    ilRisk: "no",
    exposure: "single",
    underlyingTokens: [UNDERLYING],
    ...overrides,
  };
}

/**
 * `ctx` with a `/poolsOld` fixture (the UUID → address source) and a
 * pass/fail validator, plus an optional on-chain read stub.
 */
function ctxWith(opts: {
  validate: boolean;
  poolsOld?: Array<{ pool: string; pool_old: string }>;
  json?: unknown;
  client?: Partial<EvmReadClient> | null;
}): ResolverContext {
  return {
    fetchJsonCached: async <T>(_key: string, url: string) => {
      if (url.includes("poolsOld")) {
        return { data: opts.poolsOld ?? [] } as unknown as T;
      }
      return (opts.json ?? null) as T;
    },
    validate: async () => opts.validate,
    publicClient: () =>
      opts.client === null
        ? null
        : ({
            readContract: async () => {
              throw new Error("no stub");
            },
            ...opts.client,
          } as EvmReadClient),
  };
}

describe("Family A — pinned vault resolvers (§4)", () => {
  it("resolves a pinned sUSDS vault by (chain, underlying, ticker)", async () => {
    // The ticker is load-bearing now: Sky pins TWO vaults over USDS (`sUSDS`
    // and `stUSDS`), so the asset alone no longer identifies one. The live row
    // carries `symbol: "SUSDS"`, which is what selects it.
    const target = await SkySavingsResolver.resolve(
      pool({
        project: "sky-lending",
        symbol: "SUSDS",
        underlyingTokens: [USDS],
      }),
      ctxWith({ validate: true }),
    );
    expect(target).toEqual({
      kind: "erc4626",
      vault: "0xa3931d71877c0e7a3148cb7eb4463524fec27fbd",
      asset: USDS.toLowerCase(),
    });
  });

  it("resolves stUSDS, the second pinned vault over the same asset", async () => {
    const target = await SkySavingsResolver.resolve(
      pool({
        project: "sky-lending",
        symbol: "STUSDS",
        poolMeta: "Expert Mode",
        underlyingTokens: [USDS],
      }),
      ctxWith({ validate: true }),
    );
    expect(target).toEqual({
      kind: "erc4626",
      vault: "0x99cd4ec3f88a45940936f469e4bb72a2a701eeb9",
      asset: USDS.toLowerCase(),
    });
  });

  it("refuses when two pinned vaults share an asset and the row names neither", async () => {
    // The whole point of the discriminator being EXACT. An unrecognised ticker
    // is a refusal, not an invitation to pick the first or the biggest — that
    // is the Morpho mis-route (§11.6b) in miniature, and here it would be
    // choosing between two live vaults with different products behind them.
    const target = await SkySavingsResolver.resolve(
      pool({
        project: "sky-lending",
        symbol: "USDS",
        underlyingTokens: [USDS],
      }),
      ctxWith({ validate: true }),
    );
    expect(target).toBeNull();
  });

  it("does not let a ticker substring select a sibling vault", async () => {
    // `sUSDS` vs `stUSDS` would both "match" under the bidirectional
    // `includes()` matching used elsewhere. Exactness is what stops that.
    const target = await SkySavingsResolver.resolve(
      pool({
        project: "sky-lending",
        symbol: "USDS-something",
        underlyingTokens: [USDS],
      }),
      ctxWith({ validate: true }),
    );
    expect(target).toBeNull();
  });

  it("fails closed for a token the protocol has no reviewed vault for", async () => {
    const target = await SkySavingsResolver.resolve(
      pool({ project: "sky-lending", underlyingTokens: [UNDERLYING] }),
      ctxWith({ validate: true }),
    );
    expect(target).toBeNull();
  });

  it("fails closed on an unsupported chain", async () => {
    const target = await SkySavingsResolver.resolve(
      pool({ chain: "Fantom", underlyingTokens: [USDS] }),
      ctxWith({ validate: true }),
    );
    expect(target).toBeNull();
  });
});

describe("Family A — discovered vault resolvers (§12 Q1)", () => {
  it("admits a candidate purely on the validator passing", async () => {
    const target = await EulerResolver.resolve(
      pool(),
      ctxWith({
        validate: true,
        poolsOld: [{ pool: "pool-uuid-1", pool_old: `${CANDIDATE}-ethereum` }],
      }),
    );
    expect(target).toEqual({
      kind: "erc4626",
      vault: CANDIDATE.toLowerCase(),
      asset: UNDERLYING,
    });
  });

  it("fails closed when the on-chain validator rejects the candidate", async () => {
    // §12 Q1: the validator IS the verification. No validator, no target.
    const target = await EulerResolver.resolve(
      pool(),
      ctxWith({
        validate: false,
        poolsOld: [{ pool: "pool-uuid-1", pool_old: `${CANDIDATE}-ethereum` }],
      }),
    );
    expect(target).toBeNull();
  });

  it("fails closed when the legacy id is a slug rather than an address", async () => {
    const target = await EulerResolver.resolve(
      pool(),
      ctxWith({
        validate: true,
        poolsOld: [{ pool: "pool-uuid-1", pool_old: "euler-usdc-ethereum" }],
      }),
    );
    expect(target).toBeNull();
  });

  it("refuses a candidate that is just the deposited token", async () => {
    // An address that IS the underlying can never be the vault holding it.
    const target = await EulerResolver.resolve(
      pool(),
      ctxWith({
        validate: true,
        poolsOld: [{ pool: "pool-uuid-1", pool_old: `${UNDERLYING}-ethereum` }],
      }),
    );
    expect(target).toBeNull();
  });
});

describe("Family B — Aave-fork resolvers (§5.3b)", () => {
  it("emits an aave-v3 target using the fork's PINNED Pool", async () => {
    const target = await SparkLendResolver.resolve(
      pool({ project: "spark", chain: "Ethereum" }),
      ctxWith({ validate: true }),
    );
    expect(target).toEqual({
      kind: "aave-v3",
      pool: "0xC13e21B648A5Ee794902342038FF3aDAB66BE987",
      asset: UNDERLYING,
    });
  });

  it("fails closed on a chain the fork has no pinned Pool for", async () => {
    const target = await SparkLendResolver.resolve(
      pool({ project: "spark", chain: "Base" }),
      ctxWith({ validate: true }),
    );
    expect(target).toBeNull();
  });

  it("fails closed for a fork whose Pool book is deliberately empty", async () => {
    // Avalon has one Pool per market, so there is no single address we can
    // pin — the resolver exists but must never guess one.
    const avalon = aaveForkResolver({ family: "avalon", aliases: ["avalon"] });
    expect(
      await avalon.resolve(
        pool({ project: "avalon" }),
        ctxWith({ validate: true }),
      ),
    ).toBeNull();
  });
});

describe("Compound III (§5.1)", () => {
  it("picks the Comet whose on-chain identity validates", async () => {
    // The resolver hands candidates to the validator; the one that proves out
    // is the market. Here the first candidate is accepted.
    const target = await CompoundV3Resolver.resolve(
      pool({ project: "compound-v3" }),
      ctxWith({ validate: true }),
    );
    expect(target).toMatchObject({
      kind: "compound-v3",
      asset: UNDERLYING,
    });
  });

  it("fails closed when no Comet on the chain matches the asset", async () => {
    const target = await CompoundV3Resolver.resolve(
      pool({ project: "compound-v3" }),
      ctxWith({ validate: false }),
    );
    expect(target).toBeNull();
  });
});

describe("Compound-v2 forks (§5.4)", () => {
  it("emits a compound-v2 target for a discovered cToken", async () => {
    const target = await VenusResolver.resolve(
      pool({ project: "venus-core-pool", chain: "Ethereum" }),
      ctxWith({
        validate: true,
        poolsOld: [{ pool: "pool-uuid-1", pool_old: `${CANDIDATE}-ethereum` }],
      }),
    );
    expect(target).toEqual({
      kind: "compound-v2",
      cToken: CANDIDATE.toLowerCase(),
      asset: UNDERLYING,
    });
  });
});

describe("Morpho Blue (§5.2, §3.1)", () => {
  const ORACLE = "0x1234567890123456789012345678901234567890";
  const IRM = "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC";

  /** A reviewed Chainlink feed on Ethereum — BTC / USD. */
  const REVIEWED_FEED = "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c";
  const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

  /**
   * The oracle gate reads provenance off the CHAIN, so the ctx now needs a read
   * stub. `oracleWiring` is what the oracle claims about itself; `deployed` is
   * what the pinned factory says about the oracle.
   */
  function morphoCtx(
    items: unknown[],
    onchain: {
      deployed?: boolean;
      feeds?: readonly string[];
      client?: boolean;
    } = {},
  ): ResolverContext {
    const feeds = onchain.feeds ?? [
      REVIEWED_FEED,
      ZERO_ADDR,
      ZERO_ADDR,
      ZERO_ADDR,
    ];
    const wiring: Record<string, unknown> = {
      BASE_FEED_1: feeds[0] ?? ZERO_ADDR,
      BASE_FEED_2: feeds[1] ?? ZERO_ADDR,
      QUOTE_FEED_1: feeds[2] ?? ZERO_ADDR,
      QUOTE_FEED_2: feeds[3] ?? ZERO_ADDR,
      BASE_VAULT: ZERO_ADDR,
      QUOTE_VAULT: ZERO_ADDR,
      isMorphoChainlinkOracleV2: onchain.deployed ?? true,
      latestRoundData: [
        1n,
        100_000n,
        0n,
        BigInt(Math.floor(Date.now() / 1000)),
        1n,
      ],
    };
    return {
      fetchJsonCached: async <T>() =>
        ({ data: { markets: { items } } }) as unknown as T,
      validate: async () => true,
      publicClient: () =>
        onchain.client === false
          ? null
          : ({
              readContract: async ({ functionName }) => wiring[functionName],
            } as EvmReadClient),
    };
  }

  const market = (overrides: Record<string, unknown> = {}) => ({
    marketId: `0x${"ab".repeat(32)}`,
    lltv: "860000000000000000",
    oracle: { address: ORACLE },
    irmAddress: IRM,
    listed: true,
    loanAsset: { address: UNDERLYING },
    collateralAsset: { address: CANDIDATE },
    state: { supplyAssetsUsd: 1_000_000 },
    ...overrides,
  });

  it("resolves a market whose oracle provenance proves out on chain", async () => {
    // The positive half of §12 Q6, and the reason the gate was rewritten: the
    // old per-market allowlist shipped empty, so this case was unreachable and
    // the whole family sat on Manual. If this ever goes back to null, Morpho
    // Blue has gone dark again.
    const target = await MorphoBlueResolver.resolve(
      pool({ project: "morpho-blue" }),
      morphoCtx([market()]),
    );
    expect(target).toMatchObject({
      kind: "morpho-blue",
      asset: UNDERLYING,
      params: { oracle: ORACLE.toLowerCase(), irm: IRM.toLowerCase() },
    });
  });

  it("fails closed when the oracle was not deployed by the pinned factory", async () => {
    // §12 Q6: a lender inherits bad-debt risk from a manipulated oracle, so an
    // oracle whose code we cannot attribute is not one we route into.
    const target = await MorphoBlueResolver.resolve(
      pool({ project: "morpho-blue" }),
      morphoCtx([market()], { deployed: false }),
    );
    expect(target).toBeNull();
  });

  it("fails closed when a factory oracle reads an unreviewed feed", async () => {
    // Factory membership alone is not enough: creating an oracle is
    // permissionless, so the feeds are where the attacker actually gets in.
    const target = await MorphoBlueResolver.resolve(
      pool({ project: "morpho-blue" }),
      morphoCtx([market()], {
        feeds: ["0x00000000000000000000000000000000DeadBeef"],
      }),
    );
    expect(target).toBeNull();
  });

  it("fails closed when it cannot reach the chain to check at all", async () => {
    // "Could not verify" must resolve the same way as "failed verification".
    const target = await MorphoBlueResolver.resolve(
      pool({ project: "morpho-blue" }),
      morphoCtx([market()], { client: false }),
    );
    expect(target).toBeNull();
  });

  it("fails closed on a market with no supply side", async () => {
    const target = await MorphoBlueResolver.resolve(
      pool({ project: "morpho-blue" }),
      morphoCtx([
        {
          marketId: `0x${"ab".repeat(32)}`,
          lltv: "860000000000000000",
          oracle: { address: ORACLE },
          irmAddress: IRM,
          listed: true,
          loanAsset: { address: UNDERLYING },
          collateralAsset: { address: CANDIDATE },
          state: { supplyAssetsUsd: 0 },
        },
      ]),
    );
    expect(target).toBeNull();
  });

  it("derives a stable marketId from the struct", () => {
    // This is the identity the validator re-checks; it must be deterministic
    // and it must change when any field does (§3.1).
    const params = {
      loanToken: UNDERLYING as `0x${string}`,
      collateralToken: CANDIDATE as `0x${string}`,
      oracle: ORACLE as `0x${string}`,
      irm: IRM as `0x${string}`,
      lltv: "860000000000000000",
    };
    const id = deriveMorphoMarketId(params);
    expect(id).toMatch(/^0x[0-9a-f]{64}$/);
    expect(deriveMorphoMarketId(params)).toBe(id);
    expect(
      deriveMorphoMarketId({ ...params, lltv: "770000000000000000" }),
    ).not.toBe(id);
  });
});

describe("Curve LP (§5.3)", () => {
  it("refuses a pool whose coin index is ambiguous", async () => {
    // A duplicate-asset pool is exactly where a guessed index deposits into
    // the wrong leg.
    const coins = [UNDERLYING, UNDERLYING, null];
    const target = await CurveResolver.resolve(
      pool({ project: "curve-dex" }),
      ctxWith({
        validate: true,
        poolsOld: [{ pool: "pool-uuid-1", pool_old: `${CANDIDATE}-ethereum` }],
        client: {
          readContract: async ({ args }) => {
            const i = Number((args as [bigint])[0]);
            const coin = coins[i];
            if (!coin) throw new Error("revert");
            return coin;
          },
        },
      }),
    );
    expect(target).toBeNull();
  });

  it("refuses a pool whose ABI generation cannot be determined", async () => {
    const coins = [UNDERLYING, CANDIDATE, null];
    const target = await CurveResolver.resolve(
      pool({ project: "curve-dex" }),
      ctxWith({
        validate: true,
        poolsOld: [{ pool: "pool-uuid-1", pool_old: `${CANDIDATE}-ethereum` }],
        client: {
          readContract: async ({ functionName, args }) => {
            if (functionName === "coins") {
              const i = Number((args as [bigint])[0]);
              const coin = coins[i];
              if (!coin) throw new Error("revert");
              return coin;
            }
            // Neither calc_withdraw_one_coin signature answers.
            throw new Error("revert");
          },
        },
      }),
    );
    expect(target).toBeNull();
  });

  it("fails closed when no RPC client is available", async () => {
    const target = await CurveResolver.resolve(
      pool({ project: "curve-dex" }),
      ctxWith({ validate: true, client: null }),
    );
    expect(target).toBeNull();
  });

  it("refuses a classic pool whose LP token is a separate contract", async () => {
    // `curveLp.ts:lpTokenOf` returns `target.pool`, i.e. the mobile adapter
    // assumes the pool IS its LP token. True for Curve NG, false for the
    // classic pools (3pool mints a separate ERC-20). Resolving one would give
    // an adapter that reads the user's balance off the wrong contract and
    // cannot build a `MAX` withdraw — so the resolver refuses instead, and the
    // pool degrades to Manual.
    const coins = [UNDERLYING, CANDIDATE, null];
    const target = await CurveResolver.resolve(
      pool({ project: "curve-dex" }),
      ctxWith({
        validate: true,
        poolsOld: [{ pool: "pool-uuid-1", pool_old: `${CANDIDATE}-ethereum` }],
        client: {
          readContract: async ({ functionName, args }) => {
            // A classic pool exposes neither, which is what distinguishes it.
            if (
              functionName === "totalSupply" ||
              functionName === "balanceOf"
            ) {
              throw new Error("revert: not an LP token");
            }
            if (functionName === "calc_withdraw_one_coin") return 1n;
            const i = Number((args as [bigint])[0]);
            const coin = coins[i];
            if (!coin) throw new Error("revert");
            return coin;
          },
        },
      }),
    );
    expect(target).toBeNull();
  });

  it("accepts an NG pool that is its own LP token", async () => {
    const coins = [UNDERLYING, CANDIDATE, null];
    const target = await CurveResolver.resolve(
      pool({ project: "curve-dex" }),
      ctxWith({
        validate: true,
        poolsOld: [{ pool: "pool-uuid-1", pool_old: `${CANDIDATE}-ethereum` }],
        client: {
          readContract: async ({ functionName, args }) => {
            if (functionName === "totalSupply") return 10n ** 21n;
            if (functionName === "balanceOf") return 0n;
            if (functionName === "calc_withdraw_one_coin") return 1n;
            const i = Number((args as [bigint])[0]);
            const coin = coins[i];
            if (!coin) throw new Error("revert");
            return coin;
          },
        },
      }),
    );
    expect(target).toMatchObject({ kind: "curve-lp", nCoins: 2, index: 0 });
  });
});

describe("LST venues (§6.4)", () => {
  it("carries the venue's honest exit path onto the target", async () => {
    const target = await LstStakeResolver.resolve(
      pool({ project: "ether.fi-stake", underlyingTokens: [] }),
      ctxWith({ validate: true }),
    );
    // ether.fi withdrawals are queued, and the target has to say so or the UI
    // will promise an instant exit (§12 Q2).
    expect(target).toMatchObject({ kind: "lst-stake", exit: "queue" });
  });

  it("fails closed for a venue not deployed on the pool's chain", async () => {
    const target = await LstStakeResolver.resolve(
      pool({ project: "benqi-staked-avax", chain: "Ethereum" }),
      ctxWith({ validate: true }),
    );
    expect(target).toBeNull();
  });
});

describe("chain directory is the source of chain support", () => {
  it("treats a chain absent from the directory as unsupported", async () => {
    const target = await EulerResolver.resolve(
      pool({ chain: "SomeBrandNewChain" }),
      ctxWith({
        validate: true,
        poolsOld: [{ pool: "pool-uuid-1", pool_old: `${CANDIDATE}-x` }],
      }),
    );
    expect(target).toBeNull();
  });

  it("treats a non-EVM chain as having no EVM chainId", async () => {
    const target = await EulerResolver.resolve(
      pool({ chain: "Sui" }),
      ctxWith({
        validate: true,
        poolsOld: [{ pool: "pool-uuid-1", pool_old: `${CANDIDATE}-sui` }],
      }),
    );
    expect(target).toBeNull();
  });
});

describe("registry ordered fallback (§12 Q3)", () => {
  it("tries every claimant for a slug and takes the first confident answer", async () => {
    // §12 Q3 requires the 4626-wrapper resolver to be tried BEFORE the raw
    // cToken one for the same protocol. That is only expressible if the
    // registry falls through on `null` instead of stopping at the first
    // resolver that claims the slug.
    const { registerResolver, resolveTarget, getResolversForProject } =
      require("./registry") as typeof import("./registry");

    const attempts: string[] = [];
    registerResolver({
      family: "test-wrapper",
      aliases: ["test-protocol"],
      async resolve() {
        attempts.push("wrapper");
        return null; // no wrapper for this market
      },
    });
    registerResolver({
      family: "test-ctoken",
      aliases: ["test-protocol"],
      async resolve() {
        attempts.push("ctoken");
        return {
          kind: "compound-v2",
          cToken: CANDIDATE as `0x${string}`,
          asset: UNDERLYING as `0x${string}`,
        };
      },
    });

    expect(
      getResolversForProject("test-protocol").map((r) => r.family),
    ).toEqual(["test-wrapper", "test-ctoken"]);

    const target = await resolveTarget(
      pool({ project: "test-protocol" }),
      ctxWith({ validate: true }),
    );
    expect(attempts).toEqual(["wrapper", "ctoken"]);
    expect(target).toMatchObject({ kind: "compound-v2" });
  });

  it("never lets a substring look-alike claim a slug an exact resolver owns", async () => {
    // The regression this rule exists for, in miniature. `spark-savings` (the
    // sUSDS/sDAI ERC-4626 vaults) contains "spark", so SparkLend claimed it as
    // a substring match. The savings resolver correctly declined for USDC —
    // only sUSDS and sDAI are pinned — and the ordered fallback then resolved
    // the pool onto SparkLend's LENDING Pool. A savings deposit would have
    // become a lending position.
    //
    // Ownership is exclusive: if the exact claimant declines, the answer is
    // "no target" (→ Manual), not "let the look-alike try".
    const { registerResolver, getResolversForProject, resolveTarget } =
      require("./registry") as typeof import("./registry");
    // The real pair, registered here because this spec drives resolvers
    // directly rather than through the flag-gated bootstrap.
    registerResolver(SparkLendResolver);
    registerResolver(SparkSavingsResolver);

    expect(
      getResolversForProject("spark-savings").map((r) => r.family),
    ).toEqual(["spark-savings"]);
    // The lending resolver still owns its own slugs.
    expect(getResolversForProject("sparklend").map((r) => r.family)).toEqual([
      "sparklend",
    ]);

    // WBTC has no pinned Spark savings vault, so the pool must resolve to
    // nothing rather than to SparkLend's Pool.
    //
    // This used to use USDC, which stopped being a valid example the day
    // `spUSDC` was pinned — the assertion would then have passed or failed for
    // a reason that has nothing to do with the look-alike rule. Pick an asset
    // the protocol genuinely has no vault for, and say so, so the next person
    // who adds a pin knows why this token was chosen.
    const target = await resolveTarget(
      pool({
        project: "spark-savings",
        underlyingTokens: ["0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"],
      }),
      ctxWith({ validate: true }),
    );
    expect(target).toBeNull();
  });

  it("still reaches a resolver by substring when nobody claims the slug exactly", async () => {
    // The behaviour the substring pass exists for must survive the fix.
    const { registerResolver, getResolversForProject } =
      require("./registry") as typeof import("./registry");
    registerResolver(SparkLendResolver);
    expect(
      getResolversForProject("sparklend-something").map((r) => r.family),
    ).toContain("sparklend");
  });

  it("treats a throwing resolver as 'not mine' rather than failing the pool", async () => {
    const { registerResolver, resolveTarget } =
      require("./registry") as typeof import("./registry");
    registerResolver({
      family: "test-flaky",
      aliases: ["test-flaky-protocol"],
      async resolve() {
        throw new Error("upstream API down");
      },
    });
    registerResolver({
      family: "test-backup",
      aliases: ["test-flaky-protocol"],
      async resolve() {
        return {
          kind: "erc4626",
          vault: CANDIDATE as `0x${string}`,
          asset: UNDERLYING as `0x${string}`,
        };
      },
    });
    const target = await resolveTarget(
      pool({ project: "test-flaky-protocol" }),
      ctxWith({ validate: true }),
    );
    expect(target).toMatchObject({ kind: "erc4626" });
  });
});

/**
 * The deep-link address is an EXCLUSIVE claim (§11.6b).
 *
 * This is a regression suite for a mis-route that was live and silent: 25 of 69
 * resolving Morpho pools, ~$478M, deposited into a different vault than their
 * row described, because `pickByCandidateAddress` ran only as a FALLBACK. When
 * the named address was not in the candidate set it returned null, and the
 * fuzzy label matcher then produced a confident wrong answer — a same-symbol,
 * same-asset, different-product vault that `validateErc4626` happily accepted.
 *
 * The three cases below are the whole contract.
 */
describe("deep-link address outranks the label (§11.6b)", () => {
  const MORPHO_API = "https://api.morpho.org/graphql";
  const LINKED = "0xaaaa000000000000000000000000000000000001";
  const LOOKALIKE = "0xbbbb000000000000000000000000000000000002";

  /** Two vaults, same symbol, same asset — the shape that caused the bug. */
  const VAULTS = {
    data: {
      vaults: {
        items: [
          {
            address: LINKED,
            name: "Steakhouse Prime USDC",
            symbol: "steakUSDC",
            listed: true,
            asset: { address: UNDERLYING },
          },
          {
            address: LOOKALIKE,
            name: "Steakhouse USDC",
            symbol: "steakUSDC",
            listed: true,
            asset: { address: UNDERLYING },
          },
        ],
      },
    },
  };

  /** A source that names `address` for every pool, or none at all. */
  function linkSource(address: string | null) {
    registerCandidateSource({
      id: "test-deep-link",
      projects: ["morpho-blue"],
      candidate: async () => address as never,
    });
  }

  function morphoCtx(): ResolverContext {
    return {
      fetchJsonCached: async <T>(_key: string, url: string) =>
        (url === MORPHO_API ? VAULTS : null) as T,
      validate: async () => true,
      publicClient: () => null,
    };
  }

  const morphoPool = () =>
    pool({
      project: "morpho-blue",
      symbol: "steakUSDC",
      underlyingTokens: [UNDERLYING],
    });

  beforeEach(() => {
    resetCandidateSources();
  });

  it("uses the linked vault even when the label is ambiguous", async () => {
    // Two vaults share the symbol, so the label alone is a refusal. The link
    // decides, and it must decide in favour of the address it names.
    linkSource(LINKED);
    const target = await MorphoResolver.resolve(morphoPool(), morphoCtx());
    expect(target).toEqual({
      kind: "erc4626",
      vault: LINKED,
      asset: UNDERLYING.toLowerCase(),
    });
  });

  it("REFUSES when the link names a vault the registry does not list", async () => {
    // The exact mis-route. The link names a Morpho Vault V2 (invisible to the
    // V1 `vaults` query), so no candidate matches. Falling back to the label
    // here is what deposited users into a look-alike; the honest answer is
    // Manual.
    linkSource("0xcccc000000000000000000000000000000000003");
    const target = await MorphoResolver.resolve(morphoPool(), morphoCtx());
    // A non-null here means the resolver fell back to a label match after the
    // protocol named a vault we cannot vouch for — the $478M mis-route.
    expect(target).toBeNull();
  });

  it("still falls back to the label when there is no link at all", async () => {
    // No address available is different from a contradicted one: labels are
    // then the only signal, and a UNIQUE label match is still trustworthy.
    linkSource(null);
    const unique = await MorphoResolver.resolve(
      pool({
        project: "morpho-blue",
        symbol: "Steakhouse Prime USDC",
        underlyingTokens: [UNDERLYING],
      }),
      morphoCtx(),
    );
    expect(unique).toEqual({
      kind: "erc4626",
      vault: LINKED,
      asset: UNDERLYING.toLowerCase(),
    });
  });
});

describe("Sky non-deposit rows are refused by rule, not by luck (§11.5c)", () => {
  // Sky publishes a row per Maker ILK — a CDP collateral type — alongside its
  // savings vaults. Those rows describe collateral you LOCK to borrow, not
  // something you supply, and leveraged positions are a §1 non-goal.
  //
  // They already refused before `skipPool` existed, but only because the `sky`
  // book pins no WETH/WBTC vault for the candidate step to match. That is the
  // `aave-v4` reasoning: fine until someone pins one, at which point a
  // borrow-side row resolves into a supply vault AND VALIDATES, because the
  // asset genuinely matches. These assert the refusal happens by name, up
  // front, so it cannot be undone by a later book edit.
  const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

  it.each(["ETH-A", "ETH-B", "ETH-C", "WSTETH-A", "WBTC-C"])(
    "refuses the %s ilk row without consulting the book",
    async (meta) => {
      // `validate: true` is deliberate: even a validator that would say yes to
      // anything must not rescue these, which is what proves the refusal is
      // structural rather than incidental.
      const target = await SkySavingsResolver.resolve(
        pool({
          project: "sky-lending",
          symbol: "WETH",
          poolMeta: meta,
          underlyingTokens: [WETH],
        }),
        ctxWith({ validate: true }),
      );
      expect(target).toBeNull();
    },
  );

  it("refuses the SKY Staking Engine row", async () => {
    expect(
      await SkySavingsResolver.resolve(
        pool({
          project: "sky-lending",
          symbol: "SKY",
          poolMeta: "SKY Staking Engine",
          underlyingTokens: ["0x56072C95FAA701256059aa122697B133aDEd9279"],
        }),
        ctxWith({ validate: true }),
      ),
    ).toBeNull();
  });

  it("does NOT refuse a real savings row", async () => {
    // The guard must not become a blanket refusal for the family. sUSDS and
    // sDAI carry `poolMeta: null` and are the rows that should resolve — if
    // this ever fails, the ilk regex has widened onto real deposits.
    const { isSkyNonDepositRow } = await import("./erc4626-family.resolver");
    expect(
      isSkyNonDepositRow(pool({ project: "sky-lending", poolMeta: undefined })),
    ).toBe(false);
    // Two-letter suffixes and lowercase are not the ilk convention.
    expect(
      isSkyNonDepositRow(pool({ project: "sky-lending", poolMeta: "Core" })),
    ).toBe(false);
    expect(
      isSkyNonDepositRow(
        pool({ project: "sky-lending", poolMeta: "Expert Mode" }),
      ),
    ).toBe(false);
  });
});
