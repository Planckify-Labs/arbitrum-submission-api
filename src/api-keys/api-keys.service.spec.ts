import { ConflictException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { VendorAPICacheService } from "../valkey/services/vendor-api-cache.service";
import { ApiKeysService } from "./api-keys.service";

function makeKey(overrides: Record<string, unknown> = {}) {
  return {
    id: "ak_1",
    name: "test-key",
    description: "",
    keyValue: "tk_abcdefghijklmnopqrstuvwxyz1234567890",
    type: "INTERNAL",
    permissions: [],
    rateLimit: null,
    expiresAt: null,
    metadata: {},
    status: "ACTIVE",
    createdById: null,
    createdBy: null,
    lastUsedAt: null,
    usageCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildHarness(opts: {
  existingKey?: ReturnType<typeof makeKey> | null;
  duplicateName?: ReturnType<typeof makeKey> | null;
  keys?: ReturnType<typeof makeKey>[];
} = {}) {
  const keys = opts.keys ?? [];
  const prisma = {
    apiKey: {
      findFirst: jest.fn(async () => opts.duplicateName ?? null),
      findUnique: jest.fn(async () => opts.existingKey ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) =>
        makeKey({ ...data }),
      ),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) =>
        makeKey({ ...(opts.existingKey ?? {}), ...data }),
      ),
      delete: jest.fn(async () => makeKey()),
      findMany: jest.fn(async () => keys),
      count: jest.fn(async () => keys.length),
    },
  } as unknown as PrismaService;

  const cache = {
    invalidateVendorAPICache: jest.fn(async () => undefined),
    getVendorAPI: jest.fn(async () => null),
  } as unknown as VendorAPICacheService;

  return { svc: new ApiKeysService(prisma, cache), prisma, cache };
}

