/**
 * Candidate-source registry (spec §4, §12 Q1).
 *
 * The properties that matter are all about FAILURE, because the reason this
 * registry exists is that a single external endpoint going away (DeFiLlama
 * paywalling `/poolsOld`) silently disabled seven resolver families:
 *
 *   - a protocol-specific source is preferred over the generic fallback,
 *   - one source failing must not stop the others from answering,
 *   - no candidate is always an acceptable answer; a guessed one never is.
 */

import type { DeFiLlamaYieldPool } from "../../external/defillama.client";
import type { Address, ResolverContext } from "../types";
import {
  type CandidateSource,
  candidateAddressForPool,
  pickUniqueByLabel,
  registerCandidateSource,
  resetCandidateSources,
  sourcesForProject,
} from "./registry";

const SPECIFIC = "0x1111111111111111111111111111111111111111" as Address;
const FALLBACK = "0x2222222222222222222222222222222222222222" as Address;

const ctx = {} as ResolverContext;

function pool(project = "euler-v2"): DeFiLlamaYieldPool {
  return {
    pool: "uuid-1",
    chain: "Ethereum",
    project,
    symbol: "USDC",
    tvlUsd: 1_000_000,
    apy: 5,
    ilRisk: "no",
    exposure: "single",
  };
}

function source(
  id: string,
  projects: readonly string[] | "*",
  answer: Address | null | (() => never),
): CandidateSource {
  return {
    id,
    projects,
    candidate: async () => {
      if (typeof answer === "function") return answer();
      return answer;
    },
  };
}

beforeEach(() => {
  resetCandidateSources();
});

describe("source ordering", () => {
  it("prefers a protocol-specific source over the generic fallback", () => {
    registerCandidateSource(source("generic", "*", FALLBACK));
    registerCandidateSource(source("euler", ["euler-v2"], SPECIFIC));

    // Registration order must not matter; the project match does.
    const ids = sourcesForProject("euler-v2").map((s) => s.id);
    expect(ids).toEqual(["euler", "generic"]);
  });

  it("returns the specific source's answer", async () => {
    registerCandidateSource(source("generic", "*", FALLBACK));
    registerCandidateSource(source("euler", ["euler-v2"], SPECIFIC));
    expect(await candidateAddressForPool(pool(), ctx)).toBe(SPECIFIC);
  });

  it("falls through to the generic source when the specific one declines", async () => {
    registerCandidateSource(source("euler", ["euler-v2"], null));
    registerCandidateSource(source("generic", "*", FALLBACK));
    expect(await candidateAddressForPool(pool(), ctx)).toBe(FALLBACK);
  });

  it("uses only the fallback for a project nothing claims", async () => {
    registerCandidateSource(source("euler", ["euler-v2"], SPECIFIC));
    registerCandidateSource(source("generic", "*", FALLBACK));
    expect(await candidateAddressForPool(pool("some-new-venue"), ctx)).toBe(
      FALLBACK,
    );
  });

  it("matches project slugs case-insensitively", () => {
    registerCandidateSource(source("euler", ["Euler-V2"], SPECIFIC));
    expect(sourcesForProject("euler-v2").map((s) => s.id)).toEqual(["euler"]);
  });
});

describe("failure isolation", () => {
  it("skips a source that throws and lets the next one answer", async () => {
    registerCandidateSource(
      source("broken", ["euler-v2"], () => {
        throw new Error("RPC down");
      }),
    );
    registerCandidateSource(source("generic", "*", FALLBACK));
    // One protocol's registry being unreachable must not deny an answer that
    // another source already has.
    expect(await candidateAddressForPool(pool(), ctx)).toBe(FALLBACK);
  });

  it("returns null when every source declines", async () => {
    registerCandidateSource(source("euler", ["euler-v2"], null));
    registerCandidateSource(source("generic", "*", null));
    // Null is a correct answer: the pool degrades to Manual.
    expect(await candidateAddressForPool(pool(), ctx)).toBeNull();
  });

  it("returns null when nothing is registered at all", async () => {
    expect(await candidateAddressForPool(pool(), ctx)).toBeNull();
  });

  it("does not register the same source id twice", () => {
    const s = source("euler", ["euler-v2"], SPECIFIC);
    registerCandidateSource(s);
    registerCandidateSource(s);
    expect(sourcesForProject("euler-v2")).toHaveLength(1);
  });
});

describe("pickUniqueByLabel", () => {
  const vaults = [
    { address: "0xa", symbol: "steakUSDC", name: "Steakhouse USDC" },
    { address: "0xb", symbol: "gtUSDCp", name: "Gauntlet USDC Prime" },
    { address: "0xc", symbol: "eUSDC-2", name: "Euler USDC 2" },
  ];
  const labelsOf = (v: (typeof vaults)[number]) => [v.symbol, v.name];

  it("selects the single vault a label names", () => {
    expect(pickUniqueByLabel(vaults, ["STEAKUSDC"], labelsOf)?.address).toBe(
      "0xa",
    );
    expect(
      pickUniqueByLabel(vaults, ["Gauntlet USDC Prime"], labelsOf)?.address,
    ).toBe("0xb");
  });

  it("refuses when a label matches several vaults", () => {
    // "USDC" is a substring of all three. Picking the first would be a guess
    // about where a user's money goes.
    expect(pickUniqueByLabel(vaults, ["USDC"], labelsOf)).toBeNull();
  });

  it("tries the next label when the first does not disambiguate", () => {
    expect(
      pickUniqueByLabel(vaults, ["USDC", "gtUSDCp"], labelsOf)?.address,
    ).toBe("0xb");
  });

  it("accepts a lone candidate with nothing to disambiguate with", () => {
    expect(pickUniqueByLabel([vaults[0]], [null, ""], labelsOf)?.address).toBe(
      "0xa",
    );
  });

  it("refuses several candidates with nothing to disambiguate with", () => {
    expect(pickUniqueByLabel(vaults, [null, undefined], labelsOf)).toBeNull();
  });

  it("refuses an empty candidate list", () => {
    expect(pickUniqueByLabel([], ["steakUSDC"], labelsOf)).toBeNull();
  });
});
