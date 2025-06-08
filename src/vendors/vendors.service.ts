import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateVendorDto } from "./dto/create-vendor.dto";
import { UpdateVendorDto } from "./dto/update-vendor.dto";

@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createVendorDto: CreateVendorDto) {
    return await this.prisma.vendor.create({
      data: createVendorDto,
    });
  }

  async findAll() {
    return await this.prisma.vendor.findMany();
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

  async findVendorProducts(id: string) {
    await this.findOne(id); // Check if vendor exists

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
