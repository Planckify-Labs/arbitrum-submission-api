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
// not `ctx.fetchJsonCached` — mock just that export, keep the rest real. Kai
// similarly derives `shareType` from a live `getSuiObjectType` read (its ONLY
// source, unconditional — see kai.resolver.ts), so it's mocked the same way.
jest.mock("./sui-rpc", () => ({
  ...jest.requireActual("./sui-rpc"),
  getSuiObjectFields: jest.fn(),
  getSuiObjectType: jest.fn(),
}));

import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import { BluefinSpotResolver } from "./bluefin.resolver";
import { CetusResolver } from "./cetus.resolver";
import { CurrentResolver } from "./current.resolver";
import { EmberResolver } from "./ember.resolver";
import { KaiResolver } from "./kai.resolver";
import { NaviResolver } from "./navi.resolver";
import { ScallopResolver } from "./scallop.resolver";
import { getSuiObjectFields, getSuiObjectType } from "./sui-rpc";
import { SuilendResolver } from "./suilend.resolver";
import { SuiLstResolver } from "./suilst.resolver";
import { TurbosResolver } from "./turbos.resolver";
import type { ResolverContext } from "./types";

const mockGetSuiObjectFields = getSuiObjectFields as jest.MockedFunction<
  typeof getSuiObjectFields
>;
const mockGetSuiObjectType = getSuiObjectType as jest.MockedFunction<
  typeof getSuiObjectType
>;

const SUI = "0x2::sui::SUI";
const USDC =
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";

