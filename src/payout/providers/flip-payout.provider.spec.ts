import type { ConfigService } from "@nestjs/config";
import type { Merchant, PaymentIntent } from "@generated/prisma";
import type { PrismaService } from "../../prisma/prisma.service";
import { encryptAccountNumber } from "../account-number-crypto";
import { PayoutProviderError } from "../types";
import { FlipPayoutProvider } from "./flip-payout.provider";

/**
 * Unit tests for the Flip payout provider adapter.
 *
 * All HTTP transport is mocked via the constructor-injected `httpFetch`
 * parameter — no real network calls. Follows the same pattern as the
 * Xendit and Duitku adapter specs.
 */

const FLIP_CREDS: Record<string, string> = {
  FLIP_SECRET_KEY: "flip_test_secret_key_abc123",
  FLIP_VALIDATION_TOKEN: "flip-validation-token-xyz",
  FLIP_API_BASE: "https://bigflip.test/api/v3",
};

function configStub(
  overrides: Record<string, string | undefined> = {},
): ConfigService {
  const bag: Record<string, string | undefined> = {
    ...FLIP_CREDS,
    ...overrides,
  };
  return {
    get: jest.fn((k: string) => bag[k]),
    getOrThrow: jest.fn((k: string) => {
      const v = bag[k];
      if (v === undefined) throw new Error(`missing ${k}`);
      return v;
    }),
  } as unknown as ConfigService;
}

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
): PrismaService {
  return {
    providerChannel: {
      findUnique: jest.fn(async () => providerChannelRow),
    },
  } as unknown as PrismaService;
}

function makeIntent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    id: "pi_01HXYZ_ABCDEFGHIJKLMNOP",
    fiatAmountMinor: 100_000,
    fiatCurrency: "IDR",
    ...overrides,
  } as unknown as PaymentIntent;
}

