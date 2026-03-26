import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { Prisma } from "@generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { CacheManagerService } from "../valkey/services/cache-manager.service";
import { CreateFlashSaleDto, UpdateFlashSaleDto } from "./dto/flash-sale.dto";

const FLASH_SALES_ACTIVE_CACHE_KEY = "flash-sales:active";
const FLASH_SALES_ACTIVE_TTL = 300; // 5 minutes

const productVariantInclude = {
  include: {
    product: {
      select: {
        id: true,
        name: true,
        imageUrl: true,
        code: true,
      },
    },
  },
};

const productPriceSelect = {
  select: {
    id: true,
    sellPrice: true,
    currency: true,
  },
};

const fullInclude = {
  productVariant: productVariantInclude,
  productPrice: productPriceSelect,
};

type FlashSaleWithRelations = Prisma.FlashSaleGetPayload<{
  include: {
    productVariant: {
      include: {
        product: {
          select: { id: true; name: true; imageUrl: true; code: true };
        };
      };
    };
    productPrice: {
      select: { id: true; sellPrice: true; currency: true };
    };
  };
}>;

export interface ActiveFlashSaleResponse {
  id: string;
  productVariantId: string;
  productPriceId: string;
  discountedPrice: string;
  currency: string;
  startsAt: Date;
  endsAt: Date;
  maxRedemptions: number | null;
  currentRedemptions: number;
  isActive: boolean;
  productVariant: {
    id: string;
    name: string;
    variantCode: string;
    product: {
      id: string;
      name: string;
      imageUrl: string | null;
      code: string;
    };
  };
  productPrice: {
    id: string;
    sellPrice: string;
    currency: string;
  };
  savings: string;
  discountPercent: number;
}

@Injectable()
export class FlashSalesService {
  private readonly logger = new Logger(FlashSalesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheManager: CacheManagerService,
  ) {}

  private computeSavingsAndDiscount(
    flashSale: FlashSaleWithRelations,
  ): { savings: string; discountPercent: number } {
    const sellPrice = new Prisma.Decimal(flashSale.productPrice.sellPrice.toString());
    const discountedPrice = new Prisma.Decimal(flashSale.discountedPrice.toString());

    const savings = sellPrice.sub(discountedPrice);
    const discountPercent = sellPrice.isZero()
      ? 0
      : savings.div(sellPrice).mul(100).toDecimalPlaces(1).toNumber();

    return {
      savings: savings.toFixed(2),
      discountPercent,
    };
  }

  private mapToActiveResponse(flashSale: FlashSaleWithRelations): ActiveFlashSaleResponse {
    const { savings, discountPercent } = this.computeSavingsAndDiscount(flashSale);

    return {
      id: flashSale.id,
      productVariantId: flashSale.productVariantId,
      productPriceId: flashSale.productPriceId,
      discountedPrice: flashSale.discountedPrice.toString(),
      currency: flashSale.currency,
      startsAt: flashSale.startsAt,
      endsAt: flashSale.endsAt,
      maxRedemptions: flashSale.maxRedemptions,
      currentRedemptions: flashSale.currentRedemptions,
      isActive: flashSale.isActive,
      productVariant: {
        id: flashSale.productVariant.id,
        name: flashSale.productVariant.name,
        variantCode: flashSale.productVariant.variantCode,
        product: {
          id: flashSale.productVariant.product.id,
          name: flashSale.productVariant.product.name,
          imageUrl: flashSale.productVariant.product.imageUrl,
          code: flashSale.productVariant.product.code,
        },
      },
      productPrice: {
        id: flashSale.productPrice.id,
        sellPrice: flashSale.productPrice.sellPrice.toString(),
        currency: flashSale.productPrice.currency,
      },
      savings,
      discountPercent,
    };
  }

