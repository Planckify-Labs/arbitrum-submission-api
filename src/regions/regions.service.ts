import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateRegionDto } from "./dto/create-region.dto";
import { UpdateRegionDto } from "./dto/update-region.dto";
import { CreateRegionTokenDto } from "./dto/create-region-token.dto";
import { UpdateRegionTokenDto } from "./dto/update-region-token.dto";
import { SearchRegionDto } from "./dto/search-region.dto";
import { Prisma } from "@generated/prisma";
import { CursorPaginationDto } from "../dto/common/pagination.dto";

@Injectable()
export class RegionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createRegionDto: CreateRegionDto) {
    // Check for unique code
    const existingRegion = await this.prisma.region.findUnique({
      where: { code: createRegionDto.code },
    });

    if (existingRegion) {
      throw new Error(
        `Region with code ${createRegionDto.code} already exists`,
      );
    }

    return this.prisma.region.create({
      data: createRegionDto,
      include: {
        users: true,
        availableTokens: {
          include: {
            token: true,
          },
        },
      },
    });
  }

  async findAll(paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;

    return await this.prisma.region.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      include: {
        users: true,
        availableTokens: {
          include: {
            token: true,
          },
        },
      },
      orderBy: {
        code: "asc",
      },
    });
  }

  async findOne(id: string) {
    const region = await this.prisma.region.findUnique({
      where: { id },
      include: {
        users: true,
        availableTokens: {
          include: {
            token: true,
          },
        },
      },
    });

    if (!region) {
      throw new NotFoundException(`Region with ID ${id} not found`);
    }

    return region;
  }

  async update(id: string, updateRegionDto: UpdateRegionDto) {
    await this.findOne(id); // Check if region exists

    if (updateRegionDto.code) {
      const existingRegion = await this.prisma.region.findFirst({
        where: {
          AND: [{ id: { not: id } }, { code: updateRegionDto.code }],
        },
      });

      if (existingRegion) {
        throw new Error(
          `Region with code ${updateRegionDto.code} already exists`,
        );
      }
    }

    return this.prisma.region.update({
      where: { id },
      data: updateRegionDto,
      include: {
        users: true,
        availableTokens: {
          include: {
            token: true,
          },
        },
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id); // Check if region exists

    await this.prisma.region.delete({
      where: { id },
    });
  }

  async findRegionTokens(id: string, paginationDto: CursorPaginationDto) {
    await this.findOne(id); // Check if region exists

    const { cursor, take = 10 } = paginationDto;

    return this.prisma.regionAvailableToken.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where: { regionId: id },
      include: {
        token: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async addToken(id: string, createRegionTokenDto: CreateRegionTokenDto) {
    await this.findOne(id); // Check if region exists

    // Check if token exists
    const token = await this.prisma.token.findUnique({
      where: { id: createRegionTokenDto.tokenId },
    });

    if (!token) {
      throw new NotFoundException(
        `Token with ID ${createRegionTokenDto.tokenId} not found`,
      );
    }

    // Check if token is already added to region
    const existingToken = await this.prisma.regionAvailableToken.findUnique({
      where: {
        regionId_tokenId: {
          regionId: id,
          tokenId: createRegionTokenDto.tokenId,
        },
      },
    });

    if (existingToken) {
      throw new Error(
        `Token with ID ${createRegionTokenDto.tokenId} is already added to region ${id}`,
      );
    }

    // If this token is set as default, unset other defaults
    if (createRegionTokenDto.isDefault) {
      await this.prisma.regionAvailableToken.updateMany({
        where: { regionId: id },
        data: { isDefault: false },
      });
    }

    return this.prisma.regionAvailableToken.create({
      data: {
        ...createRegionTokenDto,
        regionId: id,
      },
      include: {
        token: true,
      },
    });
  }

  async updateToken(
    id: string,
    tokenId: string,
    updateRegionTokenDto: UpdateRegionTokenDto,
  ) {
    // Check if region token exists
    const regionToken = await this.prisma.regionAvailableToken.findUnique({
      where: {
        regionId_tokenId: {
          regionId: id,
          tokenId,
        },
      },
    });

    if (!regionToken) {
      throw new NotFoundException(
        `Token with ID ${tokenId} not found in region ${id}`,
      );
    }

    // If this token is set as default, unset other defaults
    if (updateRegionTokenDto.isDefault) {
      await this.prisma.regionAvailableToken.updateMany({
        where: {
          AND: [{ regionId: id }, { tokenId: { not: tokenId } }],
        },
        data: { isDefault: false },
      });
    }

    return this.prisma.regionAvailableToken.update({
      where: {
        regionId_tokenId: {
          regionId: id,
          tokenId,
        },
      },
      data: updateRegionTokenDto,
      include: {
        token: true,
      },
    });
  }

  async removeToken(id: string, tokenId: string) {
    // Check if region token exists
    const regionToken = await this.prisma.regionAvailableToken.findUnique({
      where: {
        regionId_tokenId: {
          regionId: id,
          tokenId,
        },
      },
    });

    if (!regionToken) {
      throw new NotFoundException(
        `Token with ID ${tokenId} not found in region ${id}`,
      );
    }

    await this.prisma.regionAvailableToken.delete({
      where: {
        regionId_tokenId: {
          regionId: id,
          tokenId,
        },
      },
    });
  }

  async search(
    searchParams: SearchRegionDto,
    paginationDto: CursorPaginationDto,
  ) {
    const { cursor, take = 10 } = paginationDto;
    const { code, name, currencyCode, isActive, hasKYCRequirement } =
      searchParams;

    const where: Prisma.RegionWhereInput = {};

    if (code) {
      where.code = { contains: code, mode: "insensitive" };
    }

    if (name) {
      where.name = { contains: name, mode: "insensitive" };
    }

    if (currencyCode) {
      where.currencyCode = { contains: currencyCode, mode: "insensitive" };
    }

    if (typeof isActive !== "undefined") {
      where.isActive = isActive;
    }

    if (typeof hasKYCRequirement !== "undefined") {
      where.hasKYCRequirement = hasKYCRequirement;
    }

    return await this.prisma.region.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where,
      include: {
        users: true,
        availableTokens: {
          include: {
            token: true,
          },
        },
      },
      orderBy: {
        code: "asc",
      },
    });
  }
}
