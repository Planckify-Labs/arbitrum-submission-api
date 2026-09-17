import type { ConfigService } from "@nestjs/config";
import type { BlockchainVerificationService } from "../blockchain-verification/blockchain-verification.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { BlockchainCacheService } from "../valkey/services/blockchain-cache.service";
import type { X402SupportedService } from "../x402/x402-supported.service";
import { BlockchainsService } from "./blockchains.service";

/**
 * Unit tests for the enriched `GET /blockchains` path (task 21).
 * We stub Prisma + cache so we never touch the network.
 */
describe("BlockchainsService - enriched config", () => {
  const arcGatewayWallet = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
  const arcGatewayMinter = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";
  const arcUsdcAddress = "0x3600000000000000000000000000000000000000";
  const arcUpdatedAt = new Date("2025-01-01T00:00:00.000Z");

  function makeArcRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "01ARC",
      name: "Arc Testnet",
      chainId: 5042002,
      rpcUrl: "https://rpc.testnet.arc.network",
      blockExplorer: "https://testnet.arcscan.app",
      type: "EVM",
      isActive: true,
      isTestnet: true,
      updatedAt: arcUpdatedAt,
      metadata: {
        x402DomainName: "GatewayWalletBatched",
        x402DomainVersion: "1",
      },
      SmartContract: [
        { name: "gateway_wallet", address: arcGatewayWallet, isActive: true },
        { name: "gateway_minter", address: arcGatewayMinter, isActive: true },
      ],
      tokens: [
        {
          symbol: "USDC",
          decimals: 6,
          contractAddress: arcUsdcAddress,
          isStablecoin: true,
          isActive: true,
          isNativeCurrency: true,
        },
      ],
      ...overrides,
    };
  }

  function makeService(opts: {
    rows: Array<ReturnType<typeof makeArcRow>>;
    env?: Record<string, string>;
    x402Snapshot?: ReturnType<X402SupportedService["getSupportedForChain"]>;
  }) {
    const prisma = {
      blockchain: {
        findMany: jest.fn(async (_args: unknown) => opts.rows),
      },
    } as unknown as PrismaService;

    const cache = {
      getEnrichedConfig: jest.fn(
        async (_seg: string, fallback: () => Promise<unknown>) => fallback(),
      ),
    } as unknown as BlockchainCacheService;

    const configService = {
      get: (key: string) => opts.env?.[key],
    } as unknown as ConfigService;

    const x402 = {
      getSupportedForChain: jest.fn(() => opts.x402Snapshot ?? null),
      getLastRefreshAt: jest.fn(() => 1700000000000),
    } as unknown as X402SupportedService;

    const blockchainVerification = {
      refreshClients: jest.fn(async () => undefined),
    } as unknown as BlockchainVerificationService;

    const svc = new BlockchainsService(
      prisma,
      cache,
      configService,
      x402,
      blockchainVerification,
    );
    return { svc, prisma, cache, configService, x402, blockchainVerification };
  }

  it("returns enriched Arc row with populated gateway/x402, null paymaster", async () => {
    const { svc } = makeService({ rows: [makeArcRow()] });
    const { blockchains, etag } = await svc.getEnrichedConfig();

    expect(blockchains).toHaveLength(1);
    const [arc] = blockchains;
    expect(arc.caip2Id).toBe("eip155:5042002");
    expect(arc.gateway).toEqual({
      walletContract: arcGatewayWallet,
      minterContract: arcGatewayMinter,
    });
    expect(arc.paymaster).toBeNull();
    expect(arc.x402?.domainName).toBe("GatewayWalletBatched");
    expect(arc.x402?.verifyingContract).toBe(arcGatewayWallet);
    expect(arc.usdc?.address).toBe(arcUsdcAddress);
    expect(arc.usdc?.isNativeCurrency).toBe(true);
    expect(arc.nativeCurrency?.symbol).toBe("USDC");
    expect(etag).toMatch(/^W\/"[0-9a-f]{32}"$/);
  });

  it("emits nested null for chains without Gateway/x402 coverage", async () => {
    const bareRow = makeArcRow({
      id: "01ETH",
      name: "Ethereum",
      chainId: 1,
      rpcUrl: "https://mainnet.infura.io/v3/x",
      blockExplorer: "https://etherscan.io",
      metadata: null,
      SmartContract: [],
      tokens: [],
    });
    const { svc } = makeService({ rows: [bareRow] });
    const { blockchains } = await svc.getEnrichedConfig();

    expect(blockchains[0].gateway).toBeNull();
    expect(blockchains[0].paymaster).toBeNull();
    expect(blockchains[0].x402).toBeNull();
    expect(blockchains[0].usdc).toBeNull();
  });

  it("falls back to X402SupportedService when DB columns are null", async () => {
    const rowWithNullX402 = makeArcRow({
      metadata: {},
    });
    const { svc } = makeService({
      rows: [rowWithNullX402],
      x402Snapshot: {
        namespace: "eip155",
        chainId: 5042002,
        network: "eip155:5042002",
        scheme: "exact",
        asset: null,
        domainName: "GatewayWalletBatched",
        domainVersion: "1",
        verifyingContract: arcGatewayWallet,
        authorizedSigners: [],
      },
    });

    const { blockchains } = await svc.getEnrichedConfig();
    expect(blockchains[0].x402?.domainName).toBe("GatewayWalletBatched");
    expect(blockchains[0].x402?.verifyingContract).toBe(arcGatewayWallet);
  });

  it("filters by country=ID using the default allow-list", async () => {
    const { svc, prisma } = makeService({ rows: [makeArcRow()] });
    await svc.getEnrichedConfig("ID");

    const findManyArgs = (prisma.blockchain.findMany as jest.Mock).mock
      .calls[0][0];
    expect(findManyArgs.where).toMatchObject({
      isActive: true,
      chainId: { in: [5042002, 10143] },
    });
  });

  it("returns empty blockchain list for an unknown country", async () => {
    const { svc } = makeService({ rows: [] });
    const { blockchains } = await svc.getEnrichedConfig("ZZ");
    expect(blockchains).toEqual([]);
  });

  it("honours BLOCKCHAINS_COUNTRY_ALLOWLIST_<ISO> env override", async () => {
    const { svc, prisma } = makeService({
      rows: [makeArcRow()],
      env: { BLOCKCHAINS_COUNTRY_ALLOWLIST_ID: "1,5042002,42161" },
    });
    await svc.getEnrichedConfig("ID");

    const findManyArgs = (prisma.blockchain.findMany as jest.Mock).mock
      .calls[0][0];
    expect(findManyArgs.where.chainId).toEqual({ in: [1, 5042002, 42161] });
  });

  it("ETag changes when rows change but is stable otherwise", async () => {
    const { svc } = makeService({ rows: [makeArcRow()] });
    const a = await svc.getEnrichedConfig();
    const b = await svc.getEnrichedConfig();
    expect(a.etag).toBe(b.etag);

    const { svc: svc2 } = makeService({
      rows: [makeArcRow({ updatedAt: new Date("2025-06-01T00:00:00.000Z") })],
    });
    const c = await svc2.getEnrichedConfig();
    expect(c.etag).not.toBe(a.etag);
  });

  it("filters by active status (where.isActive = true)", async () => {
    const { svc, prisma } = makeService({ rows: [makeArcRow()] });
    await svc.getEnrichedConfig();
    const findManyArgs = (prisma.blockchain.findMany as jest.Mock).mock
      .calls[0][0];
    expect(findManyArgs.where.isActive).toBe(true);
  });
});
