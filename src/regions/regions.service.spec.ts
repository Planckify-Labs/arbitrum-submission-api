import { NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { RegionsService } from "./regions.service";

function buildHarness(opts: {
  region?: Record<string, unknown> | null;
  duplicate?: Record<string, unknown> | null;
  token?: Record<string, unknown> | null;
  regionToken?: Record<string, unknown> | null;
} = {}) {
  const prisma = {
    region: {
      findUnique: jest.fn(async () => opts.region ?? null),
      findFirst: jest.fn(async () => opts.duplicate ?? null),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "rg_new",
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "rg_x",
        ...data,
      })),
      delete: jest.fn(async () => ({ id: "rg_x" })),
    },
    token: { findUnique: jest.fn(async () => opts.token ?? null) },
    regionAvailableToken: {
      findUnique: jest.fn(async () => opts.regionToken ?? null),
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "rt_new",
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "rt_x",
        ...data,
      })),
      delete: jest.fn(async () => ({ id: "rt_x" })),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
  } as unknown as PrismaService;
  return { svc: new RegionsService(prisma), prisma };
}

describe("RegionsService.create / update unique-code guards", () => {
  it("create rejects duplicate code", async () => {
    const { svc, prisma } = buildHarness();
    (prisma.region.findUnique as jest.Mock).mockResolvedValueOnce({ id: "rg_dup" });
    await expect(svc.create({ code: "ID", name: "ID" } as never)).rejects.toThrow(
      /already exists/,
    );
  });

  it("update 404s when region missing", async () => {
    const { svc } = buildHarness({ region: null });
    await expect(svc.update("rg_x", { name: "X" } as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("update rejects rename collision (different id, same code)", async () => {
    const { svc } = buildHarness({
      region: { id: "rg_x" },
      duplicate: { id: "rg_other" },
    });
    await expect(svc.update("rg_x", { code: "ID" } as never)).rejects.toThrow(
      /already exists/,
    );
  });
});

describe("RegionsService.findOne / remove", () => {
  it("findOne 404s when missing", async () => {
    const { svc } = buildHarness({ region: null });
    await expect(svc.findOne("rg_x")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("remove 404s when missing", async () => {
    const { svc } = buildHarness({ region: null });
    await expect(svc.remove("rg_x")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("RegionsService.addToken / updateToken / removeToken", () => {
  it("addToken 404s when region missing", async () => {
    const { svc } = buildHarness({ region: null });
    await expect(
      svc.addToken("rg_x", { tokenId: "tk_x" } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("addToken 404s when token missing", async () => {
    const { svc } = buildHarness({
      region: { id: "rg_x" },
      token: null,
    });
    await expect(
      svc.addToken("rg_x", { tokenId: "tk_x" } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("addToken rejects when token already added to region", async () => {
    const { svc } = buildHarness({
      region: { id: "rg_x" },
      token: { id: "tk_x" },
      regionToken: { id: "rt_existing" },
    });
    await expect(
      svc.addToken("rg_x", { tokenId: "tk_x" } as never),
    ).rejects.toThrow(/already added/);
  });

  it("addToken with isDefault=true unsets other defaults first", async () => {
    const { svc, prisma } = buildHarness({
      region: { id: "rg_x" },
      token: { id: "tk_x" },
    });
    await svc.addToken("rg_x", { tokenId: "tk_x", isDefault: true } as never);
    expect(prisma.regionAvailableToken.updateMany).toHaveBeenCalledWith({
      where: { regionId: "rg_x" },
      data: { isDefault: false },
    });
  });

  it("updateToken 404s when entry missing", async () => {
    const { svc } = buildHarness({ regionToken: null });
    await expect(
      svc.updateToken("rg_x", "tk_x", { isDefault: true } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("removeToken 404s when entry missing", async () => {
    const { svc } = buildHarness({ regionToken: null });
    await expect(svc.removeToken("rg_x", "tk_x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("RegionsService.search", () => {
  it("composes code/name/currency/active/KYC filters", async () => {
    const { svc, prisma } = buildHarness();
    await svc.search(
      {
        code: "ID",
        name: "Indo",
        currencyCode: "IDR",
        isActive: true,
        hasKYCRequirement: false,
      } as never,
      {},
    );
    const findMany = (prisma.region.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where).toMatchObject({
      code: { contains: "ID", mode: "insensitive" },
      isActive: true,
      hasKYCRequirement: false,
    });
  });
});
