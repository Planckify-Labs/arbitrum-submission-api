import type { ConfigService } from "@nestjs/config";
import { Keypair } from "@stellar/stellar-base";
import type { NonceCacheService } from "../../valkey/services/nonce-cache.service";
import { SiwsStellarService } from "./siws-stellar.service";

/**
 * SIWS-Stellar verifier. Unlike SIWS-Sui, `@stellar/stellar-base` needs
 * no ESM/CJS dynamic-import interop, so the full happy-path round trip
 * (build → sign with a real Keypair → verify) is exercised directly
 * here rather than deferred to an integration spec.
 */
function buildSvc(
  envOverrides: Record<string, string> = {
    SIWE_DOMAIN: "com.cstralpt.takumipay",
  },
  nonceOverride: { nonce: string; expires: number } | null = null,
) {
  const config = {
    get: jest.fn((k: string) => envOverrides[k]),
  } as unknown as ConfigService;
  const nonceCache = {
    getNonce: jest.fn(async () => nonceOverride),
    deleteNonce: jest.fn(async () => undefined),
  } as unknown as NonceCacheService;
  return {
    svc: new SiwsStellarService(nonceCache, config),
    nonceCache,
    config,
  };
}

describe("SiwsStellarService.buildMessage / parseMessage", () => {
  it("buildMessage emits parseable text round-tripping through parseMessage", () => {
    const { svc } = buildSvc();
    const kp = Keypair.random();
    const msg = svc.buildMessage({
      domain: "com.cstralpt.takumipay",
      address: kp.publicKey(),
      statement: "Sign in",
      uri: "https://example.test",
      version: "1",
      chainId: "mainnet",
      nonce: "n123",
      issuedAt: "2026-01-01T00:00:00Z",
      expirationTime: "2099-01-01T00:10:00Z",
    });
    expect(msg).toContain(
      "com.cstralpt.takumipay wants you to sign in with your Stellar account:",
    );
    expect(msg).toContain(kp.publicKey());

    const parsed = svc.parseMessage(msg);
    expect(parsed.address).toBe(kp.publicKey());
    expect(parsed.nonce).toBe("n123");
    expect(parsed.chainId).toBe("mainnet");
  });
});

