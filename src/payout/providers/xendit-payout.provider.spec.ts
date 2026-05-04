import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigService } from "@nestjs/config";
import type { Merchant, PaymentIntent } from "@generated/prisma";
import type { PrismaService } from "../../prisma/prisma.service";
import { encryptAccountNumber } from "../account-number-crypto";
import { PayoutProviderError } from "../types";
import { XenditPayoutProvider } from "./xendit-payout.provider";

const xenditRequestBodyFixture = JSON.parse(
  readFileSync(join(__dirname, "xendit-request-body.fixture.json"), "utf8"),
);

/**
 * Tests for the Xendit payout provider adapter.
 *
 * We mock the `fetch`-shaped HTTP client rather than the global `fetch`
 * to keep the tests deterministic and avoid bleed between test cases.
 * The provider accepts a custom fetch via its constructor specifically
 * for this purpose.
 */

function configStub(
  values: Partial<Record<string, string>> = {},
): Pick<ConfigService, "get"> {
  const defaults: Record<string, string> = {
    XENDIT_SECRET_KEY: "xnd_development_testkey",
    XENDIT_API_BASE: "https://api.xendit.test",
    XENDIT_WEBHOOK_TOKEN: "test-callback-token",
    ...values,
  };
  return {
    get: jest.fn((k: string) => defaults[k]),
  } as any;
}

function intentStub(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    id: "pi_01HXYZ",
    fiatAmountMinor: 15_000,
    fiatCurrency: "IDR",
    ...overrides,
  } as PaymentIntent;
}

function merchantStub(overrides: Partial<Merchant> = {}): Merchant {
  return {
    id: "mch_123",
    country: "ID",
    payoutChannelCode: "GOPAY",
    payoutAccountNumber: encryptAccountNumber("081234567890"),
    payoutAccountHolderName: "Budi Warung",
    payoutProvider: "xendit",
    ...overrides,
  } as unknown as Merchant;
}

function prismaStub(
  providerChannelRow: unknown = {
    providerChannelCode: "ID_GOPAY",
    channelCode: "GOPAY",
    country: "ID",
    provider: "xendit",
    minAmountIdr: 10_000,
    maxAmountIdr: 20_000_000,
    feeIdr: 2500,
    isActive: true,
  },
): PrismaService {
  return {
    providerChannel: {
      findUnique: jest.fn(async () => providerChannelRow),
    },
  } as unknown as PrismaService;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("XenditPayoutProvider wire-format parity (task 17)", () => {
  it("produces a request body byte-for-byte equal to the pre-refactor fixture", async () => {
    // Wire-format guarantee from research §6.5: the rename (tasks 01–04)
    // changed internal TS property names only. The request body sent to
    // Xendit MUST be unchanged. If this test fails after a rename PR, the
    // rename has leaked into the wire.
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, {
        id: "disb_wire",
        status: "PENDING",
        reference_id: "pi_01HXYZ",
      }),
    );
    const provider = new XenditPayoutProvider(
      configStub() as any,
      prismaStub(),
      fetchMock as any,
    );
    await provider.triggerPayout(intentStub(), merchantStub());
    const [, init] = fetchMock.mock.calls[0];
    const parsed = JSON.parse((init as RequestInit).body as string);
    expect(parsed).toEqual(xenditRequestBodyFixture);
  });
});

