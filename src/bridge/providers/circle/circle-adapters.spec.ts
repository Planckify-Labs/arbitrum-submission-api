/**
 * Circle adapters (`circle-cctp`, `circle-cctpx`) and their shared route
 * helpers. The App Kit client is stubbed with chain definitions copied
 * from `@circle-fin/app-kit@1.15.3`'s own `getSupportedChains("bridge")`
 * output, and with estimate shapes captured from live mainnet estimates
 * (2026-09-26), so the mapping is tested against what the SDK returns.
 */

import type { CircleAppKitClient, CircleEstimate } from "./app-kit.client";
import { CircleCctpAdapter } from "./circle-cctp.adapter";
import { CircleCctpxAdapter } from "./circle-cctpx.adapter";
import {
  type CircleChainDef,
  decimalStringToRaw,
  rawToDecimalString,
  standardDurationRange,
  statusFromIrisMessage,
} from "./circle-route";

const EVM_V2 = {
  type: "split",
  tokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
};

const BASE: CircleChainDef = {
  chain: "Base",
  name: "Base",
  type: "evm",
  chainId: 8453,
  isTestnet: false,
  explorerUrl: "https://basescan.org/tx/{hash}",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  eurcAddress: "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42",
  cctp: {
    domain: 6,
    contracts: { v2: { ...EVM_V2, confirmations: 65, fastConfirmations: 1 } },
    forwarderSupported: { source: false, destination: true },
  },
  cctpx: { serviceAddress: "0x431871229103b780868f8C6BB820cd16ECf942BC" },
};

const ARC: CircleChainDef = {
  chain: "Arc",
  name: "Arc",
  type: "evm",
  chainId: 5042,
  isTestnet: false,
  explorerUrl: "https://explorer.arc.io/tx/{hash}",
  // Arc's native gas is USDC at EIGHTEEN decimals.
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  usdcAddress: "0x3600000000000000000000000000000000000000",
  eurcAddress: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
  cctp: {
    domain: 26,
    contracts: { v2: { ...EVM_V2, confirmations: 1, fastConfirmations: 1 } },
    forwarderSupported: { source: false, destination: true },
  },
  cctpx: { serviceAddress: "0x431871229103b780868f8C6BB820cd16ECf942BC" },
};

const LINEA: CircleChainDef = {
  ...BASE,
  chain: "Linea",
  name: "Linea",
  chainId: 59144,
  cctp: {
    domain: 11,
    contracts: { v2: { ...EVM_V2, confirmations: 1 } },
    forwarderSupported: { source: false, destination: true },
  },
  cctpx: null,
};

const X_LAYER: CircleChainDef = {
  ...BASE,
  chain: "X_Layer",
  name: "X Layer",
  chainId: 196,
  cctp: {
    domain: 37,
    contracts: { v2: { ...EVM_V2, confirmations: 65 } },
    forwarderSupported: { source: false, destination: false },
  },
  cctpx: null,
};

const SOLANA: CircleChainDef = {
  chain: "Solana",
  name: "Solana",
  type: "solana",
  isTestnet: false,
  explorerUrl: "https://solscan.io/tx/{hash}",
  nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 },
  usdcAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  eurcAddress: "HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr",
  cctp: {
    domain: 5,
    contracts: { v2: { confirmations: 32 } },
    forwarderSupported: { source: false, destination: true },
  },
  cctpx: null,
};

const BASE_SEPOLIA: CircleChainDef = {
  ...BASE,
  chain: "Base_Sepolia",
  name: "Base Sepolia",
  chainId: 84532,
  isTestnet: true,
};

const CHAINS = [BASE, ARC, LINEA, X_LAYER, SOLANA, BASE_SEPOLIA];

const ME = "0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A";
const SOL_ME = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

function stubClient(estimate: Partial<CircleEstimate> = {}) {
  const calls: unknown[] = [];
  const client = {
    bridgeChains: () => CHAINS,
    estimate: async (req: unknown) => {
      calls.push(req);
      return { fees: [], gasFees: [], ...estimate };
    },
  } as unknown as CircleAppKitClient;
  return { client, calls };
}

