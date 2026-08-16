/**
 * Chain directory — name resolution and the alias escape hatch.
 *
 * Chains are data (`Blockchain` rows), so the one thing that must be exactly
 * right here is how an external catalog name (DeFiLlama's `pool.chain`) maps
 * onto a row. Two properties matter and both were learned the hard way:
 *
 *  1. **An unknown chain resolves to 0**, so the resolver fails closed to
 *     Manual. A chain we cannot identify is never a chain we route funds on.
 *  2. **An alias outranks the name index.** Production had the mainnet row
 *     named "Base Mainnet" and the *testnet* row named "Base", so DeFiLlama's
 *     "Base" matched Base Sepolia and every Base pool silently went dark. With
 *     the index consulted first, the alias could only fill a MISSING match, not
 *     correct a WRONG one — powerless against the exact case it exists for.
 */

import {
  type ChainDirectoryRow,
  findChainByName,
  loadChainDirectory,
  resolveChainIdentity,
  resolveEvmChainId,
} from "./chain-directory";

function row(over: Partial<ChainDirectoryRow>): ChainDirectoryRow {
  return {
    chainId: 1,
    name: "Ethereum",
    chainSlug: null,
    rpcUrl: "/evm/1",
    family: "EVM",
    isTestnet: false,
    ...over,
  };
}

/** The shape that actually caused the outage: testnet row owns the short name. */
const PRODUCTION_SHAPED = [
  row({ chainId: 1, name: "Ethereum" }),
  row({ chainId: 8453, name: "Base Mainnet" }),
  row({ chainId: 42161, name: "Arbitrum" }),
  row({ chainId: 84532, name: "Base", isTestnet: true }),
  row({
    chainId: null,
    name: "Solana",
    chainSlug: "solana-mainnet",
    family: "SVM",
  }),
];

beforeEach(() => {
  delete process.env.STRATEGIES_CHAIN_ALIASES;
  loadChainDirectory(PRODUCTION_SHAPED);
});

afterAll(() => {
  delete process.env.STRATEGIES_CHAIN_ALIASES;
});

describe("resolveEvmChainId", () => {
  it("matches a row by name, case- and punctuation-insensitively", () => {
    expect(resolveEvmChainId("Ethereum")).toBe(1);
    expect(resolveEvmChainId("ethereum")).toBe(1);
    expect(resolveEvmChainId("Base Mainnet")).toBe(8453);
    expect(resolveEvmChainId("basemainnet")).toBe(8453);
  });

  it("returns 0 for an unknown chain (fail closed to Manual)", () => {
    expect(resolveEvmChainId("BSC")).toBe(0);
    expect(resolveEvmChainId("Optimism")).toBe(0);
    expect(resolveEvmChainId("")).toBe(0);
    expect(resolveEvmChainId(undefined)).toBe(0);
  });

  it("returns 0 for a non-EVM chain", () => {
    // Solana is in the directory but has no EVM chainId; an EVM resolver must
    // not receive 0-as-if-valid or the row's null id.
    expect(resolveEvmChainId("Solana")).toBe(0);
  });

  it("resolves 0 when the directory has not been loaded", () => {
    loadChainDirectory([]);
    expect(resolveEvmChainId("Ethereum")).toBe(0);
  });
});

describe("STRATEGIES_CHAIN_ALIASES", () => {
  it("fills a name the directory does not know", () => {
    process.env.STRATEGIES_CHAIN_ALIASES = '{"bsc":1}';
    expect(resolveEvmChainId("BSC")).toBe(1);
  });

  it("CORRECTS a name that already matches the wrong row", () => {
    // The regression this ordering exists for. Without the alias, "Base"
    // matches the testnet row by name.
    expect(resolveEvmChainId("Base")).toBe(84532);

    process.env.STRATEGIES_CHAIN_ALIASES = '{"base":8453}';
    expect(resolveEvmChainId("Base")).toBe(8453);
    expect(findChainByName("Base")?.name).toBe("Base Mainnet");
  });

  it("accepts a chainSlug alias as well as a chainId", () => {
    process.env.STRATEGIES_CHAIN_ALIASES = '{"sol":"solana-mainnet"}';
    expect(resolveChainIdentity("sol")).toEqual({
      namespace: "solana",
      chainId: 0,
    });
  });

  it("ignores malformed JSON rather than failing the poll", () => {
    process.env.STRATEGIES_CHAIN_ALIASES = "{not json";
    expect(resolveEvmChainId("Ethereum")).toBe(1);
  });

  it("fails closed when an alias points at a chain that is not in the directory", () => {
    // An alias selects a chain; it cannot invent one.
    process.env.STRATEGIES_CHAIN_ALIASES = '{"base":999999}';
    expect(resolveEvmChainId("Base")).toBe(0);
  });
});

describe("resolveChainIdentity", () => {
  it("projects the chain family onto a wallet namespace", () => {
    expect(resolveChainIdentity("Ethereum")).toEqual({
      namespace: "eip155",
      chainId: 1,
    });
    expect(resolveChainIdentity("Solana")).toEqual({
      namespace: "solana",
      chainId: 0,
    });
  });

  it("returns null for a chain it cannot place", () => {
    expect(resolveChainIdentity("Fantom")).toBeNull();
  });
});
