import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProductDto, UpdateProductDto } from "./dto/product.dto";
import {
  CreateProductPriceDto,
  UpdateProductPriceDto,
} from "./dto/product-price.dto";
import { CreateCategoryDto, UpdateCategoryDto } from "./dto/category.dto";
import { Prisma } from "@generated/prisma";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import { SearchProductVariantDto } from "./dto/search-product-variant.dto";
import { VCGamersService } from "../providers/vendor-api/implementations/vcgamers/vcgamers.service";
import { SearchProductDto } from "./dto/search-product.dto";
import {
  CreateProductInputFieldDto,
  UpdateProductInputFieldDto,
} from "./dto/product-input-field.dto";
import { ProductCacheService } from "../valkey/services/product-cache.service";
import { CacheManagerService } from "../valkey/services/cache-manager.service";
import { PaymentFeaturedResponseDto } from "./dto/payment-featured.dto";

// Known product codes for featured payment items
const PULSA_DATA_PRODUCT_CODES = ["PSATL", "PSAIN", "XL"];
const GAMING_PRODUCT_CODES = ["MLBB", "FF", "PUBGM", "CODM"];
const PLN_PRODUCT_CODE = "PLN";
const PAYMENT_FEATURED_CACHE_KEY = "payment-featured:config";
const PAYMENT_FEATURED_CACHE_TTL = 3600; // 1 hour

