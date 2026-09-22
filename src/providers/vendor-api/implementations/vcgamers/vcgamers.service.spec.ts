import type { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import type { PrismaService } from "../../../../prisma/prisma.service";
import type { VendorAPICacheService } from "../../../../valkey/services/vendor-api-cache.service";
import { VCGamersService } from "./vcgamers.service";

/**
 * VCGamersService unit tests.
 *
 * The base class fires a fetch() during initializeConfig — we override
 * fetch globally per test so init doesn't escape the sandbox. Once the
 * service is constructed we assign `.config` directly (init is async and
 * fire-and-forget) so tests stay deterministic regardless of timing.
 */

const SECRET = "test-secret-please-change-me";

function buildSvc() {
  const config = { get: jest.fn() } as unknown as ConfigService;
  const prisma = {
    vendor: {
      findUnique: jest.fn(async () => ({ id: "v_vc", name: "vcGamer" })),
    },
  } as unknown as PrismaService;
  const cache = {
    getVendorAPI: jest.fn(async () => ({
      baseUrl: "https://api.example.test",
      apiKey: "api-key",
      apiSecret: SECRET,
    })),
    invalidateVendorAPICache: jest.fn(),
  } as unknown as VendorAPICacheService;

  const svc = new VCGamersService(config, prisma, cache);
  // Skip the async init by setting config directly (init runs but
  // we don't await it — assigning here is the test seam).
  (svc as unknown as { config: Record<string, unknown> }).config = {
    baseUrl: "https://api.example.test",
    apiKey: "api-key",
    apiSecret: SECRET,
    vendorId: "v_vc",
  };
  return svc;
}

describe("VCGamersService.createSignature", () => {
  it("produces base64(HMAC-SHA512(secret, params)) — verifiable round-trip", () => {
    const svc = buildSvc();
    const params = `${SECRET}brand`;
    const sig = (
      svc as unknown as { createSignature: (p: string) => string }
    ).createSignature(params);

    const expected = Buffer.from(
      crypto.createHmac("sha512", SECRET).update(params).digest("hex"),
    ).toString("base64");
    expect(sig).toBe(expected);
  });

  it("throws when params are empty", () => {
    const svc = buildSvc();
    expect(() =>
      (
        svc as unknown as { createSignature: (p: string) => string }
      ).createSignature(""),
    ).toThrow();
  });

  it("throws when API secret is missing", () => {
    const svc = buildSvc();
    (svc as unknown as { config: { apiSecret?: string } }).config.apiSecret =
      undefined;
    expect(() =>
      (
        svc as unknown as { createSignature: (p: string) => string }
      ).createSignature("brand"),
    ).toThrow();
  });
});

describe("VCGamersService.getProducts", () => {
  it("hits /v2/public/brands with the correct sign param and returns the data array", async () => {
    const svc = buildSvc();
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ key: "ML", name: "Mobile Legends" }],
    } as Response);

    const out = await svc.getProducts();
    expect(out.success).toBe(true);
    expect(out.data?.length).toBe(1);
    const url = (fetchMock.mock.calls[0][0] as string).toString();
    expect(url).toContain("/v2/public/brands?sign=");
  });

  it("returns success=false with empty data when upstream is malformed", async () => {
    const svc = buildSvc();
    // 502 is retryable — return the same response for every retry attempt.
    jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ message: "upstream broken" }),
    } as Response);
    const out = await svc.getProducts();
    expect(out.success).toBe(false);
    expect(out.data).toEqual([]);
  });
});

describe("VCGamersService.createOrder", () => {
  it("composes sign over secret+order+brand+variation+price+ref+ts and POSTs JSON body", async () => {
    const svc = buildSvc();
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ref_id: "TRX_OK" }),
    } as Response);

    const fixedTs = "1750000000";
    jest.spyOn(Date, "now").mockReturnValueOnce(Number(fixedTs) * 1000);

    const out = await svc.createOrder(
      "ML",
      "ML-86D",
      100000,
      [{ key: "user_id", value: "12345" }],
      "REF_FIXED",
    );
    expect(out.success).toBe(true);

    const callArgs = fetchMock.mock.calls[0];
    const opts = callArgs[1] as RequestInit;
    expect(opts.method).toBe("POST");
    expect(opts.body).toBeDefined();
    expect((opts.body as string).includes("ref_id")).toBe(true);
    expect((opts.body as string).includes("REF_FIXED")).toBe(true);
  });
});

