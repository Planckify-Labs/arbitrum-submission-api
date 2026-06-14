import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { RateLimitCacheService } from "../valkey/services/rate-limit-cache.service";
import type { IBundlerClient, BundlerOutcome } from "./bundler.client";
import type { SubmitUserOpDto } from "./dto/submit-userop.dto";
import {
  USEROP_RATE_LIMIT_MAX_PER_MINUTE,
  UserOpService,
} from "./userop.service";

/**
 * Unit tests for the UserOp bundler proxy (task 37, spec §6.7).
 *
 * We mock the bundler HTTP client entirely — per user-prompt scope: "Mock
 * the bundler HTTP client in tests." — so every branch of the outcome
 * union can be exercised without touching real network.
 *
 * Coverage matrix (user-prompt verify list):
 *   1. happy path with mocked bundler    → 200 + userOpHash
 *   2. unknown chainId                   → 400 CHAIN_NOT_SUPPORTED
 *   3. bundler 4xx (JSON-RPC error)      → 4xx echoed with rpcCode/message
 *   4. bundler 5xx / upstream            → 502 BUNDLER_UPSTREAM_ERROR
 *   5. rate limit exceeded               → 429 USEROP_RATE_LIMIT_EXCEEDED
 * Plus: timeout → 504, and logging-safe fields (no signature/callData).
 */

function makeDto(overrides: Partial<SubmitUserOpDto> = {}): SubmitUserOpDto {
  return {
    chainId: 84532,
    entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    userOp: {
      sender: "0x00000000000000000000000000000000000000Ab",
      nonce: "0x0",
      callData: "0xdeadbeef",
      signature: "0x" + "aa".repeat(65),
    },
    ...overrides,
  } satisfies SubmitUserOpDto;
}

/**
 * Stub `PrismaService` that resolves `blockchain.findUnique({ where: { chainId }})`
 * to `{ bundlerUrl }` from the passed map. Unmapped chainIds resolve to `null`
 * (no DB row), which the service turns into 400 `CHAIN_NOT_SUPPORTED`.
 */
function prismaStub(
  urls: Record<number, string | undefined>,
): PrismaService {
  return {
    blockchain: {
      findUnique: jest.fn(async (args: { where: { chainId: number } }) => {
        await Promise.resolve();
        const url = urls[args.where.chainId];
        if (url === undefined) return null;
        return { bundlerUrl: url };
      }),
    },
  } as unknown as PrismaService;
}

function rateLimitStub(
  allowed: boolean,
  resetAt: number = Date.now() + 60_000,
): RateLimitCacheService {
  return {
    checkRateLimit: jest.fn(async () => ({
      allowed,
      remaining: allowed ? USEROP_RATE_LIMIT_MAX_PER_MINUTE - 1 : 0,
      resetAt,
    })),
    resetRateLimit: jest.fn(async () => undefined),
  } as unknown as RateLimitCacheService;
}

function bundlerStub(outcome: BundlerOutcome): IBundlerClient {
  return {
    sendUserOperation: jest.fn(async () => outcome),
  };
}

