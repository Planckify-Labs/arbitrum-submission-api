import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProductDto, UpdateProductDto } from "./dto/product.dto";

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
      console.error(error);
      throw new NotFoundException(`Product with ID ${id} not found`);
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.product.delete({
        where: { id },
      });
    } catch (error) {
      console.error(error);
      throw new NotFoundException(`Product with ID ${id} not found`);
    }
  }
}