describe("ApiKeysService.create", () => {
  it("rejects duplicate name (409) without inserting", async () => {
    const { svc, prisma } = buildHarness({ duplicateName: makeKey() });
    await expect(
      svc.create({ name: "test-key", type: "INTERNAL" } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.apiKey.create).not.toHaveBeenCalled();
  });

  it("generates a tk_-prefixed 64-hex value and returns it unmasked on create", async () => {
    const { svc, prisma } = buildHarness();
    const out = await svc.create({
      name: "fresh-key",
      type: "INTERNAL",
    } as never);
    const create = (prisma.apiKey.create as jest.Mock).mock.calls[0][0];
    expect(create.data.keyValue).toMatch(/^tk_[0-9a-f]{64}$/);
    expect(out.keyValue).toMatch(/^tk_[0-9a-f]{64}$/);
  });

  it("converts expiresAt string to Date", async () => {
    const { svc, prisma } = buildHarness();
    await svc.create({
      name: "exp-key",
      type: "INTERNAL",
      expiresAt: "2027-01-01",
    } as never);
    const create = (prisma.apiKey.create as jest.Mock).mock.calls[0][0];
    expect(create.data.expiresAt).toBeInstanceOf(Date);
  });
});

describe("ApiKeysService.findAll & search pagination", () => {
  it("returns hasNextPage=true with sliced items + nextCursor when over-fetching", async () => {
    const { svc } = buildHarness({
      keys: Array.from({ length: 11 }, (_, i) =>
        makeKey({ id: `ak_${i}`, name: `k${i}` }),
      ),
    });
    const out = await svc.findAll({ take: 10 });
    expect(out.hasNextPage).toBe(true);
    expect(out.items).toHaveLength(10);
    expect(out.nextCursor).toBe(out.items[9].id);
  });

  it("returns hasNextPage=false when at end", async () => {
    const { svc } = buildHarness({
      keys: [makeKey({ id: "ak_only" })],
    });
    const out = await svc.findAll({ take: 10 });
    expect(out.hasNextPage).toBe(false);
    expect(out.nextCursor).toBeNull();
  });

  it("masks keyValue in list output (first 8 + ...last 4)", async () => {
    const { svc } = buildHarness({
      keys: [
        makeKey({
          keyValue: "tk_abcdefghxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx0123",
        }),
      ],
    });
    const out = await svc.findAll({ take: 10 });
    expect(out.items[0].keyValue).toMatch(/^tk_abcde\.\.\.0123$/);
  });

  it("search composes name/type/status/createdFrom/createdTo/expiresFrom/expiresTo", async () => {
    const { svc, prisma } = buildHarness({ keys: [] });
    await svc.search(
      {
        name: "key",
        type: "INTERNAL",
        status: "ACTIVE",
        createdFrom: "2026-01-01",
        createdTo: "2026-02-01",
        expiresFrom: "2027-01-01",
        expiresTo: "2027-12-31",
      } as never,
      { take: 10 },
    );
    const findMany = (prisma.apiKey.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.name.contains).toBe("key");
    expect(findMany.where.createdAt.gte).toBeInstanceOf(Date);
    expect(findMany.where.expiresAt.lte).toBeInstanceOf(Date);
  });
});

describe("ApiKeysService.findOne / update / remove", () => {
  it("findOne 404s when missing", async () => {
    const { svc } = buildHarness({ existingKey: null });
    await expect(svc.findOne("nope")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("update 404s when missing", async () => {
    const { svc } = buildHarness({ existingKey: null });
    await expect(
      svc.update("nope", { name: "new" } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("update rejects rename collision (409)", async () => {
    const { svc, prisma } = buildHarness({ existingKey: makeKey({ id: "ak_a" }) });
    (prisma.apiKey.findFirst as jest.Mock).mockResolvedValueOnce(
      makeKey({ id: "ak_b", name: "taken" }),
    );
    await expect(
      svc.update("ak_a", { name: "taken" } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("remove 404s when missing", async () => {
    const { svc } = buildHarness({ existingKey: null });
    await expect(svc.remove("nope")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("remove deletes when present", async () => {
    const { svc, prisma } = buildHarness({ existingKey: makeKey() });
    await svc.remove("ak_1");
    expect(prisma.apiKey.delete).toHaveBeenCalled();
  });
});

describe("ApiKeysService.revokeApiKey / regenerateApiKey", () => {
  it("revoke sets status=REVOKED", async () => {
    const { svc, prisma } = buildHarness({ existingKey: makeKey() });
    await svc.revokeApiKey("ak_1");
    expect((prisma.apiKey.update as jest.Mock).mock.calls[0][0].data.status).toBe(
      "REVOKED",
    );
  });

  it("regenerate produces a new tk_ key and resets usage state", async () => {
    const { svc, prisma } = buildHarness({ existingKey: makeKey() });
    const out = await svc.regenerateApiKey("ak_1");
    const data = (prisma.apiKey.update as jest.Mock).mock.calls[0][0].data;
    expect(data.keyValue).toMatch(/^tk_[0-9a-f]{64}$/);
    expect(data.lastUsedAt).toBeNull();
    expect(data.usageCount).toBe(0);
    expect(out.keyValue).toBe(data.keyValue);
  });
});

describe("ApiKeysService.validateApiKey", () => {
  it("returns null when key not found", async () => {
    const { svc } = buildHarness({ existingKey: null });
    (
      (jest.fn() as never) as never
    );
    const result = await svc.validateApiKey("tk_nope");
    expect(result).toBeNull();
  });

  it("returns null when key is not ACTIVE", async () => {
    const { svc } = buildHarness({
      existingKey: makeKey({ status: "REVOKED" }),
    });
    expect(await svc.validateApiKey("tk_x")).toBeNull();
  });

  it("auto-marks expired keys EXPIRED and returns null", async () => {
    const { svc, prisma } = buildHarness({
      existingKey: makeKey({
        status: "ACTIVE",
        expiresAt: new Date(Date.now() - 60_000),
      }),
    });
    expect(await svc.validateApiKey("tk_x")).toBeNull();
    expect((prisma.apiKey.update as jest.Mock).mock.calls[0][0].data.status).toBe(
      "EXPIRED",
    );
  });

  it("returns the key and bumps usageCount/lastUsedAt when valid", async () => {
    const { svc, prisma } = buildHarness({
      existingKey: makeKey({ status: "ACTIVE" }),
    });
    const out = await svc.validateApiKey("tk_valid");
    expect(out).not.toBeNull();
    const updateData = (prisma.apiKey.update as jest.Mock).mock.calls[0][0].data;
    expect(updateData.usageCount).toEqual({ increment: 1 });
    expect(updateData.lastUsedAt).toBeInstanceOf(Date);
  });

  it("invalidates vendor cache when metadata.vendorId is present", async () => {
    const { svc, cache } = buildHarness({
      existingKey: makeKey({
        status: "ACTIVE",
        metadata: { vendorId: "v_x" },
      }),
    });
    await svc.validateApiKey("tk_with_vendor");
    expect(cache.invalidateVendorAPICache).toHaveBeenCalledWith("v_x");
  });
});