describe("UserOpService", () => {
  it("forwards to the configured bundler and returns the hash on success", async () => {
    const hash = `0x${"ab".repeat(32)}` as `0x${string}`;
    const bundler = bundlerStub({
      kind: "ok",
      userOpHash: hash,
      httpStatus: 200,
    });
    const service = new UserOpService(
      prismaStub({ 84532: "https://bundler.test/rpc?key=xyz" }),
      rateLimitStub(true),
      bundler,
    );

    const result = await service.submitUserOp({
      dto: makeDto(),
      userId: "user_1",
    });

    expect(result).toEqual({
      userOpHash: hash,
      chainId: 84532,
    });

    // Verify the dto.userOp is forwarded *verbatim*. No field reshape.
    const call = (bundler.sendUserOperation as jest.Mock).mock.calls[0][0];
    expect(call.bundlerUrl).toBe("https://bundler.test/rpc?key=xyz");
    expect(call.userOp).toEqual(makeDto().userOp); // Same shape — signature/callData intact.
    expect(call.entryPoint).toBe(makeDto().entryPoint);
    expect(call.chainId).toBe(84532);
  });

  it("rejects unknown chainId with 400 CHAIN_NOT_SUPPORTED", async () => {
    const bundler = bundlerStub({
      kind: "ok",
      userOpHash: `0x${"00".repeat(32)}` as `0x${string}`,
      httpStatus: 200,
    });
    const service = new UserOpService(
      // Only Base Sepolia is configured — request targets Arbitrum Sepolia.
      prismaStub({ 84532: "https://bundler.test/rpc" }),
      rateLimitStub(true),
      bundler,
    );

    await expect(
      service.submitUserOp({
        dto: makeDto({ chainId: 421614 }),
        userId: "user_1",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Bundler MUST NOT have been called on an unconfigured chain.
    expect(bundler.sendUserOperation).not.toHaveBeenCalled();
  });

  it("echoes bundler JSON-RPC errors as 4xx BUNDLER_REJECTED", async () => {
    const bundler = bundlerStub({
      kind: "rejected",
      httpStatus: 200,
      rpcCode: -32602,
      rpcMessage: "AA24 signature error",
      rpcData: { stage: "validation" },
    });
    const service = new UserOpService(
      prismaStub({ 84532: "https://bundler.test/rpc" }),
      rateLimitStub(true),
      bundler,
    );

    let thrown: HttpException | null = null;
    try {
      await service.submitUserOp({ dto: makeDto(), userId: "user_1" });
    } catch (err) {
      thrown = err as HttpException;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect(thrown!.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    const body = thrown!.getResponse() as Record<string, unknown>;
    expect(body.code).toBe("BUNDLER_REJECTED");
    expect(body.rpcCode).toBe(-32602);
    expect(body.message).toBe("AA24 signature error");
  });

  it("propagates bundler HTTP 429 as HTTP 429 (bundler rate-limited us)", async () => {
    const bundler = bundlerStub({
      kind: "rejected",
      httpStatus: 429,
      rpcCode: -32005,
      rpcMessage: "rate limited",
    });
    const service = new UserOpService(
      prismaStub({ 84532: "https://bundler.test/rpc" }),
      rateLimitStub(true),
      bundler,
    );

    let thrown: HttpException | null = null;
    try {
      await service.submitUserOp({ dto: makeDto(), userId: "user_1" });
    } catch (err) {
      thrown = err as HttpException;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect(thrown!.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it("surfaces bundler upstream errors (5xx / malformed) as 502", async () => {
    const bundler = bundlerStub({
      kind: "upstream",
      httpStatus: 503,
      message: "bundler 503 Service Unavailable",
      body: null,
    });
    const service = new UserOpService(
      prismaStub({ 84532: "https://bundler.test/rpc" }),
      rateLimitStub(true),
      bundler,
    );

    await expect(
      service.submitUserOp({ dto: makeDto(), userId: "user_1" }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it("surfaces bundler timeouts as 504 BUNDLER_TIMEOUT", async () => {
    const bundler = bundlerStub({
      kind: "timeout",
      message: "Bundler call timed out after 30000ms",
    });
    const service = new UserOpService(
      prismaStub({ 84532: "https://bundler.test/rpc" }),
      rateLimitStub(true),
      bundler,
    );

    await expect(
      service.submitUserOp({ dto: makeDto(), userId: "user_1" }),
    ).rejects.toBeInstanceOf(GatewayTimeoutException);
  });

  it("returns 429 when the per-user rate limit is exceeded", async () => {
    const bundler = bundlerStub({
      kind: "ok",
      userOpHash: `0x${"11".repeat(32)}` as `0x${string}`,
      httpStatus: 200,
    });
    const resetAt = Date.now() + 30_000;
    const service = new UserOpService(
      prismaStub({ 84532: "https://bundler.test/rpc" }),
      rateLimitStub(false, resetAt),
      bundler,
    );

    let thrown: HttpException | null = null;
    try {
      await service.submitUserOp({ dto: makeDto(), userId: "user_spammer" });
    } catch (err) {
      thrown = err as HttpException;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect(thrown!.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    const body = thrown!.getResponse() as Record<string, unknown>;
    expect(body.code).toBe("USEROP_RATE_LIMIT_EXCEEDED");
    expect(body.resetAt).toBe(resetAt);

    // Bundler MUST NOT have been called when rate limit trips.
    expect(bundler.sendUserOperation).not.toHaveBeenCalled();
  });

  it("resolves bundler URL from DB keyed by chainId (no hardcoded chain branch in service)", async () => {
    // Different chain id → different DB row. This test proves the
    // resolver is `Blockchain.bundlerUrl WHERE chainId = <n>` — so
    // extending the whitelist never requires a code change, just an
    // INSERT / UPDATE (chain-extension discipline).
    const bundler = bundlerStub({
      kind: "ok",
      userOpHash: `0x${"22".repeat(32)}` as `0x${string}`,
      httpStatus: 200,
    });
    const urls = {
      8453: "https://base-mainnet.test/rpc",
      42161: "https://arb-mainnet.test/rpc",
    };
    const service = new UserOpService(
      prismaStub(urls),
      rateLimitStub(true),
      bundler,
    );

    await service.submitUserOp({
      dto: makeDto({ chainId: 42161 }),
      userId: "user_1",
    });
    expect((bundler.sendUserOperation as jest.Mock).mock.calls[0][0].bundlerUrl).toBe(
      "https://arb-mainnet.test/rpc",
    );

    await service.submitUserOp({
      dto: makeDto({ chainId: 8453 }),
      userId: "user_1",
    });
    expect((bundler.sendUserOperation as jest.Mock).mock.calls[1][0].bundlerUrl).toBe(
      "https://base-mainnet.test/rpc",
    );
  });

  it("does not log signature or callData (log-redaction invariant)", async () => {
    const logSpy = jest
      .spyOn(require("@nestjs/common").Logger.prototype, "log")
      .mockImplementation(() => undefined);

    try {
      const bundler = bundlerStub({
        kind: "ok",
        userOpHash: `0x${"33".repeat(32)}` as `0x${string}`,
        httpStatus: 200,
      });
      const service = new UserOpService(
        prismaStub({ 84532: "https://bundler.test/rpc" }),
        rateLimitStub(true),
        bundler,
      );

      const secretSig = "0x" + "be".repeat(65);
      const secretCallData = "0xdeadbeefca11da7a";
      await service.submitUserOp({
        dto: makeDto({
          userOp: {
            sender: "0x00000000000000000000000000000000000000Ab",
            signature: secretSig,
            callData: secretCallData,
          },
        }),
        userId: "user_log",
      });

      // Nothing we logged should contain the signature or callData.
      const allLogs = logSpy.mock.calls.map((c) => String(c[0])).join(" | ");
      expect(allLogs).not.toContain(secretSig);
      expect(allLogs).not.toContain(secretCallData);

      // But the sender + entryPoint + chainId SHOULD be observable — that's
      // the audit-trail we chose to keep.
      expect(allLogs).toContain("sender=0x00000000000000000000000000000000000000Ab");
      expect(allLogs).toContain("chainId=84532");
      expect(allLogs).toContain("entryPoint=0x0000000071727De22E5E9d8BAf0edAc6f37da032");
    } finally {
      logSpy.mockRestore();
    }
  });
});
