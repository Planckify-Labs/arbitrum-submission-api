import { INestApplication } from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import * as request from "supertest";
import { webcrypto } from "node:crypto";
import { generateKeyPair, signBytes } from "@solana/keys";
import { getAddressDecoder } from "@solana/addresses";

import { AuthController } from "../src/auth/auth.controller";
import { AuthService } from "../src/auth/auth.service";
import { SiwsService } from "../src/auth/siws/siws.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { NonceCacheService } from "../src/valkey/services/nonce-cache.service";
import { parseSiwsMessage } from "../src/auth/siws/siws-message";

const DOMAIN = "com.cstralpt.takumipay";
const URI = "takumipay://wallet-auth";

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

async function pubkeyToBase58(key: CryptoKey): Promise<string> {
  const raw = await webcrypto.subtle.exportKey("raw", key);
  return getAddressDecoder().decode(new Uint8Array(raw));
}

class InMemoryPrisma {
  private readonly users = new Map<
    string,
    {
      id: string;
      walletAddress: string;
      walletAddressLower: string;
      status: string;
      role: string;
    }
  >();
  private readonly byLower = new Map<string, string>();
  private idSeq = 0;

  user = {
    findUnique: async ({
      where,
    }: {
      where: { walletAddressLower?: string; id?: string };
    }) => {
      if (where.walletAddressLower !== undefined) {
        const id = this.byLower.get(where.walletAddressLower);
        return id ? this.users.get(id) : null;
      }
      if (where.id !== undefined) {
        return this.users.get(where.id) ?? null;
      }
      return null;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const id = `user_${++this.idSeq}`;
      const record = {
        id,
        walletAddress: String(data.walletAddress ?? ""),
        walletAddressLower: String(data.walletAddressLower ?? ""),
        status: "ACTIVE",
        role: "USER",
      };
      this.users.set(id, record);
      this.byLower.set(record.walletAddressLower, id);
      return record;
    },
  };
}

class InMemoryNonceCache {
  private readonly store = new Map<string, { nonce: string; expires: number }>();

  async setNonce(ns: string, addr: string, nonce: string) {
    this.store.set(`${ns}:${addr}`, {
      nonce,
      expires: Date.now() + 300_000,
    });
  }

  async getNonce(ns: string, addr: string) {
    const v = this.store.get(`${ns}:${addr}`);
    if (!v) return null;
    if (v.expires < Date.now()) {
      this.store.delete(`${ns}:${addr}`);
      return null;
    }
    return v;
  }

  async deleteNonce(ns: string, addr: string) {
    this.store.delete(`${ns}:${addr}`);
  }

  has(ns: string, addr: string) {
    return this.store.has(`${ns}:${addr}`);
  }
}

describe("SIWS auth e2e — @solana/kit round-trip", () => {
  let app: INestApplication;
  let nonceCache: InMemoryNonceCache;

  beforeEach(async () => {
    nonceCache = new InMemoryNonceCache();

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              SIWE_DOMAIN: DOMAIN,
              SIWE_URI: URI,
              SIWE_STATEMENT: "Sign in to TakumiPay",
              NONCE_EXPIRE_TIME_MINUTES: "5",
              CHAIN_ID: 1,
              JWT_SECRET: "test-secret-for-siws-e2e-only",
              JWT_EXPIRATION_TIME: "1h",
              REFRESH_TOKEN_EXPIRATION_TIME: "7d",
            }),
          ],
        }),
        JwtModule.registerAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            secret: config.get<string>("JWT_SECRET"),
            signOptions: { expiresIn: "1h" },
          }),
        }),
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        SiwsService,
        { provide: PrismaService, useValue: new InMemoryPrisma() },
        { provide: NonceCacheService, useValue: nonceCache },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  async function getNonce(address: string) {
    const res = await request(app.getHttpServer())
      .get(`/auth/nonce/${address}`)
      .query({ chainSlug: "solana-devnet" });
    expect(res.status).toBe(200);
    return res.body as { nonce: string; message: string };
  }

  it("full happy path: nonce → sign → verify → JWT", async () => {
    const { privateKey, publicKey } = await generateKeyPair();
    const address = await pubkeyToBase58(publicKey);

    const { nonce, message } = await getNonce(address);

    // Sanity: the message is SIWS with the expected cluster & nonce.
    const parsed = parseSiwsMessage(message);
    expect(parsed.domain).toBe(DOMAIN);
    expect(parsed.address).toBe(address);
    expect(parsed.nonce).toBe(nonce);
    expect(parsed.chainId).toBe("devnet");

    const sig = await signBytes(privateKey, new TextEncoder().encode(message));
    const sigBase58 = encodeBase58(sig as unknown as Uint8Array);

    const verifyRes = await request(app.getHttpServer())
      .post("/auth/verify")
      .send({ message, signature: sigBase58 });

    // Nest default POST status is 201 Created — existing SIWE behavior.
    expect(verifyRes.status).toBe(201);
    expect(verifyRes.body.access_token).toBeTruthy();

    const jwt = app.get(JwtService);
    const payload = jwt.decode(verifyRes.body.access_token) as {
      walletAddress: string;
      addressNamespace: string;
    };
    expect(payload.addressNamespace).toBe("solana");
    expect(payload.walletAddress).toBe(address);

    expect(nonceCache.has("solana", address)).toBe(false);
  });

  it("replay of the same signature after success → 401", async () => {
    const { privateKey, publicKey } = await generateKeyPair();
    const address = await pubkeyToBase58(publicKey);

    const { message } = await getNonce(address);
    const sig = await signBytes(privateKey, new TextEncoder().encode(message));
    const sigBase58 = encodeBase58(sig as unknown as Uint8Array);

    const ok = await request(app.getHttpServer())
      .post("/auth/verify")
      .send({ message, signature: sigBase58 });
    expect(ok.status).toBe(201);

    const replay = await request(app.getHttpServer())
      .post("/auth/verify")
      .send({ message, signature: sigBase58 });
    expect(replay.status).toBe(401);
  });

  it("malformed base58 signature → 401", async () => {
    const { publicKey } = await generateKeyPair();
    const address = await pubkeyToBase58(publicKey);
    const { message } = await getNonce(address);
    const res = await request(app.getHttpServer())
      .post("/auth/verify")
      .send({ message, signature: "not-a-valid-sig!!" });
    expect(res.status).toBe(401);
  });

  it("unsupported chainSlug → 400", async () => {
    const res = await request(app.getHttpServer())
      .get("/auth/nonce/anyaddress")
      .query({ chainSlug: "ethereum-1" });
    expect(res.status).toBe(400);
  });
});
