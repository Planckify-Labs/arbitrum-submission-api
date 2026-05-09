import { ConflictException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import type { ExchangeRateCacheService } from "../valkey/services/exchange-rate-cache.service";
import { ExchangeRateService } from "./exchange-rate.service";

const sourceProvider = { id: "src_x", name: "Coingecko" };

function makeRate(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    fromCurrency: "USDC",
    toCurrency: "IDR",
    rate: "15700",
    sourceProvider,
    sourceProviderId: "src_x",
    region: null,
    provider: null,
    markup: null,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function buildHarness(opts: {
  rates?: ReturnType<typeof makeRate>[];
  rate?: ReturnType<typeof makeRate> | null;
  source?: Record<string, unknown> | null;
  rateAvg?: number | null;
  ratesUsingSourceCount?: number;
} = {}) {
  const rates = opts.rates ?? [];
  const prisma = {
    exchangeRate: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) =>
        makeRate({ ...data }),
      ),
      findFirst: jest.fn(async () => opts.rate ?? rates[0] ?? null),
      findMany: jest.fn(async () => rates),
      count: jest.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
        if (where?.sourceProviderId) return opts.ratesUsingSourceCount ?? 0;
        return rates.length;
      }),
      aggregate: jest.fn(async () => ({
        _avg: { rate: opts.rateAvg ?? null },
      })),
    },
    exchangeSource: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => opts.source ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "src_new",
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "src_x",
        ...data,
      })),
      delete: jest.fn(async () => ({ id: "src_x" })),
    },
  } as unknown as PrismaService;

  const cache = {
    invalidateRate: jest.fn(async () => undefined),
    getLatestRate: jest.fn(
      async (
        _from: string,
        _to: string,
        fallback: () => unknown,
      ) => fallback(),
    ),
    getRate: jest.fn(async (_id: number, fallback: () => unknown) => fallback()),
    getAverageRate: jest.fn(
      async (
        _from: string,
        _to: string,
        _days: number,
        fallback: () => unknown,
      ) => fallback(),
    ),
  } as unknown as ExchangeRateCacheService;

  return { svc: new ExchangeRateService(prisma, cache), prisma, cache };
}

