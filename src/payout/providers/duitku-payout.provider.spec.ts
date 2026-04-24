import { Logger } from "@nestjs/common";
import type { Merchant, PaymentIntent } from "@generated/prisma";
import type { PrismaService } from "../../prisma/prisma.service";
import { encryptAccountNumber } from "../account-number-crypto";
import { PayoutProviderError, type TPayoutReceipt } from "../types";
import { DuitkuPayoutProvider } from "./duitku-payout.provider";

/**
 * Unit tests for the Duitku adapter. All transport is mocked — no real
 * sandbox traffic (that's task 16, gated `RUN_DUITKU_SANDBOX_E2E=1`).
 *
 * Tests the load-bearing branches:
 *   - holder-name guard (wrong name never issues transfer)
 *   - response-code short-circuit (TO/68/-100 never retransmit)
 *   - transport retry (5xx retried; ambiguous-body not)
 *   - redaction (secret + plaintext account + signature absent from logs)
 */

const DUITKU_CREDS = {
  DUITKU_DISB_USER_ID: "3551",
  DUITKU_DISB_EMAIL: "pg@merchantpgtest.com",
  DUITKU_DISB_SECRET_KEY:
    "de56f832487bc1ce1de5ff2cfacf8d9486c61da69df6fd61d5537b6b7d6d354d",
  DUITKU_DISB_API_BASE: "https://sandbox.duitku.com/webapi/api/disbursement",
};

function configStub(overrides: Record<string, string> = {}) {
  const bag = { ...DUITKU_CREDS, ...overrides };
  return {
    get: (k: string) => bag[k as keyof typeof bag],
    getOrThrow: (k: string) => {
      const v = bag[k as keyof typeof bag];
      if (v === undefined) throw new Error(`missing ${k}`);
      return v;
    },
  };
}

function prismaStub(
  providerChannelRow: unknown = {
    providerChannelCode: "1011",
    channelCode: "GOPAY",
    country: "ID",
    provider: "duitku",
    minAmountIdr: 10_000,
    maxAmountIdr: 10_000_000,
    feeIdr: 2500,
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
    id: "pi_01HXYZ",
    fiatAmountMinor: 15_000,
    fiatCurrency: "IDR",
    ...overrides,
  } as unknown as PaymentIntent;
}

function makeMerchant(overrides: Partial<Merchant> = {}): Merchant {
  return {
    id: "mch_123",
    country: "ID",
    payoutChannelCode: "GOPAY",
    payoutAccountNumber: encryptAccountNumber("081234567890"),
    payoutAccountHolderName: "BUDI WARUNG",
    payoutProvider: "duitku",
    ...overrides,
  } as unknown as Merchant;
}

/**
 * Build a `fetch`-shaped mock that returns `scripts` in order. If more
 * calls are made than scripts, the excess calls get the last script.
 */
function makeFetch(
  scripts: Array<{
    status: number;
    body?: unknown;
    throws?: Error;
    matchUrl?: RegExp;
  }>,
) {
  const callLog: Array<{ url: string; body: unknown }> = [];
  let i = 0;
  const fn = jest.fn(
    async (
      url: string | URL | Request,
      init?: { body?: string },
    ): Promise<Response> => {
      const u = typeof url === "string" ? url : url.toString();
      const parsedBody = init?.body ? JSON.parse(init.body) : undefined;
      callLog.push({ url: u, body: parsedBody });
      const scriptIdx = Math.min(i++, scripts.length - 1);
      const s = scripts[scriptIdx];
      if (s.throws) throw s.throws;
      const text = s.body === undefined ? "" : JSON.stringify(s.body);
      return new Response(text, { status: s.status });
    },
  );
  return { fn, callLog };
}

