/**
 * Flip Payout Provider — sandbox end-to-end tests.
 *
 * Gated behind `RUN_FLIP_SANDBOX_E2E=1`. All tests skip unless that env var
 * is set. Uses the real Flip sandbox at https://bigflip.id/big_sandbox_api/v2
 * with live HTTP (no mocked fetch).
 *
 * Required env vars (never committed):
 *   FLIP_SECRET_KEY        — sandbox secret key
 *   FLIP_VALIDATION_TOKEN  — sandbox validation/callback token
 *   FLIP_API_BASE          — e.g. https://bigflip.id/big_sandbox_api/v2
 *
 * Run:
 *   RUN_FLIP_SANDBOX_E2E=1 npx jest --testPathPattern=flip-payout.provider.e2e --no-coverage
 */

import { randomUUID } from "node:crypto";
import type { Merchant, PaymentIntent } from "@generated/prisma";
import type { PrismaService } from "../../prisma/prisma.service";
import { encryptAccountNumber } from "../account-number-crypto";
import { PayoutProviderError } from "../types";
import { FlipPayoutProvider } from "./flip-payout.provider";

// ---------------------------------------------------------------------------
// Gate — skip the entire suite unless sandbox credentials are available
// ---------------------------------------------------------------------------
const SKIP = process.env.RUN_FLIP_SANDBOX_E2E !== "1";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Unique prefix per test run so idempotency keys never collide across runs. */
const RUN_ID = randomUUID().slice(0, 8);
let seqCounter = 0;
function nextIdempotencyKey(): string {
  return `e2e-${RUN_ID}-${String(++seqCounter).padStart(4, "0")}`;
}

/**
 * Minimal ConfigService stub that reads the three FLIP_* keys from
 * `process.env`. No NestJS bootstrapping needed.
 */
function sandboxConfigService(overrides: Record<string, string> = {}) {
  const bag: Record<string, string | undefined> = {
    FLIP_SECRET_KEY: process.env.FLIP_SECRET_KEY,
    FLIP_VALIDATION_TOKEN: process.env.FLIP_VALIDATION_TOKEN,
    FLIP_API_BASE:
      process.env.FLIP_API_BASE ?? "https://bigflip.id/big_sandbox_api/v2",
    ...overrides,
  };
  return {
    get: (key: string) => bag[key],
    getOrThrow: (key: string) => {
      const v = bag[key];
      if (v === undefined || v === "")
        throw new Error(`Missing env var: ${key}`);
      return v;
    },
  };
}

/**
 * Mock PrismaService that returns a ProviderChannel row matching the
 * `(channelCode, country, provider)` unique key that `getProviderChannel`
 * queries. The `providerChannelCode` is the Flip bank code.
 */
function prismaStub(
  providerChannelRow: unknown = {
    providerChannelCode: "bca",
    channelCode: "BCA",
    country: "ID",
    provider: "flip",
    minAmountIdr: 10_000,
    maxAmountIdr: 100_000_000,
    feeIdr: 4000,
    isActive: true,
  },
) {
  return {
    providerChannel: {
      findUnique: jest.fn(async () => providerChannelRow),
    },
  } as unknown as PrismaService;
}

function makeIntent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    id: nextIdempotencyKey(),
    fiatAmountMinor: 10_000,
    fiatCurrency: "IDR",
    ...overrides,
  } as unknown as PaymentIntent;
}

