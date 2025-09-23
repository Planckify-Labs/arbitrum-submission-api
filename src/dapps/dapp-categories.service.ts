import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateDappCategoryDto,
  UpdateDappCategoryDto,
} from "./dto/dapp-category.dto";
import { Prisma } from "generated/prisma";

@Injectable()
export class DappCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return await this.prisma.dappCategory.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        name: "asc",
      },
      include: {
        _count: {
          select: {
            dapps: {
              where: {
                isActive: true,
              },
            },
          },
        },
      },
    });
  }

  async findOne(id: string) {
    const category = await this.prisma.dappCategory.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            dapps: {
              where: {
                isActive: true,
              },
            },
          },
        },
      },
    });

    if (!category) {
      throw new NotFoundException("Category not found");
    }

    return category;
  }

  async create(createDappCategoryDto: CreateDappCategoryDto) {
    try {
      return await this.prisma.dappCategory.create({
        data: createDappCategoryDto,
        include: {
          _count: {
            select: {
              dapps: true,
            },
          },
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Category name already exists");
      }
      throw error;
    }
  }

  async update(id: string, updateDappCategoryDto: UpdateDappCategoryDto) {
    const existingCategory = await this.prisma.dappCategory.findUnique({
      where: { id },
    });

    if (!existingCategory) {
      throw new NotFoundException("Category not found");
    }

    try {
      return await this.prisma.dappCategory.update({
        where: { id },
        data: updateDappCategoryDto,
        include: {
          _count: {
            select: {
              dapps: true,
            },
          },
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Category name already exists");
      }
      throw error;
    }
  }

  async remove(id: string) {
    const category = await this.prisma.dappCategory.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            dapps: true,
          },
        },
      },
    });

    if (!category) {
      throw new NotFoundException("Category not found");
    }

    if (category._count.dapps > 0) {
      throw new ConflictException(
        "Cannot delete category with associated dapps",
      );
    }

    await this.prisma.dappCategory.delete({
      where: { id },
    });

    return { message: "Category deleted successfully" };
  }
}