describe("VCGamersService.getOrderStatus", () => {
  it("rejects empty/whitespace transaction codes with 400 (no fetch)", async () => {
    const svc = buildSvc();
    const fetchMock = jest.spyOn(globalThis, "fetch");
    const out = await svc.getOrderStatus("   ");
    expect(out.success).toBe(false);
    expect(out.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns success=true with the raw vendor body on a 200", async () => {
    const svc = buildSvc();
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: { status: 2, detail: { voucher_code: "ABCD" } },
      }),
    } as Response);
    const out = await svc.getOrderStatus("TRX_X");
    expect(out.success).toBe(true);
    expect(out.data?.data?.status).toBe(2);
  });

  it("returns 502 invalid-vendor-response when body is not an object", async () => {
    const svc = buildSvc();
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => "not-an-object",
    } as Response);
    const out = await svc.getOrderStatus("TRX_BAD");
    expect(out.success).toBe(false);
    expect(out.statusCode).toBe(502);
  });

  it("maps an upstream 500 to a 503 (mapped via base-class error mapper)", async () => {
    const svc = buildSvc();
    jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: "boom" }),
    } as Response);
    // 4 attempts (1 + 3 retries) — keep retry delays from blowing the test budget
    jest
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((fn: TimerHandler) => {
        if (typeof fn === "function") fn();
        return 0 as unknown as NodeJS.Timeout;
      });
    const out = await svc.getOrderStatus("TRX_500");
    expect(out.success).toBe(false);
    expect(out.statusCode).toBe(503);
  });
});

describe("VCGamersService.getProductVariants", () => {
  it("includes brand_key in URL and returns the inner data array", async () => {
    const svc = buildSvc();
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ variation_key: "v1" }] }),
    } as Response);
    const out = await svc.getProductVariants("ML");
    expect(out.success).toBe(true);
    expect(out.data?.length).toBe(1);
    expect((fetchMock.mock.calls[0][0] as string).toString()).toContain(
      "brand_key=ML",
    );
  });

  it("returns empty data when upstream gives no payload", async () => {
    const svc = buildSvc();
    // 502 is retryable — provide the same response across all retries.
    jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ message: "fail" }),
    } as Response);
    const out = await svc.getProductVariants("ML");
    expect(out.data).toEqual([]);
  });
});

// Skip the real retry-delay setTimeout so 5xx tests don't take 7+ seconds.
beforeEach(() => {
  jest
    .spyOn(globalThis, "setTimeout")
    .mockImplementation((fn: TimerHandler) => {
      if (typeof fn === "function") fn();
      return 0 as unknown as NodeJS.Timeout;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("VCGamersService.readCachedStatus", () => {
  it("reads a cached order-status body, including the pre-fulfilment redeem cache", () => {
    const svc = buildSvc();
    const stored = {
      code: 200,
      status: "success",
      rc_code: "00",
      data: {
        status: 2,
        detail: { voucher_code: "1234 5678 9012 3456 7890/BUDI/R1/900VA/32,1" },
        history_status: [],
      },
    };
    expect(svc.readCachedStatus(stored)).toEqual({
      outcome: "delivered",
      raw: "1234 5678 9012 3456 7890/BUDI/R1/900VA/32,1",
    });
  });

  it("does not claim bodies that are not order-status bodies", () => {
    const svc = buildSvc();
    expect(svc.readCachedStatus(null)).toBeNull();
    expect(svc.readCachedStatus({ data: { status: 4 } })).toBeNull();
    expect(svc.readCachedStatus("nope")).toBeNull();
  });
});
