import type { ConfigService } from "@nestjs/config";
import { X402SupportedService } from "./x402-supported.service";
import type { ValkeyService } from "../valkey/valkey.service";
import type {
  IX402HttpClient,
  TX402SupportedResponse,
} from "./x402-supported.types";

/**
 * Unit tests for {@link X402SupportedService}. We exercise the parse + cache
 * behaviour with a mock HTTP client — we never hit Circle in CI.
 *
 * Spec ref: umkm-usdc-payout-spec.md §6.5, task 22.
 */
describe("X402SupportedService", () => {
  const arcTestnetVerifyingContract =
    "0x1111111111111111111111111111111111111111";
  const baseSepoliaVerifyingContract =
    "0x2222222222222222222222222222222222222222";

  const happyResponse: TX402SupportedResponse = {
    kinds: [
      {
        scheme: "exact",
        network: "eip155:5042002",
        asset: "0x3333333333333333333333333333333333333333",
        extra: {
          name: "GatewayWalletBatched",
          version: "1",
          verifyingContract: arcTestnetVerifyingContract,
        },
        authorizedSigners: ["0x4444444444444444444444444444444444444444"],
      },
      {
        scheme: "exact",
        network: "eip155:84532",
        asset: "0x5555555555555555555555555555555555555555",
        extra: {
          name: "GatewayWalletBatched",
          version: "1",
          verifyingContract: baseSepoliaVerifyingContract,
        },
      },
      {
        scheme: "exact",
        network: "solana:mainnet",
        asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        extra: { feePayer: "FeePayerPubkeyBase58" },
      },
    ],
  };

  function makeService(opts?: {
    httpGet?: IX402HttpClient["get"];
    cached?: unknown;
  }) {
    const store = new Map<string, unknown>();
    if (opts?.cached !== undefined) {
      store.set("x402:supported", opts.cached);
    }
    const valkey = {
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      set: jest.fn(async (key: string, value: unknown) => {
        await Promise.resolve();
        store.set(key, value);
      }),
    } as unknown as ValkeyService;

    const config = {
      get: (_key: string, def?: string) => def,
    } as unknown as ConfigService;

    const http: IX402HttpClient = {
      get:
        opts?.httpGet ??
        jest.fn(async () => happyResponse),
    };

    const service = new X402SupportedService(config, valkey, http);
    return { service, valkey, http, store };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it("parses happy-path response and exposes by chainId + network", async () => {
    const { service } = makeService();

    expect(await service.refreshNow()).toBe(true);

    const arc = service.getSupportedForChain(5042002);
    expect(arc).not.toBeNull();
    expect(arc?.namespace).toBe("eip155");
    expect(arc?.domainName).toBe("GatewayWalletBatched");
    expect(arc?.domainVersion).toBe("1");
    expect(arc?.verifyingContract).toBe(arcTestnetVerifyingContract);

    const baseSepolia = service.getSupportedForChain(84532);
    expect(baseSepolia?.verifyingContract).toBe(baseSepoliaVerifyingContract);

    const solana = service.getSupportedForNetwork("solana:mainnet");
    expect(solana?.namespace).toBe("solana");
    expect(solana?.chainId).toBeNull();
  });

  it("returns null for a chain Circle does not advertise", async () => {
    const { service } = makeService();
    await service.refreshNow();

    expect(service.getSupportedForChain(999999)).toBeNull();
  });

  it("skips entries with malformed verifyingContract (not 20-byte hex)", async () => {
    const bad: TX402SupportedResponse = {
      kinds: [
        {
          scheme: "exact",
          network: "eip155:5042002",
          extra: {
            name: "GatewayWalletBatched",
            version: "1",
            verifyingContract: "0xNOTHEX",
          },
        },
        {
          scheme: "exact",
          network: "eip155:84532",
          extra: {
            name: "GatewayWalletBatched",
            version: "1",
            verifyingContract: baseSepoliaVerifyingContract,
          },
        },
      ],
    };
    const { service } = makeService({
      httpGet: jest.fn(async () => bad),
    });

    await service.refreshNow();

    // Malformed entry dropped, the good one kept.
    expect(service.getSupportedForChain(5042002)).toBeNull();
    expect(service.getSupportedForChain(84532)?.verifyingContract).toBe(
      baseSepoliaVerifyingContract,
    );
  });

  it("keeps existing cache when fetch throws (graceful failure)", async () => {
    // First: populate cache from a happy response.
    const { service, http } = makeService();
    await service.refreshNow();
    expect(service.getSupportedForChain(5042002)).not.toBeNull();

    // Now swap the http client's behaviour to throw and refresh again.
    (http.get as jest.Mock).mockRejectedValueOnce(new Error("network down"));
    const ok = await service.refreshNow();
    expect(ok).toBe(false);

    // The old entries are still served.
    expect(service.getSupportedForChain(5042002)).not.toBeNull();
  });

  it("keeps existing cache when response returns zero valid entries", async () => {
    const { service, http } = makeService();
    await service.refreshNow();
    expect(service.getSupportedForChain(5042002)).not.toBeNull();

    (http.get as jest.Mock).mockResolvedValueOnce({ kinds: [] });
    const ok = await service.refreshNow();
    expect(ok).toBe(false);

    // Previous good data preserved.
    expect(service.getSupportedForChain(5042002)).not.toBeNull();
  });

  it("tolerates a malformed Circle response shape", async () => {
    const { service } = makeService({
      // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
      httpGet: jest.fn(async () => ({}) as any),
    });
    const ok = await service.refreshNow();
    expect(ok).toBe(false);
    expect(service.getSupportedForChain(5042002)).toBeNull();
  });

  it("persists the parsed snapshot to Valkey with 24h TTL", async () => {
    const { service, valkey } = makeService();
    await service.refreshNow();

    // Give the fire-and-forget write a tick to complete.
    await new Promise((resolve) => setImmediate(resolve));

    expect(valkey.set).toHaveBeenCalled();
    const [key, _value, options] = (valkey.set as jest.Mock).mock.calls[0];
    expect(key).toBe("x402:supported");
    expect(options).toEqual({ ttl: 24 * 60 * 60 });
  });

  it("primes the in-memory cache from Valkey on boot", async () => {
    // Seed Valkey with a prior snapshot.
    const seed = [
      {
        namespace: "eip155",
        chainId: 5042002,
        network: "eip155:5042002",
        scheme: "exact",
        asset: null,
        domainName: "GatewayWalletBatched",
        domainVersion: "1",
        verifyingContract: arcTestnetVerifyingContract,
        authorizedSigners: [],
      },
    ];
    // The http client here would error if called, but onApplicationBootstrap
    // fires both primeFromCache and refresh — we make refresh also succeed.
    const { service, http } = makeService({
      cached: seed,
      httpGet: jest.fn(async () => ({ kinds: [] })),
    });

    service.onApplicationBootstrap();
    // Let both the prime and the refresh promise settle.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    // Primed from Valkey even though the live fetch returned zero entries.
    expect(service.getSupportedForChain(5042002)).not.toBeNull();
    expect(http.get).toHaveBeenCalled();

    // Clean up the 12h interval so the test process exits.
    service.onModuleDestroy();
  });
});