describe("XenditPayoutProvider.triggerPayout", () => {
  it("returns a PENDING receipt on 200 and echoes the provider id", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, {
        id: "disb_abc123",
        status: "PENDING",
        reference_id: "pi_01HXYZ",
      }),
    );
    const provider = new XenditPayoutProvider(
      configStub() as any,
      prismaStub(),
      fetchMock as any,
    );
    const receipt = await provider.triggerPayout(intentStub(), merchantStub());

    expect(receipt.providerPayoutId).toBe("disb_abc123");
    expect(receipt.status).toBe("PENDING");
    expect(receipt.referenceId).toBe("pi_01HXYZ");
    expect(receipt.amount).toBe(15_000);
    expect(receipt.currency).toBe("IDR");
    expect(receipt.channelCode).toBe("GOPAY");

    // Verify the request shape — body includes decrypted account number.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.xendit.test/v2/payouts");
    const parsed = JSON.parse((init as RequestInit).body as string);
    expect(parsed).toMatchObject({
      reference_id: "pi_01HXYZ",
      channel_code: "ID_GOPAY",
      amount: 15_000,
      currency: "IDR",
    });
    expect(parsed.channel_properties.account_number).toBe("081234567890");
    expect(parsed.channel_properties.account_holder_name).toBe("Budi Warung");

    // Verify headers include Basic auth + idempotency key (intent id).
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Idempotency-key"]).toBe("pi_01HXYZ");
    expect(headers.Authorization).toMatch(/^Basic [A-Za-z0-9+/=]+$/);
    // Basic auth is base64(KEY + ":") — verify it decodes back.
    const decoded = Buffer.from(
      headers.Authorization.replace("Basic ", ""),
      "base64",
    ).toString("utf8");
    expect(decoded).toBe("xnd_development_testkey:");
  });

  it("throws PayoutProviderError with kind=client_error on 4xx (no retry)", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(400, {
        error_code: "CHANNEL_CODE_INVALID",
        message: "channel_code is not supported",
      }),
    );
    const provider = new XenditPayoutProvider(
      configStub() as any,
      prismaStub(),
      fetchMock as any,
    );

    await expect(
      provider.triggerPayout(intentStub(), merchantStub()),
    ).rejects.toMatchObject({
      kind: "client_error",
      httpStatus: 400,
    });
    // 4xx → no retry.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on 5xx up to MAX_ATTEMPTS and eventually throws kind=server_error", async () => {
    // Fresh Response per call — `Response` bodies can only be consumed once,
    // so `mockResolvedValue` with a single instance fails on the second attempt.
    const fetchMock = jest.fn(async () =>
      jsonResponse(503, { message: "upstream timeout" }),
    );
    const provider = new XenditPayoutProvider(
      configStub() as any,
      prismaStub(),
      fetchMock as any,
    );

    await expect(
      provider.triggerPayout(intentStub(), merchantStub()),
    ).rejects.toMatchObject({
      kind: "server_error",
      httpStatus: 503,
    });
    // 1 initial + 2 retries = 3 calls.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("recovers on a retry after a transient 5xx", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(502, { message: "bad gateway" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { id: "disb_after_retry", status: "PENDING" }),
      );
    const provider = new XenditPayoutProvider(
      configStub() as any,
      prismaStub(),
      fetchMock as any,
    );
    const receipt = await provider.triggerPayout(intentStub(), merchantStub());

    expect(receipt.providerPayoutId).toBe("disb_after_retry");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws kind=timeout when the request is aborted", async () => {
    // Simulate an abort-triggered AbortError. We don't need the real 60 s
    // clock to fire — we just need fetch to reject with an AbortError and
    // let postOnce's error-mapping branch turn it into kind=timeout.
    const fetchMock = jest.fn(async () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;

    const provider = new XenditPayoutProvider(
      configStub() as any,
      prismaStub(),
      fetchMock,
    );

    await expect(
      provider.triggerPayout(intentStub(), merchantStub()),
    ).rejects.toMatchObject({
      kind: "timeout",
    });
    // All three attempts should have fired since timeout is treated as
    // transient and retried.
    expect((fetchMock as unknown as jest.Mock).mock.calls.length).toBe(3);
  });

  it("throws a PayoutProviderError when XENDIT_SECRET_KEY is missing", async () => {
    const fetchMock = jest.fn();
    const provider = new XenditPayoutProvider(
      configStub({ XENDIT_SECRET_KEY: undefined } as any) as any,
      prismaStub(),
      fetchMock as any,
    );
    await expect(
      provider.triggerPayout(intentStub(), merchantStub()),
    ).rejects.toBeInstanceOf(PayoutProviderError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("XenditPayoutProvider.verifyWebhookSignature", () => {
  it("returns true when x-callback-token matches", () => {
    const provider = new XenditPayoutProvider(configStub() as any);
    const ok = provider.verifyWebhookSignature(
      { "x-callback-token": "test-callback-token" },
      "{}",
    );
    expect(ok).toBe(true);
  });

  it("returns false when x-callback-token mismatches", () => {
    const provider = new XenditPayoutProvider(configStub() as any);
    const ok = provider.verifyWebhookSignature(
      { "x-callback-token": "wrong-token" },
      "{}",
    );
    expect(ok).toBe(false);
  });

  it("returns false when x-callback-token is missing", () => {
    const provider = new XenditPayoutProvider(configStub() as any);
    const ok = provider.verifyWebhookSignature({}, "{}");
    expect(ok).toBe(false);
  });

  it("returns false when the env var is missing (fail closed)", () => {
    const provider = new XenditPayoutProvider(
      configStub({ XENDIT_WEBHOOK_TOKEN: undefined } as any) as any,
    );
    const ok = provider.verifyWebhookSignature(
      { "x-callback-token": "anything" },
      "{}",
    );
    expect(ok).toBe(false);
  });

  it("handles an array-shaped header value (takes the first)", () => {
    const provider = new XenditPayoutProvider(configStub() as any);
    const ok = provider.verifyWebhookSignature(
      { "x-callback-token": ["test-callback-token", "spoof"] },
      "{}",
    );
    expect(ok).toBe(true);
  });
});

describe("XenditPayoutProvider.getStatus", () => {
  it("returns PENDING as a stub (webhook is source of truth in v1)", async () => {
    const provider = new XenditPayoutProvider(configStub() as any);
    await expect(provider.getStatus("disb_abc")).resolves.toEqual({
      status: "PENDING",
    });
  });
});
