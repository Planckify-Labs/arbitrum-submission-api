import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { CacheManagerService } from "../valkey/services/cache-manager.service";
import { FlashSalesService } from "./flash-sales.service";

function makeFlashSale(overrides: Record<string, unknown> = {}) {
  return {
    id: "fs_1",
    productVariantId: "pv_1",
    productPriceId: "pp_1",
    discountedPrice: "8000",
    currency: "IDR",
    startsAt: new Date("2026-01-01"),
    endsAt: new Date("2026-12-31"),
    maxRedemptions: 100,
    currentRedemptions: 0,
    isActive: true,
    productVariant: {
      id: "pv_1",
      name: "Variant",
      variantCode: "VC",
      product: {
        id: "p_1",
        name: "Product",
        imageUrl: null,
        code: "P1",
      },
    },
    productPrice: {
      id: "pp_1",
      sellPrice: "10000",
      currency: "IDR",
    },
    createdAt: new Date(),
    ...overrides,
  };
}

function buildHarness(opts: {
  flashSales?: ReturnType<typeof makeFlashSale>[];
  one?: ReturnType<typeof makeFlashSale> | null;
} = {}) {
  const sales = opts.flashSales ?? [];
  const prisma = {
    flashSale: {
      findMany: jest.fn(async () => sales),
      findUnique: jest.fn(async () => opts.one ?? null),
      count: jest.fn(async () => sales.length),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) =>
        makeFlashSale({ ...data }),
      ),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) =>
        makeFlashSale({ ...(opts.one ?? {}), ...data }),
      ),
      delete: jest.fn(async () => makeFlashSale()),
    },
  } as unknown as PrismaService;

  const cacheManager = {
    cacheAside: jest.fn(async (_key: string, fn: () => unknown) => fn()),
    invalidate: jest.fn(async () => undefined),
  } as unknown as CacheManagerService;

  return { svc: new FlashSalesService(prisma, cacheManager), prisma, cacheManager };
}

describe("FlashSalesService.findActive", () => {
  it("queries with isActive + window contains now and maps savings/discount%", async () => {
    const { svc, prisma } = buildHarness({
      flashSales: [makeFlashSale()],
    });
    const out = await svc.findActive();
    expect(out).toHaveLength(1);
    expect(out[0].savings).toBe("2000.00");
    expect(out[0].discountPercent).toBe(20);

    const findMany = (prisma.flashSale.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.isActive).toBe(true);
    expect(findMany.where.startsAt.lte).toBeInstanceOf(Date);
    expect(findMany.where.endsAt.gte).toBeInstanceOf(Date);
  });

  it("returns 0 discountPercent when sellPrice is zero (no division by zero)", async () => {
    const { svc } = buildHarness({
      flashSales: [
        makeFlashSale({
          productPrice: { id: "pp", sellPrice: "0", currency: "IDR" },
          discountedPrice: "0",
        }),
      ],
    });
    const out = await svc.findActive();
    expect(out[0].discountPercent).toBe(0);
  });
});

describe("FlashSalesService.findAll (admin pagination)", () => {
  it("page=1 has skip=0", async () => {
    const { svc, prisma } = buildHarness({ flashSales: [makeFlashSale()] });
    await svc.findAll(1);
    const findMany = (prisma.flashSale.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.skip).toBe(0);
  });

  it("page=3 with limit=20 produces skip=40", async () => {
    const { svc, prisma } = buildHarness({ flashSales: [] });
    await svc.findAll(3);
    const findMany = (prisma.flashSale.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.skip).toBe(40);
  });
});

describe("FlashSalesService.findOne", () => {
  it("404s when missing", async () => {
    const { svc } = buildHarness({ one: null });
    await expect(svc.findOne("fs_x")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("FlashSalesService.create", () => {
  it("rejects when endsAt <= startsAt (400)", async () => {
    const { svc } = buildHarness();
    await expect(
      svc.create({
        productVariantId: "pv",
        productPriceId: "pp",
        discountedPrice: "1",
        currency: "IDR",
        startsAt: "2026-12-31",
        endsAt: "2026-01-01",
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("creates and invalidates the active-sales cache", async () => {
    const { svc, cacheManager } = buildHarness();
    await svc.create({
      productVariantId: "pv",
      productPriceId: "pp",
      discountedPrice: "1",
      currency: "IDR",
      startsAt: "2026-01-01",
      endsAt: "2026-12-31",
    } as never);
    expect(cacheManager.invalidate).toHaveBeenCalledWith("flash-sales:active");
  });
});

describe("FlashSalesService.update", () => {
  it("404s when not found", async () => {
    const { svc } = buildHarness({ one: null });
    await expect(svc.update("fs_x", {} as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("inherits the existing window unless overridden, and rejects if effective endsAt <= startsAt", async () => {
    const { svc } = buildHarness({
      one: makeFlashSale({
        startsAt: new Date("2026-06-01"),
        endsAt: new Date("2026-07-01"),
      }),
    });
    // overriding endsAt to a date before existing startsAt should fail
    await expect(
      svc.update("fs_1", { endsAt: "2026-05-01" } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("invalidates the cache after a successful update", async () => {
    const { svc, cacheManager } = buildHarness({ one: makeFlashSale() });
    await svc.update("fs_1", { isActive: false } as never);
    expect(cacheManager.invalidate).toHaveBeenCalledWith("flash-sales:active");
  });
});

describe("FlashSalesService.remove", () => {
  it("404s when not found", async () => {
    const { svc } = buildHarness({ one: null });
    await expect(svc.remove("fs_x")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("deletes and invalidates the cache when present", async () => {
    const { svc, prisma, cacheManager } = buildHarness({ one: makeFlashSale() });
    await svc.remove("fs_1");
    expect(prisma.flashSale.delete).toHaveBeenCalled();
    expect(cacheManager.invalidate).toHaveBeenCalledWith("flash-sales:active");
  });
});