const usdc = (def: CircleChainDef) =>
  def.type === "solana"
    ? `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:${def.usdcAddress}`
    : `eip155:${def.chainId}/erc20:${(def.usdcAddress as string).toLowerCase()}`;
const eurc = (def: CircleChainDef) =>
  `eip155:${def.chainId}/erc20:${(def.eurcAddress as string).toLowerCase()}`;

describe("circle-route helpers", () => {
  it("converts raw ⇄ decimal exactly", () => {
    expect(rawToDecimalString(1_500_000n, 6)).toBe("1.5");
    expect(rawToDecimalString(5_000_000n, 6)).toBe("5");
    expect(rawToDecimalString(1n, 6)).toBe("0.000001");
    expect(decimalStringToRaw("0.017867", 6)).toBe(17_867n);
    expect(decimalStringToRaw("1.823721", 18)).toBe(1_823_721_000_000_000_000n);
  });

  it("rounds excess fee precision UP, never down", () => {
    expect(decimalStringToRaw("0.0000001", 6)).toBe(1n);
    expect(decimalStringToRaw("0.0000010", 6)).toBe(1n);
  });

  it("quotes Circle's per-source standard window plus forward delivery", () => {
    expect(standardDurationRange(BASE)).toEqual([905, 1260]);
    expect(standardDurationRange(ARC)).toEqual([7, 150]);
  });

  it("maps Iris onto the four-value lifecycle, delivered only on forwardState", () => {
    const base = {
      sourceTxHash: "0xabc",
      burnStepKey: "burn",
      mintStepKey: "mint",
    };
    expect(
      statusFromIrisMessage({ ...base, message: undefined }),
    ).toMatchObject({
      outcome: null,
      phase: "pending_source",
    });
    expect(
      statusFromIrisMessage({
        ...base,
        message: { status: "pending_confirmations" },
      }),
    ).toMatchObject({ outcome: null, phase: "pending_attestation" });
    // Attested but not yet delivered is NOT completed.
    expect(
      statusFromIrisMessage({
        ...base,
        message: {
          status: "complete",
          attestation: "0x01",
          forwardState: "PENDING",
        },
      }),
    ).toMatchObject({
      outcome: null,
      phase: "pending_destination",
      currentStepKey: "mint",
    });
    expect(
      statusFromIrisMessage({
        ...base,
        message: {
          status: "complete",
          attestation: "0x01",
          forwardState: "CONFIRMED",
          forwardTxHash: "0xdef",
        },
        explorerUrlFor: (h) => `https://explorer.arc.io/tx/${h}`,
      }),
    ).toMatchObject({
      outcome: "completed",
      phase: "settled",
      destinationTxHash: "0xdef",
      explorerUrl: "https://explorer.arc.io/tx/0xdef",
    });
    expect(
      statusFromIrisMessage({
        ...base,
        message: { status: "complete", forwardState: "FAILED" },
      }),
    ).toMatchObject({ outcome: "failed" });
  });
});

