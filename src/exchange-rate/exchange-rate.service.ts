import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateExchangeRateDto,
  QueryExchangeRateDto,
  ExchangeRateResponseDto,
  GetLatestExchangeRateDto,
} from "./dto/exchange-rate.dto";
import {
  CreateExchangeSourceDto,
  UpdateExchangeSourceDto,
} from "./dto/exchange-source.dto";
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
  ): Promise<{ items: ExchangeRateResponseDto[]; total: number }> {
    const take = Math.max(1, Math.min(100, query.take || 10));
    const skip =
      typeof query.skip === "number" && query.skip > 0 ? query.skip : undefined;
    const cursor = skip ? null : this.decodeCursor(query.cursor);
    const baseWhere = this.buildWhereClause(query);
    const where = { ...baseWhere };

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

    const [rates, total] = await Promise.all([
      this.prisma.exchangeRate.findMany({
        take,
        ...(skip ? { skip } : {}),
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          sourceProvider: true,
        },
      }),
      this.prisma.exchangeRate.count({ where: baseWhere }),
    ]);

    return {
      items: rates.map((rate) => this.transformExchangeRate(rate)),
      total,
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

  async findAllSources() {
    return this.prisma.exchangeSource.findMany({
      orderBy: { priority: "asc" },
    });
  }

  async findSourceById(id: string) {
    const source = await this.prisma.exchangeSource.findUnique({
      where: { id },
    });
    if (!source)
      throw new NotFoundException(`Exchange source ${id} not found`);
    return source;
  }

  async createSource(dto: CreateExchangeSourceDto) {
    return this.prisma.exchangeSource.create({ data: dto });
  }

  async updateSource(id: string, dto: UpdateExchangeSourceDto) {
    await this.findSourceById(id);
    return this.prisma.exchangeSource.update({ where: { id }, data: dto });
  }

  async deleteSource(id: string) {
    await this.findSourceById(id);
    const count = await this.prisma.exchangeRate.count({
      where: { sourceProviderId: id },
    });
    if (count > 0) {
      throw new ConflictException(
        `Cannot delete source: ${count} exchange rates reference it`,
      );
    }
    await this.prisma.exchangeSource.delete({ where: { id } });
  }
}
