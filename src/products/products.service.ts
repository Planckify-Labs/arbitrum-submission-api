import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProductDto, UpdateProductDto } from "./dto/product.dto";
import {
  CreateProductPriceDto,
  UpdateProductPriceDto,
} from "./dto/product-price.dto";
import { CreateCategoryDto, UpdateCategoryDto } from "./dto/category.dto";
import { Prisma } from "generated/prisma";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import { SearchProductVariantDto } from "./dto/search-product-variant.dto";

interface SearchProductsParams {
  query?: string;
  vendorId?: string;
  active?: boolean;
  code?: string;
  id?: string;
  name?: string;
  vendorName?: string;
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;

    return this.prisma.product.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: {
        name: "asc",
      },
    });
  }

  search(params: SearchProductsParams, paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;
    const { query, vendorId, active, code, id, name, vendorName } = params;

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

    return this.prisma.product.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where,
      include: {
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
      },
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
    const products = await this.prisma.product.findMany({
      where: { categoryId },
      include: {
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
      },
    });

    if (!products.length) {
      throw new NotFoundException(
        `No products found for category ${categoryId}`,
      );
    }

    return products;
  }

  async findByCode(code: string) {
    const product = await this.prisma.product.findFirst({
      where: { code },
      include: {
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
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with code ${code} not found`);
    }

    return product;
  }

  async findPrices(id: string) {
    const product = await this.prisma.product.findUnique({
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
      return await this.prisma.productPrice.create({
        data: {
          ...data,
          productVariantId,
        },
        include: {
          vendor: true,
          productVariant: true,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new NotFoundException("Failed to create product price");
      }
      throw error;
    }
  }

  async updatePrice(priceId: string, data: UpdateProductPriceDto) {
    try {
      return await this.prisma.productPrice.update({
        where: { id: priceId },
        data,
        include: {
          vendor: true,
          productVariant: true,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new NotFoundException(`Price with ID ${priceId} not found`);
      }
      throw error;
    }
  }

  async removePrice(priceId: string) {
    try {
      return await this.prisma.productPrice.delete({
        where: { id: priceId },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new NotFoundException(`Price with ID ${priceId} not found`);
      }
      throw error;
    }
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
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
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return product;
  }

  create(data: CreateProductDto) {
    return this.prisma.product.create({
      data,
      include: {
        category: true,
        variants: true,
      },
    });
  }

  async update(id: string, data: UpdateProductDto) {
    try {
      return await this.prisma.product.update({
        where: { id },
        data,
        include: {
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
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new NotFoundException(`Product with ID ${id} not found`);
      }
      throw error;
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.product.delete({
        where: { id },
      });
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

  createCategory(data: CreateCategoryDto) {
    return this.prisma.category.create({
      data,
      include: {
        Product: true,
      },
    });
  }

  async updateCategory(id: string, data: UpdateCategoryDto) {
    try {
      return await this.prisma.category.update({
        where: { id },
        data,
        include: {
          Product: true,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw new NotFoundException(`Category with ID ${id} not found`);
      }
      throw error;
    }
  }

  async removeCategory(id: string) {
    try {
      return await this.prisma.category.delete({
        where: { id },
      });
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
    const { sku, name, productId, isActive, query } = params;

    const where: Prisma.ProductVariantWhereInput = {};

    if (sku) {
      where.sku = {
        contains: sku,
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

    if (query && !sku && !name) {
      where.OR = [
        { name: { contains: query, mode: "insensitive" } },
        { sku: { contains: query, mode: "insensitive" } },
      ];
    }

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
    const categories = await this.prisma.category.findMany({
      include: {
        Product: {
          take: take ? take : 6,
        },
      },
      orderBy: {
        name: "asc",
      },
    });

    return categories.map((category) => ({
      category: {
        id: category.id,
        name: category.name,
      },
      products: category.Product,
    }));
  }
}
