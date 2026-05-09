import { NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "./users.service";

function buildHarness(opts: {
  user?: Record<string, unknown> | null;
  users?: Record<string, unknown>[];
  cursorTx?: { createdAt: Date } | null;
} = {}) {
  const prisma = {
    user: {
      findUnique: jest.fn(async () => opts.user ?? null),
      findMany: jest.fn(async () => opts.users ?? []),
      count: jest.fn(async () => opts.users?.length ?? 0),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "u_new",
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "u_x",
        ...data,
      })),
      delete: jest.fn(async () => ({ id: "u_x" })),
    },
    transactionHistory: {
      findFirst: jest.fn(async () => opts.cursorTx ?? null),
      findMany: jest.fn(async () => []),
    },
  } as unknown as PrismaService;
  const svc = new UsersService(prisma);
  return { svc, prisma };
}

describe("UsersService.findAll", () => {
  it("composes role/status/search into where (search ORs across multiple columns)", async () => {
    const { svc, prisma } = buildHarness({ users: [] });
    await svc.findAll({
      role: "ADMIN",
      status: "ACTIVE",
      search: "0xabc",
      take: 25,
    } as never);
    const findMany = (prisma.user.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.role).toBe("ADMIN");
    expect(findMany.where.status).toBe("ACTIVE");
    expect(findMany.where.OR).toHaveLength(4);
    expect(findMany.take).toBe(25);
  });

  it("uses cursor pagination by default (skip:1 when cursor present)", async () => {
    const { svc, prisma } = buildHarness();
    await svc.findAll({ cursor: "u_after" } as never);
    const findMany = (prisma.user.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.skip).toBe(1);
    expect(findMany.cursor).toEqual({ id: "u_after" });
  });

  it("uses skip pagination when skip > 0 (ignoring cursor)", async () => {
    const { svc, prisma } = buildHarness();
    await svc.findAll({ cursor: "ignored", skip: 50, take: 10 } as never);
    const findMany = (prisma.user.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.skip).toBe(50);
    expect(findMany.cursor).toBeUndefined();
  });

  it("returns empty where when no filters/skip/cursor are supplied", async () => {
    const { svc, prisma } = buildHarness();
    await svc.findAll();
    const findMany = (prisma.user.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where).toEqual({});
  });
});

describe("UsersService.findOne", () => {
  it("404s when user missing", async () => {
    const { svc } = buildHarness({ user: null });
    await expect(svc.findOne("u_x")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("returns the safe-select payload (no password/sensitive fields)", async () => {
    const { svc, prisma } = buildHarness({
      user: { id: "u_x", username: "alice", role: "USER" },
    });
    const out = await svc.findOne("u_x");
    expect(out.id).toBe("u_x");
    const findUnique = (prisma.user.findUnique as jest.Mock).mock.calls[0][0];
    expect(findUnique.select).toBeDefined();
    expect(findUnique.select.password).toBeUndefined();
  });
});

describe("UsersService.update", () => {
  it("404s when user does not exist (delegated to findOne)", async () => {
    const { svc } = buildHarness({ user: null });
    await expect(svc.update("u_x", { name: "X" } as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("updates after the existence check passes", async () => {
    const { svc, prisma } = buildHarness({ user: { id: "u_x" } });
    await svc.update("u_x", { name: "Y" } as never);
    expect(prisma.user.update).toHaveBeenCalled();
  });
});

describe("UsersService.remove / softDelete", () => {
  it("remove 404s when user missing", async () => {
    const { svc } = buildHarness({ user: null });
    await expect(svc.remove("u_x")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("remove deletes when user exists", async () => {
    const { svc, prisma } = buildHarness({ user: { id: "u_x" } });
    await svc.remove("u_x");
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: "u_x" } });
  });

  it("softDelete sets status=INACTIVE without deleting the row", async () => {
    const { svc, prisma } = buildHarness({ user: { id: "u_x" } });
    await svc.softDelete("u_x");
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u_x" },
      data: { status: "INACTIVE" },
    });
  });
});

describe("UsersService.findUserTransactions", () => {
  it("404s when user missing", async () => {
    const { svc } = buildHarness({ user: null });
    await expect(svc.findUserTransactions("u_x", {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("uses createdAt-based cursor (hypertable-safe pagination)", async () => {
    const { svc, prisma } = buildHarness({
      user: { id: "u_x" },
      cursorTx: { createdAt: new Date("2026-01-01T00:00:00Z") },
    });
    await svc.findUserTransactions("u_x", { cursor: "tx_x", take: 5 });
    const findMany = (prisma.transactionHistory.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.userId).toBe("u_x");
    expect(findMany.where.createdAt.lt).toBeInstanceOf(Date);
    expect(findMany.take).toBe(5);
  });

  it("does not add createdAt filter when cursor lookup misses", async () => {
    const { svc, prisma } = buildHarness({
      user: { id: "u_x" },
      cursorTx: null,
    });
    await svc.findUserTransactions("u_x", { cursor: "tx_missing" });
    const findMany = (prisma.transactionHistory.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.createdAt).toBeUndefined();
  });
});
