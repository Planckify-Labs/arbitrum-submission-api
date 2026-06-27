import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { DappsService } from "./dapps.service";

function makeDapp(overrides: Record<string, unknown> = {}) {
  return {
    id: "dapp_1",
    name: "TestDapp",
    isActive: true,
    isPopular: false,
    isSponsor: false,
    categoryId: "cat_1",
    favorites: [],
    category: { id: "cat_1", name: "Cat" },
    ...overrides,
  };
}

function buildHarness(
  opts: {
    dapps?: ReturnType<typeof makeDapp>[];
    one?: ReturnType<typeof makeDapp> | null;
    category?: Record<string, unknown> | null;
    favorite?: Record<string, unknown> | null;
  } = {},
) {
  const dapps = opts.dapps ?? [];
  const prisma = {
    dapp: {
      findMany: jest.fn(async () => dapps),
      count: jest.fn(async () => dapps.length),
      findUnique: jest.fn(async () => opts.one ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "dapp_new",
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "dapp_x",
        ...data,
      })),
      delete: jest.fn(async () => ({ id: "dapp_x" })),
    },
    dappCategory: {
      findUnique: jest.fn(async () => opts.category ?? null),
    },
    userDappFavorite: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => opts.favorite ?? null),
      create: jest.fn(async () => ({ id: "f_1" })),
      delete: jest.fn(async () => ({ id: "f_1" })),
    },
  } as unknown as PrismaService;
  return { svc: new DappsService(prisma), prisma };
}

describe("DappsService.findAll", () => {
  it("attaches isFavorite=true when user has favorited the dapp", async () => {
    const { svc } = buildHarness({
      dapps: [makeDapp({ favorites: [{ id: "f1", userId: "u1" }] })],
    });
    const out = await svc.findAll({ take: 10 }, "u1");
    expect(out.items[0].isFavorite).toBe(true);
  });

  it("isFavorite=false when no userId provided", async () => {
    const { svc } = buildHarness({ dapps: [makeDapp()] });
    const out = await svc.findAll({ take: 10 });
    expect(out.items[0].isFavorite).toBe(false);
  });

  it("filters where isActive=true", async () => {
    const { svc, prisma } = buildHarness();
    await svc.findAll({});
    const findMany = (prisma.dapp.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.isActive).toBe(true);
  });
});

describe("DappsService.findPopular / findSponsored / findByCategory", () => {
  it("findPopular adds isPopular=true filter", async () => {
    const { svc, prisma } = buildHarness();
    await svc.findPopular({});
    const findMany = (prisma.dapp.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.isPopular).toBe(true);
  });

  it("findSponsored adds isSponsor=true filter", async () => {
    const { svc, prisma } = buildHarness();
    await svc.findSponsored({});
    const findMany = (prisma.dapp.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.isSponsor).toBe(true);
  });

  it("findByCategory 404s when category missing", async () => {
    const { svc } = buildHarness({ category: null });
    await expect(svc.findByCategory("cat_x", {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("DappsService favorites", () => {
  it("addToFavorites 404s when dapp missing", async () => {
    const { svc } = buildHarness({ one: null });
    await expect(svc.addToFavorites("u_1", "dapp_x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("addToFavorites maps P2002 to ConflictException", async () => {
    const { svc, prisma } = buildHarness({ one: makeDapp() });
    const { Prisma } = await import("@generated/prisma");
    (prisma.userDappFavorite.create as jest.Mock).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "0",
      }),
    );
    await expect(svc.addToFavorites("u_1", "dapp_1")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("removeFromFavorites 404s when not favorited", async () => {
    const { svc } = buildHarness({ favorite: null });
    await expect(
      svc.removeFromFavorites("u_1", "dapp_x"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("removeFromFavorites deletes when found", async () => {
    const { svc, prisma } = buildHarness({
      favorite: { id: "f_1", userId: "u_1", dappId: "dapp_1" },
    });
    await svc.removeFromFavorites("u_1", "dapp_1");
    expect(prisma.userDappFavorite.delete).toHaveBeenCalled();
  });
});

describe("DappsService.create / update / remove", () => {
  it("create rejects when category missing (400)", async () => {
    const { svc } = buildHarness({ category: null });
    await expect(
      svc.create({ name: "X", categoryId: "cat_x" } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("update 404s when dapp missing", async () => {
    const { svc } = buildHarness({ one: null });
    await expect(svc.update("dapp_x", {} as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("update 400s when overriding to a missing category", async () => {
    const { svc } = buildHarness({ one: makeDapp(), category: null });
    await expect(
      svc.update("dapp_1", { categoryId: "cat_missing" } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("remove 404s when missing", async () => {
    const { svc } = buildHarness({ one: null });
    await expect(svc.remove("dapp_x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("DappsService.findOne", () => {
  it("404s when missing", async () => {
    const { svc } = buildHarness({ one: null });
    await expect(svc.findOne("dapp_x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
