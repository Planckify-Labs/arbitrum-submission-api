import { ConfigService } from "@nestjs/config";
import { NonceCacheService } from "./nonce-cache.service";
import { ValkeyService } from "../valkey.service";

describe("NonceCacheService", () => {
  const store = new Map<string, unknown>();

  const valkey = {
    set: jest.fn(async (key: string, value: string) => {
      await Promise.resolve();
      store.set(key, JSON.parse(value));
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    del: jest.fn(async (key: string) => {
      await Promise.resolve();
      store.delete(key);
    }),
  } as unknown as ValkeyService;

  const config = {
    get: (key: string, def?: string) => {
      if (key === "NONCE_EXPIRE_TIME_MINUTES") return "5";
      return def;
    },
  } as unknown as ConfigService;

  let service: NonceCacheService;

  beforeEach(() => {
    store.clear();
    service = new NonceCacheService(valkey, config);
  });

  it("preserves case for Solana addresses — mixed-case round-trip works", async () => {
    const address = "ABcd1234XYZmixedCaseBase58PubkeyExample";
    await service.setNonce("solana", address, "nonce-1");

    const hit = await service.getNonce("solana", address);
    expect(hit?.nonce).toBe("nonce-1");

    const miss = await service.getNonce("solana", address.toLowerCase());
    expect(miss).toBeNull();
  });

  it("lowercases EVM addresses — mixed-case lookups match", async () => {
    await service.setNonce("eip155", "0xABCD0000000000000000000000000000DEADBEEF", "nonce-2");

    const hit = await service.getNonce(
      "eip155",
      "0xabcd0000000000000000000000000000deadbeef",
    );
    expect(hit?.nonce).toBe("nonce-2");
  });

  it("legacy (address)-only signature defaults to eip155", async () => {
    await service.setNonce("0xABCD0000000000000000000000000000DEADBEEF", "nonce-3");
    const hit = await service.getNonce(
      "0xabcd0000000000000000000000000000deadbeef",
    );
    expect(hit?.nonce).toBe("nonce-3");
  });

  it("deleteNonce removes the stored value", async () => {
    await service.setNonce("solana", "ABCxyz", "n");
    await service.deleteNonce("solana", "ABCxyz");
    expect(await service.getNonce("solana", "ABCxyz")).toBeNull();
  });

  it("namespaces EVM and Solana keys separately", async () => {
    await service.setNonce("eip155", "abcd", "evm-nonce");
    await service.setNonce("solana", "abcd", "sol-nonce");
    expect((await service.getNonce("eip155", "abcd"))?.nonce).toBe("evm-nonce");
    expect((await service.getNonce("solana", "abcd"))?.nonce).toBe("sol-nonce");
  });
});