describe("ExchangeRateService.create", () => {
  it("invalidates cache for the (from,to) pair after insert", async () => {
    const { svc, cache } = buildHarness();
    await svc.create({
      fromCurrency: "USDC",
      toCurrency: "IDR",
      rate: 15700,
      sourceProviderId: "src_x",
    } as never);
    expect(cache.invalidateRate).toHaveBeenCalledWith("USDC", "IDR");
  });

  it("transforms response and includes rate as number", async () => {
    const { svc } = buildHarness();
    const out = await svc.create({
      fromCurrency: "USDC",
      toCurrency: "IDR",
      rate: 15700,
      sourceProviderId: "src_x",
    } as never);
    expect(typeof out.rate).toBe("number");
    expect(out.cursor).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

describe("ExchangeRateService.findLatest", () => {
  it("uses cache when both fromCurrency and toCurrency are provided", async () => {
    const { svc, cache, prisma } = buildHarness({
      rate: makeRate({ rate: "16000" }),
    });
    await svc.findLatest({ fromCurrency: "USDC", toCurrency: "IDR" });
    expect(cache.getLatestRate).toHaveBeenCalled();
    expect(prisma.exchangeRate.findFirst).toHaveBeenCalled();
  });

  it("skips cache when one currency is missing", async () => {
    const { svc, cache } = buildHarness({ rate: makeRate() });
    await svc.findLatest({ fromCurrency: "USDC" } as never);
    expect(cache.getLatestRate).not.toHaveBeenCalled();
  });

  it("returns null when no rate exists", async () => {
    const { svc } = buildHarness({ rate: null });
    const out = await svc.findLatest({
      fromCurrency: "USDC",
      toCurrency: "IDR",
    });
    expect(out).toBeNull();
  });
});

describe("ExchangeRateService.findOne", () => {
  it("404s when rate missing", async () => {
    const { svc } = buildHarness({ rate: null });
    await expect(svc.findOne(999)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("returns transformed rate when present", async () => {
    const { svc } = buildHarness({ rate: makeRate({ id: 7 }) });
    const out = await svc.findOne(7);
    expect(out.id).toBe(7);
  });
});

describe("ExchangeRateService.findAll cursor encoding/decoding", () => {
  it("decodes cursor and applies (timestamp,id) tie-break in where.OR", async () => {
    const { svc, prisma } = buildHarness({ rates: [makeRate()] });
    // Encode a cursor manually so the test pins the on-the-wire format.
    const cursor = Buffer.from(`${new Date("2026-01-01").getTime()}_5`).toString("base64");
    await svc.findAll({ cursor } as never);
    const findMany = (prisma.exchangeRate.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.OR).toHaveLength(2);
  });

  it("uses skip pagination when skip > 0 and ignores cursor", async () => {
    const { svc, prisma } = buildHarness();
    await svc.findAll({ skip: 5, cursor: "ignored", take: 5 } as never);
    const findMany = (prisma.exchangeRate.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.skip).toBe(5);
    expect(findMany.where.OR).toBeUndefined();
  });

  it("clamps take to [1, 100]", async () => {
    const { svc, prisma } = buildHarness();
    await svc.findAll({ take: 999 } as never);
    expect((prisma.exchangeRate.findMany as jest.Mock).mock.calls[0][0].take).toBe(100);

    await svc.findAll({ take: 0 } as never);
    expect((prisma.exchangeRate.findMany as jest.Mock).mock.calls[1][0].take).toBe(10);
  });

  it("composes startDate / endDate / region / provider / isActive filters", async () => {
    const { svc, prisma } = buildHarness();
    await svc.findAll({
      fromCurrency: "USDC",
      toCurrency: "IDR",
      region: "ID",
      provider: "coingecko",
      isActive: true,
      startDate: "2026-01-01",
      endDate: "2026-02-01",
    } as never);
    const findMany = (prisma.exchangeRate.findMany as jest.Mock).mock.calls[0][0];
    expect(findMany.where.fromCurrency).toBe("USDC");
    expect(findMany.where.region).toBe("ID");
    expect(findMany.where.provider).toBe("coingecko");
    expect(findMany.where.createdAt.gte).toBeInstanceOf(Date);
    expect(findMany.where.createdAt.lte).toBeInstanceOf(Date);
  });
});

describe("ExchangeRateService.getAverageRate", () => {
  it("uses cache only when from+to currencies are present", async () => {
    const { svc, cache } = buildHarness({ rateAvg: 15800 });
    await svc.getAverageRate({ fromCurrency: "USDC", toCurrency: "IDR" } as never);
    expect(cache.getAverageRate).toHaveBeenCalled();
  });

  it("returns null when aggregate yields no rate", async () => {
    const { svc } = buildHarness({ rateAvg: null });
    const out = await svc.getAverageRate({} as never);
    expect(out).toBeNull();
  });

  it("returns the aggregate avg as a number", async () => {
    const { svc } = buildHarness({ rateAvg: 12345.67 });
    const out = await svc.getAverageRate({} as never);
    expect(out).toBe(12345.67);
  });
});

describe("ExchangeRateService source CRUD", () => {
  it("findSourceById 404s when missing", async () => {
    const { svc } = buildHarness({ source: null });
    await expect(svc.findSourceById("src_missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("deleteSource is blocked by ConflictException when rates reference it", async () => {
    const { svc } = buildHarness({
      source: { id: "src_x", name: "X" },
      ratesUsingSourceCount: 3,
    });
    await expect(svc.deleteSource("src_x")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("deleteSource succeeds when no rates reference it", async () => {
    const { svc, prisma } = buildHarness({
      source: { id: "src_x", name: "X" },
      ratesUsingSourceCount: 0,
    });
    await svc.deleteSource("src_x");
    expect(prisma.exchangeSource.delete).toHaveBeenCalled();
  });
});
