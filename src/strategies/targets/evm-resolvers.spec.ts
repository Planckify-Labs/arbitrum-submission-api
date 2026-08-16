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
import { aaveForkResolver, SparkLendResolver } from "./aave-fork.resolver";
import { loadChainDirectory } from "./chain-directory";
import { CompoundV3Resolver, VenusResolver } from "./compound.resolver";
import { CurveResolver } from "./curve.resolver";
import { resetCandidateVaultCache } from "./candidates/onchain.source";
import {
  registerCandidateSource,
  resetCandidateSources,
} from "./candidates/registry";
import {
  PoolsOldCandidateSource,
  resetPoolAddressIndex,
} from "./defillama-pool-address";
import {
  EulerResolver,
  SkySavingsResolver,
  SparkSavingsResolver,
} from "./erc4626-family.resolver";
import { LstStakeResolver } from "./lst.resolver";
import { MorphoBlueResolver } from "./morpho-blue.resolver";
import { deriveMorphoMarketId } from "./validation";
import type { EvmReadClient, ResolverContext } from "./types";

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
  it("resolves a pinned sUSDS vault by (chain, underlying)", async () => {
    const target = await SkySavingsResolver.resolve(
      pool({ project: "sky-lending", underlyingTokens: [USDS] }),
      ctxWith({ validate: true }),
    );
    expect(target).toEqual({
      kind: "erc4626",
      vault: "0xa3931d71877c0e7a3148cb7eb4463524fec27fbd",
      asset: USDS.toLowerCase(),
    });
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

  function morphoCtx(items: unknown[]): ResolverContext {
    return {
      fetchJsonCached: async <T>() =>
        ({ data: { markets: { items } } }) as unknown as T,
      validate: async () => true,
    };
  }

  it("fails closed when the market's oracle is not on the reviewed allowlist", async () => {
    // §12 Q6: a lender inherits bad-debt risk from a manipulated oracle, so an
    // unreviewed oracle is not a market we route into. The seeded allowlist
    // has no oracles yet, so every market must be refused.
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
          state: { supplyAssetsUsd: 1_000_000 },
        },
      ]),
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

    expect(getResolversForProject("spark-savings").map((r) => r.family)).toEqual(
      ["spark-savings"],
    );
    // The lending resolver still owns its own slugs.
    expect(getResolversForProject("sparklend").map((r) => r.family)).toEqual([
      "sparklend",
    ]);

    // USDC has no pinned Spark savings vault, so the pool must resolve to
    // nothing rather than to SparkLend's Pool.
    const target = await resolveTarget(
      pool({
        project: "spark-savings",
        underlyingTokens: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"],
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