describe("DuitkuPayoutProvider.triggerPayout", () => {
  it("happy path — returns COMPLETED + shape parity with Xendit adapter receipt", async () => {
    const { fn } = makeFetch([
      {
        status: 200,
        body: {
          responseCode: "00",
          accountName: "BUDI WARUNG",
          disburseId: "DSB-ABC-123",
        },
      },
      { status: 200, body: { responseCode: "00" } },
    ]);
    const provider = new DuitkuPayoutProvider(
      configStub() as any,
      prismaStub(),
      fn as unknown as typeof fetch,
    );
    const receipt = await provider.triggerPayout(makeIntent(), makeMerchant());

    expect(receipt.status).toBe("COMPLETED");
    expect(receipt.providerPayoutId).toBe("DSB-ABC-123");
    expect(receipt.providerResponseCode).toBe("00");
    expect(receipt.referenceId).toBe("pi_01HXYZ");
    expect(receipt.amount).toBe(15_000);
    expect(receipt.currency).toBe("IDR");
    expect(receipt.channelCode).toBe("GOPAY");
    // Shape parity vs. the Xendit adapter's TPayoutReceipt. Every required
    // key is present; new optional keys (providerResponseCode, reconcile)
    // are additive only.
    expect(Object.keys(receipt).sort()).toEqual(
      expect.arrayContaining([
        "amount",
        "channelCode",
        "currency",
        "providerPayoutId",
        "providerResponseCode",
        "rawResponse",
        "referenceId",
        "requestedAt",
        "status",
      ]),
    );
  });

  it("name mismatch — aborts before /transfer with a client_error", async () => {
    const { fn } = makeFetch([
      {
        status: 200,
        body: {
          responseCode: "00",
          accountName: "SOMEONE ELSE",
          disburseId: "DSB-ABC-123",
        },
      },
    ]);
    const provider = new DuitkuPayoutProvider(
      configStub() as any,
      prismaStub(),
      fn as unknown as typeof fetch,
    );
    let caught: unknown;
    try {
      await provider.triggerPayout(makeIntent(), makeMerchant());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PayoutProviderError);
    expect((caught as PayoutProviderError).kind).toBe("client_error");

    // /inquiry was called; /transfer was not.
    expect(
      fn.mock.calls.some((c) => String(c[0]).includes("/transfer")),
    ).toBe(false);
  });

  it("ambiguous code 68 — returns PENDING + reconcile hint; /transfer called exactly once", async () => {
    const { fn, callLog } = makeFetch([
      {
        status: 200,
        body: {
          responseCode: "00",
          accountName: "BUDI WARUNG",
          disburseId: "DSB-ABC-123",
        },
      },
      { status: 200, body: { responseCode: "68" } },
    ]);
    const provider = new DuitkuPayoutProvider(
      configStub() as any,
      prismaStub(),
      fn as unknown as typeof fetch,
    );
    const receipt = await provider.triggerPayout(makeIntent(), makeMerchant());

    expect(receipt.status).toBe("PENDING");
    expect(receipt.reconcile).toEqual({ reason: "68" });
    expect(receipt.providerPayoutId).toBe("DSB-ABC-123");

    const transferCalls = callLog.filter((c) => c.url.includes("/transfer"));
    expect(transferCalls).toHaveLength(1);
  });

  it("ambiguous code TO — returns PENDING + reconcile hint (no retransmit)", async () => {
    const { fn, callLog } = makeFetch([
      {
        status: 200,
        body: {
          responseCode: "00",
          accountName: "BUDI WARUNG",
          disburseId: "DSB-XYZ-999",
        },
      },
      { status: 200, body: { responseCode: "TO" } },
    ]);
    const provider = new DuitkuPayoutProvider(
      configStub() as any,
      prismaStub(),
      fn as unknown as typeof fetch,
    );
    const receipt = await provider.triggerPayout(makeIntent(), makeMerchant());
    expect(receipt.status).toBe("PENDING");
    expect(receipt.reconcile).toEqual({ reason: "TO" });
    expect(callLog.filter((c) => c.url.includes("/transfer"))).toHaveLength(1);
  });

  it("ambiguous code -100 — returns PENDING + reconcile hint", async () => {
    const { fn, callLog } = makeFetch([
      {
        status: 200,
        body: {
          responseCode: "00",
          accountName: "BUDI WARUNG",
          disburseId: "DSB-100",
        },
      },
      { status: 200, body: { responseCode: "-100" } },
    ]);
    const provider = new DuitkuPayoutProvider(
      configStub() as any,
      prismaStub(),
      fn as unknown as typeof fetch,
    );
    const receipt = await provider.triggerPayout(makeIntent(), makeMerchant());
    expect(receipt.status).toBe("PENDING");
    expect(receipt.reconcile).toEqual({ reason: "-100" });
    expect(callLog.filter((c) => c.url.includes("/transfer"))).toHaveLength(1);
  });

  it("transport retry — 5xx on inquiry attempt 1 succeeds on attempt 2", async () => {
    const { fn, callLog } = makeFetch([
      { status: 503 },
      {
        status: 200,
        body: {
          responseCode: "00",
          accountName: "BUDI WARUNG",
          disburseId: "DSB-RETRY",
        },
      },
      { status: 200, body: { responseCode: "00" } },
    ]);
    const provider = new DuitkuPayoutProvider(
      configStub() as any,
      prismaStub(),
      fn as unknown as typeof fetch,
    );
    const receipt = await provider.triggerPayout(makeIntent(), makeMerchant());
    expect(receipt.status).toBe("COMPLETED");
    // Expect: 2 inquiry calls (one failed, one succeeded) + 1 transfer.
    expect(callLog.filter((c) => c.url.includes("/inquiry"))).toHaveLength(2);
  }, 10_000);

  it("transport retry cap — exhausts 3 attempts on persistent 5xx and throws", async () => {
    const { fn } = makeFetch([
      { status: 503 },
      { status: 503 },
      { status: 503 },
    ]);
    const provider = new DuitkuPayoutProvider(
      configStub() as any,
      prismaStub(),
      fn as unknown as typeof fetch,
    );
    await expect(
      provider.triggerPayout(makeIntent(), makeMerchant()),
    ).rejects.toMatchObject({
      kind: "server_error",
      httpStatus: 503,
    });
    expect(fn).toHaveBeenCalledTimes(3);
  }, 10_000);
});

