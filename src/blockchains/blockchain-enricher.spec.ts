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
    isEVM: true,
    isActive: true,
    isTestnet: true,
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    gatewayWalletContract: arcGatewayWallet,
    gatewayMinterContract: arcGatewayMinter,
    paymasterAddress: null, // Arc has no paymaster — USDC is gas
    x402DomainName: "GatewayWalletBatched",
    x402DomainVersion: "1",
    x402VerifyingContract: arcGatewayWallet,
    x402FacilitatorUrl: null,
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
    isEVM: true,
    isActive: true,
    isTestnet: false,
    updatedAt: new Date(),
    gatewayWalletContract: null,
    gatewayMinterContract: null,
    paymasterAddress: null,
    x402DomainName: null,
    x402DomainVersion: null,
    x402VerifyingContract: null,
    x402FacilitatorUrl: null,
    tokens: [],
  };

  describe("buildCaip2Id", () => {
    it("returns eip155:<chainId> for EVM rows", () => {
      expect(buildCaip2Id(arcRow)).toBe("eip155:5042002");
    });

    it("returns null for non-EVM rows", () => {
      expect(buildCaip2Id({ ...bareRow, isEVM: false })).toBeNull();
    });
  });

  describe("buildGateway", () => {
    it("populates both contracts when DB has them", () => {
      expect(buildGateway(arcRow)).toEqual({
        walletContract: arcGatewayWallet,
        minterContract: arcGatewayMinter,
      });
    });

    it("returns null (NOT an object-of-nulls) when either column is missing", () => {
      expect(buildGateway(bareRow)).toBeNull();
      expect(
        buildGateway({ ...arcRow, gatewayMinterContract: null }),
      ).toBeNull();
    });
  });

  describe("buildPaymaster", () => {
    it("returns null on chains with no paymaster (Arc case)", () => {
      expect(buildPaymaster(arcRow)).toBeNull();
    });

    it("returns object when address present", () => {
      const row = { ...arcRow, paymasterAddress: "0xpaymaster" };
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
