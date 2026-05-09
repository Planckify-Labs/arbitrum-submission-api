import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../../prisma/prisma.service";
import { AdminMerchantsService } from "./admin-merchants.service";

function makeMerchant(overrides: Record<string, unknown> = {}) {
  return {
    id: "mch_1",
    userId: "u_1",
    displayName: "Toko Test",
    jwsQr: "takumipay:v1:abc",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {
      id: "u_1",
      username: "owner",
      email: null,
      walletAddress: "0x1",
    },
    _count: { paymentIntents: 5 },
    ...overrides,
  };
}

function buildHarness(opts: {
  merchants?: ReturnType<typeof makeMerchant>[];
  one?: ReturnType<typeof makeMerchant> | null;
} = {}) {
  const merchants = opts.merchants ?? [];
  const prisma = {
    merchant: {
      findMany: jest.fn(async () => merchants),
      count: jest.fn(async () => merchants.length),
      findUnique: jest.fn(async () => opts.one ?? null),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) =>
        makeMerchant({ ...(opts.one ?? {}), ...data }),
      ),
    },
  } as unknown as PrismaService;
  return { svc: new AdminMerchantsService(prisma), prisma };
}

describe("AdminMerchantsService.list", () => {
  it("status=ACTIVE → isActive=true filter", async () => {
    const { svc, prisma } = buildHarness();
    await svc.list({ status: "ACTIVE" });
    const findMany = (prisma.merchant.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.AND[0]).toEqual({ isActive: true });
  });

  it("status=INACTIVE → isActive=false filter", async () => {
    const { svc, prisma } = buildHarness();
    await svc.list({ status: "INACTIVE" });
    const findMany = (prisma.merchant.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.AND[0]).toEqual({ isActive: false });
  });

  it("search applies OR across displayName/contactPhone/qrisPan/email/username", async () => {
    const { svc, prisma } = buildHarness();
    await svc.list({ search: "toko" });
    const findMany = (prisma.merchant.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.AND[0].OR).toHaveLength(5);
  });

  it("clamps take to [1, 100]", async () => {
    const { svc, prisma } = buildHarness();
    await svc.list({ take: 9999 });
    expect((prisma.merchant.findMany as jest.Mock).mock.calls[0][0].take).toBe(100);
  });

  it("maps the response shape (paymentIntents → _count.transactions)", async () => {
    const { svc } = buildHarness({ merchants: [makeMerchant()] });
    const out = await svc.list({});
    expect(out.items[0]).toMatchObject({
      id: "mch_1",
      businessName: "Toko Test",
      status: "ACTIVE",
    });
    expect(out.items[0]._count?.transactions).toBe(5);
  });
});

describe("AdminMerchantsService.findOne", () => {
  it("404s when missing", async () => {
    const { svc } = buildHarness({ one: null });
    await expect(svc.findOne("mch_x")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("AdminMerchantsService.updateStatus", () => {
  it("404s when missing", async () => {
    const { svc } = buildHarness({ one: null });
    await expect(
      svc.updateStatus("mch_x", "ACTIVE"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects unknown status string", async () => {
    const { svc } = buildHarness({ one: makeMerchant() });
    await expect(
      svc.updateStatus("mch_1", "BOGUS" as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("ACTIVE → isActive=true and PENDING → isActive=false (DB only stores boolean)", async () => {
    const { svc, prisma } = buildHarness({ one: makeMerchant() });
    await svc.updateStatus("mch_1", "ACTIVE");
    expect((prisma.merchant.update as jest.Mock).mock.calls[0][0].data).toEqual({
      isActive: true,
    });

    (prisma.merchant.update as jest.Mock).mockClear();
    await svc.updateStatus("mch_1", "PENDING");
    expect((prisma.merchant.update as jest.Mock).mock.calls[0][0].data).toEqual({
      isActive: false,
    });
  });

  it("returns the response with the requested status override (PENDING preserved)", async () => {
    const { svc } = buildHarness({ one: makeMerchant({ isActive: false }) });
    const out = await svc.updateStatus("mch_1", "PENDING");
    expect(out.status).toBe("PENDING");
  });
});
