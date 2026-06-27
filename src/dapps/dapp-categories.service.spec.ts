import { ConflictException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { DappCategoriesService } from "./dapp-categories.service";

function buildHarness(
  opts: {
    category?: Record<string, unknown> | null;
    withDapps?: number;
  } = {},
) {
  const prisma = {
    dappCategory: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () =>
        opts.category
          ? { ...opts.category, _count: { dapps: opts.withDapps ?? 0 } }
          : null,
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "cat_new",
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "cat_x",
        ...data,
      })),
      delete: jest.fn(async () => ({ id: "cat_x" })),
    },
  } as unknown as PrismaService;
  return { svc: new DappCategoriesService(prisma), prisma };
}

describe("DappCategoriesService", () => {
  it("findOne 404s when missing", async () => {
    const { svc } = buildHarness({ category: null });
    await expect(svc.findOne("cat_x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("create maps P2002 → ConflictException", async () => {
    const { svc, prisma } = buildHarness();
    const { Prisma } = await import("@generated/prisma");
    (prisma.dappCategory.create as jest.Mock).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "0",
      }),
    );
    await expect(svc.create({ name: "Cat" } as never)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("update 404s when missing", async () => {
    const { svc } = buildHarness({ category: null });
    await expect(
      svc.update("cat_x", { name: "Y" } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("update maps P2002 → ConflictException", async () => {
    const { svc, prisma } = buildHarness({ category: { id: "cat_x" } });
    const { Prisma } = await import("@generated/prisma");
    (prisma.dappCategory.update as jest.Mock).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "0",
      }),
    );
    await expect(
      svc.update("cat_x", { name: "Y" } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("remove 404s when missing", async () => {
    const { svc } = buildHarness({ category: null });
    await expect(svc.remove("cat_x")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("remove rejects with 409 when category has dapps", async () => {
    const { svc } = buildHarness({ category: { id: "cat_x" }, withDapps: 3 });
    await expect(svc.remove("cat_x")).rejects.toBeInstanceOf(ConflictException);
  });

  it("remove deletes when no dapps reference it", async () => {
    const { svc, prisma } = buildHarness({
      category: { id: "cat_x" },
      withDapps: 0,
    });
    await svc.remove("cat_x");
    expect(prisma.dappCategory.delete).toHaveBeenCalled();
  });
});
