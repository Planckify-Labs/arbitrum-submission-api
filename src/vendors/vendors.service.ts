import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateVendorDto } from "./dto/create-vendor.dto";
import { UpdateVendorDto } from "./dto/update-vendor.dto";
import { CursorPaginationDto } from "../dto/common/pagination.dto";

@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createVendorDto: CreateVendorDto) {
    return await this.prisma.vendor.create({
      data: createVendorDto,
    });
  }

  async findAll() {
    const [items, total] = await Promise.all([
      this.prisma.vendor.findMany(),
      this.prisma.vendor.count(),
    ]);
    return { items, total };
  }

  async findOne(id: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id },
    });

    if (!vendor) {
      throw new NotFoundException(`Vendor with ID ${id} not found`);
    }

    return vendor;
  }

  async update(id: string, updateVendorDto: UpdateVendorDto) {
    await this.findOne(id); // Check if vendor exists

    return await this.prisma.vendor.update({
      where: { id },
      data: updateVendorDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id); // Check if vendor exists

    await this.prisma.vendor.delete({
      where: { id },
    });
  }

  async findVendorProducts(
    id: string,
    pagination: CursorPaginationDto = {},
  ) {
    await this.findOne(id); // Check if vendor exists

    const { cursor, take = 50 } = pagination;

    return await this.prisma.product.findMany({
      where: {
        variants: {
          some: {
            ProductPrice: {
              some: {
                vendorId: id,
              },
            },
          },
        },
      },
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: "desc" },
      include: {
        category: true,
        variants: {
          include: {
            ProductPrice: {
              where: {
                vendorId: id,
              },
              include: {
                vendor: true,
              },
            },
          },
        },
      },
    });
  }
}
