import type { CacheManagerService } from "./cache-manager.service";
import { BookingCacheService } from "./booking-cache.service";

function buildHarness() {
  const cacheManager = {
    buildKey: jest.fn((...parts: (string | number)[]) => parts.join(":")),
    buildPattern: jest.fn((p: string) => p),
    cacheAside: jest.fn(async (_k: string, fn: () => unknown) => fn()),
    invalidatePattern: jest.fn(async () => 0),
    invalidateKeys: jest.fn(async () => undefined),
    writeThrough: jest.fn(async (_k: string, _d: unknown, fn: () => unknown) => fn()),
    set: jest.fn(async () => undefined),
    exists: jest.fn(async () => false),
  } as unknown as CacheManagerService;

  return { svc: new BookingCacheService(cacheManager), cacheManager };
}

describe("BookingCacheService key construction", () => {
  it("getBooking uses key 'booking:<id>'", async () => {
    const { svc, cacheManager } = buildHarness();
    await svc.getBooking(123, async () => "data");
    expect(cacheManager.buildKey).toHaveBeenCalledWith("booking", 123);
  });

  it("getBookingByRef uses key 'booking:ref:<refId>'", async () => {
    const { svc, cacheManager } = buildHarness();
    await svc.getBookingByRef("ref_x", async () => "data");
    expect(cacheManager.buildKey).toHaveBeenCalledWith("booking", "ref", "ref_x");
  });

  it("getLatestBooking lowercases EVM address in key", async () => {
    const { svc, cacheManager } = buildHarness();
    await svc.getLatestBooking("0xABCD", async () => "data");
    expect(cacheManager.buildKey).toHaveBeenCalledWith(
      "user",
      "0xabcd",
      "bookings",
      "latest",
    );
  });
});

describe("BookingCacheService.invalidateBooking", () => {
  it("invalidates only specific booking when id given", async () => {
    const { svc, cacheManager } = buildHarness();
    await svc.invalidateBooking("b_1");
    expect(cacheManager.invalidatePattern).toHaveBeenCalledWith("booking:b_1*");
  });

  it("invalidates all bookings when no id given", async () => {
    const { svc, cacheManager } = buildHarness();
    await svc.invalidateBooking();
    expect(cacheManager.invalidatePattern).toHaveBeenCalledWith("booking:*");
  });

  it("also invalidates user-bookings pattern when wallet given", async () => {
    const { svc, cacheManager } = buildHarness();
    await svc.invalidateBooking("b_1", "0xABCD");
    expect(cacheManager.invalidatePattern).toHaveBeenCalledWith(
      "user:0xabcd:bookings:*",
    );
  });
});

describe("BookingCacheService.batchInvalidateBookings", () => {
  it("builds keys and forwards to invalidateKeys", async () => {
    const { svc, cacheManager } = buildHarness();
    await svc.batchInvalidateBookings([1, 2, 3]);
    expect(cacheManager.invalidateKeys).toHaveBeenCalledWith([
      "booking:1",
      "booking:2",
      "booking:3",
    ]);
  });
});
