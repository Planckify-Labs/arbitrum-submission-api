/**
 * Sui pool-target resolvers — Ember / Scallop / NAVI
 * (docs/defi-pool-level-deposits-spec.md §3, §5, §7.1 / Phase 3).
 *
 * On-chain validation is disabled (`STRATEGIES_TARGET_VALIDATION=off`) so the
 * matching logic is tested in isolation against a stubbed `ResolverContext`
 * (protocol-API fetches). Fail-closed behaviour (→ null → manual) is the crux.
 */

process.env.STRATEGIES_TARGET_VALIDATION = "off";

// Suilend reads its reserves vector via a live RPC call (`getSuiObjectFields`),
// not `ctx.fetchJsonCached` — mock just that export, keep the rest real.
jest.mock("./sui-rpc", () => ({
  ...jest.requireActual("./sui-rpc"),
  getSuiObjectFields: jest.fn(),
}));

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import { EmberResolver } from "./ember.resolver";
import { NaviResolver } from "./navi.resolver";
import { ScallopResolver } from "./scallop.resolver";
import { getSuiObjectFields } from "./sui-rpc";
import { SuilendResolver } from "./suilend.resolver";
import type { ResolverContext } from "./types";

const mockGetSuiObjectFields = getSuiObjectFields as jest.MockedFunction<
  typeof getSuiObjectFields
>;

const SUI = "0x2::sui::SUI";
const USDC =
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";

function suiPool(overrides: Partial<DeFiLlamaYieldPool> = {}): DeFiLlamaYieldPool {
  return {
    pool: "some-defillama-uuid",
    chain: "Sui",
    project: "ember-protocol",
    symbol: "USDC",
    tvlUsd: 1_000_000,
    apy: 10,
    ilRisk: "no",
    exposure: "single",
    poolMeta: null,
    underlyingTokens: [USDC],
    ...overrides,
  } as DeFiLlamaYieldPool;
}

/** Build a ctx whose `fetchJsonCached` returns `fn(url)`. */
function ctxWith(fn: (url: string) => unknown): ResolverContext {
  return {
    fetchJsonCached: async <T>(_k: string, url: string) => fn(url) as T,
    validate: async () => true,
  };
}

// ── Ember ───────────────────────────────────────────────────────────────────

const EMBER_INFO = {
  VaultProtocol: { Package: "0xpkg", ProtocolConfig: "0xcfg" },
  Vaults: {
    "Ember Basis": {
      ObjectId: "0xbasis",
      Name: "Ember Basis",
      DepositCoinType: USDC,
      ReceiptCoinType: "0xr1::ebasis::EBASIS",
    },
    "Gamma USDC": {
      ObjectId: "0xgamma",
      Name: "Gamma USDC",
      DepositCoinType: USDC,
      ReceiptCoinType: "0xr2::egusdc::EGUSDC",
    },
    "Ember Third Eye": {
      ObjectId: "0xcross",
      Name: "Ember Third Eye",
      DepositCoinType: USDC,
      ReceiptCoinType: "0xr4::ethird::ETHIRD",
    },
    "Ember SUI": {
      ObjectId: "0xsui",
      Name: "Ember SUI",
      DepositCoinType: SUI,
      ReceiptCoinType: "0xr3::esui::ESUI",
    },
  },
};
// The list endpoint carries the DeFiLlama-facing `name` (== poolMeta).
const EMBER_LIST = [
  { id: "0xbasis", name: "Basis Vault", depositCoin: { symbol: "USDC" } },
  // "Crosschain USD Vault" comes BEFORE "USD Vault" and its normalized name
  // ("crosschainusdvault") CONTAINS "usdvault" — the substring-collision case.
  { id: "0xcross", name: "Crosschain USD Vault", depositCoin: { symbol: "USDC" } },
  { id: "0xgamma", name: "USD Vault", depositCoin: { symbol: "USDC" } },
  { id: "0xsui", name: "SUI Vault", depositCoin: { symbol: "SUI" } },
];

