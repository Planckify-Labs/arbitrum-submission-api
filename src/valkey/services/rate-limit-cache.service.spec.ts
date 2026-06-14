import type { ValkeyService } from "../valkey.service";
import { RateLimitCacheService } from "./rate-limit-cache.service";

function buildHarness(opts: { incrCounts?: number[]; ttl?: number } = {}) {
  const incrSequence = opts.incrCounts ?? [1];
  let i = 0;
  const valkey = {
    incr: jest.fn(async () => {
      await Promise.resolve();
      const v = incrSequence[i] ?? incrSequence[incrSequence.length - 1];
      i++;
      return v;
    }),
    expire: jest.fn(async () => true),
    ttl: jest.fn(async () => opts.ttl ?? 30),
    del: jest.fn(async () => 1),
  } as unknown as ValkeyService;
  return { svc: new RateLimitCacheService(valkey), valkey };
}

describe("RateLimitCacheService.checkRateLimit", () => {
  it("first call sets EXPIRE and returns allowed=true", async () => {
    const { svc, valkey } = buildHarness({ incrCounts: [1] });
    const out = await svc.checkRateLimit("user_1", 5, 60_000);
    expect(out.allowed).toBe(true);
    expect(out.remaining).toBe(4);
    expect(valkey.expire).toHaveBeenCalled();
  });

  it("subsequent calls do NOT call EXPIRE again", async () => {
    const { svc, valkey } = buildHarness({ incrCounts: [2, 3] });
    await svc.checkRateLimit("user_2", 5, 60_000);
    await svc.checkRateLimit("user_2", 5, 60_000);
    expect(valkey.expire).not.toHaveBeenCalled();
  });

  it("returns allowed=false when count exceeds maxRequests", async () => {
    const { svc } = buildHarness({ incrCounts: [11] });
    const out = await svc.checkRateLimit("user_3", 10, 60_000);
    expect(out.allowed).toBe(false);
    expect(out.remaining).toBe(0);
  });

  it("falls open (allowed=true) when valkey throws", async () => {
    const { svc, valkey } = buildHarness();
    (valkey.incr as jest.Mock).mockRejectedValueOnce(new Error("boom"));
    const out = await svc.checkRateLimit("user_4", 5, 60_000);
    expect(out.allowed).toBe(true);
    expect(out.remaining).toBe(4);
  });

  it("computes resetAt from current TTL when present", async () => {
    const before = Date.now();
    const { svc } = buildHarness({ incrCounts: [2], ttl: 10 });
    const out = await svc.checkRateLimit("user_5", 5, 60_000);
    expect(out.resetAt).toBeGreaterThanOrEqual(before + 9_000);
  });
});

describe("RateLimitCacheService.resetRateLimit", () => {
  it("DELs the rate-limit key", async () => {
    const { svc, valkey } = buildHarness();
    await svc.resetRateLimit("user_x");
    expect(valkey.del).toHaveBeenCalledWith("rate-limit:user_x");
  });
});
