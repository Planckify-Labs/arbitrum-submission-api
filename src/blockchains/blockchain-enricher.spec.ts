import {
  buildGateway,
  buildPaymaster,
  buildUsdc,
  buildX402,
  buildNativeCurrency,
  buildCaip2Id,
  enrichBlockchain,
  type TBlockchainRow,
} from "./blockchain-enricher";
import type { X402SupportedService } from "../x402/x402-supported.service";

/**
 * Unit tests for the {@link enrichBlockchain} serializer. Task 21.
 * Focus: nested-nullable discipline + x402 DB→memory fallback.
 */
describe("blockchain-enricher", () => {
  const arcGatewayWallet = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
  const arcGatewayMinter = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";
  const arcUsdcAddress = "0x3600000000000000000000000000000000000000";

  const tokenDefaults = {
    id: "tok-default",
    name: "Token",
    blockchainId: "01ARC...",
    logoUrl: null,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
  };

  const arcRow: TBlockchainRow = {
    id: "01ARC...",
    name: "Arc Testnet",
    chainId: 5042002,
    rpcUrl: "https://rpc.testnet.arc.network",
    blockExplorer: "https://testnet.arcscan.app",
    type: "EVM",
    isActive: true,
    isTestnet: true,
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    metadata: {
      x402DomainName: "GatewayWalletBatched",
      x402DomainVersion: "1",
    },
    // No "paymaster" row — Arc has no paymaster (USDC is gas). No distinct
    // "x402_verifying" row — falls back to gateway_wallet (same address by
    // protocol design).
    SmartContract: [
      { name: "gateway_wallet", address: arcGatewayWallet, isActive: true },
      { name: "gateway_minter", address: arcGatewayMinter, isActive: true },
    ],
    tokens: [
      {
        ...tokenDefaults,
        id: "tok-usdc-arc",
        name: "USD Coin",
        symbol: "USDC",
        decimals: 6,
        contractAddress: arcUsdcAddress,
        isStablecoin: true,
        isActive: true,
        isNativeCurrency: true,
      },
    ],
  };

  const bareRow: TBlockchainRow = {
    id: "01BARE...",
    name: "Ethereum",
    chainId: 1,
    rpcUrl: "https://mainnet.infura.io/v3/x",
    blockExplorer: "https://etherscan.io",
    type: "EVM",
    isActive: true,
    isTestnet: false,
    updatedAt: new Date(),
    metadata: null,
    SmartContract: [],
    tokens: [],
  };

  describe("buildCaip2Id", () => {
    it("returns eip155:<chainId> for EVM rows", () => {
      expect(buildCaip2Id(arcRow)).toBe("eip155:5042002");
    });

    it("returns null for non-EVM rows with no chainSlug", () => {
      expect(buildCaip2Id({ ...bareRow, type: "SVM" })).toBeNull();
    });

    // Solana's CAIP-2 reference is the truncated cluster genesis hash, NOT
    // the RPC cluster name "mainnet-beta" — this must match the genesis
    // hash `bridge/providers/lifi.mapping.ts`'s `NON_EVM_CAIP2_BY_LIFI_ID`
    // table uses, or an exact-match lookup against a live bridge quote's
    // `chain` field (e.g. the mobile bridge card's destination-chain icon)
    // silently fails. Regression coverage for that bug.
    it("returns the genesis-hash CAIP-2 reference for solana-mainnet", () => {
      expect(
        buildCaip2Id({ ...bareRow, type: "SVM", chainSlug: "solana-mainnet" }),
      ).toBe("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
    });

    it("returns the genesis-hash CAIP-2 reference for solana-devnet", () => {
      expect(
        buildCaip2Id({ ...bareRow, type: "SVM", chainSlug: "solana-devnet" }),
      ).toBe("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
    });

    it("falls back to the literal cluster name for an unrecognised solana cluster", () => {
      expect(
        buildCaip2Id({ ...bareRow, type: "SVM", chainSlug: "solana-testnet" }),
      ).toBe("solana:testnet");
    });

    it("returns sui:<cluster> for sui rows, unaffected by the solana fix", () => {
      expect(
        buildCaip2Id({ ...bareRow, type: "MOVE_VM", chainSlug: "sui-mainnet" }),
      ).toBe("sui:mainnet");
    });

    // Stellar's CAIP-28 reference is `pubnet`, not `mainnet` — and Stellar
    // rows used to fall through to `null` entirely, so no lookup keyed on
    // caip2Id could ever resolve a Stellar chain.
    it("maps stellar-mainnet to the pubnet CAIP-2 reference", () => {
      expect(
        buildCaip2Id({
          ...bareRow,
          type: "STELLAR",
          chainSlug: "stellar-mainnet",
        }),
      ).toBe("stellar:pubnet");
    });

    it("maps stellar-testnet verbatim", () => {
      expect(
        buildCaip2Id({
          ...bareRow,
          type: "STELLAR",
          chainSlug: "stellar-testnet",
        }),
      ).toBe("stellar:testnet");
    });
  });

  describe("buildGateway", () => {
    it("populates both contracts when DB has them", () => {
      expect(buildGateway(arcRow)).toEqual({
        walletContract: arcGatewayWallet,
        minterContract: arcGatewayMinter,
      });
    });

    it("returns null (NOT an object-of-nulls) when either contract is missing", () => {
      expect(buildGateway(bareRow)).toBeNull();
      expect(
        buildGateway({
          ...arcRow,
          SmartContract: arcRow.SmartContract?.filter((s) => s.name !== "gateway_minter"),
        }),
      ).toBeNull();
    });
  });

  describe("buildPaymaster", () => {
    it("returns null on chains with no paymaster (Arc case)", () => {
      expect(buildPaymaster(arcRow)).toBeNull();
    });

    it("returns object when address present", () => {
      const row: TBlockchainRow = {
        ...arcRow,
        SmartContract: [
          ...(arcRow.SmartContract ?? []),
          { name: "paymaster", address: "0xpaymaster", isActive: true },
        ],
      };
      expect(buildPaymaster(row)).toEqual({ address: "0xpaymaster" });
    });
  });

  describe("buildX402", () => {
    it("uses DB columns when all three core fields are present", () => {
      expect(buildX402(arcRow)).toEqual({
        domainName: "GatewayWalletBatched",
        domainVersion: "1",
        verifyingContract: arcGatewayWallet,
        facilitatorUrl: null,
      });
    });

    it("returns null when DB empty and no x402 service provided", () => {
      expect(buildX402(bareRow)).toBeNull();
    });

    it("falls back to X402SupportedService when DB is empty", () => {
      const svc = {
        getSupportedForChain: (_chainId: number) => ({
          namespace: "eip155" as const,
          chainId: 1,
          network: "eip155:1",
          scheme: "exact",
          asset: null,
          domainName: "FallbackDomain",
          domainVersion: "2",
          verifyingContract: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          authorizedSigners: [],
        }),
      } as unknown as X402SupportedService;

      expect(buildX402(bareRow, svc)).toEqual({
        domainName: "FallbackDomain",
        domainVersion: "2",
        verifyingContract: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        facilitatorUrl: null,
      });
    });

    it("prefers DB values over x402 fallback (DB is authoritative)", () => {
      const svc = {
        getSupportedForChain: () => ({
          namespace: "eip155" as const,
          chainId: 5042002,
          network: "eip155:5042002",
          scheme: "exact",
          asset: null,
          domainName: "WRONG",
          domainVersion: "99",
          verifyingContract: "0xbad",
          authorizedSigners: [],
        }),
      } as unknown as X402SupportedService;
      expect(buildX402(arcRow, svc)?.domainName).toBe("GatewayWalletBatched");
    });

    it("still returns null when neither DB nor fallback has values", () => {
      const svc = {
        getSupportedForChain: () => null,
      } as unknown as X402SupportedService;
      expect(buildX402(bareRow, svc)).toBeNull();
    });
  });

  describe("buildNativeCurrency + buildUsdc", () => {
    it("returns both native+usdc pointing at USDC on Arc", () => {
      expect(buildNativeCurrency(arcRow)).toEqual({
        symbol: "USDC",
        decimals: 6,
        address: arcUsdcAddress,
      });
      expect(buildUsdc(arcRow)).toEqual({
        address: arcUsdcAddress,
        decimals: 6,
        symbol: "USDC",
        isNativeCurrency: true,
      });
    });

    it("returns null native when no native token row is joined", () => {
      expect(buildNativeCurrency(bareRow)).toBeNull();
    });

    it("returns null usdc when no USDC token row is joined", () => {
      expect(buildUsdc(bareRow)).toBeNull();
    });

    it("picks USDC even when native is ETH (Ethereum row)", () => {
      const row: TBlockchainRow = {
        ...bareRow,
        tokens: [
          {
            ...tokenDefaults,
            id: "tok-eth",
            name: "Ether",
            blockchainId: "01BARE...",
            symbol: "ETH",
            decimals: 18,
            contractAddress: null,
            isStablecoin: false,
            isActive: true,
            isNativeCurrency: true,
          },
          {
            ...tokenDefaults,
            id: "tok-usdc-eth",
            name: "USD Coin",
            blockchainId: "01BARE...",
            symbol: "USDC",
            decimals: 6,
            contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            isStablecoin: true,
            isActive: true,
            isNativeCurrency: false,
          },
        ],
      };
      expect(buildNativeCurrency(row)).toEqual({
        symbol: "ETH",
        decimals: 18,
        address: null,
      });
      expect(buildUsdc(row)?.isNativeCurrency).toBe(false);
    });
  });

  describe("enrichBlockchain (integration)", () => {
    it("assembles full enriched shape for Arc", () => {
      const out = enrichBlockchain(arcRow);
      expect(out.caip2Id).toBe("eip155:5042002");
      expect(out.gateway).not.toBeNull();
      expect(out.paymaster).toBeNull();
      expect(out.x402).not.toBeNull();
      expect(out.usdc).not.toBeNull();
      expect(out.nativeCurrency?.symbol).toBe("USDC");
    });

    it("assembles shape with three nested nulls for a bare row", () => {
      const out = enrichBlockchain(bareRow);
      expect(out.gateway).toBeNull();
      expect(out.paymaster).toBeNull();
      expect(out.x402).toBeNull();
      expect(out.usdc).toBeNull();
    });

    // Regression guard: `Blockchain.bundlerUrl` (task 37) carries the
    // provider API key in its query string. The enricher must NEVER
    // serialize it into the public `/v1/blockchains` payload, even if
    // the upstream Prisma query accidentally selects it. Adding a row
    // with a populated `bundlerUrl` and asserting it does not appear
    // anywhere in the serialized output is the cheapest way to catch
    // a future DTO change that would leak it.
    it("never serializes bundlerUrl — server-secret invariant", () => {
      const rowWithBundler = {
        ...arcRow,
        bundlerUrl: "https://api.pimlico.io/v2/arc/rpc?apikey=leaky-key",
      } as unknown as TBlockchainRow;
      const out = enrichBlockchain(rowWithBundler);
      const serialized = JSON.stringify(out);
      expect(serialized).not.toContain("bundlerUrl");
      expect(serialized).not.toContain("leaky-key");
      expect(serialized).not.toContain("pimlico.io");
      expect(Object.keys(out)).not.toContain("bundlerUrl");
    });
  });
});
