import { NotFoundException, BadRequestException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { VCGamersService } from "../providers/vendor-api/implementations/vcgamers/vcgamers.service";
import type { ProductCacheService } from "../valkey/services/product-cache.service";
import type { CacheManagerService } from "../valkey/services/cache-manager.service";
import { ProductsService } from "./products.service";

/**
 * ProductsService unit tests.
 *
 * The service has many caching layers (productCache, cacheManager) so the
 * harness uses pass-through stubs that defer to the underlying fallback.
 * Tests focus on:
 *   • the search/filter composition (high blast-radius for the home screen),
 *   • prerequisite checks before mutations,
 *   • cache invalidation around create/update/delete (sysadmin contract).
 */

function passThroughCache<T = unknown>() {
  return jest.fn(async (_id: string, fallback: () => Promise<T>) => fallback());
}

function buildHarness(
  opts: {
    products?: Record<string, unknown>[];
    productById?: Record<string, unknown> | null;
    productByCode?: Record<string, unknown> | null;
    variant?: Record<string, unknown> | null;
    variantById?: Record<string, unknown> | null;
    productInputField?: Record<string, unknown> | null;
    purchaseGroup?: Record<string, unknown>[];
    redemptionGroup?: Record<string, unknown>[];
  } = {},
) {
  const products = opts.products ?? [];
  const prisma = {
    product: {
      findMany: jest.fn(async () => products),
      count: jest.fn(async () => products.length),
      findUnique: jest.fn(async () => opts.productById ?? null),
      findFirst: jest.fn(async () => opts.productByCode ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "prod_new",
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "prod_x",
        ...data,
      })),
      delete: jest.fn(async () => ({ id: "prod_x" })),
    },
    productVariant: {
      findUnique: jest.fn(async () => opts.variantById ?? opts.variant ?? null),
      findMany: jest.fn(async () => []),
    },
    productPrice: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "pp_new",
        ...data,
        productVariant: { productId: "prod_x" },
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "pp_x",
        ...data,
        productVariant: { productId: "prod_x" },
      })),
      delete: jest.fn(async () => ({ id: "pp_x" })),
      findUnique: jest.fn(async () => ({
        id: "pp_x",
        productVariant: { productId: "prod_x" },
      })),
    },
    productInputField: {
      findFirst: jest.fn(async () => opts.productInputField ?? null),
      create: jest.fn(async () => ({ id: "if_new" })),
      update: jest.fn(async () => ({ id: "if_new" })),
      delete: jest.fn(async () => ({ id: "if_new" })),
    },
    category: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => ({
        id: "cat_x",
        name: "Cat",
        Product: [],
      })),
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "cat_new",
        ...data,
        Product: [],
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "cat_x",
        ...data,
        Product: [],
      })),
      delete: jest.fn(async () => ({ id: "cat_x" })),
    },
    purchase: {
      groupBy: jest.fn(async () => opts.purchaseGroup ?? []),
      count: jest.fn(async () => 0),
    },
    pointRedemption: {
      groupBy: jest.fn(async () => opts.redemptionGroup ?? []),
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    },
    bookingOrder: { findMany: jest.fn(async () => []) },
  } as unknown as PrismaService;

  const vcGamersService = {} as VCGamersService;

  const productCache = {
    getProductList: passThroughCache(),
    getProductsByCategory: passThroughCache(),
    getProductByCode: passThroughCache(),
    getProductPrices: passThroughCache(),
    getProductDetails: passThroughCache(),
    getProductVariants: passThroughCache(),
    getCatalogGrouped: jest.fn(async (fallback: () => unknown) => fallback()),
    invalidateProduct: jest.fn(async () => undefined),
    invalidateCategory: jest.fn(async () => undefined),
  } as unknown as ProductCacheService;

  const cacheManager = {
    cacheAside: jest.fn(async (_key: string, fn: () => unknown) => fn()),
  } as unknown as CacheManagerService;

  const svc = new ProductsService(
    prisma,
    vcGamersService,
    productCache,
    cacheManager,
  );
  return { svc, prisma, productCache, cacheManager };
}