function makeMerchant(overrides: Partial<Merchant> = {}): Merchant {
  return {
    id: "mch_123",
    country: "ID",
    payoutChannelCode: "BCA",
    payoutAccountNumber: encryptAccountNumber("1234567890"),
    payoutAccountHolderName: "Budi Warung",
    payoutProvider: "flip",
    ...overrides,
  } as unknown as Merchant;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// triggerPayout
// ---------------------------------------------------------------------------
describe("FlipPayoutProvider.triggerPayout", () => {
  it("happy path — returns a PENDING receipt with stringified providerPayoutId", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, {
        id: 123,
        status: "PENDING",
        bank_code: "bca",
        amount: 100_000,
        fee: 4000,
      }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    const intent = makeIntent();
    const receipt = await provider.triggerPayout(intent, makeMerchant());

    expect(receipt.providerPayoutId).toBe("123");
    expect(receipt.status).toBe("PENDING");
    expect(receipt.referenceId).toBe(intent.id);
    expect(receipt.amount).toBe(100_000);
    expect(receipt.currency).toBe("IDR");
    expect(receipt.channelCode).toBe("BCA");
    expect(receipt.providerResponseCode).toBe("PENDING");
    expect(receipt.requestedAt).toBeInstanceOf(Date);
    expect(receipt.rawResponse).toMatchObject({
      id: 123,
      status: "PENDING",
      bank_code: "bca",
    });
  });

  it("sends form-urlencoded body with correct Content-Type", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { id: 1, status: "PENDING" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    await provider.triggerPayout(makeIntent(), makeMerchant());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://bigflip.test/api/v3/disbursement");

    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

    // Parse the form body to verify params
    const params = new URLSearchParams(init.body as string);
    expect(params.get("account_number")).toBe("1234567890");
    expect(params.get("bank_code")).toBe("bca");
    expect(params.get("amount")).toBe("100000");
    expect(params.get("remark")).toBeTruthy();
  });

  it("includes idempotency-key header equal to intent.id", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { id: 1, status: "PENDING" }),
    );
    const intent = makeIntent({ id: "pi_unique_idem_key_42" });
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    await provider.triggerPayout(intent, makeMerchant());

    const headers = fetchMock.mock.calls[0][1].headers as Record<
      string,
      string
    >;
    expect(headers["idempotency-key"]).toBe("pi_unique_idem_key_42");
  });

  it("includes Basic auth header with trailing colon in the credential", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { id: 1, status: "PENDING" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    await provider.triggerPayout(makeIntent(), makeMerchant());

    const headers = fetchMock.mock.calls[0][1].headers as Record<
      string,
      string
    >;
    expect(headers.Authorization).toMatch(/^Basic [A-Za-z0-9+/=]+$/);
    // Decode and verify the trailing colon
    const decoded = Buffer.from(
      headers.Authorization.replace("Basic ", ""),
      "base64",
    ).toString("utf8");
    expect(decoded).toBe(`${FLIP_CREDS.FLIP_SECRET_KEY}:`);
  });

  it("truncates remark to 18 chars via intent.id.slice(-18)", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { id: 1, status: "PENDING" }),
    );
    // Use a long intent id to verify truncation
    const longId = "pi_01HXYZ_ABCDEFGHIJKLMNOPQRSTUVWXYZ_1234567890";
    const intent = makeIntent({ id: longId });
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    await provider.triggerPayout(intent, makeMerchant());

    const params = new URLSearchParams(
      fetchMock.mock.calls[0][1].body as string,
    );
    const remark = params.get("remark");
    expect(remark).toBe(longId.slice(-18));
    expect(remark!.length).toBeLessThanOrEqual(18);
  });

  it("resolves bank code via PrismaService.providerChannel.findUnique", async () => {
    const prisma = prismaStub({
      providerChannelCode: "mandiri",
      channelCode: "MANDIRI",
      country: "ID",
      provider: "flip",
      isActive: true,
    });
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { id: 1, status: "PENDING" }),
    );
    const merchant = makeMerchant({ payoutChannelCode: "MANDIRI" });
    const provider = new FlipPayoutProvider(
      configStub(),
      prisma,
      fetchMock as unknown as typeof fetch,
    );
    await provider.triggerPayout(makeIntent(), merchant);

    expect(prisma.providerChannel.findUnique).toHaveBeenCalledTimes(1);
    const params = new URLSearchParams(
      fetchMock.mock.calls[0][1].body as string,
    );
    expect(params.get("bank_code")).toBe("mandiri");
  });

  it("throws PayoutProviderError kind=client_error on 401", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(401, { message: "Unauthorized" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      provider.triggerPayout(makeIntent(), makeMerchant()),
    ).rejects.toMatchObject({
      kind: "client_error",
      httpStatus: 401,
    });
    // 4xx — no retry
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws PayoutProviderError kind=client_error on 422 validation error", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(422, {
        code: "VALIDATION_ERROR",
        errors: [{ message: "bank_code is invalid" }],
      }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      provider.triggerPayout(makeIntent(), makeMerchant()),
    ).rejects.toMatchObject({
      kind: "client_error",
      httpStatus: 422,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on 503 up to MAX_ATTEMPTS then throws kind=server_error", async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse(503, { message: "service unavailable" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      provider.triggerPayout(makeIntent(), makeMerchant()),
    ).rejects.toMatchObject({
      kind: "server_error",
      httpStatus: 503,
    });
    // 1 initial + 2 retries = 3 calls
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 15_000);

  it("throws kind=timeout on AbortError", async () => {
    const fetchMock = jest.fn(() => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    }) as unknown as typeof fetch;

    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock,
    );

    await expect(
      provider.triggerPayout(makeIntent(), makeMerchant()),
    ).rejects.toMatchObject({
      kind: "timeout",
    });
    // Timeout is transient — retried MAX_ATTEMPTS times
    expect((fetchMock as unknown as jest.Mock).mock.calls.length).toBe(3);
  }, 15_000);

  it("maps Flip status PENDING to PENDING", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { id: 10, status: "PENDING" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    const receipt = await provider.triggerPayout(makeIntent(), makeMerchant());
    expect(receipt.status).toBe("PENDING");
  });

  it("maps Flip status DONE to COMPLETED", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { id: 11, status: "DONE" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    const receipt = await provider.triggerPayout(makeIntent(), makeMerchant());
    expect(receipt.status).toBe("COMPLETED");
  });

  it("maps Flip status CANCELLED to FAILED", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { id: 12, status: "CANCELLED" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    const receipt = await provider.triggerPayout(makeIntent(), makeMerchant());
    expect(receipt.status).toBe("FAILED");
  });

  it("recovers on retry after a transient 5xx", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(502, { message: "bad gateway" }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { id: 99, status: "PENDING" }),
      );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    const receipt = await provider.triggerPayout(makeIntent(), makeMerchant());

    expect(receipt.providerPayoutId).toBe("99");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15_000);

  it("throws when PrismaService is not injected", async () => {
    const fetchMock = jest.fn();
    const provider = new FlipPayoutProvider(
      configStub(),
      undefined,
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      provider.triggerPayout(makeIntent(), makeMerchant()),
    ).rejects.toMatchObject({
      kind: "unknown",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when ProviderChannel row is missing", async () => {
    const fetchMock = jest.fn();
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(null),
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      provider.triggerPayout(makeIntent(), makeMerchant()),
    ).rejects.toMatchObject({
      kind: "client_error",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stringifies a numeric provider id", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { id: 9876543, status: "DONE" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    const receipt = await provider.triggerPayout(makeIntent(), makeMerchant());
    expect(receipt.providerPayoutId).toBe("9876543");
    expect(typeof receipt.providerPayoutId).toBe("string");
  });

  it("returns null providerPayoutId when id is absent from response", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { status: "PENDING" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    const receipt = await provider.triggerPayout(makeIntent(), makeMerchant());
    expect(receipt.providerPayoutId).toBeNull();
  });

  it("trims trailing slash from API base URL", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { id: 1, status: "PENDING" }),
    );
    const provider = new FlipPayoutProvider(
      configStub({ FLIP_API_BASE: "https://bigflip.test/api/v3/" }),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    await provider.triggerPayout(makeIntent(), makeMerchant());

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("https://bigflip.test/api/v3/disbursement");
  });
});

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------
describe("FlipPayoutProvider.getStatus", () => {
  it("happy path — DONE maps to COMPLETED", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { id: 123, status: "DONE" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.getStatus("123");
    expect(result.status).toBe("COMPLETED");
    expect(result.providerResponseCode).toBe("DONE");
  });

  it("PENDING status maps to PENDING", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { id: 456, status: "PENDING" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.getStatus("456");
    expect(result.status).toBe("PENDING");
    expect(result.providerResponseCode).toBe("PENDING");
  });

  it("CANCELLED status maps to FAILED", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { id: 789, status: "CANCELLED" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.getStatus("789");
    expect(result.status).toBe("FAILED");
    expect(result.providerResponseCode).toBe("CANCELLED");
  });

  it("is case-insensitive — 'done' maps to COMPLETED", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { id: 100, status: "done" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.getStatus("100");
    expect(result.status).toBe("COMPLETED");
  });

  it("unknown status defaults to PENDING", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { id: 200, status: "SOME_NEW_STATUS" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.getStatus("200");
    expect(result.status).toBe("PENDING");
  });

  it("throws PayoutProviderError kind=client_error on 404", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(404, { message: "Disbursement not found" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );

    await expect(provider.getStatus("nonexistent")).rejects.toMatchObject({
      kind: "client_error",
      httpStatus: 404,
    });
    // 4xx — no retry
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("calls the correct URL: ${apiBase}/disbursement/${id}", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { id: 555, status: "PENDING" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    await provider.getStatus("555");

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("https://bigflip.test/api/v3/disbursement/555");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("GET");
  });

  it("retries on 5xx then throws kind=server_error after exhausting attempts", async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse(500, { message: "internal error" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );

    await expect(provider.getStatus("123")).rejects.toMatchObject({
      kind: "server_error",
      httpStatus: 500,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 15_000);

  it("includes the provider response body", async () => {
    const responseBody = { id: 123, status: "DONE", bank_code: "bca", amount: 50_000 };
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, responseBody),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.getStatus("123");
    expect(result.providerResponseBody).toMatchObject(responseBody);
  });
});

// ---------------------------------------------------------------------------
// getStatusByIdempotencyKey
// ---------------------------------------------------------------------------
describe("FlipPayoutProvider.getStatusByIdempotencyKey", () => {
  it("happy path — returns status and providerPayoutId", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { id: 777, status: "DONE" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.getStatusByIdempotencyKey("pi_some_intent");

    expect(result.status).toBe("COMPLETED");
    expect(result.providerPayoutId).toBe("777");
    expect(result.providerResponseCode).toBe("DONE");
  });

  it("calls the correct URL with encoded idempotency_key query param", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { id: 888, status: "PENDING" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    const intentId = "pi_01HXYZ_with special&chars=yes";
    await provider.getStatusByIdempotencyKey(intentId);

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe(
      `https://bigflip.test/api/v3/disbursement?idempotency_key=${encodeURIComponent(intentId)}`,
    );

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("GET");
  });

  it("returns null providerPayoutId when id is absent", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { status: "PENDING" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.getStatusByIdempotencyKey("pi_no_id");
    expect(result.providerPayoutId).toBeNull();
  });

  it("throws on 404 (no retry — single getOnce call)", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(404, { message: "not found" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      provider.getStatusByIdempotencyKey("pi_missing"),
    ).rejects.toMatchObject({
      kind: "client_error",
      httpStatus: 404,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// checkBalance
// ---------------------------------------------------------------------------
describe("FlipPayoutProvider.checkBalance", () => {
  it("happy path — returns { balance } from the response", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { balance: 1_234_567 }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.checkBalance();
    expect(result).toEqual({ balance: 1_234_567 });
  });

  it("calls the correct balance URL", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { balance: 500_000 }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    await provider.checkBalance();

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("https://bigflip.test/api/v3/general/balance");
  });

  it("throws on 401 with a clear error", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(401, { message: "Unauthorized" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );

    await expect(provider.checkBalance()).rejects.toMatchObject({
      kind: "client_error",
      httpStatus: 401,
    });
  });

  it("handles balance as a string (coerced to number)", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { balance: "9876543" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.checkBalance();
    expect(result).toEqual({ balance: 9_876_543 });
  });

  it("throws server_error when balance is missing from response", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(
      jsonResponse(200, { other_field: "no balance" }),
    );
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
      fetchMock as unknown as typeof fetch,
    );

    await expect(provider.checkBalance()).rejects.toMatchObject({
      kind: "server_error",
    });
  });
});

// ---------------------------------------------------------------------------
// verifyWebhookSignature
// ---------------------------------------------------------------------------
describe("FlipPayoutProvider.verifyWebhookSignature", () => {
  it("returns true when token in body matches FLIP_VALIDATION_TOKEN", () => {
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
    );
    const body = `token=${FLIP_CREDS.FLIP_VALIDATION_TOKEN}&data=%7B%22id%22%3A123%7D`;
    const result = provider.verifyWebhookSignature({}, body);
    expect(result).toBe(true);
  });

  it("returns false when token does not match", () => {
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
    );
    const body = "token=wrong-token&data=%7B%7D";
    const result = provider.verifyWebhookSignature({}, body);
    expect(result).toBe(false);
  });

  it("returns false when token is missing from body", () => {
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
    );
    const body = "data=%7B%7D";
    const result = provider.verifyWebhookSignature({}, body);
    expect(result).toBe(false);
  });

  it("returns false when body is empty string", () => {
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
    );
    const result = provider.verifyWebhookSignature({}, "");
    expect(result).toBe(false);
  });

  it("returns false when FLIP_VALIDATION_TOKEN env var is missing", () => {
    const provider = new FlipPayoutProvider(
      configStub({ FLIP_VALIDATION_TOKEN: undefined }),
      prismaStub(),
    );
    const body = `token=anything`;
    const result = provider.verifyWebhookSignature({}, body);
    expect(result).toBe(false);
  });

  it("returns false for tokens with different lengths (timing-safe)", () => {
    const provider = new FlipPayoutProvider(
      configStub(),
      prismaStub(),
    );
    const body = "token=short";
    const result = provider.verifyWebhookSignature({}, body);
    expect(result).toBe(false);
  });
});
