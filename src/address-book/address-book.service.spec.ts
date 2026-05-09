import { ConflictException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { AddressBookCacheService } from "../valkey/services/address-book-cache.service";
import { AddressBookService } from "./address-book.service";

function buildHarness(opts: {
  existing?: Record<string, unknown> | null;
  byId?: Record<string, unknown> | null;
} = {}) {
  const prisma = {
    addressBook: {
      findUnique: jest.fn(
        async ({ where }: { where: { userId_address?: unknown; id?: string } }) => {
          if (where.userId_address) return opts.existing ?? null;
          if (where.id) return opts.byId ?? null;
          return null;
        },
      ),
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "ab_new",
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "ab_x",
        ...data,
      })),
      delete: jest.fn(async () => ({ id: "ab_x" })),
    },
  } as unknown as PrismaService;
  const cache = {
    invalidateUserAddressBook: jest.fn(async () => undefined),
    invalidateEntry: jest.fn(async () => undefined),
    getUserAddressBook: jest.fn(
      async (_uid: string, fallback: () => unknown) => fallback(),
    ),
    getById: jest.fn(async (_id: string, fallback: () => unknown) => fallback()),
  } as unknown as AddressBookCacheService;
  return { svc: new AddressBookService(prisma, cache), prisma, cache };
}

describe("AddressBookService.create", () => {
  it("rejects duplicate (userId, address) with 409", async () => {
    const { svc } = buildHarness({ existing: { id: "ab_dup" } });
    await expect(
      svc.create("u1", { address: "0xX", label: "X" } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("creates and invalidates the user's cached list", async () => {
    const { svc, cache } = buildHarness();
    await svc.create("u1", { address: "0xY", label: "Y" } as never);
    expect(cache.invalidateUserAddressBook).toHaveBeenCalledWith("u1");
  });
});

describe("AddressBookService.findOne / update / remove", () => {
  it("findOne 404s when missing or owned by another user", async () => {
    const { svc } = buildHarness({ byId: { id: "ab_x", userId: "OTHER" } });
    await expect(svc.findOne("u1", "ab_x")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("update 404s when missing", async () => {
    const { svc } = buildHarness({ byId: null });
    await expect(
      svc.update("u1", "ab_x", { label: "Y" } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("update + remove invalidate the cached entry for that user", async () => {
    const { svc, cache } = buildHarness({
      byId: { id: "ab_x", userId: "u1" },
    });
    await svc.update("u1", "ab_x", { label: "Y" } as never);
    expect(cache.invalidateEntry).toHaveBeenCalledWith("ab_x", "u1");

    (cache.invalidateEntry as jest.Mock).mockClear();
    await svc.remove("u1", "ab_x");
    expect(cache.invalidateEntry).toHaveBeenCalledWith("ab_x", "u1");
  });
});
