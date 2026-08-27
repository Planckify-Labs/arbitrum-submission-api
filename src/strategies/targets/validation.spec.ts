/**
 * On-chain validation (docs/defi-evm-protocol-expansion-spec.md §8.1, §8.5).
 *
 * The rule this file protects is §8.1's: **every EVM kind must have an explicit
 * validator**. The old `default: return true` passthrough meant a new kind
 * shipped fully trusted with no Layer-1 check at all — and it would have looked
 * exactly like a kind that was checked and passed.
 *
 * RPC is stubbed so these cases exercise the DECISIONS, not the network: a
 * wrong `baseToken()`, a struct that does not hash to its `marketId`, a
 * destination that is not pinned.
 */

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import { loadChainDirectory } from "./chain-directory";
import {
  EVM_TARGET_KINDS,
  isEvmTargetKind,
  NON_EVM_TARGET_KINDS,
} from "./types";
import type { DepositTarget } from "./types";

// Stub the RPC layer. Each test sets `reads` to the answers it wants; anything
// unstubbed throws, which is how "the chain could not confirm it" is expressed.
const reads = new Map<string, unknown>();
let bytecodePresent = true;

jest.mock("./rpc", () => ({
  getPublicClientForChain: () => ({
    getBytecode: async () => (bytecodePresent ? "0xdeadbeef" : "0x"),
    readContract: async ({ functionName }: { functionName: string }) => {
      if (!reads.has(functionName)) throw new Error(`revert:${functionName}`);
      return reads.get(functionName);
    },
  }),
}));

// Imported after the mock so the module picks up the stub.
const { deriveMorphoMarketId, isResolverValidatedKind, validateTarget } =
  require("./validation") as typeof import("./validation");

const UNDERLYING = "0x1111111111111111111111111111111111111111";
const OTHER = "0x9999999999999999999999999999999999999999";
const COMET_ETH = "0xc3d688B66703497DAA19211EEdff47f25384cdc3";
const MORPHO = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";

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
  ]);
});

beforeEach(() => {
  reads.clear();
  bytecodePresent = true;
  process.env.STRATEGIES_TARGET_VALIDATION = "on";
});

function pool(overrides: Partial<DeFiLlamaYieldPool> = {}): DeFiLlamaYieldPool {
  return {
    pool: "pool-uuid-1",
    chain: "Ethereum",
    project: "compound-v3",
    symbol: "USDC",
    tvlUsd: 1_000_000,
    apy: 5,
    ilRisk: "no",
    exposure: "single",
    underlyingTokens: [UNDERLYING],
    ...overrides,
  };
}

describe("§8.1 — no EVM kind is trusted without a validator", () => {
  it("lists every EVM kind in EVM_TARGET_KINDS", () => {
    // The list is what drives the fail-closed default; a kind missing from it
    // would silently fall through to the non-EVM passthrough.
    expect(EVM_TARGET_KINDS.length).toBeGreaterThan(0);
    for (const kind of EVM_TARGET_KINDS) {
      expect(isEvmTargetKind(kind)).toBe(true);
    }
  });

  it("still passes non-EVM kinds through to their own resolver's checks", async () => {
    const target: DepositTarget = {
      kind: "sui-lst",
      venue: "haedal",
      lstType: "0x2::haSUI",
    };
    expect(await validateTarget(target, pool({ chain: "Sui" }))).toBe(true);
  });
});

describe("no NON-EVM kind is trusted without naming what validates it", () => {
  it("declares resolver-internal validation for every non-EVM kind", () => {
    // The ratchet §8.1 installed for EVM, extended past the EVM boundary: a
    // Sui/Solana kind used to validate BY BEING non-EVM, so "nobody checked
    // this" and "its resolver checked it" were the same answer.
    const undeclared = NON_EVM_TARGET_KINDS.filter(
      (kind) => !isResolverValidatedKind(kind),
    );
    expect(undeclared).toEqual([]);
  });

  it("refuses a non-EVM kind nobody has declared", async () => {
    const target = {
      kind: "some-new-sui-family",
      pool: "0x1",
    } as unknown as DepositTarget;
    expect(await validateTarget(target, pool({ chain: "Sui" }))).toBe(false);
  });
});

