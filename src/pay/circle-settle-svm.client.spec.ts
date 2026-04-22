import type { ConfigService } from "@nestjs/config";
import { CircleSettleSvmClient } from "./circle-settle-svm.client";

function configStub(
  env: Partial<Record<string, string>> = {},
): ConfigService {
  return {
    get: jest.fn(<T,>(k: string, fallback?: T): T | undefined => {
      const raw = env[k];
      if (raw === undefined || raw === "") return fallback;
      return raw as unknown as T;
    }),
  } as unknown as ConfigService;
}

describe("CircleSettleSvmClient", () => {
  const URL = "https://facilitator.example/v1/settle";
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it("returns `ok` on facilitator 200 with success=true body", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: jest.fn().mockResolvedValue({
        success: true,
        transaction: "svm-sig-base58",
        network: "solana:mainnet",
      }),
    }) as unknown as typeof fetch;

    const client = new CircleSettleSvmClient(configStub({}));
    const outcome = await client.settle(URL, { signedTransaction: "abc" });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.response.transaction).toBe("svm-sig-base58");
      expect(outcome.response.network).toBe("solana:mainnet");
    }
  });

  it("returns `rejected` on 4xx with errorReason body", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: jest.fn().mockResolvedValue({
        success: false,
        errorReason: "invalid_signature",
      }),
    }) as unknown as typeof fetch;

    const client = new CircleSettleSvmClient(configStub({}));
    const outcome = await client.settle(URL, { signedTransaction: "abc" });
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind === "rejected") {
      expect(outcome.status).toBe(400);
      expect(outcome.response.errorReason).toBe("invalid_signature");
    }
  });

  it("returns `upstream` on 5xx", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: jest.fn().mockResolvedValue({ message: "down" }),
    }) as unknown as typeof fetch;

    const client = new CircleSettleSvmClient(configStub({}));
    const outcome = await client.settle(URL, { signedTransaction: "abc" });
    expect(outcome.kind).toBe("upstream");
    if (outcome.kind === "upstream") {
      expect(outcome.status).toBe(503);
    }
  });

  it("returns `upstream` when the body is not JSON", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: jest.fn().mockRejectedValue(new Error("not JSON")),
    }) as unknown as typeof fetch;

    const client = new CircleSettleSvmClient(configStub({}));
    const outcome = await client.settle(URL, { signedTransaction: "abc" });
    expect(outcome.kind).toBe("upstream");
  });

  it("returns `timeout` when fetch aborts", async () => {
    global.fetch = jest.fn().mockImplementation(() => {
      const err = new Error("The operation was aborted.");
      err.name = "AbortError";
      return Promise.reject(err);
    }) as unknown as typeof fetch;

    const client = new CircleSettleSvmClient(configStub({}));
    const outcome = await client.settle(URL, { signedTransaction: "abc" });
    expect(outcome.kind).toBe("timeout");
  });

  it("returns `upstream` on a generic network error (not an abort)", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("ENOTFOUND")) as unknown as typeof fetch;

    const client = new CircleSettleSvmClient(configStub({}));
    const outcome = await client.settle(URL, { signedTransaction: "abc" });
    expect(outcome.kind).toBe("upstream");
  });

  it("attaches Authorization: Bearer when CIRCLE_API_KEY is set", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: jest.fn().mockResolvedValue({
        success: true,
        transaction: "t",
        network: "solana:mainnet",
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new CircleSettleSvmClient(
      configStub({ CIRCLE_API_KEY: "SAND_API_KEY:deadbeef" }),
    );
    await client.settle(URL, { signedTransaction: "abc" });
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers["Authorization"]).toBe("Bearer SAND_API_KEY:deadbeef");
  });
});
