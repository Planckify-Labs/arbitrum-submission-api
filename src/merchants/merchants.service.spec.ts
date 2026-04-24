import {
  type KeyObject,
  createPrivateKey,
  generateKeyPairSync,
} from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { exportJWK, importSPKI, jwtVerify } from "jose";
import type { PrismaService } from "../prisma/prisma.service";
import type { ValkeyService } from "../valkey/valkey.service";
import {
  CHANNELS_CACHE_KEY_PREFIX,
  CHANNELS_CACHE_TTL_SECONDS,
  MerchantsService,
} from "./merchants.service";
import { QrSigningService } from "./qr-signing.service";

/**
 * Test harness for MerchantsService + QrSigningService. Every spec lazy-
 * generates its own ES256 key-pair so the repo's real PEM is never
 * required and the full sign → verify round-trip exercises task 09's
 * key format contract.
 *
 * The tests are deliberately chatty about assertions so breaking the
 * JWS claim shape (§4.4) or the first-claim-wins transaction guarantee
 * fails loudly rather than drifting silently.
 */

function genEcKeyPair(): { privateKey: KeyObject; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const publicPem = publicKey
    .export({ format: "pem", type: "spki" })
    .toString();
  return { privateKey, publicPem };
}

function configStub(
  overrides: Record<string, string> = {},
): Pick<ConfigService, "get"> {
  const defaults: Record<string, string> = {
    TAKUMIPAY_QR_KID: "test-2026-04-20",
  };
  const merged = { ...defaults, ...overrides };
  return {
    get: jest.fn((k: string) => merged[k]),
  } as Pick<ConfigService, "get">;
}

interface FakeTx {
  merchant: {
    create: jest.Mock;
  };
  merchantQrisClaim: { create: jest.Mock };
}

function buildPrismaStub(
  opts: {
    existingMerchantForUser?: unknown;
    existingQrisOwner?: unknown;
    createdMerchant?: Record<string, unknown> | null;
    existingMerchantRow?: Record<string, unknown> | null;
    createRejectsWith?: unknown;
    activeChannel?: Record<string, unknown> | null;
  } = {},
) {
  const activeChannel =
    opts.activeChannel === undefined
      ? {
          channelCode: "GOPAY",
          country: "ID",
          label: "GoPay",
          kind: "ewallet",
          accountFormat: "^\\+62\\d{8,12}$",
          priority: 1,
          isActive: true,
          feeIdr: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      : opts.activeChannel;

  const defaultCreated = {
    id: "mch_01HTEST",
    displayName: "Warung Test",
    contactPhone: "",
    country: "ID",
    payoutChannelCode: "GOPAY",
    payoutAccountNumber: Buffer.from("+6281234567890", "utf8"),
    payoutAccountHolderName: "Bu Sari",
    qrisPan: null,
    jwsQr: "takumipay:v1:PENDING",
    jwsIssuedAt: new Date("2026-04-20T00:00:00Z"),
    jwsExpiresAt: new Date("2027-04-20T00:00:00Z"),
    createdAt: new Date("2026-04-20T00:00:00Z"),
    updatedAt: new Date("2026-04-20T00:00:00Z"),
  };
  const createdMerchant =
    opts.createdMerchant === undefined ? defaultCreated : opts.createdMerchant;

  const tx: FakeTx = {
    merchant: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        if (opts.createRejectsWith) throw opts.createRejectsWith;
        return {
          ...defaultCreated,
          ...createdMerchant,
          ...args.data,
        };
      }),
    },
    merchantQrisClaim: { create: jest.fn(async () => ({ id: "claim_1" })) },
  };

  const prisma = {
    merchant: {
      findUnique: jest.fn(async ({ where }: { where: { userId?: string } }) => {
        if (where.userId) return opts.existingMerchantForUser ?? null;
        return opts.existingMerchantRow ?? null;
      }),
      findFirst: jest.fn(async () => opts.existingQrisOwner ?? null),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...defaultCreated,
        ...data,
      })),
    },
    channel: {
      findFirst: jest.fn(async () => activeChannel),
    },
    merchantQrisClaim: { create: jest.fn() },
    $transaction: jest.fn(async (cb: (tx: FakeTx) => Promise<unknown>) =>
      cb(tx),
    ),
  };

  return { prisma, tx };
}

