import type { ValkeyService } from "../valkey.service";
import { CacheManagerService } from "./cache-manager.service";

function buildHarness() {
  const store = new Map<string, string>();
  const valkey = {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => {
      await Promise.resolve();
      store.set(k, v);
      return true;
    }),
    del: jest.fn(async (k: string) => store.delete(k)),
    mget: jest.fn(async (keys: string[]) => keys.map((k) => store.get(k) ?? null)),
    mset: jest.fn(async (entries: Record<string, string>) => {
      await Promise.resolve();
      for (const [k, v] of Object.entries(entries)) store.set(k, v);
      return true;
    }),
    expire: jest.fn(async () => true),
    exists: jest.fn(async (k: string) => store.has(k)),
    ttl: jest.fn(async () => 100),
    incr: jest.fn(async () => 1),
    decr: jest.fn(async () => 0),
    unlinkBatch: jest.fn(async (keys: string[]) => {
      await Promise.resolve();
      for (const k of keys) store.delete(k);
    }),
    customCommand: jest.fn(async (args: string[]) => {
      await Promise.resolve();
      if (args[0] === "SCAN") {
        return ["0", Array.from(store.keys())];
      }
      if (args[0] === "INCRBY") {
        return Number(args[2]);
      }
      if (args[0] === "DECRBY") {
        return -Number(args[2]);
      }
      return null;
    }),
  } as unknown as ValkeyService;

  return { svc: new CacheManagerService(valkey), valkey, store };
}

describe("CacheManagerService.buildKey / buildPattern", () => {
  it("buildKey joins parts with ':'", () => {
    const { svc } = buildHarness();
    expect(svc.buildKey("product", 123, "details")).toBe("product:123:details");
  });

  it("buildPattern is the identity (no transformation)", () => {
    const { svc } = buildHarness();
    expect(svc.buildPattern("product:*")).toBe("product:*");
  });
});

describe("CacheManagerService.cacheAside", () => {
  it("returns the unwrapped value on a HIT and never calls the fallback", async () => {
    const { svc, store } = buildHarness();
    store.set(
      "k",
      JSON.stringify({ data: { x: 1 }, metadata: { cachedAt: 0, version: "1.0" } }),
    );
    const fallback = jest.fn(async () => ({ x: 9 }));
    const out = await svc.cacheAside("k", fallback);
    expect(out).toEqual({ x: 1 });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back on MISS and writes the response into cache", async () => {
    const { svc, valkey } = buildHarness();
    const out = await svc.cacheAside("missing", async () => ({ y: 2 }), { ttl: 60 });
    expect(out).toEqual({ y: 2 });
    // Set is fire-and-forget — flush the microtask queue before asserting.
    await new Promise((r) => setImmediate(r));
    expect(valkey.set).toHaveBeenCalled();
  });

  it("fails open (calls fallback) when valkey.get throws", async () => {
    const { svc, valkey } = buildHarness();
    (valkey.get as jest.Mock).mockRejectedValueOnce(new Error("boom"));
    const out = await svc.cacheAside("err", async () => ({ z: 3 }));
    expect(out).toEqual({ z: 3 });
  });

  it("uses prefix when supplied (built into the key)", async () => {
    const { svc, valkey } = buildHarness();
    await svc.cacheAside("k", async () => ({ a: 1 }), { prefix: "ns" });
    expect(valkey.get).toHaveBeenCalledWith("ns:k");
  });
});

describe("CacheManagerService.invalidate / invalidateKeys / invalidatePattern", () => {
  it("invalidatePattern returns 0 when SCAN finds no keys", async () => {
    const { svc, valkey } = buildHarness();
    (valkey.customCommand as jest.Mock).mockResolvedValueOnce(["0", []]);
    const out = await svc.invalidatePattern("user:nope:*");
    expect(out).toBe(0);
  });

  it("invalidatePattern unlinks all keys returned by SCAN", async () => {
    const { svc, valkey, store } = buildHarness();
    store.set("a", "x");
    store.set("b", "y");
    const out = await svc.invalidatePattern("*");
    expect(out).toBeGreaterThanOrEqual(0);
    expect(valkey.unlinkBatch).toHaveBeenCalled();
  });

  it("invalidateKeys swallows errors", async () => {
    const { svc, valkey } = buildHarness();
    (valkey.unlinkBatch as jest.Mock).mockRejectedValueOnce(new Error("x"));
    await expect(svc.invalidateKeys(["a", "b"])).resolves.toBeUndefined();
  });
});

describe("CacheManagerService.increment / decrement", () => {
  it("increment by 1 uses INCR (no INCRBY)", async () => {
    const { svc, valkey } = buildHarness();
    await svc.increment("counter");
    expect(valkey.incr).toHaveBeenCalledWith("counter");
  });

  it("increment by N uses INCRBY", async () => {
    const { svc, valkey } = buildHarness();
    const out = await svc.increment("counter", 5);
    expect(valkey.customCommand).toHaveBeenCalledWith(["INCRBY", "counter", "5"]);
    expect(out).toBe(5);
  });

  it("decrement by 1 uses DECR", async () => {
    const { svc, valkey } = buildHarness();
    await svc.decrement("c");
    expect(valkey.decr).toHaveBeenCalledWith("c");
  });
});

describe("CacheManagerService.writeThrough", () => {
  it("writes to db first, then fires cache update without blocking", async () => {
    const { svc, valkey } = buildHarness();
    const writer = jest.fn(async () => ({ saved: true }));
    const out = await svc.writeThrough("k", null, writer, 30);
    expect(writer).toHaveBeenCalled();
    expect(out).toEqual({ saved: true });
    await new Promise((r) => setImmediate(r));
    expect(valkey.set).toHaveBeenCalled();
  });
});

describe("CacheManagerService.mget / mset / TTL helpers", () => {
  it("mget unwraps cached entries and skips missing", async () => {
    const { svc, store } = buildHarness();
    store.set(
      "a",
      JSON.stringify({ data: 1, metadata: { cachedAt: 0, version: "1.0" } }),
    );
    const out = await svc.mget<number>(["a", "b"]);
    expect(out.get("a")).toBe(1);
    expect(out.has("b")).toBe(false);
  });

  it("mset wraps + sets, then sets TTL on each key when ttl provided", async () => {
    const { svc, valkey } = buildHarness();
    await svc.mset(new Map([["a", 1], ["b", 2]]), 60);
    expect(valkey.mset).toHaveBeenCalled();
    expect(valkey.expire).toHaveBeenCalledTimes(2);
  });

  it("getTTL returns null on error", async () => {
    const { svc, valkey } = buildHarness();
    (valkey.ttl as jest.Mock).mockRejectedValueOnce(new Error("ttl-err"));
    const out = await svc.getTTL("k");
    expect(out).toBeNull();
  });

  it("exists returns false on error", async () => {
    const { svc, valkey } = buildHarness();
    (valkey.exists as jest.Mock).mockRejectedValueOnce(new Error("ex-err"));
    expect(await svc.exists("k")).toBe(false);
  });
});
