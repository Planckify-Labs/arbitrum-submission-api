import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateExchangeRateDto,
  QueryExchangeRateDto,
  CursorPaginatedExchangeRateResponse,
  ExchangeRateResponseDto,
  GetLatestExchangeRateDto,
} from "./dto/exchange-rate.dto";
import { Prisma, ExchangeRate } from "@generated/prisma";
import { ExchangeRateCacheService } from "../valkey/services/exchange-rate-cache.service";

@Injectable()
export class ExchangeRateService {
  constructor(
    private prisma: PrismaService,
    private exchangeRateCache: ExchangeRateCacheService,
  ) {}

  async create(data: CreateExchangeRateDto) {
    const now = new Date();
    const result = await this.prisma.exchangeRate.create({
      data: {
        ...data,
        createdAt: now,
      },
      include: {
        sourceProvider: true,
      },
    });

    // Invalidate cache for this currency pair after creation
    await this.exchangeRateCache.invalidateRate(data.fromCurrency, data.toCurrency);

    return this.transformExchangeRate(result);
  }

  async findLatest(query: GetLatestExchangeRateDto) {
    if (!query.fromCurrency || !query.toCurrency) {
      // If currencies not specified, skip cache
      const where: Prisma.ExchangeRateWhereInput = {};
      if (query.fromCurrency) where.fromCurrency = query.fromCurrency;
      if (query.toCurrency) where.toCurrency = query.toCurrency;

      const result = await this.prisma.exchangeRate.findFirst({
        where,
        orderBy: { createdAt: "desc" },
        include: { sourceProvider: true },
      });

      return result ? this.transformExchangeRate(result) : null;
    }

    // Use cache for specific currency pair
    const result = await this.exchangeRateCache.getLatestRate(
      query.fromCurrency,
      query.toCurrency,
      async () => {
        const where: Prisma.ExchangeRateWhereInput = {
          fromCurrency: query.fromCurrency,
          toCurrency: query.toCurrency,
        };

        return this.prisma.exchangeRate.findFirst({
          where,
          orderBy: { createdAt: "desc" },
          include: { sourceProvider: true },
        });
      },
    );

    return result ? this.transformExchangeRate(result) : null;
  }

  async findOne(id: number) {
    const result = await this.exchangeRateCache.getRate(id, async () => {
      return this.prisma.exchangeRate.findFirst({
        where: { id },
        include: { sourceProvider: true },
        orderBy: { createdAt: "desc" },
      });
    });

    if (!result) {
      throw new NotFoundException(`Exchange rate with ID ${id} not found`);
    }

    return this.transformExchangeRate(result);
  }

  async findAll(
    query: QueryExchangeRateDto,
  ): Promise<CursorPaginatedExchangeRateResponse> {
    const take = Math.max(1, Math.min(100, query.take || 10));
    const cursor = this.decodeCursor(query.cursor);
    const where = this.buildWhereClause(query);

    if (cursor) {
      where.OR = [
        {
          createdAt: cursor.timestamp,
          id: { lt: cursor.id },
        },
        {
          createdAt: { lt: cursor.timestamp },
        },
      ];
    }

    // Paginated queries are not cached due to cursor complexity
    const rates = await this.prisma.exchangeRate.findMany({
      take: take + 1,
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        sourceProvider: true,
      },
    });

    const hasMore = rates.length > take;
    const items = rates.slice(0, take);

    const transformedItems = items.map((rate) =>
      this.transformExchangeRate(rate),
    );

    const nextCursor =
      hasMore && items.length > 0
        ? this.encodeCursor(items[items.length - 1])
        : undefined;

    return {
      data: transformedItems,
      count: items.length,
      nextCursor,
      hasMore,
    };
  }

  async getAverageRate(query: QueryExchangeRateDto) {
    if (!query.fromCurrency || !query.toCurrency) {
      // If currencies not specified, skip cache
      const where = this.buildWhereClause(query);
      const result = await this.prisma.exchangeRate.aggregate({
        where,
        _avg: { rate: true },
      });
      return result._avg.rate ? Number(result._avg.rate) : null;
    }

    // Calculate days for cache key (default to 30 days if date range provided)
    const days = query.startDate && query.endDate
      ? Math.ceil((new Date(query.endDate).getTime() - new Date(query.startDate).getTime()) / (1000 * 60 * 60 * 24))
      : 30;

    return this.exchangeRateCache.getAverageRate(
      query.fromCurrency,
      query.toCurrency,
      days,
      async () => {
        const where = this.buildWhereClause(query);
        const result = await this.prisma.exchangeRate.aggregate({
          where,
          _avg: { rate: true },
        });
        return result._avg.rate ? Number(result._avg.rate) : null;
      },
    );
  }

  private buildWhereClause(
    query: QueryExchangeRateDto,
  ): Prisma.ExchangeRateWhereInput {
    const where: Prisma.ExchangeRateWhereInput = {};

    if (query.fromCurrency) {
      where.fromCurrency = query.fromCurrency;
    }

    if (query.toCurrency) {
      where.toCurrency = query.toCurrency;
    }

    if (query.region) {
      where.region = query.region;
    }

    if (query.provider) {
      where.provider = query.provider;
    }

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};

      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }

      if (query.endDate) {
        where.createdAt.lte = new Date(query.endDate);
      }
    }

    return where;
  }

  private transformExchangeRate(
    rate: ExchangeRate & { sourceProvider: { id: string; name: string } },
  ): ExchangeRateResponseDto {
    return {
      id: rate.id,
      fromCurrency: rate.fromCurrency,
      toCurrency: rate.toCurrency,
      rate: Number(rate.rate),
      sourceProvider: {
        id: rate.sourceProvider.id,
        name: rate.sourceProvider.name,
      },
      region: rate.region || undefined,
      provider: rate.provider || undefined,
      markup: rate.markup ? Number(rate.markup) : undefined,
      isActive: rate.isActive,
      createdAt: rate.createdAt,
      cursor: this.encodeCursor(rate),
    };
  }

  private encodeCursor(rate: ExchangeRate): string {
    const timestamp = rate.createdAt.getTime();
    const cursor = `${timestamp}_${rate.id}`;
    return Buffer.from(cursor).toString("base64");
  }

  private decodeCursor(
    cursor?: string,
  ): { timestamp: Date; id: number } | null {
    if (!cursor) return null;

    try {
      const decoded = Buffer.from(cursor, "base64").toString();
      const [timestamp, id] = decoded.split("_");
      return {
        timestamp: new Date(parseInt(timestamp)),
        id: parseInt(id),
      };
    } catch {
      return null;
    }
  }
}