function emberCtx(): ResolverContext {
  return ctxWith((url) =>
    url.includes("/vaults/info") ? EMBER_INFO : EMBER_LIST,
  );
}

describe("EmberResolver", () => {
  it("disambiguates sibling USDC vaults by poolMeta ↔ list name", async () => {
    const target = await EmberResolver.resolve(
      suiPool({ poolMeta: "Basis Vault" }),
      emberCtx(),
    );
    expect(target).toEqual({
      kind: "ember-vault",
      vault: "0xbasis",
      coinType: USDC,
      shareType: "0xr1::ebasis::EBASIS",
    });
  });

  it("prefers an EXACT name over a substring sibling (USD Vault ≠ Crosschain USD Vault)", async () => {
    const target = await EmberResolver.resolve(
      suiPool({ poolMeta: "USD Vault" }),
      emberCtx(),
    );
    // Must land on the real "USD Vault" (0xgamma), NOT "Crosschain USD Vault"
    // (0xcross) which contains "usdvault" as a substring and comes first.
    expect(target).toMatchObject({ kind: "ember-vault", vault: "0xgamma" });
  });

  it("matches the SUI vault (native coinType tolerant)", async () => {
    const target = await EmberResolver.resolve(
      suiPool({ symbol: "SUI", underlyingTokens: [SUI], poolMeta: "SUI Vault" }),
      emberCtx(),
    );
    expect(target).toMatchObject({ kind: "ember-vault", vault: "0xsui" });
  });

  it("fails closed on ambiguous USDC with no poolMeta match", async () => {
    expect(
      await EmberResolver.resolve(suiPool({ poolMeta: "Nonexistent Vault" }), emberCtx()),
    ).toBeNull();
  });

  it("fails closed for a non-Sui chain", async () => {
    expect(
      await EmberResolver.resolve(suiPool({ chain: "Ethereum" }), emberCtx()),
    ).toBeNull();
  });
});

// ── Scallop ─────────────────────────────────────────────────────────────────

const SCALLOP_CTX = ctxWith(() => ({
  mainnet: { core: { market: "0xmarket" } },
}));

describe("ScallopResolver", () => {
  it("emits a scallop-market target for a supported asset", async () => {
    const target = await ScallopResolver.resolve(
      suiPool({ project: "scallop-lend", symbol: "SUI", underlyingTokens: [SUI] }),
      SCALLOP_CTX,
    );
    expect(target).toEqual({
      kind: "scallop-market",
      market: "0xmarket",
      coinType: SUI,
    });
  });

  it("fails closed for an unsupported asset", async () => {
    expect(
      await ScallopResolver.resolve(
        suiPool({ project: "scallop-lend", symbol: "PEPE", underlyingTokens: [] }),
        SCALLOP_CTX,
      ),
    ).toBeNull();
  });

  it("fails closed when the underlying doesn't match the pinned coinType", async () => {
    expect(
      await ScallopResolver.resolve(
        suiPool({ project: "scallop-lend", symbol: "USDC", underlyingTokens: [SUI] }),
        SCALLOP_CTX,
      ),
    ).toBeNull();
  });
});

// ── NAVI ────────────────────────────────────────────────────────────────────

// Real NAVI shape: `{ data: [...] }`, `id` = assetId, `suiCoinType` is
// 0x-prefixed, `contract.pool` is the Pool<T> object id. The USDC row also
// carries the bare (no-0x) `coinType` to prove the prefix-normalisation path.
const NAVI_CTX = ctxWith(() => ({
  data: [
    { id: 0, suiCoinType: SUI, contract: { pool: "0xsuipool" } },
    {
      id: 10,
      suiCoinType: USDC,
      coinType: USDC.slice(2),
      contract: { pool: "0xusdcpool", reserveId: "0xres" },
    },
  ],
}));

