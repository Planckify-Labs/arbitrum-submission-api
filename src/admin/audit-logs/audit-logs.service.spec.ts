import { NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../../prisma/prisma.service";
import { AuditLogsService } from "./audit-logs.service";

function buildHarness(opts: {
  rows?: Record<string, unknown>[];
  cursorRow?: { id: string; createdAt: Date } | null;
  one?: Record<string, unknown> | null;
} = {}) {
  const rows = opts.rows ?? [];
  const prisma = {
    adminAuditLog: {
      findMany: jest.fn(async () => rows),
      count: jest.fn(async () => rows.length),
      findFirst: jest.fn(async () => opts.cursorRow ?? opts.one ?? null),
    },
  } as unknown as PrismaService;
  return { svc: new AuditLogsService(prisma), prisma };
}

const baseRow = {
  id: "al_1",
  adminUserId: "u_1",
  action: "MERCHANT_ACTIVATE",
  resource: "merchant",
  resourceId: "mch_x",
  metadata: { foo: "bar" },
  ipAddress: "1.2.3.4",
  userAgent: "ua",
  createdAt: new Date("2026-01-01"),
  adminUser: {
    id: "u_1",
    username: "admin",
    email: "a@x",
    walletAddress: null,
  },
};

describe("AuditLogsService.list", () => {
  it("clamps take to [1, 100] and applies cursor lookup with id<cursor.id tiebreak", async () => {
    const { svc, prisma } = buildHarness({
      rows: [baseRow],
      cursorRow: { id: "al_cursor", createdAt: new Date("2026-02-01") },
    });
    await svc.list({ take: 9999, cursor: "al_after" });
    const findMany = (prisma.adminAuditLog.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.take).toBe(100);
    expect(findMany.where.OR).toBeDefined();
  });

  it("uses skip pagination when skip > 0 and ignores cursor", async () => {
    const { svc, prisma } = buildHarness({ rows: [baseRow] });
    await svc.list({ skip: 5, cursor: "ignored", take: 5 });
    const findMany = (prisma.adminAuditLog.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.skip).toBe(5);
  });

  it("composes action / userId / entityType / dateFrom / dateTo filters", async () => {
    const { svc, prisma } = buildHarness({ rows: [] });
    await svc.list({
      action: "MERCHANT_DEACTIVATE",
      userId: "u_1",
      entityType: "merchant",
      dateFrom: "2026-01-01",
      dateTo: "2026-02-01",
    });
    const findMany = (prisma.adminAuditLog.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.AND).toHaveLength(4);
  });

  it("ignores invalid date strings", async () => {
    const { svc, prisma } = buildHarness({ rows: [] });
    await svc.list({ dateFrom: "not-a-date", dateTo: "" });
    const findMany = (prisma.adminAuditLog.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.AND).toBeUndefined();
  });

  it("maps response to wire shape (resource → entityType, resourceId → entityId, ISO date)", async () => {
    const { svc } = buildHarness({ rows: [baseRow] });
    const out = await svc.list({});
    expect(out.items[0]).toMatchObject({
      action: "MERCHANT_ACTIVATE",
      entityType: "merchant",
      entityId: "mch_x",
      userId: "u_1",
    });
    expect(typeof out.items[0].createdAt).toBe("string");
  });
});

describe("AuditLogsService.findOne", () => {
  it("404s when missing", async () => {
    const { svc } = buildHarness({ one: null });
    await expect(svc.findOne("al_x")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("returns the mapped audit log when present", async () => {
    const { svc } = buildHarness({ one: baseRow });
    const out = await svc.findOne("al_1");
    expect(out.id).toBe("al_1");
  });
});