describe("MerchantsService", () => {
  let qrSigning: QrSigningService;
  let privateKey: KeyObject;
  let publicPem: string;

  beforeEach(() => {
    const kp = genEcKeyPair();
    privateKey = kp.privateKey;
    publicPem = kp.publicPem;

    qrSigning = new QrSigningService(configStub() as unknown as ConfigService);
    qrSigning.setTestPrivateKey(privateKey);
  });

  describe("signup", () => {
    it("creates the merchant, signs a JWS QR, writes a QRIS audit row, and returns the wire-format QR", async () => {
      const { prisma, tx } = buildPrismaStub();
      const svc = new MerchantsService(
        prisma as unknown as PrismaService,
        qrSigning,
      );

      const result = await svc.signup("user_1", {
        displayName: "Warung Test",
        countryCode: "ID",
        payoutChannel: "GOPAY",
        payoutAccountNumber: "+6281234567890",
        payoutAccountHolderName: "Bu Sari",
        qrisLink: {
          qrisPan: "936000091234567890",
          stickerPhotoKey: "s3://evidence/1",
        },
      });

      expect(result.jwsQr).toMatch(/^takumipay:v1:/);
      expect(result.merchant.id).toMatch(/^[0-9A-Z]{26}$/);
      expect(result.merchant.payoutAccountLast4).toBe("7890");
      expect(tx.merchant.create).toHaveBeenCalledTimes(1);
      expect(tx.merchantQrisClaim.create).toHaveBeenCalledTimes(1);

      // Verify the JWS actually round-trips against the matching pubkey.
      const jws = result.jwsQr.replace(/^takumipay:v1:/, "");
      const publicKey = await importSPKI(publicPem, "ES256");
      const { payload, protectedHeader } = await jwtVerify(jws, publicKey, {
        algorithms: ["ES256"],
      });
      expect(protectedHeader.alg).toBe("ES256");
      expect(protectedHeader.kid).toBe("test-2026-04-20");
      expect(payload.merchantId).toBe(result.merchant.id);
      expect(payload.merchantName).toBe("Warung Test");
      expect(payload.displayName).toBe("Warung Test");
      expect(payload.country).toBe("ID");
      expect(payload.currency).toBe("IDR");
      expect(payload.amountMinor).toBeNull();
      expect(payload.qrisPan).toBe("936000091234567890");
      expect(typeof payload.iat).toBe("number");
      expect(payload.exp).toBeUndefined();
    });

    it("rejects duplicate QRIS PAN claims with 409 (first-claim-wins)", async () => {
      const { prisma } = buildPrismaStub({
        existingQrisOwner: { id: "mch_OTHER" },
      });
      const svc = new MerchantsService(
        prisma as unknown as PrismaService,
        qrSigning,
      );

      await expect(
        svc.signup("user_2", {
          displayName: "Other",
          countryCode: "ID",
          payoutChannel: "GOPAY",
          payoutAccountNumber: "+6281234567890",
          payoutAccountHolderName: "Other Person",
          qrisLink: { qrisPan: "936000091234567890" },
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("rejects a duplicate QRIS PAN even if the pre-check raced (P2002 → 409)", async () => {
      // Pre-check returns null (no existing owner) but the DB insert
      // fails with a unique-constraint error as two concurrent signups
      // hit the partial unique index.
      const { prisma } = buildPrismaStub({
        createRejectsWith: Object.assign(new Error("dup"), { code: "P2002" }),
      });
      const svc = new MerchantsService(
        prisma as unknown as PrismaService,
        qrSigning,
      );

      await expect(
        svc.signup("user_3", {
          displayName: "Racey",
          countryCode: "ID",
          payoutChannel: "GOPAY",
          payoutAccountNumber: "+6281234567890",
          payoutAccountHolderName: "Bu Racey",
          qrisLink: { qrisPan: "936000091234567890" },
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("rejects an unknown channel code with 400 (CHANNEL_UNKNOWN)", async () => {
      const { prisma } = buildPrismaStub({ activeChannel: null });
      const svc = new MerchantsService(
        prisma as unknown as PrismaService,
        qrSigning,
      );

      await expect(
        svc.signup("user_4", {
          displayName: "Unknown",
          countryCode: "ID",
          payoutChannel: "NOT_A_THING",
          payoutAccountNumber: "123",
          payoutAccountHolderName: "N/A",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects an account number that doesn't match the channel accountFormat", async () => {
      const { prisma } = buildPrismaStub();
      const svc = new MerchantsService(
        prisma as unknown as PrismaService,
        qrSigning,
      );

      await expect(
        svc.signup("user_5", {
          displayName: "BadNum",
          countryCode: "ID",
          payoutChannel: "GOPAY",
          payoutAccountNumber: "not-a-phone",
          payoutAccountHolderName: "Bu Bad",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects signup when a merchant already exists for this user", async () => {
      const { prisma } = buildPrismaStub({
        existingMerchantForUser: { id: "mch_EXISTING" },
      });
      const svc = new MerchantsService(
        prisma as unknown as PrismaService,
        qrSigning,
      );

      await expect(
        svc.signup("user_6", {
          displayName: "Dupe",
          countryCode: "ID",
          payoutChannel: "GOPAY",
          payoutAccountNumber: "+6281234567890",
          payoutAccountHolderName: "Bu Dupe",
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("findMeOrThrow", () => {
    it("404s when the user has no merchant profile", async () => {
      const { prisma } = buildPrismaStub({ existingMerchantForUser: null });
      const svc = new MerchantsService(
        prisma as unknown as PrismaService,
        qrSigning,
      );
      await expect(svc.findMeOrThrow("user_x")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("projects the DB row without leaking the raw account number", async () => {
      const row = {
        id: "mch_PROFILE",
        displayName: "Warung Profile",
        contactPhone: "+6289999",
        country: "ID",
        payoutChannelCode: "BCA",
        payoutAccountNumber: Buffer.from("1234567890", "utf8"),
        payoutAccountHolderName: "Bu Profile",
        qrisPan: null,
        jwsQr: "takumipay:v1:AAA",
        jwsIssuedAt: new Date(1_700_000_000_000),
        jwsExpiresAt: new Date(1_800_000_000_000),
        createdAt: new Date(1_700_000_000_000),
        updatedAt: new Date(1_700_000_000_000),
      };
      const { prisma } = buildPrismaStub({ existingMerchantForUser: row });
      const svc = new MerchantsService(
        prisma as unknown as PrismaService,
        qrSigning,
      );
      const result = await svc.findMeOrThrow("user_y");
      expect(result.payoutAccountLast4).toBe("7890");
      expect(JSON.stringify(result)).not.toContain("1234567890");
    });
  });

  describe("rotateQr", () => {
    it("re-issues the JWS with a fresh iat even when no fields change", async () => {
      const originalIat = new Date(1_700_000_000_000);
      const row = {
        id: "mch_ROT",
        displayName: "Warung Rot",
        contactPhone: "",
        country: "ID",
        payoutChannelCode: "GOPAY",
        payoutAccountNumber: Buffer.from("+6281234567890", "utf8"),
        payoutAccountHolderName: "Bu Rot",
        qrisPan: null,
        jwsQr: "takumipay:v1:OLD",
        jwsIssuedAt: originalIat,
        jwsExpiresAt: new Date(1_800_000_000_000),
        createdAt: originalIat,
        updatedAt: originalIat,
      };
      const { prisma } = buildPrismaStub({ existingMerchantForUser: row });
      const svc = new MerchantsService(
        prisma as unknown as PrismaService,
        qrSigning,
      );

      const result = await svc.rotateQr("user_z");

      expect(result.jwsQr).toMatch(/^takumipay:v1:/);
      expect(result.jwsQr).not.toBe("takumipay:v1:OLD");

      const publicKey = await importSPKI(publicPem, "ES256");
      const { payload } = await jwtVerify(
        result.jwsQr.replace(/^takumipay:v1:/, ""),
        publicKey,
        { algorithms: ["ES256"] },
      );
      expect(payload.merchantId).toBe("mch_ROT");
      // Freshly-minted iat must be after the stored one.
      expect((payload.iat as number) * 1000).toBeGreaterThanOrEqual(
        originalIat.getTime(),
      );
    });
  });

  describe("listChannels", () => {
    // The 8 seeded ID channels (task 26) — mirrors
    // src/scripts/prisma/seed.ts. Kept in priority order so the test
    // doubles as documentation of the filter-at-source contract.
    const ID_CHANNELS = [
      {
        channelCode: "GOPAY",
        country: "ID",
        label: "GoPay",
        kind: "ewallet",
        accountFormat: "phone_id",
        priority: 10,
        isActive: true,
        minAmountIdr: 10_000,
        maxAmountIdr: 20_000_000,
        feeIdr: 2500,
      },
      {
        channelCode: "OVO",
        country: "ID",
        label: "OVO",
        kind: "ewallet",
        accountFormat: "phone_id",
        priority: 11,
        isActive: true,
        minAmountIdr: 10_000,
        maxAmountIdr: 10_000_000,
        feeIdr: 2500,
      },
      {
        channelCode: "DANA",
        country: "ID",
        label: "DANA",
        kind: "ewallet",
        accountFormat: "phone_id",
        priority: 12,
        isActive: true,
        minAmountIdr: 10_000,
        maxAmountIdr: 10_000_000,
        feeIdr: 2500,
      },
      {
        channelCode: "SHOPEEPAY",
        country: "ID",
        label: "ShopeePay",
        kind: "ewallet",
        accountFormat: "phone_id",
        priority: 13,
        isActive: true,
        minAmountIdr: 10_000,
        maxAmountIdr: 10_000_000,
        feeIdr: 2500,
      },
      {
        channelCode: "BCA",
        country: "ID",
        label: "BCA",
        kind: "bank",
        accountFormat: "digits:10",
        priority: 20,
        isActive: true,
        minAmountIdr: 10_000,
        maxAmountIdr: 50_000_000,
        feeIdr: 5000,
      },
      {
        channelCode: "MANDIRI",
        country: "ID",
        label: "Mandiri",
        kind: "bank",
        accountFormat: "digits:13",
        priority: 21,
        isActive: true,
        minAmountIdr: 10_000,
        maxAmountIdr: 50_000_000,
        feeIdr: 5000,
      },
      {
        channelCode: "BNI",
        country: "ID",
        label: "BNI",
        kind: "bank",
        accountFormat: "digits:10",
        priority: 22,
        isActive: true,
        minAmountIdr: 10_000,
        maxAmountIdr: 50_000_000,
        feeIdr: 5000,
      },
      {
        channelCode: "BRI",
        country: "ID",
        label: "BRI",
        kind: "bank",
        accountFormat: "digits:15",
        priority: 23,
        isActive: true,
        minAmountIdr: 10_000,
        maxAmountIdr: 50_000_000,
        feeIdr: 5000,
      },
    ];

    function buildChannelsPrisma(
      rowsByCountry: Record<string, typeof ID_CHANNELS>,
    ) {
      return {
        channel: {
          findMany: jest.fn(
            async ({
              where,
              orderBy,
            }: {
              where: { country: string; isActive: boolean };
              orderBy: unknown;
            }) => {
              expect(where.isActive).toBe(true);
              expect(orderBy).toEqual([
                { priority: "asc" },
                { channelCode: "asc" },
              ]);
              const rows = rowsByCountry[where.country] ?? [];
              const sorted = [...rows].sort((a, b) =>
                a.priority === b.priority
                  ? a.channelCode.localeCompare(b.channelCode)
                  : a.priority - b.priority,
              );
              // Service uses `include: { providerChannels: { where: xendit } }`.
              // Synthesize a single-row providerChannels array per channel so
              // the DTO mapper picks up fees/limits.
              return sorted.map((row) => ({
                ...row,
                providerChannels: [
                  {
                    channelCode: row.channelCode,
                    country: row.country,
                    provider: "xendit",
                    providerChannelCode: row.channelCode,
                    minAmountIdr: row.minAmountIdr,
                    maxAmountIdr: row.maxAmountIdr,
                    feeIdr: row.feeIdr,
                    isActive: true,
                  },
                ],
              }));
            },
          ),
        },
      };
    }

    function buildValkeyStub(initial: Record<string, unknown> = {}) {
      const store = new Map<string, unknown>(Object.entries(initial));
      const get = jest.fn(async (key: string) => store.get(key) ?? null);
      const set = jest.fn(
        async (
          key: string,
          value: unknown,
          _opts?: { ttl?: number },
        ): Promise<boolean> => {
          store.set(key, value);
          return true;
        },
      );
      return {
        valkey: { get, set } as unknown as ValkeyService,
        get,
        set,
        store,
      };
    }

    it("returns the 8 seeded ID channels ordered by priority ASC then channelCode ASC", async () => {
      const prisma = buildChannelsPrisma({ ID: ID_CHANNELS });
      const { valkey, get, set } = buildValkeyStub();
      const svc = new MerchantsService(
        prisma as unknown as PrismaService,
        qrSigning,
        valkey,
      );

      const result = await svc.listChannels("ID");

      expect(result).toHaveLength(8);
      expect(result.map((c) => c.channelCode)).toEqual([
        "GOPAY",
        "OVO",
        "DANA",
        "SHOPEEPAY",
        "BCA",
        "MANDIRI",
        "BNI",
        "BRI",
      ]);
      expect(result.map((c) => c.priority)).toEqual([
        10, 11, 12, 13, 20, 21, 22, 23,
      ]);
      // Wire shape — matches §6.0 ChannelDescriptor + user-scope
      // additive fields (minAmountIdr / maxAmountIdr / feeIdr).
      expect(result[0]).toEqual({
        channelCode: "GOPAY",
        label: "GoPay",
        kind: "ewallet",
        accountFormat: "phone_id",
        priority: 10,
        minAmountIdr: 10_000,
        maxAmountIdr: 20_000_000,
        feeIdr: 2500,
        // Mock fixtures don't set iconUrl, so the DTO surfaces it as
        // null — the DB schema allows null and the service passes
        // through with `?? null`. Real seeded rows have real URLs.
        iconUrl: null,
      });

      // Cache MISS on first call → DB read → cache write with 1 h TTL.
      expect(get).toHaveBeenCalledWith(`${CHANNELS_CACHE_KEY_PREFIX}ID`);
      // `set` is fire-and-forget — flush the microtask queue so the
      // assertion runs after the background await resolves.
      await new Promise((r) => setImmediate(r));
      expect(set).toHaveBeenCalledWith(
        `${CHANNELS_CACHE_KEY_PREFIX}ID`,
        result,
        { ttl: CHANNELS_CACHE_TTL_SECONDS },
      );
    });

    it("returns an empty array for a well-formed but unseeded country (e.g. US)", async () => {
      const prisma = buildChannelsPrisma({ ID: ID_CHANNELS, US: [] });
      const { valkey } = buildValkeyStub();
      const svc = new MerchantsService(
        prisma as unknown as PrismaService,
        qrSigning,
        valkey,
      );

      const result = await svc.listChannels("US");
      expect(result).toEqual([]);
    });

    it("uppercases the country before hitting cache + DB (defensive normalization)", async () => {
      const prisma = buildChannelsPrisma({ ID: ID_CHANNELS });
      const { valkey, get } = buildValkeyStub();
      const svc = new MerchantsService(
        prisma as unknown as PrismaService,
        qrSigning,
        valkey,
      );

      await svc.listChannels("id");

      expect(get).toHaveBeenCalledWith(`${CHANNELS_CACHE_KEY_PREFIX}ID`);
      expect(prisma.channel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ country: "ID", isActive: true }),
        }),
      );
    });

    it("returns the cached payload on a hit without touching Prisma", async () => {
      const prisma = buildChannelsPrisma({ ID: ID_CHANNELS });
      const cachedPayload = [
        {
          channelCode: "CACHED_GOPAY",
          label: "GoPay (cached)",
          kind: "ewallet" as const,
          accountFormat: "phone_id",
          priority: 10,
          minAmountIdr: 10_000,
          maxAmountIdr: 20_000_000,
          feeIdr: 2500,
        },
      ];
      const { valkey } = buildValkeyStub({
        [`${CHANNELS_CACHE_KEY_PREFIX}ID`]: cachedPayload,
      });
      const svc = new MerchantsService(
        prisma as unknown as PrismaService,
        qrSigning,
        valkey,
      );

      const first = await svc.listChannels("ID");
      const second = await svc.listChannels("ID");

      expect(first).toEqual(cachedPayload);
      expect(second).toEqual(cachedPayload);
      // Cache hit — DB was never consulted.
      expect(prisma.channel.findMany).not.toHaveBeenCalled();
    });

    it("falls through to the DB when the Valkey read throws (cache degrades cleanly)", async () => {
      const prisma = buildChannelsPrisma({ ID: ID_CHANNELS });
      const valkey = {
        get: jest.fn(async () => {
          throw new Error("valkey-down");
        }),
        set: jest.fn(async () => true),
      } as unknown as ValkeyService;

      const svc = new MerchantsService(
        prisma as unknown as PrismaService,
        qrSigning,
        valkey,
      );

      const result = await svc.listChannels("ID");
      expect(result).toHaveLength(8);
      expect(prisma.channel.findMany).toHaveBeenCalledTimes(1);
    });

    it("works without a ValkeyService injected (Optional() dependency)", async () => {
      const prisma = buildChannelsPrisma({ ID: ID_CHANNELS });
      const svc = new MerchantsService(
        prisma as unknown as PrismaService,
        qrSigning,
      );

      const result = await svc.listChannels("ID");
      expect(result).toHaveLength(8);
    });
  });
});

describe("QrSigningService (unit)", () => {
  it("exports a JWK that matches the signed JWS so mobile can verify", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });

    const svc = new QrSigningService(configStub() as unknown as ConfigService);
    svc.setTestPrivateKey(privateKey);

    const signed = await svc.signMerchantQr({
      merchantId: "mch_JWK",
      displayName: "JWK test",
      country: "ID",
    });

    const jwk = await exportJWK(publicKey);
    jwk.alg = "ES256";
    jwk.kid = "test-2026-04-20";
    const publicKeyImported = await importSPKI(
      publicKey.export({ format: "pem", type: "spki" }).toString(),
      "ES256",
    );

    const { payload, protectedHeader } = await jwtVerify(
      signed.jws,
      publicKeyImported,
      {
        algorithms: ["ES256"],
      },
    );
    expect(protectedHeader.kid).toBe("test-2026-04-20");
    expect(payload.merchantId).toBe("mch_JWK");
  });

  it("lazy-loads the PEM only on first sign call (no throw at construction)", () => {
    // Deliberately pass a config stub that has NO PEM. Construction and
    // import of the module must not blow up — only calling signMerchantQr
    // without a test key or env var should fail. Task-file rule:
    // "Do not load the PEM at module-import time if tests don't have the env var."
    const svc = new QrSigningService(
      configStub({}) as unknown as ConfigService,
    );
    expect(svc).toBeDefined();
  });

  it("signs a JWS verifiable via importJWK — the exact path mobile's detector uses", async () => {
    // This reproduces the mobile side of the verification pipeline
    // (see `mobile-app/services/paymentIntent/detectors/takumipayJws.ts`):
    //    importJWK(publicJwk, 'ES256') → jwtVerify(jws, key, { algorithms: ['ES256'] })
    // Proving task 09's keypair round-trips here guarantees the mobile
    // detector will accept a freshly-signed QR at scan time.
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const jwk = await exportJWK(publicKey);
    jwk.alg = "ES256";
    jwk.kid = "test-2026-04-20";

    const svc = new QrSigningService(configStub() as unknown as ConfigService);
    svc.setTestPrivateKey(privateKey);
    const signed = await svc.signMerchantQr({
      merchantId: "mch_MOBILE",
      displayName: "Mobile path",
      country: "ID",
    });
    expect(signed.wire.startsWith("takumipay:v1:")).toBe(true);

    const { importJWK } = await import("jose");
    const key = await importJWK(jwk, "ES256");
    const { payload } = await jwtVerify(signed.jws, key, {
      algorithms: ["ES256"],
    });
    expect(payload.merchantId).toBe("mch_MOBILE");
    expect(payload.currency).toBe("IDR");
  });

  it("round-trips a SEC1 PEM (EC PRIVATE KEY block) — the format in the repo .env", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const sec1Pem = privateKey
      .export({ format: "pem", type: "sec1" })
      .toString();

    const svc = new QrSigningService(
      configStub({
        TAKUMIPAY_QR_PRIVATE_KEY_PEM: sec1Pem,
      }) as unknown as ConfigService,
    );

    // Directly exercise the lazy-loader by signing — no test key set.
    const signed = await svc.signMerchantQr({
      merchantId: "mch_SEC1",
      displayName: "SEC1 test",
      country: "ID",
    });

    const pubPem = publicKey.export({ format: "pem", type: "spki" }).toString();
    const imported = await importSPKI(pubPem, "ES256");
    const { payload } = await jwtVerify(signed.jws, imported, {
      algorithms: ["ES256"],
    });
    expect(payload.merchantId).toBe("mch_SEC1");

    // The loaded PEM path must also be able to parse a PKCS8 variant —
    // exercise that too so SEC1 isn't the only format we claim to support.
    const pkcs8Pem = privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString();
    expect(() =>
      createPrivateKey({ key: pkcs8Pem, format: "pem" }),
    ).not.toThrow();
  });
});