// Standard product include for consistency
const productInclude = {
  category: true,
  variants: {
    include: {
      ProductPrice: {
        include: {
          vendor: true,
        },
      },
    },
  },
} as const;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vcGamersService: VCGamersService,
    private readonly productCache: ProductCacheService,
    private readonly cacheManager: CacheManagerService,
  ) {}

  async findAll(paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;

    return this.productCache.getProductList(cursor ?? "first", async () => {
      return this.prisma.product.findMany({
        take,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        include: productInclude,
        orderBy: {
          name: "asc",
        },
      });
    });
  }

  search(params: SearchProductDto, paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;
    const { query, vendorId, active, code, id, name, vendorName, isVoucher } =
      params;

    const where: Prisma.ProductWhereInput = {};

    if (id) {
      where.id = id;
    }

    if (code) {
      where.code = {
        contains: code,
        mode: "insensitive",
      };
    }

    if (name) {
      where.name = {
        contains: name,
        mode: "insensitive",
      };
    }

    if (vendorName) {
      where.variants = {
        some: {
          ProductPrice: {
            some: {
              vendor: {
                name: {
                  contains: vendorName,
                  mode: "insensitive",
                },
              },
            },
          },
        },
      };
    }

    if (query && !id && !code && !name && !vendorName) {
      where.OR = [
        { name: { contains: query, mode: "insensitive" } },
        { code: { contains: query, mode: "insensitive" } },
        {
          variants: {
            some: {
              ProductPrice: {
                some: {
                  vendor: {
                    name: {
                      contains: query,
                      mode: "insensitive",
                    },
                  },
                },
              },
            },
          },
        },
      ];
    }

    if (vendorId) {
      where.variants = {
        some: {
          ProductPrice: {
            some: {
              vendorId: vendorId,
            },
          },
        },
      };
    }

    if (active !== undefined) {
      where.isActive = active;
    }

    if (isVoucher !== undefined) {
      where.isVoucher = isVoucher;
    }

    // Search queries are not cached due to high variability
    return this.prisma.product.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where,
      include: productInclude,
      orderBy: {
        name: "asc",
      },
    });
  }

  findVouchers(paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;

    return this.prisma.product.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where: {
        isVoucher: true,
        isActive: true,
      },
      include: productInclude,
      orderBy: {
        name: "asc",
      },
    });
  }

  findNonVouchers(paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;

    return this.prisma.product.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where: {
        isVoucher: false,
        isActive: true,
      },
      include: productInclude,
      orderBy: {
        name: "asc",
      },
    });
  }

  findAllCategories(paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;

    return this.prisma.category.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: {
        name: "asc",
      },
    });
  }

  async findByCategory(categoryId: string) {
    return this.productCache.getProductsByCategory(categoryId, async () => {
      return this.prisma.product.findMany({
        where: { categoryId },
        include: productInclude,
      });
    });
  }

  async findByCode(code: string) {
    const product = await this.productCache.getProductByCode(code, async () => {
      return this.prisma.product.findFirst({
        where: { code },
        include: productInclude,
      });
    });

    if (!product) {
      throw new NotFoundException(`Product with code ${code} not found`);
    }

    return product;
  }

  async findPrices(id: string) {
    const product = await this.productCache.getProductPrices(id, async () => {
      return this.prisma.product.findUnique({
        where: { id },
        include: {
          variants: {
            include: {
              ProductPrice: {
                include: {
                  vendor: true,
                },
              },
            },
          },
        },
      });
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    const prices = product.variants.flatMap((variant) => variant.ProductPrice);
    return prices;
  }

  async createPrice(productVariantId: string, data: CreateProductPriceDto) {
    const productVariant = await this.prisma.productVariant.findUnique({
      where: { id: productVariantId },
    });

    if (!productVariant) {
      throw new NotFoundException(
        `Product variant with ID ${productVariantId} not found`,
      );
    }

    try {
      const price = await this.prisma.productPrice.create({
        data: {
          ...data,
          productVariantId,
        },
        include: {
          vendor: true,
          productVariant: true,
        },
      });

      // Invalidate product cache after price creation
      await this.productCache.invalidateProduct(productVariant.productId);

      return price;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new NotFoundException("Failed to create product price");
      }
      throw error;
    }
  }

  async updatePrice(priceId: string, data: UpdateProductPriceDto) {
    try {
      const price = await this.prisma.productPrice.update({
        where: { id: priceId },
        data,
        include: {
          vendor: true,
          productVariant: true,
        },
      });

      // Invalidate product cache after price update
      await this.productCache.invalidateProduct(price.productVariant.productId);

      return price;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new NotFoundException(`Price with ID ${priceId} not found`);
      }
      throw error;
    }
  }

  async removePrice(priceId: string) {
    try {
      // Get price with variant to know which product to invalidate
      const existingPrice = await this.prisma.productPrice.findUnique({
        where: { id: priceId },
        include: { productVariant: true },
      });

      const result = await this.prisma.productPrice.delete({
        where: { id: priceId },
      });

      // Invalidate product cache after price deletion
      if (existingPrice) {
        await this.productCache.invalidateProduct(existingPrice.productVariant.productId);
      }

      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new NotFoundException(`Price with ID ${priceId} not found`);
      }
      throw error;
    }
  }

  async findOne(id: string) {
    const product = await this.productCache.getProductDetails(id, async () => {
      return this.prisma.product.findUnique({
        where: { id },
        include: productInclude,
      });
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return product;
  }

  async create(data: CreateProductDto) {
    const product = await this.prisma.product.create({
      data,
      include: {
        category: true,
        variants: true,
      },
    });

    // Invalidate catalog cache after product creation
    await this.productCache.invalidateProduct();

    return product;
  }

  async update(id: string, data: UpdateProductDto) {
    try {
      const product = await this.prisma.product.update({
        where: { id },
        data,
        include: productInclude,
      });

      // Invalidate specific product cache after update
      await this.productCache.invalidateProduct(id);

      return product;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new NotFoundException(`Product with ID ${id} not found`);
      }
      throw error;
    }
  }

  async remove(id: string) {
    try {
      const result = await this.prisma.product.delete({
        where: { id },
      });

      // Invalidate product cache after deletion
      await this.productCache.invalidateProduct(id);

      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new NotFoundException(`Product with ID ${id} not found`);
      }
      throw error;
    }
  }

  async findOneCategory(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        Product: true,
      },
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    return category;
  }

  async createCategory(data: CreateCategoryDto) {
    const category = await this.prisma.category.create({
      data,
      include: {
        Product: true,
      },
    });

    // Invalidate category cache after creation
    await this.productCache.invalidateCategory();

    return category;
  }

  async updateCategory(id: string, data: UpdateCategoryDto) {
    try {
      const category = await this.prisma.category.update({
        where: { id },
        data,
        include: {
          Product: true,
        },
      });

      // Invalidate category cache after update
      await this.productCache.invalidateCategory(id);

      return category;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new NotFoundException(`Category with ID ${id} not found`);
      }
      throw error;
    }
  }

  async removeCategory(id: string) {
    try {
      const result = await this.prisma.category.delete({
        where: { id },
      });

      // Invalidate category cache after deletion
      await this.productCache.invalidateCategory(id);

      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new NotFoundException(`Category with ID ${id} not found`);
      }
      throw error;
    }
  }

  async findVariants(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${productId} not found`);
    }

    return this.productCache.getProductVariants(productId, async () => {
      return this.prisma.productVariant.findMany({
        where: { productId },
        include: {
          ProductPrice: {
            include: {
              vendor: true,
            },
          },
        },
        orderBy: {
          name: "asc",
        },
      });
    });
  }

  async findOneVariant(id: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id },
      include: {
        product: true,
        ProductPrice: {
          include: {
            vendor: true,
          },
        },
      },
    });

    if (!variant) {
      throw new NotFoundException(`Product variant with ID ${id} not found`);
    }

    return variant;
  }

  async searchVariants(
    params: SearchProductVariantDto,
    paginationDto: CursorPaginationDto,
  ) {
    const { cursor, take = 10 } = paginationDto;
    const { variantCode, name, productId, isActive, query } = params;

    const where: Prisma.ProductVariantWhereInput = {};

    if (variantCode) {
      where.variantCode = {
        contains: variantCode,
        mode: "insensitive",
      };
    }

    if (name) {
      where.name = {
        contains: name,
        mode: "insensitive",
      };
    }

    if (productId) {
      where.productId = productId;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (query && !variantCode && !name) {
      where.OR = [
        { name: { contains: query, mode: "insensitive" } },
        { variantCode: { contains: query, mode: "insensitive" } },
      ];
    }

    // Search queries are not cached due to high variability
    return await this.prisma.productVariant.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where,
      include: {
        product: true,
        ProductPrice: {
          include: {
            vendor: true,
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    });
  }

  async findAllGroupedByCategories(take?: number) {
    return this.productCache.getCatalogGrouped(async () => {
      const categories = await this.prisma.category.findMany({
        select: {
          id: true,
          name: true,
          Product: {
            take: take ? take : 6,
            where: {
              isActive: true,
            },
            select: {
              id: true,
              name: true,
              description: true,
              imageUrl: true,
              code: true,
              categoryId: true,
              isActive: true,
              isVoucher: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
        where: {
          isActive: true,
          Product: {
            some: {
              isActive: true,
            },
          },
        },
        orderBy: {
          name: "asc",
        },
      });

      return categories.map((category) => {
        return {
          category: {
            id: category.id,
            name: category.name,
          },
          products: category.Product,
        };
      });
    });
  }

  async createProductInputField(
    productId: string,
    createInputFieldDto: CreateProductInputFieldDto,
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${productId} not found`);
    }

    const inputField = await this.prisma.productInputField.create({
      data: {
        product: {
          connect: { id: productId },
        },
        forms: JSON.parse(JSON.stringify(createInputFieldDto.fields)),
      },
    });

    // Invalidate product cache after input field creation
    await this.productCache.invalidateProduct(productId);

    return inputField;
  }

  async updateProductInputField(
    productId: string,
    fieldId: string,
    updateInputFieldDto: UpdateProductInputFieldDto,
  ) {
    const existingField = await this.prisma.productInputField.findFirst({
      where: {
        id: fieldId,
        productId,
      },
    });

    if (!existingField) {
      throw new NotFoundException(
        `Input field with ID ${fieldId} not found for product ${productId}`,
      );
    }

    if (
      !updateInputFieldDto.fields ||
      updateInputFieldDto.fields.length === 0
    ) {
      throw new BadRequestException("No form fields provided for update");
    }

    const inputField = await this.prisma.productInputField.update({
      where: { id: fieldId },
      data: {
        forms: JSON.parse(JSON.stringify(updateInputFieldDto.fields)),
      },
    });

    // Invalidate product cache after input field update
    await this.productCache.invalidateProduct(productId);

    return inputField;
  }

  async deleteProductInputField(productId: string, fieldId: string) {
    const existingField = await this.prisma.productInputField.findFirst({
      where: {
        id: fieldId,
        productId,
      },
    });

    if (!existingField) {
      throw new NotFoundException(
        `Input field with ID ${fieldId} not found for product ${productId}`,
      );
    }

    const result = await this.prisma.productInputField.delete({
      where: { id: fieldId },
    });

    // Invalidate product cache after input field deletion
    await this.productCache.invalidateProduct(productId);

    return result;
  }

  async getPaymentFeatured(): Promise<PaymentFeaturedResponseDto> {
    return this.cacheManager.cacheAside(
      PAYMENT_FEATURED_CACHE_KEY,
      () => this.fetchPaymentFeatured(),
      { ttl: PAYMENT_FEATURED_CACHE_TTL },
    );
  }

  private async fetchPaymentFeatured(): Promise<PaymentFeaturedResponseDto> {
    const [plnProduct, pulsaDataProduct, gamingProduct] = await Promise.all([
      this.prisma.product.findFirst({
        where: {
          code: PLN_PRODUCT_CODE,
          isActive: true,
        },
        select: {
          id: true,
        },
      }),
      this.prisma.product.findFirst({
        where: {
          code: { in: PULSA_DATA_PRODUCT_CODES },
          isActive: true,
        },
        select: {
          category: {
            select: {
              id: true,
            },
          },
        },
      }),
      this.prisma.product.findFirst({
        where: {
          code: { in: GAMING_PRODUCT_CODES },
          isActive: true,
        },
        select: {
          category: {
            select: {
              id: true,
            },
          },
        },
      }),
    ]);

    const result: PaymentFeaturedResponseDto = {};

    if (pulsaDataProduct?.category) {
      result["Pulsa & Data Package"] = { id: pulsaDataProduct.category.id };
    }

    if (gamingProduct?.category) {
      result["Gaming"] = { id: gamingProduct.category.id };
    }

    if (plnProduct) {
      result["Token PLN"] = { id: plnProduct.id };
    }

    return result;
  }
}