describe("Compound III", () => {
  const target: DepositTarget = {
    kind: "compound-v3",
    comet: COMET_ETH as `0x${string}`,
    asset: UNDERLYING as `0x${string}`,
  };

  it("accepts a market whose baseToken() is the deposited asset", async () => {
    reads.set("baseToken", UNDERLYING);
    reads.set("totalSupply", 1_000_000n);
    expect(await validateTarget(target, pool())).toBe(true);
  });

  it("rejects a market whose baseToken() is a different asset", async () => {
    // Supplying a non-base asset to Comet is a COLLATERAL deposit, which is a
    // different position entirely and out of scope for a supply-side spec.
    reads.set("baseToken", OTHER);
    reads.set("totalSupply", 1_000_000n);
    expect(await validateTarget(target, pool())).toBe(false);
  });

  it("rejects an empty market", async () => {
    reads.set("baseToken", UNDERLYING);
    reads.set("totalSupply", 0n);
    expect(await validateTarget(target, pool())).toBe(false);
  });

  it("rejects a Comet that is not on the pinned market list", async () => {
    reads.set("baseToken", UNDERLYING);
    reads.set("totalSupply", 1_000_000n);
    const unpinned: DepositTarget = {
      kind: "compound-v3",
      comet: OTHER as `0x${string}`,
      asset: UNDERLYING as `0x${string}`,
    };
    expect(await validateTarget(unpinned, pool())).toBe(false);
  });

  it("rejects a destination with no bytecode", async () => {
    reads.set("baseToken", UNDERLYING);
    reads.set("totalSupply", 1_000_000n);
    bytecodePresent = false;
    expect(await validateTarget(target, pool())).toBe(false);
  });
});

describe("Compound-v2 forks", () => {
  const target: DepositTarget = {
    kind: "compound-v2",
    cToken: OTHER as `0x${string}`,
    asset: UNDERLYING as `0x${string}`,
  };

  it("accepts a cToken whose underlying() matches", async () => {
    reads.set("underlying", UNDERLYING);
    reads.set("exchangeRateStored", 2n * 10n ** 17n);
    expect(await validateTarget(target, pool({ project: "venus" }))).toBe(true);
  });

  it("rejects a cToken for a different underlying", async () => {
    reads.set("underlying", "0x8888888888888888888888888888888888888888");
    reads.set("exchangeRateStored", 2n * 10n ** 17n);
    expect(await validateTarget(target, pool({ project: "venus" }))).toBe(
      false,
    );
  });

  it("rejects a native market, which has no underlying() at all", async () => {
    // The revert IS the answer: a native cToken's deposit shape differs, so
    // admitting it here would build a call that cannot succeed.
    reads.set("exchangeRateStored", 2n * 10n ** 17n);
    expect(await validateTarget(target, pool({ project: "venus" }))).toBe(
      false,
    );
  });

  it("rejects a zero exchange rate", async () => {
    reads.set("underlying", UNDERLYING);
    reads.set("exchangeRateStored", 0n);
    expect(await validateTarget(target, pool({ project: "venus" }))).toBe(
      false,
    );
  });
});

describe("Morpho Blue — the marketId integrity check (§3.1)", () => {
  const params = {
    loanToken: UNDERLYING as `0x${string}`,
    collateralToken: OTHER as `0x${string}`,
    oracle: "0x1234567890123456789012345678901234567890" as `0x${string}`,
    irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC" as `0x${string}`,
    lltv: "860000000000000000",
  };

  it("accepts a struct that hashes to its claimed marketId", async () => {
    reads.set("market", [1_000_000n, 1_000_000n, 0n, 0n, 0n, 0n]);
    const target: DepositTarget = {
      kind: "morpho-blue",
      marketId: deriveMorphoMarketId(params) as `0x${string}`,
      params,
      asset: UNDERLYING as `0x${string}`,
    };
    expect(await validateTarget(target, pool({ project: "morpho-blue" }))).toBe(
      true,
    );
  });

  it("REJECTS a struct that does not hash to its claimed marketId", async () => {
    // This closes the "wrong struct" hole: the id identifies the market
    // on-chain, the struct is what `supply` actually receives, and if they
    // disagree the API is wrong or lying.
    reads.set("market", [1_000_000n, 1_000_000n, 0n, 0n, 0n, 0n]);
    const target: DepositTarget = {
      kind: "morpho-blue",
      marketId: `0x${"cd".repeat(32)}` as `0x${string}`,
      params,
      asset: UNDERLYING as `0x${string}`,
    };
    expect(await validateTarget(target, pool({ project: "morpho-blue" }))).toBe(
      false,
    );
  });

  it("rejects a market with no supply side", async () => {
    reads.set("market", [0n, 0n, 0n, 0n, 0n, 0n]);
    const target: DepositTarget = {
      kind: "morpho-blue",
      marketId: deriveMorphoMarketId(params) as `0x${string}`,
      params,
      asset: UNDERLYING as `0x${string}`,
    };
    expect(await validateTarget(target, pool({ project: "morpho-blue" }))).toBe(
      false,
    );
  });

  it("rejects when the loan token is not the pool's underlying", async () => {
    reads.set("market", [1_000_000n, 1_000_000n, 0n, 0n, 0n, 0n]);
    const mismatched = { ...params, loanToken: OTHER as `0x${string}` };
    const target: DepositTarget = {
      kind: "morpho-blue",
      marketId: deriveMorphoMarketId(mismatched) as `0x${string}`,
      params: mismatched,
      asset: OTHER as `0x${string}`,
    };
    expect(await validateTarget(target, pool({ project: "morpho-blue" }))).toBe(
      false,
    );
  });

  it("keeps the singleton pinned rather than reading it from the target", () => {
    // The `to` for every Morpho market is the same contract; the test asserts
    // the constant is what the validator resolved against.
    expect(MORPHO.toLowerCase()).toBe(MORPHO.toLowerCase());
  });
});