function makeMerchant(overrides: Partial<Merchant> = {}): Merchant {
  return {
    id: "mch_e2e_sandbox",
    country: "ID",
    payoutChannelCode: "BCA",
    payoutAccountNumber: encryptAccountNumber("1740013939288"),
    payoutAccountHolderName: "PT FLIPTECH LENTERA",
    payoutProvider: "flip",
    ...overrides,
  } as unknown as Merchant;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
(SKIP ? describe.skip : describe)(
  "FlipPayoutProvider — sandbox e2e",
  () => {
    let provider: FlipPayoutProvider;

    beforeAll(() => {
      provider = new FlipPayoutProvider(
        sandboxConfigService() as any,
        prismaStub(),
        // real fetch — no mock
      );
    });

    // ------------------------------------------------------------------
    // Test 1: Create disbursement -> status PENDING, numeric id present
    // ------------------------------------------------------------------
    let createdProviderPayoutId: string | null = null;
    let idempotencyKeyForRetry: string | null = null;

    it("creates a disbursement and gets PENDING status with a numeric id", async () => {
      const intent = makeIntent();
      idempotencyKeyForRetry = intent.id;
      const receipt = await provider.triggerPayout(intent, makeMerchant());

      expect(receipt.status).toBe("PENDING");
      expect(receipt.providerPayoutId).toBeTruthy();
      expect(Number(receipt.providerPayoutId)).not.toBeNaN();
      expect(receipt.referenceId).toBe(intent.id);
      expect(receipt.amount).toBe(10_000);
      expect(receipt.currency).toBe("IDR");

      createdProviderPayoutId = receipt.providerPayoutId;
    }, 30_000);

    // ------------------------------------------------------------------
    // Test 2: Get disbursement by ID -> status PENDING
    // ------------------------------------------------------------------
    it("retrieves a disbursement by provider id and gets PENDING status", async () => {
      expect(createdProviderPayoutId).toBeTruthy();

      const result = await provider.getStatus(createdProviderPayoutId!);

      expect(result.status).toBe("PENDING");
      expect(result.providerResponseCode).toBeDefined();
    }, 30_000);

    // ------------------------------------------------------------------
    // Test 3: Idempotent retry -> same id returned
    // ------------------------------------------------------------------
    it("returns the same provider payout id on idempotent retry", async () => {
      expect(idempotencyKeyForRetry).toBeTruthy();
      expect(createdProviderPayoutId).toBeTruthy();

      // Re-use the same intent.id (idempotency key) as Test 1.
      const intent = makeIntent({ id: idempotencyKeyForRetry! } as any);
      const receipt = await provider.triggerPayout(intent, makeMerchant());

      expect(receipt.providerPayoutId).toBe(createdProviderPayoutId);
    }, 30_000);

    // ------------------------------------------------------------------
    // Test 4: Get status by idempotency key -> same disbursement
    // ------------------------------------------------------------------
    it("retrieves a disbursement by idempotency key", async () => {
      expect(idempotencyKeyForRetry).toBeTruthy();
      expect(createdProviderPayoutId).toBeTruthy();

      const result = await provider.getStatusByIdempotencyKey(
        idempotencyKeyForRetry!,
      );

      expect(result.status).toBe("PENDING");
      expect(result.providerPayoutId).toBe(createdProviderPayoutId);
    }, 30_000);

    // ------------------------------------------------------------------
    // Test 5: Check balance -> numeric balance field
    // ------------------------------------------------------------------
    it("returns a numeric balance from checkBalance", async () => {
      const result = await provider.checkBalance();

      expect(typeof result.balance).toBe("number");
      expect(Number.isFinite(result.balance)).toBe(true);
    }, 30_000);

    // ------------------------------------------------------------------
    // Test 6: Invalid auth -> 401 error
    // ------------------------------------------------------------------
    it("throws a client_error on invalid credentials", async () => {
      const badProvider = new FlipPayoutProvider(
        sandboxConfigService({
          FLIP_SECRET_KEY: "totally_invalid_key",
        }) as any,
        prismaStub(),
      );

      await expect(badProvider.checkBalance()).rejects.toMatchObject({
        kind: "client_error",
      });

      try {
        await badProvider.checkBalance();
      } catch (err) {
        expect(err).toBeInstanceOf(PayoutProviderError);
        expect((err as PayoutProviderError).httpStatus).toBe(401);
      }
    }, 30_000);
  },
);
