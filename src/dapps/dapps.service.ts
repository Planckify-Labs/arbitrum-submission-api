import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateDappDto, UpdateDappDto } from "./dto/dapp.dto";
import { Prisma } from "@generated/prisma";
import { CursorPaginationDto } from "../dto/common/pagination.dto";

@Injectable()
export class DappsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(paginationDto: CursorPaginationDto, userId?: string) {
    const { cursor, take = 10, skip } = paginationDto;
    const useSkip = typeof skip === "number" && skip > 0;
    const where: Prisma.DappWhereInput = {
      isActive: true,
    };

    const findArgs = {
      take,
      skip: useSkip ? skip : cursor ? 1 : 0,
      cursor: useSkip ? undefined : cursor ? { id: cursor } : undefined,
    };

    const [dapps, total] = await Promise.all([
      this.prisma.dapp.findMany({
        ...findArgs,
        where,
        include: {
          category: true,
          favorites: userId ? { where: { userId } } : false,
        },
        orderBy: {
          createdAt: "desc",
        },
      }),
      this.prisma.dapp.count({ where }),
    ]);

    return {
      items: dapps.map((dapp) => ({
        ...dapp,
        isFavorite: userId ? dapp.favorites.length > 0 : false,
        favorites: undefined,
      })),
      total,
    };
  }

  async findPopular(paginationDto: CursorPaginationDto, userId?: string) {
    const { cursor, take = 10 } = paginationDto;

    const dapps = await this.prisma.dapp.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where: {
        isActive: true,
        isPopular: true,
      },
      include: {
        category: true,
        favorites: userId ? { where: { userId } } : false,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });

    return dapps.map((dapp) => ({
      ...dapp,
      isFavorite: userId ? dapp.favorites.length > 0 : false,
      favorites: undefined,
    }));
  }

  async findSponsored(paginationDto: CursorPaginationDto, userId?: string) {
    const { cursor, take = 10 } = paginationDto;

    const dapps = await this.prisma.dapp.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where: {
        isActive: true,
        isSponsor: true,
      },
      include: {
        category: true,
        favorites: userId ? { where: { userId } } : false,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });

    return dapps.map((dapp) => ({
      ...dapp,
      isFavorite: userId ? dapp.favorites.length > 0 : false,
      favorites: undefined,
    }));
  }

  async findByCategory(
    categoryId: string,
    paginationDto: CursorPaginationDto,
    userId?: string,
  ) {
    const { cursor, take = 10 } = paginationDto;

    const category = await this.prisma.dappCategory.findUnique({
      where: { id: categoryId },
    });

    if (!category) {
      throw new NotFoundException("Category not found");
    }

    const dapps = await this.prisma.dapp.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where: {
        isActive: true,
        categoryId,
      },
      include: {
        category: true,
        favorites: userId ? { where: { userId } } : false,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });

    return dapps.map((dapp) => ({
      ...dapp,
      isFavorite: userId ? dapp.favorites.length > 0 : false,
      favorites: undefined,
    }));
  }

  async findUserFavorites(userId: string, paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;

    const favorites = await this.prisma.userDappFavorite.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where: {
        userId,
      },
      include: {
        dapp: {
          include: {
            category: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return favorites.map((favorite) => ({
      ...favorite.dapp,
      isFavorite: true,
    }));
  }

  async addToFavorites(userId: string, dappId: string) {
    // Verify dapp exists
    const dapp = await this.prisma.dapp.findUnique({
      where: { id: dappId },
    });

    if (!dapp) {
      throw new NotFoundException("Dapp not found");
    }

    try {
      await this.prisma.userDappFavorite.create({
        data: {
          userId,
          dappId,
        },
      });

      return { message: "Dapp added to favorites successfully" };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Dapp is already in favorites");
      }
      throw error;
    }
  }

  async removeFromFavorites(userId: string, dappId: string) {
    const favorite = await this.prisma.userDappFavorite.findUnique({
      where: {
        userId_dappId: {
          userId,
          dappId,
        },
      },
    });

    if (!favorite) {
      throw new NotFoundException("Favorite not found");
    }

    await this.prisma.userDappFavorite.delete({
      where: {
        id: favorite.id,
      },
    });

    return { message: "Dapp removed from favorites successfully" };
  }

  async findOne(id: string, userId?: string) {
    const dapp = await this.prisma.dapp.findUnique({
      where: { id },
      include: {
        category: true,
        favorites: userId ? { where: { userId } } : false,
      },
    });

    if (!dapp) {
      throw new NotFoundException("Dapp not found");
    }

    return {
      ...dapp,
      isFavorite: userId ? dapp.favorites.length > 0 : false,
      favorites: undefined,
    };
  }

  async create(createDappDto: CreateDappDto) {
    const category = await this.prisma.dappCategory.findUnique({
      where: { id: createDappDto.categoryId },
    });

    if (!category) {
      throw new BadRequestException("Category not found");
    }

    return this.prisma.dapp.create({
      data: createDappDto,
      include: {
        category: true,
      },
    });
  }

  async update(id: string, updateDappDto: UpdateDappDto) {
    const existingDapp = await this.prisma.dapp.findUnique({
      where: { id },
    });

    if (!existingDapp) {
      throw new NotFoundException("Dapp not found");
    }

    if (updateDappDto.categoryId) {
      const category = await this.prisma.dappCategory.findUnique({
        where: { id: updateDappDto.categoryId },
      });

      if (!category) {
        throw new BadRequestException("Category not found");
      }
    }

    return this.prisma.dapp.update({
      where: { id },
      data: updateDappDto,
      include: {
        category: true,
      },
    });
  }

  async remove(id: string) {
    const dapp = await this.prisma.dapp.findUnique({
      where: { id },
    });

    if (!dapp) {
      throw new NotFoundException("Dapp not found");
    }

    await this.prisma.dapp.delete({
      where: { id },
    });

    return { message: "Dapp deleted successfully" };
  }
}