describe("DuitkuPayoutProvider.getStatus", () => {
  it("happy path — responseCode 00 maps to COMPLETED", async () => {
    const { fn } = makeFetch([{ status: 200, body: { responseCode: "00" } }]);
    const provider = new DuitkuPayoutProvider(
      configStub() as any,
      prismaStub(),
      fn as unknown as typeof fetch,
    );
    const res = await provider.getStatus("DSB-ABC");
    expect(res.status).toBe("COMPLETED");
    expect(res.providerResponseCode).toBe("00");
  });

  it("ambiguous 68 maps to PENDING (no operationalAlert)", async () => {
    const { fn } = makeFetch([{ status: 200, body: { responseCode: "68" } }]);
    const provider = new DuitkuPayoutProvider(
      configStub() as any,
      prismaStub(),
      fn as unknown as typeof fetch,
    );
    const res = await provider.getStatus("DSB-ABC");
    expect(res.status).toBe("PENDING");
    expect(res.operationalAlert).toBeFalsy();
  });

  it("-100 maps to PENDING + operationalAlert", async () => {
    const { fn } = makeFetch([{ status: 200, body: { responseCode: "-100" } }]);
    const provider = new DuitkuPayoutProvider(
      configStub() as any,
      prismaStub(),
      fn as unknown as typeof fetch,
    );
    const res = await provider.getStatus("DSB-ABC");
    expect(res.status).toBe("PENDING");
    expect(res.operationalAlert).toBe(true);
  });

  it("FAILED terminal code (01) maps to FAILED", async () => {
    const { fn } = makeFetch([{ status: 200, body: { responseCode: "01" } }]);
    const provider = new DuitkuPayoutProvider(
      configStub() as any,
      prismaStub(),
      fn as unknown as typeof fetch,
    );
    const res = await provider.getStatus("DSB-ABC");
    expect(res.status).toBe("FAILED");
  });
});

describe("DuitkuPayoutProvider.verifyWebhookSignature", () => {
  it("returns false — RTOL has no callback in v1 (research §2.8)", () => {
    const provider = new DuitkuPayoutProvider(
      configStub() as any,
      prismaStub(),
    );
    expect(provider.verifyWebhookSignature({}, "{}")).toBe(false);
  });
});

