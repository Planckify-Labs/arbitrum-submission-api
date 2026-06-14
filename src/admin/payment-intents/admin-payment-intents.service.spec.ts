import { NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../../prisma/prisma.service";
import { AdminPaymentIntentsService } from "./admin-payment-intents.service";

function makeIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: "pi_1",
    merchantId: "mch_1",
    fiatAmountMinor: 100_000,
    fiatCurrency: "IDR",
    status: "QUOTED" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    merchant: { id: "mch_1", displayName: "Toko" },
    ...overrides,
  };
}

function buildHarness(opts: {
  intents?: ReturnType<typeof makeIntent>[];
  intentExists?: { id: string } | null;
  one?: (ReturnType<typeof makeIntent> & {
    _count?: { nanopaySubmissions: number; payouts: number };
  }) | null;
  submissions?: Record<string, unknown>[];
  payouts?: Record<string, unknown>[];
} = {}) {
  const intents = opts.intents ?? [];
  const prisma = {
    paymentIntent: {
      findMany: jest.fn(async () => intents),
      count: jest.fn(async () => intents.length),
      findUnique: jest.fn(
        async ({
          select,
        }: {
          where: { id: string };
          select?: { id: boolean };
        }) => {
          await Promise.resolve();
          if (select) return opts.intentExists ?? null;
          return opts.one ?? null;
        },
      ),
    },
    nanopaySubmission: {
      findMany: jest.fn(async () => opts.submissions ?? []),
      count: jest.fn(async () => opts.submissions?.length ?? 0),
    },
    providerPayout: {
      findMany: jest.fn(async () => opts.payouts ?? []),
      count: jest.fn(async () => opts.payouts?.length ?? 0),
    },
  } as unknown as PrismaService;
  return { svc: new AdminPaymentIntentsService(prisma), prisma };
}

describe("AdminPaymentIntentsService.list", () => {
  it("status=PENDING maps to QUOTED+SIGNED prisma statuses", async () => {
    const { svc, prisma } = buildHarness();
    await svc.list({ status: "PENDING" });
    const findMany = (prisma.paymentIntent.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.AND[0].status.in).toEqual(["QUOTED", "SIGNED"]);
  });

  it("status=COMPLETED maps to SETTLED+PAID_OUT", async () => {
    const { svc, prisma } = buildHarness();
    await svc.list({ status: "COMPLETED" });
    expect(
      (prisma.paymentIntent.findMany as jest.Mock).mock.calls[0][0].where.AND[0]
        .status.in,
    ).toEqual(["SETTLED", "PAID_OUT"]);
  });

  it("composes merchantId + dateRange + search", async () => {
    const { svc, prisma } = buildHarness();
    await svc.list({
      merchantId: "mch_x",
      dateFrom: "2026-01-01",
      dateTo: "2026-02-01",
      search: "abc",
    });
    const findMany = (prisma.paymentIntent.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.AND).toHaveLength(3);
  });

  it("returns mapped wire shape with formatted IDR amount (no decimals)", async () => {
    const { svc } = buildHarness({
      intents: [makeIntent({ fiatAmountMinor: 100_000, fiatCurrency: "IDR" })],
    });
    const out = await svc.list({});
    expect(out.items[0].amount).toBe("100000");
    expect(out.items[0].status).toBe("PENDING");
  });

  it("returns mapped wire shape with formatted USD amount (2 decimals)", async () => {
    const { svc } = buildHarness({
      intents: [makeIntent({ fiatAmountMinor: 1_234, fiatCurrency: "USD" })],
    });
    const out = await svc.list({});
    expect(out.items[0].amount).toBe("12.34");
  });

  it("clamps take to [1, 100]", async () => {
    const { svc, prisma } = buildHarness();
    await svc.list({ take: 9999 });
    expect((prisma.paymentIntent.findMany as jest.Mock).mock.calls[0][0].take).toBe(
      100,
    );
  });
});

describe("AdminPaymentIntentsService.findOne", () => {
  it("404s when missing", async () => {
    const { svc } = buildHarness({ one: null });
    await expect(svc.findOne("pi_x")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("attaches _count when present", async () => {
    const { svc } = buildHarness({
      one: { ...makeIntent(), _count: { nanopaySubmissions: 2, payouts: 1 } },
    });
    const out = await svc.findOne("pi_1");
    expect((out as { _count?: { submissions: number; payouts: number } })._count).toEqual(
      { submissions: 2, payouts: 1 },
    );
  });
});

describe("AdminPaymentIntentsService.listSubmissions / listPayouts", () => {
  it("listSubmissions 404s when intent doesn't exist", async () => {
    const { svc } = buildHarness({ intentExists: null });
    await expect(svc.listSubmissions("pi_x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("listPayouts 404s when intent doesn't exist", async () => {
    const { svc } = buildHarness({ intentExists: null });
    await expect(svc.listPayouts("pi_x")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("listPayouts masks accountNumberEncrypted to ••••<last4>", async () => {
    const { svc } = buildHarness({
      intentExists: { id: "pi_1" },
      payouts: [
        {
          id: "pp_1",
          intentId: "pi_1",
          providerPayoutId: "ext_1",
          referenceId: "ref",
          amount: { toString: () => "10000" },
          status: "PENDING",
          accountNumberEncrypted: Buffer.from("1234567890"),
          createdAt: new Date(),
        },
      ],
    });
    const out = await svc.listPayouts("pi_1");
    expect(out.items[0].accountNumber).toBe("••••7890");
  });
});