describe("circle-cctp (USDC)", () => {
  it("serves EVM → Arc and EVM → Solana USDC, sorted ahead of generalists by supportsAsset", () => {
    const { client } = stubClient();
    const a = new CircleCctpAdapter(client);
    expect(a.supports("eip155:8453", "eip155:5042")).toBe(true);
    expect(a.supportsAsset(usdc(BASE), usdc(ARC))).toBe(true);
    expect(
      a.supports("eip155:8453", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"),
    ).toBe(true);
    expect(a.supportsAsset(usdc(BASE), usdc(SOLANA))).toBe(true);
    // Solana as the SOURCE: signed on the device by App Kit's Solana adapter.
    expect(
      a.supports("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "eip155:5042"),
    ).toBe(true);
    expect(a.supportsAsset(usdc(SOLANA), usdc(ARC))).toBe(true);
  });

  it("declines what it cannot finish safely", () => {
    const { client } = stubClient();
    const a = new CircleCctpAdapter(client);
    // Same chain, mixed networks.
    expect(a.supports("eip155:8453", "eip155:8453")).toBe(false);
    expect(a.supports("eip155:84532", "eip155:5042")).toBe(false);
    // Destination without Forwarding Service.
    expect(a.supports("eip155:8453", "eip155:196")).toBe(false);
    // Linea's standard attestation is 6-32 h: left to LI.FI.
    expect(a.supports("eip155:59144", "eip155:8453")).toBe(false);
    // Unknown chain, Sui, Stellar.
    expect(a.supports("eip155:8453", "sui:mainnet")).toBe(false);
    expect(a.supports("eip155:8453", "stellar:pubnet")).toBe(false);
    // Not USDC.
    expect(a.supportsAsset(eurc(BASE), eurc(ARC))).toBe(false);
    expect(a.supportsAsset("eip155:8453/slip44:60", usdc(ARC))).toBe(false);
  });

  it("quotes with the forwarding fee deducted and pins it as the burn's maxFee", async () => {
    const { client, calls } = stubClient({
      fees: [{ type: "forwarder", token: "USDC", amount: "0.017867" }],
      gasFees: [
        { name: "Approve", token: "ETH", fee: "0.000000945" },
        { name: "Burn", token: "ETH", fee: "0.00000315" },
      ],
    });
    const a = new CircleCctpAdapter(client);
    const q = await a.quote({
      fromChain: "eip155:8453",
      toChain: "eip155:5042",
      fromAsset: usdc(BASE),
      toAsset: usdc(ARC),
      amountRaw: "5000000",
      fromAddress: ME,
      toAddress: ME,
    });

    expect(calls[0]).toMatchObject({
      amount: "5",
      token: "USDC",
      recipientAddress: ME,
    });
    expect(q.provider).toBe("circle-cctp");
    expect(q.to.amountRaw).toBe("4982133");
    expect(q.toAmountMinRaw).toBe("4982133");
    expect(q.slippageBps).toBe(0);
    expect(q.receivesNativeAsset).toBe(true);
    expect(q.fees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "forwarding",
          amountRaw: "17867",
          included: true,
        }),
        expect.objectContaining({
          key: "gas_source",
          amountRaw: "4095000000000",
          included: false,
        }),
      ]),
    );
    expect(q.steps.map((s) => s.key)).toEqual([
      "approve",
      "burn",
      "attestation",
      "mint",
    ]);
    expect(q.execution).toEqual({
      kind: "circle_app_kit_bridge",
      chain: "eip155:8453",
      protocol: "cctp",
      sourceChain: "Base",
      destinationChain: "Arc",
      token: "USDC",
      tokenAddress: BASE.usdcAddress,
      amount: "5",
      recipientAddress: ME,
      transferSpeed: "SLOW",
      useForwarder: true,
      maxFee: "0.017867",
    });
    expect(new Date(q.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("marks receivesNativeAsset as true only when destination is Arc (native USDC)", async () => {
    const { client } = stubClient({
      fees: [{ type: "forwarder", token: "USDC", amount: "0.017867" }],
    });
    const a = new CircleCctpAdapter(client);
    // Bridging Arc -> Base: destination is Base where USDC is ERC-20, not native gas
    const qArcToBase = await a.quote({
      fromChain: "eip155:5042",
      toChain: "eip155:8453",
      fromAsset: usdc(ARC),
      toAsset: usdc(BASE),
      amountRaw: "5000000",
      fromAddress: ME,
      toAddress: ME,
    });
    expect(qArcToBase.receivesNativeAsset).toBe(false);
    expect(qArcToBase.to.token.isNative).toBe(false);

    // Bridging Base -> Arc: destination is Arc where USDC is the native gas asset
    const qBaseToArc = await a.quote({
      fromChain: "eip155:8453",
      toChain: "eip155:5042",
      fromAsset: usdc(BASE),
      toAsset: usdc(ARC),
      amountRaw: "5000000",
      fromAddress: ME,
      toAddress: ME,
    });
    expect(qBaseToArc.receivesNativeAsset).toBe(true);
    expect(qBaseToArc.to.token.isNative).toBe(true);
  });

  it("refuses an amount the delivery fee would swallow", async () => {
    const { client } = stubClient({
      fees: [{ type: "forwarder", token: "USDC", amount: "0.05" }],
    });
    const a = new CircleCctpAdapter(client);
    await expect(
      a.quote({
        fromChain: "eip155:8453",
        toChain: "eip155:5042",
        fromAsset: usdc(BASE),
        toAsset: usdc(ARC),
        amountRaw: "50000",
        fromAddress: ME,
        toAddress: ME,
      }),
    ).rejects.toMatchObject({ code: "unsupported_asset" });
  });

  it("maps an estimate failure to network_error so the registry falls through", async () => {
    const client = {
      bridgeChains: () => CHAINS,
      estimate: async () => {
        throw new Error("rpc down");
      },
    } as unknown as CircleAppKitClient;
    const a = new CircleCctpAdapter(client);
    await expect(
      a.quote({
        fromChain: "eip155:8453",
        toChain: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        fromAsset: usdc(BASE),
        toAsset: usdc(SOLANA),
        amountRaw: "5000000",
        fromAddress: ME,
        toAddress: SOL_ME,
      }),
    ).rejects.toMatchObject({ code: "network_error" });
  });
});

describe("circle-cctpx (EURC)", () => {
  it("serves only chains App Kit marks as CCTPx", () => {
    const { client } = stubClient();
    const a = new CircleCctpxAdapter(client);
    expect(a.supports("eip155:8453", "eip155:5042")).toBe(true);
    expect(a.supportsAsset(eurc(BASE), eurc(ARC))).toBe(true);
    // Solana has an EURC mint but is not a CCTPx domain.
    expect(
      a.supports("eip155:8453", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"),
    ).toBe(false);
    expect(a.supports("eip155:59144", "eip155:8453")).toBe(false);
    expect(a.supportsAsset(usdc(BASE), usdc(ARC))).toBe(false);
  });

  it("charges the protocol fee ON TOP in native gas and passes the signed quote through", async () => {
    const signed = {
      signedQuote: "0x01",
      expiresAt: Math.floor(Date.now() / 1000) + 600,
      items: [],
    };
    const { client } = stubClient({
      fees: [{ type: "provider", token: "USDC", amount: "1.823721" }],
      quote: signed,
      quoteExpiresAtMs: signed.expiresAt * 1000,
    });
    const a = new CircleCctpxAdapter(client);
    const q = await a.quote({
      fromChain: "eip155:5042",
      toChain: "eip155:8453",
      fromAsset: eurc(ARC),
      toAsset: eurc(BASE),
      amountRaw: "5000000",
      fromAddress: ME,
      toAddress: ME,
    });
    // Full amount arrives: the fee is msg.value, not deducted.
    expect(q.to.amountRaw).toBe("5000000");
    expect(q.toAmountMinRaw).toBe("5000000");
    const delivery = q.fees.find((f) => f.key === "forwarding");
    expect(delivery).toMatchObject({
      included: false,
      amountRaw: "1823721000000000000",
    });
    // Arc's native gas token, at its own 18 decimals.
    expect(delivery?.token).toMatchObject({
      symbol: "USDC",
      decimals: 18,
      isNative: true,
    });
    expect(q.execution).toMatchObject({
      kind: "circle_app_kit_bridge",
      protocol: "cctpx",
      token: "EURC",
      quote: signed,
    });
    expect(q.steps.map((s) => s.key)).toEqual([
      "approve",
      "transfer",
      "attestation",
      "forward",
    ]);
    // Our card never outlives the signed quote.
    expect(new Date(q.expiresAt).getTime()).toBeLessThan(
      signed.expiresAt * 1000,
    );
  });

  it("refuses a CCTPx route with no signed quote", async () => {
    const { client } = stubClient({ fees: [] });
    const a = new CircleCctpxAdapter(client);
    await expect(
      a.quote({
        fromChain: "eip155:8453",
        toChain: "eip155:5042",
        fromAsset: eurc(BASE),
        toAsset: eurc(ARC),
        amountRaw: "5000000",
        fromAddress: ME,
        toAddress: ME,
      }),
    ).rejects.toMatchObject({ code: "network_error" });
  });
});
