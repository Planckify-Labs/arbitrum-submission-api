import { ConfigService } from "@nestjs/config";
import { generateKeyPair, signBytes } from "@solana/keys";
import { getAddressDecoder } from "@solana/addresses";
import { webcrypto } from "node:crypto";
import { SiwsService, decodeSignature } from "./siws.service";
import { buildSiwsMessage, SiwsPayload } from "./siws-message";
import { NonceCacheService } from "../../valkey/services/nonce-cache.service";

const DOMAIN = "com.cstralpt.takumipay";

function buildConfig(): ConfigService {
  return {
    get: (key: string) => (key === "SIWE_DOMAIN" ? DOMAIN : undefined),
  } as unknown as ConfigService;
}

function buildNonceMock(): {
  cache: NonceCacheService;
  set: (ns: string, addr: string, nonce: string) => void;
  has: (ns: string, addr: string) => boolean;
} {
  const store = new Map<string, string>();
  const cache = {
    setNonce: jest.fn(async (ns: string, addr: string, nonce: string) => {
      store.set(`${ns}:${addr}`, nonce);
    }),
    getNonce: jest.fn(async (ns: string, addr: string) => {
      const n = store.get(`${ns}:${addr}`);
      return n ? { nonce: n, expires: Date.now() + 300_000 } : null;
    }),
    deleteNonce: jest.fn(async (ns: string, addr: string) => {
      store.delete(`${ns}:${addr}`);
    }),
  } as unknown as NonceCacheService;
  return {
    cache,
    set: (ns, addr, nonce) => store.set(`${ns}:${addr}`, nonce),
    has: (ns, addr) => store.has(`${ns}:${addr}`),
  };
}

async function pubkeyToBase58(key: CryptoKey): Promise<string> {
  const raw = await webcrypto.subtle.exportKey("raw", key);
  return getAddressDecoder().decode(new Uint8Array(raw));
}

function encodeBase58(bytes: Uint8Array): string {
  const ALPHABET =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits: number[] = [0];
  for (const b of bytes) {
    let carry = b;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let leadingZeros = 0;
  for (const b of bytes) {
    if (b === 0) leadingZeros++;
    else break;
  }
  let out = "1".repeat(leadingZeros);
  for (let i = digits.length - 1; i >= 0; i--) {
    out += ALPHABET[digits[i]];
  }
  return out;
}

describe("SiwsService.verify", () => {
  let service: SiwsService;
  let nonce: ReturnType<typeof buildNonceMock>;

  beforeEach(() => {
    nonce = buildNonceMock();
    service = new SiwsService(nonce.cache, buildConfig());
  });

  async function makeSignedMessage(
    payloadOverride: Partial<SiwsPayload> = {},
  ): Promise<{
    message: string;
    sigBase58: string;
    address: string;
    payload: SiwsPayload;
  }> {
    const { privateKey, publicKey } = await generateKeyPair();
    const address = await pubkeyToBase58(publicKey);
    const payload: SiwsPayload = {
      domain: DOMAIN,
      address,
      uri: "takumipay://wallet-auth",
      version: "1",
      chainId: "devnet",
      nonce: "fixed-nonce-abc",
      issuedAt: new Date(Date.now() - 1000).toISOString(),
      expirationTime: new Date(Date.now() + 300_000).toISOString(),
      ...payloadOverride,
    };
    const message = buildSiwsMessage(payload);
    const sig = await signBytes(privateKey, new TextEncoder().encode(message));
    return {
      message,
      sigBase58: encodeBase58(sig as unknown as Uint8Array),
      address,
      payload,
    };
  }

  it("accepts a valid signature and consumes the nonce", async () => {
    const { message, sigBase58, address, payload } = await makeSignedMessage();
    nonce.set("solana", address, payload.nonce!);
    const res = await service.verify(message, sigBase58);
    expect(res.success).toBe(true);
    expect(res.address).toBe(address);
    expect(nonce.has("solana", address)).toBe(false);
  });

  it("rejects when nonce in cache does not match", async () => {
    const { message, sigBase58, address } = await makeSignedMessage();
    nonce.set("solana", address, "wrong-nonce");
    const res = await service.verify(message, sigBase58);
    expect(res.success).toBe(false);
    expect(nonce.has("solana", address)).toBe(true);
  });

  it("rejects expired message", async () => {
    const { message, sigBase58, address, payload } = await makeSignedMessage({
      issuedAt: new Date(Date.now() - 600_000).toISOString(),
      expirationTime: new Date(Date.now() - 300_000).toISOString(),
    });
    nonce.set("solana", address, payload.nonce!);
    const res = await service.verify(message, sigBase58);
    expect(res.success).toBe(false);
  });

  it("rejects domain mismatch", async () => {
    const { message, sigBase58, address, payload } = await makeSignedMessage({
      domain: "evil.example",
    });
    nonce.set("solana", address, payload.nonce!);
    const res = await service.verify(message, sigBase58);
    expect(res.success).toBe(false);
  });

  it("rejects malformed base58 signature", async () => {
    const { message, address, payload } = await makeSignedMessage();
    nonce.set("solana", address, payload.nonce!);
    const res = await service.verify(message, "not-a-base58-sig-$$");
    expect(res.success).toBe(false);
  });

  it("rejects 63-byte signature (wrong length)", async () => {
    const { message, address, payload } = await makeSignedMessage();
    nonce.set("solana", address, payload.nonce!);
    // 63-byte buffer encoded as base58.
    const shortSig = encodeBase58(new Uint8Array(63));
    const res = await service.verify(message, shortSig);
    expect(res.success).toBe(false);
  });

  it("rejects tampered message with valid sig", async () => {
    const { sigBase58, address, payload } = await makeSignedMessage();
    nonce.set("solana", address, payload.nonce!);
    const tampered = buildSiwsMessage({
      ...payload,
      nonce: "tampered-nonce",
    });
    const res = await service.verify(tampered, sigBase58);
    expect(res.success).toBe(false);
  });

  it("rejects message missing Expiration Time line", async () => {
    const { address, payload } = await makeSignedMessage();
    nonce.set("solana", address, payload.nonce!);
    // Build a message without the expirationTime field — the parser treats
    // it as present-but-empty (undefined), which fails verify's expiry check.
    const stripped = [
      `com.cstralpt.takumipay wants you to sign in with your Solana account:`,
      address,
      "",
      "URI: takumipay://wallet-auth",
      "Version: 1",
      "Chain ID: devnet",
      "Nonce: fixed-nonce-abc",
      "Issued At: 2026-04-18T00:00:00.000Z",
      // no Expiration Time
    ].join("\n");
    const res = await service.verify(stripped, "doesnt-matter");
    expect(res.success).toBe(false);
  });

  it("accepts base64 signature as fallback", async () => {
    const { message, sigBase58, address, payload } = await makeSignedMessage();
    nonce.set("solana", address, payload.nonce!);
    // Decode base58 → re-encode as base64
    const bytes = decodeSignature(sigBase58)!;
    const b64 = Buffer.from(bytes).toString("base64");
    const res = await service.verify(message, b64);
    expect(res.success).toBe(true);
  });
});
