import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProductDto, UpdateProductDto } from "./dto/product.dto";
import {
  CreateProductPriceDto,
  UpdateProductPriceDto,
} from "./dto/product-price.dto";
import { CreateCategoryDto, UpdateCategoryDto } from "./dto/category.dto";
import { Prisma } from "generated/prisma";

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
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.product.findMany({
      include: {
        category: true,
        vendor: true,
        ProductPrice: true,
      },
    });
  }

  search({
    query,
    vendorId,
    active,
    code,
    id,
    name,
    vendorName,
  }: SearchProductsParams) {
    const where: Prisma.ProductWhereInput = {};

    // Handle direct ID search
    if (id) {
      where.id = id;
    }

    // Handle direct code search
    if (code) {
      where.code = {
        contains: code,
        mode: "insensitive",
      };
    }

    // Handle direct name search
    if (name) {
      where.name = {
        contains: name,
        mode: "insensitive",
      };
    }

    // Handle vendor name search
    if (vendorName) {
      where.vendor = {
        name: {
          contains: vendorName,
          mode: "insensitive",
        },
      };
    }

    // Handle general query search
    if (query && !id && !code && !name && !vendorName) {
      where.OR = [
        { name: { contains: query, mode: "insensitive" } },
        { code: { contains: query, mode: "insensitive" } },
        {
          vendor: {
            name: {
              contains: query,
              mode: "insensitive",
            },
          },
        },
      ];
    }

    // Handle vendor filter
    if (vendorId) {
      where.vendorId = vendorId;
    }

    // Handle active status filter
    if (active !== undefined) {
      where.isActive = active;
    }

    return this.prisma.product.findMany({
      where,
      include: {
        category: true,
        vendor: true,
        ProductPrice: true,
      },
    });
  }

  findAllCategories() {
    return this.prisma.category.findMany({
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
        vendor: true,
        ProductPrice: true,
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
        vendor: true,
        ProductPrice: true,
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
        ProductPrice: {
          include: {
            vendor: true,
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return product.ProductPrice;
  }

  async createPrice(productId: string, data: CreateProductPriceDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${productId} not found`);
    }

    try {
      return await this.prisma.productPrice.create({
        data: {
          ...data,
          productId,
        },
        include: {
          vendor: true,
          product: true,
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
          product: true,
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
        vendor: true,
        ProductPrice: true,
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
        vendor: true,
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
          vendor: true,
          ProductPrice: true,
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
}