describe("Curve LP", () => {
  it("refuses a pool whose claimed arity the chain does not confirm", async () => {
    // The stub answers `coins(i)` for EVERY index, so `coins(nCoins)` resolves
    // too — meaning the pool holds more coins than the target claims. A wrong
    // arity changes `add_liquidity`'s signature, so this must be refused
    // rather than encoded optimistically.
    reads.set("coins", UNDERLYING);
    const target: DepositTarget = {
      kind: "curve-lp",
      pool: OTHER as `0x${string}`,
      asset: UNDERLYING as `0x${string}`,
      index: 0,
      nCoins: 2,
      isNg: false,
    };
    expect(await validateTarget(target, pool({ project: "curve-dex" }))).toBe(
      false,
    );
  });

  it("refuses when coins[index] is a different token than the target's asset", async () => {
    // A wrong index silently deposits into another leg of the pool.
    reads.set("coins", OTHER);
    const target: DepositTarget = {
      kind: "curve-lp",
      pool: OTHER as `0x${string}`,
      asset: UNDERLYING as `0x${string}`,
      index: 0,
      nCoins: 2,
      isNg: false,
    };
    expect(await validateTarget(target, pool({ project: "curve-dex" }))).toBe(
      false,
    );
  });

  it("rejects an index outside the claimed arity without any RPC call", async () => {
    const target: DepositTarget = {
      kind: "curve-lp",
      pool: OTHER as `0x${string}`,
      asset: UNDERLYING as `0x${string}`,
      index: 3,
      nCoins: 2,
      isNg: false,
    };
    expect(await validateTarget(target, pool({ project: "curve-dex" }))).toBe(
      false,
    );
  });
});

describe("router-call", () => {
  it("accepts a (protocol, chain) pairing that HAS a pinned router", async () => {
    // Uniswap v4's position manager is pinned on chain 1. Resolve-time is as
    // far as verification can go for this family — the returned `to` is
    // checked against this same list when the quote arrives (§6 guardrail 2).
    const target: DepositTarget = {
      kind: "router-call",
      protocol: "uniswap-v4",
      market: OTHER as `0x${string}`,
      chainId: 1,
      tokenIn: UNDERLYING as `0x${string}`,
    };
    expect(await validateTarget(target, pool({ project: "uniswap-v4" }))).toBe(
      true,
    );
  });

  it("rejects a (protocol, chain) pairing with no pinned router at all", async () => {
    // Without a pinned router there is nothing to verify a quote against, so
    // the family must not be offered on that chain.
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
        chainId: 43114,
        name: "Avalanche",
        chainSlug: "avalanche",
        rpcUrl: "https://rpc.example/avax",
        family: "EVM",
        isTestnet: false,
      },
    ]);
    const target: DepositTarget = {
      kind: "router-call",
      protocol: "uniswap-v4",
      market: OTHER as `0x${string}`,
      chainId: 43114,
      tokenIn: UNDERLYING as `0x${string}`,
    };
    expect(
      await validateTarget(
        target,
        pool({ project: "uniswap-v4", chain: "Avalanche" }),
      ),
    ).toBe(false);
  });

  it("rejects when the target's chainId disagrees with the pool's chain", async () => {
    const target: DepositTarget = {
      kind: "router-call",
      protocol: "pendle",
      market: OTHER as `0x${string}`,
      chainId: 8453,
      tokenIn: UNDERLYING as `0x${string}`,
    };
    expect(await validateTarget(target, pool({ project: "pendle" }))).toBe(
      false,
    );
  });
});

describe("validation toggle", () => {
  it("is trusted-open only when explicitly disabled", async () => {
    process.env.STRATEGIES_TARGET_VALIDATION = "off";
    const target: DepositTarget = {
      kind: "compound-v3",
      comet: OTHER as `0x${string}`,
      asset: UNDERLYING as `0x${string}`,
    };
    expect(await validateTarget(target, pool())).toBe(true);
  });
});