function suiPool(
  overrides: Partial<DeFiLlamaYieldPool> = {},
): DeFiLlamaYieldPool {
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
  {
    id: "0xcross",
    name: "Crosschain USD Vault",
    depositCoin: { symbol: "USDC" },
  },
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
      suiPool({
        symbol: "SUI",
        underlyingTokens: [SUI],
        poolMeta: "SUI Vault",
      }),
      emberCtx(),
    );
    expect(target).toMatchObject({ kind: "ember-vault", vault: "0xsui" });
  });

  it("fails closed on ambiguous USDC with no poolMeta match", async () => {
    expect(
      await EmberResolver.resolve(
        suiPool({ poolMeta: "Nonexistent Vault" }),
        emberCtx(),
      ),
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
      suiPool({
        project: "scallop-lend",
        symbol: "SUI",
        underlyingTokens: [SUI],
      }),
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
        suiPool({
          project: "scallop-lend",
          symbol: "PEPE",
          underlyingTokens: [],
        }),
        SCALLOP_CTX,
      ),
    ).toBeNull();
  });

  it("fails closed when the underlying doesn't match the pinned coinType", async () => {
    expect(
      await ScallopResolver.resolve(
        suiPool({
          project: "scallop-lend",
          symbol: "USDC",
          underlyingTokens: [SUI],
        }),
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
      data: [
        { id: 0, coinType: SUI.slice(2), contract: { pool: "0xsuipool" } },
      ],
    }));
    const target = await NaviResolver.resolve(
      suiPool({
        project: "navi-lending",
        symbol: "SUI",
        underlyingTokens: [SUI],
      }),
      bareCtx,
    );
    expect(target).toMatchObject({
      kind: "navi-pool",
      pool: "0xsuipool",
      assetId: 0,
    });
  });

  it("fails closed when no reserve matches the underlying", async () => {
    expect(
      await NaviResolver.resolve(
        suiPool({
          project: "navi-lending",
          underlyingTokens: ["0xdead::x::X"],
        }),
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
    expect(target).toMatchObject({
      kind: "suilend-market",
      reserveArrayIndex: 0,
    });
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
      await SuilendResolver.resolve(
        suiPool({ project: "suilend" }),
        SCALLOP_CTX,
      ),
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

// ── Kai Finance Single Asset Vaults ─────────────────────────────────────────

const KAI_USDC_VAULT =
  "0x3e8a6d1e29d2c86aed50d6055863b878a7dd382de22ea168177c80c1d7150061";
const KAI_YUSDC =
  "0x7ea359636b36e7c027c2cd71adedaf19be658e1477d9e71368a0b3824a0a27ff::yusdc::YUSDC";

describe("KaiResolver", () => {
  beforeEach(() => mockGetSuiObjectType.mockReset());

  it("resolves a pinned vault and derives shareType from the live vault type", async () => {
    mockGetSuiObjectType.mockResolvedValue(
      `0xpkg::vault::Vault<${USDC}, ${KAI_YUSDC}>`,
    );
    const target = await KaiResolver.resolve(
      suiPool({ project: "kai-finance", symbol: "USDC" }),
      SCALLOP_CTX,
    );
    expect(target).toEqual({
      kind: "kai-vault",
      vault: KAI_USDC_VAULT,
      coinType: USDC,
      shareType: KAI_YUSDC,
    });
  });

  it("fails closed for an asset with no pinned vault", async () => {
    expect(
      await KaiResolver.resolve(
        suiPool({
          project: "kai-finance",
          symbol: "PEPE",
          underlyingTokens: ["0xpepe::pepe::PEPE"],
        }),
        SCALLOP_CTX,
      ),
    ).toBeNull();
    expect(mockGetSuiObjectType).not.toHaveBeenCalled();
  });

  it("fails closed when the vault object can't be read", async () => {
    mockGetSuiObjectType.mockResolvedValue(null);
    expect(
      await KaiResolver.resolve(
        suiPool({ project: "kai-finance", symbol: "USDC" }),
        SCALLOP_CTX,
      ),
    ).toBeNull();
  });

  it("fails closed on a malformed/unparseable vault type", async () => {
    mockGetSuiObjectType.mockResolvedValue("0xpkg::not_a_vault::Thing");
    expect(
      await KaiResolver.resolve(
        suiPool({ project: "kai-finance", symbol: "USDC" }),
        SCALLOP_CTX,
      ),
    ).toBeNull();
  });

  it("fails closed when the live type's coinType disagrees with the pin", async () => {
    // Wrong T — a stale/incorrect pin should never validate against a
    // mismatched live read.
    mockGetSuiObjectType.mockResolvedValue(
      `0xpkg::vault::Vault<${SUI}, ${KAI_YUSDC}>`,
    );
    expect(
      await KaiResolver.resolve(
        suiPool({ project: "kai-finance", symbol: "USDC" }),
        SCALLOP_CTX,
      ),
    ).toBeNull();
  });

  it("fails closed for a non-Sui chain", async () => {
    expect(
      await KaiResolver.resolve(
        suiPool({ project: "kai-finance", symbol: "USDC", chain: "Ethereum" }),
        SCALLOP_CTX,
      ),
    ).toBeNull();
  });
});

// ── Current Finance ─────────────────────────────────────────────────────────

const CURRENT_MAIN_MARKET =
  "0x41f3d76aee8b20e53f7d0d395fdc09e241e683c7bc5d0f69674b545ee42549df";
const CURRENT_CTX = ctxWith(() => ({
  data: {
    content: [
      {
        marketID: CURRENT_MAIN_MARKET,
        token: USDC.slice(2),
        name: "MainMarket",
      },
    ],
  },
}));

describe("CurrentResolver", () => {
  beforeEach(() => mockGetSuiObjectType.mockReset());

  it("resolves a (market name + coinType) match to a current-market target", async () => {
    mockGetSuiObjectType.mockResolvedValue("0xpkg::market::Market<...>");
    const target = await CurrentResolver.resolve(
      suiPool({ project: "current", symbol: "USDC", poolMeta: "MainMarket" }),
      CURRENT_CTX,
    );
    expect(target).toEqual({
      kind: "current-market",
      app: "0xd4395f77a48f6d64af2008280c8dc06ee0fe69953a141e683935f6086d849177",
      market: CURRENT_MAIN_MARKET,
      marketType:
        "0xfe1d8929d13b00aaecd7642dec1c6d41cab82882a1b139efa46bf61dfd6380bf::market_type::MainMarket",
      coinType: USDC,
    });
  });

  it("fails closed when poolMeta doesn't name a known isolated market", async () => {
    expect(
      await CurrentResolver.resolve(
        suiPool({ project: "current", symbol: "USDC", poolMeta: "NotAMarket" }),
        CURRENT_CTX,
      ),
    ).toBeNull();
    expect(mockGetSuiObjectType).not.toHaveBeenCalled();
  });

  it("fails closed when no row in that market matches the underlying", async () => {
    expect(
      await CurrentResolver.resolve(
        suiPool({
          project: "current",
          symbol: "PEPE",
          poolMeta: "MainMarket",
          underlyingTokens: ["0xpepe::pepe::PEPE"],
        }),
        CURRENT_CTX,
      ),
    ).toBeNull();
  });

  it("fails closed when the Market object can't be read", async () => {
    mockGetSuiObjectType.mockResolvedValue(null);
    expect(
      await CurrentResolver.resolve(
        suiPool({ project: "current", symbol: "USDC", poolMeta: "MainMarket" }),
        CURRENT_CTX,
      ),
    ).toBeNull();
  });

  it("fails closed for a non-Sui chain", async () => {
    expect(
      await CurrentResolver.resolve(
        suiPool({
          project: "current",
          symbol: "USDC",
          poolMeta: "MainMarket",
          chain: "Ethereum",
        }),
        CURRENT_CTX,
      ),
    ).toBeNull();
  });
});

// ── Cetus CLMM ──────────────────────────────────────────────────────────────

const CETUS_POOL =
  "0x51e883ba7c0b566a26cbc8a94cd33eb0abd418a77cc1e60ad22fd9b1f29cd2ab";
const CETUS_ROW = {
  address: CETUS_POOL,
  fee: "0.0005", // 0.05%
  tick_spacing: "10",
  coin_a_address: USDC.slice(2),
  coin_b_address: SUI.slice(2),
  is_closed: false,
};
const CETUS_CTX = ctxWith(() => ({ data: { lp_list: [CETUS_ROW] } }));

describe("CetusResolver", () => {
  beforeEach(() => mockGetSuiObjectType.mockReset());

  it("resolves a (fee tier + pair) match to a cetus-clmm-pool target", async () => {
    mockGetSuiObjectType.mockResolvedValue("0xpkg::pool::Pool<...>");
    const target = await CetusResolver.resolve(
      suiPool({
        project: "cetus-clmm",
        symbol: "USDC-SUI",
        poolMeta: "0.05%",
        underlyingTokens: [USDC, SUI],
      }),
      CETUS_CTX,
    );
    expect(target).toEqual({
      kind: "cetus-clmm-pool",
      pool: CETUS_POOL,
      coinTypeA: USDC,
      coinTypeB: SUI,
      tickSpacing: 10,
    });
  });

  it("matches the pair regardless of on-chain coin_a/coin_b order", async () => {
    mockGetSuiObjectType.mockResolvedValue("0xpkg::pool::Pool<...>");
    const target = await CetusResolver.resolve(
      suiPool({
        project: "cetus-clmm",
        symbol: "USDC-SUI",
        poolMeta: "0.05%",
        underlyingTokens: [SUI, USDC], // reversed vs. the row's a/b order
      }),
      CETUS_CTX,
    );
    expect(target).toMatchObject({ kind: "cetus-clmm-pool", pool: CETUS_POOL });
  });

  it("fails closed when poolMeta isn't a parseable fee percent", async () => {
    expect(
      await CetusResolver.resolve(
        suiPool({
          project: "cetus-clmm",
          poolMeta: "not-a-fee",
          underlyingTokens: [USDC, SUI],
        }),
        CETUS_CTX,
      ),
    ).toBeNull();
    expect(mockGetSuiObjectType).not.toHaveBeenCalled();
  });

  it("fails closed when no row matches the fee tier", async () => {
    expect(
      await CetusResolver.resolve(
        suiPool({
          project: "cetus-clmm",
          poolMeta: "1%", // row is 0.05%
          underlyingTokens: [USDC, SUI],
        }),
        CETUS_CTX,
      ),
    ).toBeNull();
  });

  it("fails closed when the matched row has no valid tick_spacing", async () => {
    const ctx = ctxWith(() => ({
      data: { lp_list: [{ ...CETUS_ROW, tick_spacing: undefined }] },
    }));
    expect(
      await CetusResolver.resolve(
        suiPool({
          project: "cetus-clmm",
          poolMeta: "0.05%",
          underlyingTokens: [USDC, SUI],
        }),
        ctx,
      ),
    ).toBeNull();
  });

  it("fails closed when a matched row is closed", async () => {
    const ctx = ctxWith(() => ({
      data: { lp_list: [{ ...CETUS_ROW, is_closed: true }] },
    }));
    expect(
      await CetusResolver.resolve(
        suiPool({
          project: "cetus-clmm",
          poolMeta: "0.05%",
          underlyingTokens: [USDC, SUI],
        }),
        ctx,
      ),
    ).toBeNull();
  });

  it("fails closed when the pool object can't be read", async () => {
    mockGetSuiObjectType.mockResolvedValue(null);
    expect(
      await CetusResolver.resolve(
        suiPool({
          project: "cetus-clmm",
          poolMeta: "0.05%",
          underlyingTokens: [USDC, SUI],
        }),
        CETUS_CTX,
      ),
    ).toBeNull();
  });

  it("fails closed for a non-Sui chain", async () => {
    expect(
      await CetusResolver.resolve(
        suiPool({
          project: "cetus-clmm",
          poolMeta: "0.05%",
          underlyingTokens: [USDC, SUI],
          chain: "Ethereum",
        }),
        CETUS_CTX,
      ),
    ).toBeNull();
  });
});

// ── Turbos Finance CLMM ─────────────────────────────────────────────────────

const TURBOS_POOL =
  "0x770010854059edf1dd3d49a97f3054c39b870ec708fe2f408e30a8ef4724caef";
const TURBOS_FEE_TYPE =
  "0x91bfbc386a41afcfd9b2533058d7e915a1d3829089cc268ff4333d54d6339ca1::fee100bps::FEE100BPS";
const TURBOS_ROW = {
  pool_id: TURBOS_POOL,
  fee: 100, // 100/10000 = 0.01%
  fee_type: TURBOS_FEE_TYPE,
  tick_spacing: 2,
  coin_type_a: USDC.slice(2),
  coin_type_b: SUI.slice(2),
  unlocked: true,
};
const TURBOS_CTX = ctxWith(() => ({ result: [TURBOS_ROW], total: 1 }));

describe("TurbosResolver", () => {
  beforeEach(() => mockGetSuiObjectType.mockReset());

  it("resolves a (fee tier + pair) match to a turbos-clmm-pool target", async () => {
    mockGetSuiObjectType.mockResolvedValue("0xpkg::pool::Pool<...>");
    const target = await TurbosResolver.resolve(
      suiPool({
        project: "turbos",
        symbol: "USDC-SUI",
        poolMeta: "0.01%",
        underlyingTokens: [USDC, SUI],
      }),
      TURBOS_CTX,
    );
    expect(target).toEqual({
      kind: "turbos-clmm-pool",
      pool: TURBOS_POOL,
      coinTypeA: USDC,
      coinTypeB: SUI,
      feeType: TURBOS_FEE_TYPE,
      tickSpacing: 2,
    });
  });

  it("matches the pair regardless of on-chain coin_type_a/b order", async () => {
    mockGetSuiObjectType.mockResolvedValue("0xpkg::pool::Pool<...>");
    const target = await TurbosResolver.resolve(
      suiPool({
        project: "turbos",
        poolMeta: "0.01%",
        underlyingTokens: [SUI, USDC], // reversed vs. the row's a/b order
      }),
      TURBOS_CTX,
    );
    expect(target).toMatchObject({
      kind: "turbos-clmm-pool",
      pool: TURBOS_POOL,
    });
  });

  it("fails closed when poolMeta isn't a parseable fee percent", async () => {
    expect(
      await TurbosResolver.resolve(
        suiPool({
          project: "turbos",
          poolMeta: "not-a-fee",
          underlyingTokens: [USDC, SUI],
        }),
        TURBOS_CTX,
      ),
    ).toBeNull();
    expect(mockGetSuiObjectType).not.toHaveBeenCalled();
  });

  it("fails closed when no row matches the fee tier", async () => {
    expect(
      await TurbosResolver.resolve(
        suiPool({
          project: "turbos",
          poolMeta: "1%", // row is 0.01%
          underlyingTokens: [USDC, SUI],
        }),
        TURBOS_CTX,
      ),
    ).toBeNull();
  });

  it("fails closed when the matched row has no valid tick_spacing", async () => {
    const ctx = ctxWith(() => ({
      result: [{ ...TURBOS_ROW, tick_spacing: undefined }],
      total: 1,
    }));
    expect(
      await TurbosResolver.resolve(
        suiPool({
          project: "turbos",
          poolMeta: "0.01%",
          underlyingTokens: [USDC, SUI],
        }),
        ctx,
      ),
    ).toBeNull();
  });

  it("fails closed when a matched row is locked/unavailable", async () => {
    const ctx = ctxWith(() => ({
      result: [{ ...TURBOS_ROW, unlocked: false }],
      total: 1,
    }));
    expect(
      await TurbosResolver.resolve(
        suiPool({
          project: "turbos",
          poolMeta: "0.01%",
          underlyingTokens: [USDC, SUI],
        }),
        ctx,
      ),
    ).toBeNull();
  });

  it("fails closed when the pool object can't be read", async () => {
    mockGetSuiObjectType.mockResolvedValue(null);
    expect(
      await TurbosResolver.resolve(
        suiPool({
          project: "turbos",
          poolMeta: "0.01%",
          underlyingTokens: [USDC, SUI],
        }),
        TURBOS_CTX,
      ),
    ).toBeNull();
  });

  it("fails closed for a non-Sui chain", async () => {
    expect(
      await TurbosResolver.resolve(
        suiPool({
          project: "turbos",
          poolMeta: "0.01%",
          underlyingTokens: [USDC, SUI],
          chain: "Ethereum",
        }),
        TURBOS_CTX,
      ),
    ).toBeNull();
  });
});

// ── Bluefin Spot CLMM ───────────────────────────────────────────────────────

const BLUEFIN_POOL =
  "0x15dbcac854b1fc68fc9467dbd9ab34270447aabd8cc0e04a5864d95ccb86b74a";
const BLUEFIN_ROW = {
  address: BLUEFIN_POOL,
  feeRate: "0.1750", // 0.175%
  is_paused: false,
  config: { tickSpacing: 1 },
  tokenA: { info: { address: SUI } },
  tokenB: { info: { address: USDC } },
};
const BLUEFIN_CTX = ctxWith(() => [BLUEFIN_ROW]);

describe("BluefinSpotResolver", () => {
  beforeEach(() => mockGetSuiObjectType.mockReset());

  it("resolves a (fee tier + pair) match to a bluefin-spot-pool target", async () => {
    mockGetSuiObjectType.mockResolvedValue("0xpkg::pool::Pool<...>");
    const target = await BluefinSpotResolver.resolve(
      suiPool({
        project: "bluefin-spot",
        symbol: "SUI-USDC",
        poolMeta: "0.175%",
        underlyingTokens: [SUI, USDC],
      }),
      BLUEFIN_CTX,
    );
    expect(target).toEqual({
      kind: "bluefin-spot-pool",
      pool: BLUEFIN_POOL,
      coinTypeA: SUI,
      coinTypeB: USDC,
      tickSpacing: 1,
    });
  });

  it("matches the pair regardless of on-chain tokenA/tokenB order", async () => {
    mockGetSuiObjectType.mockResolvedValue("0xpkg::pool::Pool<...>");
    const target = await BluefinSpotResolver.resolve(
      suiPool({
        project: "bluefin-spot",
        poolMeta: "0.175%",
        underlyingTokens: [USDC, SUI], // reversed vs. the row's a/b order
      }),
      BLUEFIN_CTX,
    );
    expect(target).toMatchObject({
      kind: "bluefin-spot-pool",
      pool: BLUEFIN_POOL,
    });
  });

  it("fails closed when poolMeta isn't a parseable fee percent", async () => {
    expect(
      await BluefinSpotResolver.resolve(
        suiPool({
          project: "bluefin-spot",
          poolMeta: "not-a-fee",
          underlyingTokens: [SUI, USDC],
        }),
        BLUEFIN_CTX,
      ),
    ).toBeNull();
    expect(mockGetSuiObjectType).not.toHaveBeenCalled();
  });

  it("fails closed when no row matches the fee tier", async () => {
    expect(
      await BluefinSpotResolver.resolve(
        suiPool({
          project: "bluefin-spot",
          poolMeta: "1%", // row is 0.175%
          underlyingTokens: [SUI, USDC],
        }),
        BLUEFIN_CTX,
      ),
    ).toBeNull();
  });

  it("fails closed when the matched row has no valid tickSpacing", async () => {
    const ctx = ctxWith(() => [
      { ...BLUEFIN_ROW, config: { tickSpacing: undefined } },
    ]);
    expect(
      await BluefinSpotResolver.resolve(
        suiPool({
          project: "bluefin-spot",
          poolMeta: "0.175%",
          underlyingTokens: [SUI, USDC],
        }),
        ctx,
      ),
    ).toBeNull();
  });

  it("fails closed when a matched row is paused", async () => {
    const ctx = ctxWith(() => [{ ...BLUEFIN_ROW, is_paused: true }]);
    expect(
      await BluefinSpotResolver.resolve(
        suiPool({
          project: "bluefin-spot",
          poolMeta: "0.175%",
          underlyingTokens: [SUI, USDC],
        }),
        ctx,
      ),
    ).toBeNull();
  });

  it("fails closed when the pool object can't be read", async () => {
    mockGetSuiObjectType.mockResolvedValue(null);
    expect(
      await BluefinSpotResolver.resolve(
        suiPool({
          project: "bluefin-spot",
          poolMeta: "0.175%",
          underlyingTokens: [SUI, USDC],
        }),
        BLUEFIN_CTX,
      ),
    ).toBeNull();
  });

  it("fails closed for a non-Sui chain", async () => {
    expect(
      await BluefinSpotResolver.resolve(
        suiPool({
          project: "bluefin-spot",
          poolMeta: "0.175%",
          underlyingTokens: [SUI, USDC],
          chain: "Ethereum",
        }),
        BLUEFIN_CTX,
      ),
    ).toBeNull();
  });
});

// ── Sui liquid staking (Haedal / Volo / SpringSui / Aftermath) ────────────────

describe("SuiLstResolver", () => {
  it("resolves each synthesized LST pool to its sui-lst target", async () => {
    const cases: Array<[string, string, string]> = [
      ["haedal-protocol", "haedal", "hasui::HASUI"],
      ["volo-lst", "volo", "cert::CERT"],
      ["springsui", "springsui", "spring_sui::SPRING_SUI"],
      ["aftermath-afsui", "aftermath", "afsui::AFSUI"],
    ];
    for (const [project, venue, tail] of cases) {
      const target = await SuiLstResolver.resolve(
        suiPool({ project, symbol: "SUI", underlyingTokens: [SUI] }),
        SCALLOP_CTX,
      );
      expect(target).toMatchObject({ kind: "sui-lst", venue });
      expect((target as { lstType: string }).lstType).toContain(tail);
    }
  });

  it("fails closed for an unknown (non-LST) project", async () => {
    expect(
      await SuiLstResolver.resolve(
        suiPool({ project: "not-an-lst" }),
        SCALLOP_CTX,
      ),
    ).toBeNull();
  });

  it("fails closed for a non-Sui chain", async () => {
    expect(
      await SuiLstResolver.resolve(
        suiPool({ project: "haedal-protocol", chain: "Ethereum" }),
        SCALLOP_CTX,
      ),
    ).toBeNull();
  });
});