describe("NaviResolver", () => {
  it("matches by underlying coinType → navi-pool target (native USDC = assetId 10)", async () => {
    const target = await NaviResolver.resolve(
      suiPool({ project: "navi-lending" }),
      NAVI_CTX,
    );
    expect(target).toEqual({
      kind: "navi-pool",
      pool: "0xusdcpool",
      assetId: 10,
      coinType: USDC,
    });
  });

  it("matches a bare (no-0x) coinType by prepending 0x", async () => {
    const bareCtx = ctxWith(() => ({
      data: [{ id: 0, coinType: SUI.slice(2), contract: { pool: "0xsuipool" } }],
    }));
    const target = await NaviResolver.resolve(
      suiPool({ project: "navi-lending", symbol: "SUI", underlyingTokens: [SUI] }),
      bareCtx,
    );
    expect(target).toMatchObject({ kind: "navi-pool", pool: "0xsuipool", assetId: 0 });
  });

  it("fails closed when no reserve matches the underlying", async () => {
    expect(
      await NaviResolver.resolve(
        suiPool({ project: "navi-lending", underlyingTokens: ["0xdead::x::X"] }),
        NAVI_CTX,
      ),
    ).toBeNull();
  });
});

// ── Suilend ───────────────────────────────────────────────────────────────────

// LendingMarket.reserves[]: coin_type is a Pyth TypeName whose `name` is the
// coinType WITHOUT a 0x prefix. SUI is stored zero-padded to exercise the
// address-normalisation path; the reserve slot index IS `reserve_array_index`.
const SUILEND_LM_FIELDS = {
  reserves: [
    {
      fields: {
        coin_type: {
          fields: {
            name: "0000000000000000000000000000000000000000000000000000000000000002::sui::SUI",
          },
        },
      },
    },
    { fields: { coin_type: { fields: { name: "dead::x::X" } } } },
    { fields: { coin_type: { fields: { name: USDC.slice(2) } } } },
  ],
};

describe("SuilendResolver", () => {
  beforeEach(() => mockGetSuiObjectFields.mockReset());

  it("maps the underlying coinType to its reserve_array_index", async () => {
    mockGetSuiObjectFields.mockResolvedValue(SUILEND_LM_FIELDS);
    const target = await SuilendResolver.resolve(
      suiPool({ project: "suilend" }),
      SCALLOP_CTX,
    );
    expect(target).toMatchObject({
      kind: "suilend-market",
      reserveArrayIndex: 2,
      coinType: USDC,
    });
  });

  it("matches native SUI across zero-padding (index 0)", async () => {
    mockGetSuiObjectFields.mockResolvedValue(SUILEND_LM_FIELDS);
    const target = await SuilendResolver.resolve(
      suiPool({ project: "suilend", symbol: "SUI", underlyingTokens: [SUI] }),
      SCALLOP_CTX,
    );
    expect(target).toMatchObject({ kind: "suilend-market", reserveArrayIndex: 0 });
  });

  it("fails closed when no reserve matches the underlying", async () => {
    mockGetSuiObjectFields.mockResolvedValue(SUILEND_LM_FIELDS);
    expect(
      await SuilendResolver.resolve(
        suiPool({ project: "suilend", underlyingTokens: ["0xbeef::y::Y"] }),
        SCALLOP_CTX,
      ),
    ).toBeNull();
  });

  it("fails closed when the LendingMarket can't be read", async () => {
    mockGetSuiObjectFields.mockResolvedValue(null);
    expect(
      await SuilendResolver.resolve(suiPool({ project: "suilend" }), SCALLOP_CTX),
    ).toBeNull();
  });

  it("fails closed for a non-Sui chain", async () => {
    expect(
      await SuilendResolver.resolve(
        suiPool({ project: "suilend", chain: "Ethereum" }),
        SCALLOP_CTX,
      ),
    ).toBeNull();
  });
});