describe("SiwsStellarService.verify — happy path", () => {
  it("verifies a real ed25519 signature over the built message and consumes the nonce", async () => {
    const kp = Keypair.random();
    const { svc, nonceCache } = buildSvc(
      { SIWE_DOMAIN: "com.cstralpt.takumipay" },
      { nonce: "n123", expires: Date.now() + 60_000 },
    );

    const message = svc.buildMessage({
      domain: "com.cstralpt.takumipay",
      address: kp.publicKey(),
      uri: "https://example.test",
      version: "1",
      chainId: "mainnet",
      nonce: "n123",
      issuedAt: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 60_000).toISOString(),
    });

    // Mirrors mobile `StellarWalletKit.signAuthMessage`: raw ed25519
    // sign over the UTF-8 message bytes, base64-encoded.
    const signature = kp.sign(Buffer.from(message, "utf8")).toString("base64");

    const result = await svc.verify(message, signature);
    expect(result.success).toBe(true);
    expect(result.address).toBe(kp.publicKey());
    expect(nonceCache.deleteNonce).toHaveBeenCalledWith(
      "stellar",
      kp.publicKey(),
    );
  });

  it("rejects a signature from a different keypair (wrong signer)", async () => {
    const kp = Keypair.random();
    const impostor = Keypair.random();
    const { svc } = buildSvc(
      { SIWE_DOMAIN: "com.cstralpt.takumipay" },
      { nonce: "n123", expires: Date.now() + 60_000 },
    );

    const message = svc.buildMessage({
      domain: "com.cstralpt.takumipay",
      address: kp.publicKey(),
      uri: "https://example.test",
      version: "1",
      chainId: "mainnet",
      nonce: "n123",
      issuedAt: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 60_000).toISOString(),
    });
    const signature = impostor
      .sign(Buffer.from(message, "utf8"))
      .toString("base64");

    const result = await svc.verify(message, signature);
    expect(result.success).toBe(false);
  });

  it("rejects when the nonce cache doesn't have a matching entry", async () => {
    const kp = Keypair.random();
    const { svc } = buildSvc({ SIWE_DOMAIN: "com.cstralpt.takumipay" }, null);

    const message = svc.buildMessage({
      domain: "com.cstralpt.takumipay",
      address: kp.publicKey(),
      uri: "https://example.test",
      version: "1",
      chainId: "mainnet",
      nonce: "n123",
      issuedAt: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 60_000).toISOString(),
    });
    const signature = kp.sign(Buffer.from(message, "utf8")).toString("base64");

    const result = await svc.verify(message, signature);
    expect(result.success).toBe(false);
  });

  it("rejects an expired message", async () => {
    const kp = Keypair.random();
    const { svc } = buildSvc(
      { SIWE_DOMAIN: "com.cstralpt.takumipay" },
      { nonce: "n123", expires: Date.now() + 60_000 },
    );

    const message = svc.buildMessage({
      domain: "com.cstralpt.takumipay",
      address: kp.publicKey(),
      uri: "https://example.test",
      version: "1",
      chainId: "mainnet",
      nonce: "n123",
      issuedAt: "2020-01-01T00:00:00Z",
      expirationTime: "2020-01-01T00:10:00Z",
    });
    const signature = kp.sign(Buffer.from(message, "utf8")).toString("base64");

    const result = await svc.verify(message, signature);
    expect(result.success).toBe(false);
  });

  it("rejects a domain mismatch", async () => {
    const kp = Keypair.random();
    const { svc } = buildSvc(
      { SIWE_DOMAIN: "com.cstralpt.takumipay" },
      { nonce: "n123", expires: Date.now() + 60_000 },
    );

    const message = svc.buildMessage({
      domain: "evil.example",
      address: kp.publicKey(),
      uri: "https://example.test",
      version: "1",
      chainId: "mainnet",
      nonce: "n123",
      issuedAt: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 60_000).toISOString(),
    });
    const signature = kp.sign(Buffer.from(message, "utf8")).toString("base64");

    const result = await svc.verify(message, signature);
    expect(result.success).toBe(false);
  });
});

describe("SiwsStellarService.verify failure modes", () => {
  it("returns success=false for unparseable messages", async () => {
    const { svc } = buildSvc();
    const out = await svc.verify("not-a-siws-message", "sig");
    expect(out.success).toBe(false);
  });

  it("returns success=false for a malformed base64 signature", async () => {
    const kp = Keypair.random();
    const { svc } = buildSvc(
      { SIWE_DOMAIN: "com.cstralpt.takumipay" },
      { nonce: "n123", expires: Date.now() + 60_000 },
    );
    const message = svc.buildMessage({
      domain: "com.cstralpt.takumipay",
      address: kp.publicKey(),
      uri: "https://example.test",
      version: "1",
      chainId: "mainnet",
      nonce: "n123",
      issuedAt: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 60_000).toISOString(),
    });
    const out = await svc.verify(message, "not-valid-base64-sig!!");
    expect(out.success).toBe(false);
  });

  it("returns success=false for an invalid StrKey address", async () => {
    const { svc } = buildSvc(
      { SIWE_DOMAIN: "com.cstralpt.takumipay" },
      { nonce: "n123", expires: Date.now() + 60_000 },
    );
    const message = svc.buildMessage({
      domain: "com.cstralpt.takumipay",
      address: "not-a-stellar-address",
      uri: "https://example.test",
      version: "1",
      chainId: "mainnet",
      nonce: "n123",
      issuedAt: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 60_000).toISOString(),
    });
    const out = await svc.verify(message, "aGVsbG8=");
    expect(out.success).toBe(false);
  });
});