describe("ProductsService.findAll", () => {
  it("paginates with cursor (skip=1) when no skip is given", async () => {
    const { svc, prisma } = buildHarness({
      products: [{ id: "a" }, { id: "b" }],
    });
    await svc.findAll({ cursor: "x", take: 5 });
    const findMany = (prisma.product.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.skip).toBe(1);
    expect(findMany.cursor).toEqual({ id: "x" });
  });

  it("uses skip pagination when skip > 0 (ignoring cursor)", async () => {
    const { svc, prisma } = buildHarness();
    await svc.findAll({ cursor: "x", skip: 20, take: 10 });
    const findMany = (prisma.product.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.skip).toBe(20);
    expect(findMany.cursor).toBeUndefined();
  });
});

describe("ProductsService.search", () => {
  it("composes id/code/name/active/isVoucher and applies vendorName as nested filter", async () => {
    const { svc, prisma } = buildHarness();
    await svc.search(
      {
        id: "p1",
        code: "ML",
        name: "Mobile",
        active: true,
        isVoucher: false,
        vendorName: "VC",
      } as never,
      {},
    );
    const findMany = (prisma.product.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.id).toBe("p1");
    expect(findMany.where.code).toEqual({
      contains: "ML",
      mode: "insensitive",
    });
    expect(findMany.where.name).toEqual({
      contains: "Mobile",
      mode: "insensitive",
    });
    expect(findMany.where.isActive).toBe(true);
    expect(findMany.where.isVoucher).toBe(false);
    expect(
      findMany.where.variants.some.ProductPrice.some.vendor.name.contains,
    ).toBe("VC");
  });

  it("uses generic OR query only when no specific filter is given", async () => {
    const { svc, prisma } = buildHarness();
    await svc.search({ query: "MLBB" } as never, {});
    const findMany = (prisma.product.findMany as jest.Mock).mock.calls[0][0];
    // OR spans name, code, category name, and vendor name.
    expect(findMany.where.OR).toHaveLength(4);
    expect(findMany.where.OR).toContainEqual({
      category: { name: { contains: "MLBB", mode: "insensitive" } },
    });
  });

  it("filters by categoryId and categoryName when provided", async () => {
    const { svc, prisma } = buildHarness();
    await svc.search(
      { categoryId: "cat-1", categoryName: "gaming" } as never,
      {},
    );
    const findMany = (prisma.product.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.categoryId).toBe("cat-1");
    expect(findMany.where.category.name.contains).toBe("gaming");
  });

  it("does NOT add OR query when id/code/name is also given (specific wins)", async () => {
    const { svc, prisma } = buildHarness();
    await svc.search({ query: "ignored", code: "ML" } as never, {});
    const findMany = (prisma.product.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.OR).toBeUndefined();
  });

  it("vendorId overrides vendorName variant-filter (last spread wins)", async () => {
    const { svc, prisma } = buildHarness();
    await svc.search({ vendorName: "X", vendorId: "v1" } as never, {});
    const findMany = (prisma.product.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.variants.some.ProductPrice.some.vendorId).toBe("v1");
  });

  it("filters by a points range on active variant prices", async () => {
    const { svc, prisma } = buildHarness();
    await svc.search({ minPoints: 1000, maxPoints: 2300 } as never, {});
    const findMany = (prisma.product.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.AND[0]).toEqual({
      variants: {
        some: {
          isActive: true,
          ProductPrice: {
            some: { isActive: true, sellPrice: { gte: 1000, lte: 2300 } },
          },
        },
      },
    });
  });

  it("supports an open-ended max points filter ('under N points')", async () => {
    const { svc, prisma } = buildHarness();
    await svc.search({ maxPoints: 2300 } as never, {});
    const findMany = (prisma.product.findMany as jest.Mock).mock.calls[0][0];
    const sellPrice =
      findMany.where.AND[0].variants.some.ProductPrice.some.sellPrice;
    expect(sellPrice).toEqual({ lte: 2300 });
  });

  it("composes points range with a text query (AND + OR coexist)", async () => {
    const { svc, prisma } = buildHarness();
    await svc.search({ query: "diamond", maxPoints: 5000 } as never, {});
    const findMany = (prisma.product.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.OR).toHaveLength(4);
    expect(
      findMany.where.AND[0].variants.some.ProductPrice.some.sellPrice,
    ).toEqual({ lte: 5000 });
  });

  it("orders results cheapest-first for a points query", async () => {
    const mk = (id: string, points: number) => ({
      id,
      variants: [
        {
          isActive: true,
          ProductPrice: [{ isActive: true, sellPrice: points }],
        },
      ],
    });
    const { svc } = buildHarness({
      products: [mk("a", 5000), mk("b", 1000), mk("c", 3000)],
    });
    const { items } = await svc.search({ maxPoints: 5000 } as never, {});
    expect(items.map((i: { id: string }) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts unpriced products last in a points query", async () => {
    const priced = {
      id: "priced",
      variants: [
        { isActive: true, ProductPrice: [{ isActive: true, sellPrice: 2000 }] },
      ],
    };
    const unpriced = { id: "unpriced", variants: [] };
    const { svc } = buildHarness({ products: [unpriced, priced] });
    const { items } = await svc.search({ maxPoints: 5000 } as never, {});
    expect(items.map((i: { id: string }) => i.id)).toEqual([
      "priced",
      "unpriced",
    ]);
  });
});

describe("ProductsService.findAllCategories", () => {
  it("returns only active categories by default", async () => {
    const { svc, prisma } = buildHarness();
    await svc.findAllCategories({});
    const findMany = (prisma.category.findMany as jest.Mock).mock.calls[0][0];
    const count = (prisma.category.count as jest.Mock).mock.calls[0][0];
    expect(findMany.where).toEqual({ isActive: true });
    expect(count.where).toEqual({ isActive: true });
  });

  it("includes inactive categories when opted in", async () => {
    const { svc, prisma } = buildHarness();
    await svc.findAllCategories({}, true);
    const findMany = (prisma.category.findMany as jest.Mock).mock.calls[0][0];
    const count = (prisma.category.count as jest.Mock).mock.calls[0][0];
    expect(findMany.where).toEqual({});
    expect(count.where).toEqual({});
  });
});

describe("ProductsService.findByCode", () => {
  it("404s when not found", async () => {
    const { svc } = buildHarness({ productByCode: null });
    await expect(svc.findByCode("NONE")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("returns the product when found", async () => {
    const { svc } = buildHarness({
      productByCode: { id: "p", code: "MLBB", name: "ML" },
    });
    const out = await svc.findByCode("MLBB");
    expect(out.id).toBe("p");
  });
});

describe("ProductsService.findPrices", () => {
  it("404s when product missing", async () => {
    const { svc } = buildHarness({ productById: null });
    await expect(svc.findPrices("p")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("flattens variant.ProductPrice arrays", async () => {
    const { svc } = buildHarness({
      productById: {
        id: "p",
        variants: [
          { ProductPrice: [{ id: "pp1" }] },
          { ProductPrice: [{ id: "pp2" }, { id: "pp3" }] },
        ],
      },
    });
    const prices = await svc.findPrices("p");
    expect(prices).toHaveLength(3);
  });
});

describe("ProductsService.createPrice / updatePrice / removePrice", () => {
  it("createPrice 404s when variant missing", async () => {
    const { svc } = buildHarness({ variant: null });
    await expect(
      svc.createPrice("pv_x", { sellPrice: 100, currency: "IDR" } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("createPrice invalidates the product cache after success", async () => {
    const { svc, productCache } = buildHarness({
      variant: { id: "pv_1", productId: "prod_1" },
    });
    await svc.createPrice("pv_1", { sellPrice: 100, currency: "IDR" } as never);
    expect(productCache.invalidateProduct).toHaveBeenCalledWith("prod_1");
  });

  it("updatePrice invalidates cache for the parent productId", async () => {
    const { svc, productCache } = buildHarness();
    await svc.updatePrice("pp_x", { sellPrice: 200 } as never);
    expect(productCache.invalidateProduct).toHaveBeenCalledWith("prod_x");
  });

  it("removePrice invalidates cache for the parent productId", async () => {
    const { svc, productCache } = buildHarness();
    await svc.removePrice("pp_x");
    expect(productCache.invalidateProduct).toHaveBeenCalledWith("prod_x");
  });
});

describe("ProductsService.findOne", () => {
  it("404s when not found", async () => {
    const { svc } = buildHarness({ productById: null });
    await expect(svc.findOne("missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("returns the product when found", async () => {
    const { svc } = buildHarness({ productById: { id: "p", name: "X" } });
    const out = await svc.findOne("p");
    expect(out.id).toBe("p");
  });
});

describe("ProductsService.create / update / remove", () => {
  it("create invalidates the catalog cache", async () => {
    const { svc, productCache } = buildHarness();
    await svc.create({ name: "X" } as never);
    expect(productCache.invalidateProduct).toHaveBeenCalledWith();
  });

  it("update invalidates the specific-product cache", async () => {
    const { svc, productCache } = buildHarness();
    await svc.update("p_1", { name: "Y" } as never);
    expect(productCache.invalidateProduct).toHaveBeenCalledWith("p_1");
  });

  it("remove invalidates the specific-product cache", async () => {
    const { svc, productCache } = buildHarness();
    await svc.remove("p_1");
    expect(productCache.invalidateProduct).toHaveBeenCalledWith("p_1");
  });
});

describe("ProductsService.findVariants", () => {
  it("404s when product missing", async () => {
    const { svc } = buildHarness({ productById: null });
    await expect(svc.findVariants("p_x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("returns variants when product exists", async () => {
    const { svc } = buildHarness({ productById: { id: "p_x" } });
    const out = await svc.findVariants("p_x");
    expect(out).toEqual([]);
  });
});

describe("ProductsService.findOneVariant", () => {
  it("404s when variant missing", async () => {
    const { svc } = buildHarness({ variant: null });
    await expect(svc.findOneVariant("v_x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("ProductsService.searchVariants", () => {
  it("composes variantCode/name/productId/isActive into where", async () => {
    const { svc, prisma } = buildHarness();
    await svc.searchVariants(
      {
        variantCode: "ML",
        name: "Diamond",
        productId: "p_1",
        isActive: true,
      } as never,
      {},
    );
    const findMany = (prisma.productVariant.findMany as jest.Mock).mock
      .calls[0][0];
    expect(findMany.where.variantCode).toEqual({
      contains: "ML",
      mode: "insensitive",
    });
    expect(findMany.where.productId).toBe("p_1");
    expect(findMany.where.isActive).toBe(true);
  });

  it("uses OR query only when neither variantCode nor name is given", async () => {
    const { svc, prisma } = buildHarness();
    await svc.searchVariants({ query: "X" } as never, {});
    const findMany = (prisma.productVariant.findMany as jest.Mock).mock
      .calls[0][0];
    expect(findMany.where.OR).toHaveLength(2);
  });
});

describe("ProductsService.createProductInputField", () => {
  it("404s when product missing", async () => {
    const { svc } = buildHarness({ productById: null });
    await expect(
      svc.createProductInputField("p_x", { fields: [{ key: "x" }] } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("creates and invalidates product cache", async () => {
    const { svc, productCache } = buildHarness({ productById: { id: "p" } });
    await svc.createProductInputField("p", { fields: [{ key: "x" }] } as never);
    expect(productCache.invalidateProduct).toHaveBeenCalledWith("p");
  });
});

describe("ProductsService.updateProductInputField / deleteProductInputField", () => {
  it("update 404s when field missing for that product", async () => {
    const { svc } = buildHarness({ productInputField: null });
    await expect(
      svc.updateProductInputField("p", "f", {
        fields: [{ key: "x" }],
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("update rejects when fields list is empty", async () => {
    const { svc } = buildHarness({
      productInputField: { id: "f", productId: "p", forms: [] },
    });
    await expect(
      svc.updateProductInputField("p", "f", { fields: [] } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("delete 404s when field missing", async () => {
    const { svc } = buildHarness({ productInputField: null });
    await expect(svc.deleteProductInputField("p", "f")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("ProductsService.getRecommendations", () => {
  it("returns empty when no purchases and no fallback products exist", async () => {
    const { svc } = buildHarness();
    const out = await svc.getRecommendations(5);
    expect(out).toEqual([]);
  });

  it("ranks by purchase count, deduping by productId", async () => {
    const { svc, prisma } = buildHarness({
      purchaseGroup: [
        { productVariantId: "v1", _count: { productVariantId: 100 } },
        { productVariantId: "v2", _count: { productVariantId: 50 } },
      ],
    });
    (prisma.productVariant.findMany as jest.Mock).mockResolvedValueOnce([
      { id: "v1", productId: "p1" },
      { id: "v2", productId: "p1" }, // duplicate product → deduped
    ]);
    (prisma.product.findMany as jest.Mock)
      .mockResolvedValueOnce([
        { id: "p1", name: "P1", variants: [{ ProductPrice: [] }] },
      ])
      .mockResolvedValueOnce([]); // no fallback needed past limit

    const out = await svc.getRecommendations(1);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("p1");
  });
});

describe("ProductsService.getSearchSuggestions", () => {
  it("returns [] for empty/whitespace query", async () => {
    const { svc } = buildHarness();
    expect(await svc.getSearchSuggestions("")).toEqual([]);
    expect(await svc.getSearchSuggestions("   ")).toEqual([]);
  });

  it("queries with startsWith on name and code", async () => {
    const { svc, prisma } = buildHarness();
    await svc.getSearchSuggestions("ML");
    const findMany = (prisma.product.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.OR[0]).toEqual({
      name: { startsWith: "ML", mode: "insensitive" },
    });
    expect(findMany.where.OR[1]).toEqual({
      code: { startsWith: "ML", mode: "insensitive" },
    });
    expect(findMany.take).toBe(8);
  });
});

describe("ProductsService.getProductStats", () => {
  it("404s when product missing", async () => {
    const { svc } = buildHarness({ productById: null });
    await expect(svc.getProductStats("p_x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("returns zeroed stats when product has no active variants", async () => {
    const { svc, prisma } = buildHarness({ productById: { id: "p" } });
    (prisma.productVariant.findMany as jest.Mock).mockResolvedValueOnce([]);
    const stats = await svc.getProductStats("p");
    expect(stats).toEqual({
      productId: "p",
      totalSales: 0,
      totalPurchases: 0,
      totalRedemptions: 0,
      salesToday: 0,
    });
  });

  it("aggregates purchase + redemption counts when variants exist", async () => {
    const { svc, prisma } = buildHarness({ productById: { id: "p" } });
    (prisma.productVariant.findMany as jest.Mock).mockResolvedValueOnce([
      { id: "v1" },
      { id: "v2" },
    ]);
    (prisma.purchase.count as jest.Mock)
      .mockResolvedValueOnce(10) // total purchases
      .mockResolvedValueOnce(2); // today purchases
    (prisma.pointRedemption.count as jest.Mock)
      .mockResolvedValueOnce(3) // total redemptions
      .mockResolvedValueOnce(1); // today redemptions
    const stats = await svc.getProductStats("p");
    expect(stats.totalSales).toBe(13);
    expect(stats.salesToday).toBe(3);
  });
});
