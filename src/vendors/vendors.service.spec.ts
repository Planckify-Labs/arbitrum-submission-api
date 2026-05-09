import { NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { VendorsService } from "./vendors.service";

function buildHarness(opts: {
  vendor?: Record<string, unknown> | null;
  vendors?: Record<string, unknown>[];
} = {}) {
  const vendors = opts.vendors ?? [];
  const prisma = {
    vendor: {
      findUnique: jest.fn(async () => opts.vendor ?? null),
      findMany: jest.fn(async () => vendors),
      count: jest.fn(async () => vendors.length),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "v_new",
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "v_x",
        ...data,
      })),
      delete: jest.fn(async () => ({ id: "v_x" })),
    },
    product: { findMany: jest.fn(async () => []) },
  } as unknown as PrismaService;
  return { svc: new VendorsService(prisma), prisma };
}

describe("VendorsService", () => {
  it("findOne 404s when missing", async () => {
    const { svc } = buildHarness({ vendor: null });
    await expect(svc.findOne("v_x")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("update 404s when missing", async () => {
    const { svc } = buildHarness({ vendor: null });
    await expect(svc.update("v_x", { name: "X" } as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("remove 404s when missing", async () => {
    const { svc } = buildHarness({ vendor: null });
    await expect(svc.remove("v_x")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("findVendorProducts queries with the some/some/vendorId pattern", async () => {
    const { svc, prisma } = buildHarness({ vendor: { id: "v_x" } });
    await svc.findVendorProducts("v_x", { take: 5 });
    const findMany = (prisma.product.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.variants.some.ProductPrice.some.vendorId).toBe("v_x");
    expect(findMany.take).toBe(5);
  });

  it("findAll returns items + total", async () => {
    const { svc } = buildHarness({
      vendors: [{ id: "v1" }, { id: "v2" }],
    });
    const out = await svc.findAll();
    expect(out.total).toBe(2);
  });
});