  /**
   * GET /flash-sales — Active flash sales for the home screen.
   * Cached for 5 minutes under "flash-sales:active".
   */
  async findActive(): Promise<ActiveFlashSaleResponse[]> {
    return this.cacheManager.cacheAside(
      FLASH_SALES_ACTIVE_CACHE_KEY,
      async () => {
        const now = new Date();
        const records = await this.prisma.flashSale.findMany({
          where: {
            isActive: true,
            startsAt: { lte: now },
            endsAt: { gte: now },
          },
          include: fullInclude,
          orderBy: { startsAt: "asc" },
        });

        return records.map((r) => this.mapToActiveResponse(r as FlashSaleWithRelations));
      },
      { ttl: FLASH_SALES_ACTIVE_TTL },
    );
  }

  /**
   * GET /flash-sales/admin — All flash sales paginated (admin only, no cache).
   */
  async findAll(page?: number) {
    const limit = 20;
    const skip = page && page > 1 ? (page - 1) * limit : 0;

    const [total, records] = await Promise.all([
      this.prisma.flashSale.count(),
      this.prisma.flashSale.findMany({
        skip,
        take: limit,
        include: fullInclude,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const hasMore = skip + records.length < total;
    const nextCursor = hasMore && records.length > 0
      ? records[records.length - 1].id
      : null;

    return {
      data: records.map((r) => this.mapToActiveResponse(r as FlashSaleWithRelations)),
      total,
      hasMore,
      nextCursor,
    };
  }

  /**
   * GET /flash-sales/:id — Single flash sale by ID (admin only).
   */
  async findOne(id: string) {
    const record = await this.prisma.flashSale.findUnique({
      where: { id },
      include: fullInclude,
    });

    if (!record) {
      throw new NotFoundException(`Flash sale with ID ${id} not found`);
    }

    return this.mapToActiveResponse(record as FlashSaleWithRelations);
  }

  /**
   * POST /flash-sales — Create a new flash sale (admin only).
   */
  async create(dto: CreateFlashSaleDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);

    if (endsAt <= startsAt) {
      throw new BadRequestException("endsAt must be after startsAt");
    }

    const record = await this.prisma.flashSale.create({
      data: {
        productVariantId: dto.productVariantId,
        productPriceId: dto.productPriceId,
        discountedPrice: new Prisma.Decimal(dto.discountedPrice),
        currency: dto.currency,
        startsAt,
        endsAt,
        maxRedemptions: dto.maxRedemptions ?? null,
        currentRedemptions: 0,
        isActive: true,
      },
      include: fullInclude,
    });

    await this.cacheManager.invalidate(FLASH_SALES_ACTIVE_CACHE_KEY);
    this.logger.log(`Created flash sale ${record.id}`);

    return this.mapToActiveResponse(record as FlashSaleWithRelations);
  }

  /**
   * PUT /flash-sales/:id — Update a flash sale (admin only).
   */
  async update(id: string, dto: UpdateFlashSaleDto) {
    const existing = await this.prisma.flashSale.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Flash sale with ID ${id} not found`);
    }

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : existing.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : existing.endsAt;

    if (endsAt <= startsAt) {
      throw new BadRequestException("endsAt must be after startsAt");
    }

    const record = await this.prisma.flashSale.update({
      where: { id },
      data: {
        ...(dto.productVariantId !== undefined && { productVariantId: dto.productVariantId }),
        ...(dto.productPriceId !== undefined && { productPriceId: dto.productPriceId }),
        ...(dto.discountedPrice !== undefined && {
          discountedPrice: new Prisma.Decimal(dto.discountedPrice),
        }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        startsAt,
        endsAt,
        ...(dto.maxRedemptions !== undefined && { maxRedemptions: dto.maxRedemptions }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: fullInclude,
    });

    await this.cacheManager.invalidate(FLASH_SALES_ACTIVE_CACHE_KEY);
    this.logger.log(`Updated flash sale ${id}`);

    return this.mapToActiveResponse(record as FlashSaleWithRelations);
  }

  /**
   * DELETE /flash-sales/:id — Delete a flash sale (admin only).
   */
  async remove(id: string): Promise<void> {
    const existing = await this.prisma.flashSale.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Flash sale with ID ${id} not found`);
    }

    await this.prisma.flashSale.delete({ where: { id } });
    await this.cacheManager.invalidate(FLASH_SALES_ACTIVE_CACHE_KEY);
    this.logger.log(`Deleted flash sale ${id}`);
  }
}