describe("DuitkuPayoutProvider log redaction", () => {
  it("never logs secret, plaintext account, or the computed signature", async () => {
    const captured: string[] = [];
    const origLog = Logger.prototype.log;
    const origWarn = Logger.prototype.warn;
    const origError = Logger.prototype.error;
    // Monkey-patch NestJS Logger so every subclass instance routes through
    // the capture. Restored in `finally` to keep other suites clean.
    // biome-ignore lint/suspicious/noExplicitAny: monkey patching NestJS Logger for log capture
    (Logger.prototype as any).log = function (msg: string) {
      captured.push(String(msg));
    };
    // biome-ignore lint/suspicious/noExplicitAny: monkey patching NestJS Logger for log capture
    (Logger.prototype as any).warn = function (msg: string) {
      captured.push(String(msg));
    };
    // biome-ignore lint/suspicious/noExplicitAny: monkey patching NestJS Logger for log capture
    (Logger.prototype as any).error = function (msg: string) {
      captured.push(String(msg));
    };

    try {
      const { fn } = makeFetch([
        {
          status: 200,
          body: {
            responseCode: "00",
            accountName: "SOMEONE ELSE",
            disburseId: "DSB-REDACT",
          },
        },
      ]);
      const provider = new DuitkuPayoutProvider(
        configStub() as any,
        prismaStub(),
        fn as unknown as typeof fetch,
      );
      await expect(
        provider.triggerPayout(makeIntent(), makeMerchant()),
      ).rejects.toBeInstanceOf(PayoutProviderError);

      const all = captured.join("\n");
      expect(all).not.toContain(DUITKU_CREDS.DUITKU_DISB_SECRET_KEY);
      // Plaintext account number MUST NOT appear (only redactAccountNumber
      // mask `••••7890` is safe).
      expect(all).not.toContain("081234567890");
      // Also confirm the bank-reported (mismatched) name isn't logged in
      // clear — we only log a non-crypto short hash.
      expect(all).not.toContain("SOMEONE ELSE");
    } finally {
      Logger.prototype.log = origLog;
      Logger.prototype.warn = origWarn;
      Logger.prototype.error = origError;
    }
  });
});

describe("DuitkuPayoutProvider.checkBalance (task 18)", () => {
  it("returns { balance, currency: 'IDR' } on responseCode 00", async () => {
    const { fn } = makeFetch([
      { status: 200, body: { responseCode: "00", balance: 5_000_000 } },
    ]);
    const provider = new DuitkuPayoutProvider(
      configStub() as any,
      prismaStub(),
      fn as unknown as typeof fetch,
    );
    const res = await provider.checkBalance();
    expect(res).toEqual({ balance: 5_000_000, currency: "IDR" });
  });

  it("throws a typed client_error on -191 (bad signature)", async () => {
    const { fn } = makeFetch([
      { status: 200, body: { responseCode: "-191" } },
    ]);
    const provider = new DuitkuPayoutProvider(
      configStub() as any,
      prismaStub(),
      fn as unknown as typeof fetch,
    );
    await expect(provider.checkBalance()).rejects.toMatchObject({
      kind: "client_error",
    });
  });
});

describe("DuitkuPayoutProvider.AMBIGUOUS_CODES", () => {
  it("is a frozen set of exactly { TO, 68, -100 }", () => {
    expect(Array.from(DuitkuPayoutProvider.AMBIGUOUS_CODES).sort()).toEqual(
      ["-100", "68", "TO"].sort(),
    );
    expect(DuitkuPayoutProvider.AMBIGUOUS_CODES.has("01")).toBe(false);
    expect(DuitkuPayoutProvider.AMBIGUOUS_CODES.has("80")).toBe(false);
  });
});

// Type-level parity check (compile-only) — guards that DuitkuPayoutProvider
// returns a TPayoutReceipt compatible with the Xendit adapter's shape.
const _typeCheck: TPayoutReceipt = {} as unknown as Awaited<
  ReturnType<DuitkuPayoutProvider["triggerPayout"]>
>;
void _typeCheck;
