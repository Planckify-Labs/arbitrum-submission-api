import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateDappPromotionDto,
  UpdateDappPromotionDto,
} from "./dto/dapp-promotion.dto";

@Injectable()
export class DappPromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Active, in-window banners for the public hub carousel. */
  async findActive() {
    const now = new Date();
    return this.prisma.dappPromotion.findMany({
      where: {
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });
  }

  async findAll() {
    return this.prisma.dappPromotion.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });
  }

  async create(dto: CreateDappPromotionDto) {
    if (dto.dappId) {
      const dapp = await this.prisma.dapp.findUnique({
        where: { id: dto.dappId },
      });
      if (!dapp) {
        throw new BadRequestException("Linked dapp not found");
      }
    }
    return this.prisma.dappPromotion.create({ data: { ...dto } });
  }

  async update(id: string, dto: UpdateDappPromotionDto) {
    const existing = await this.prisma.dappPromotion.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException("Promotion not found");
    }
    if (dto.dappId) {
      const dapp = await this.prisma.dapp.findUnique({
        where: { id: dto.dappId },
      });
      if (!dapp) {
        throw new BadRequestException("Linked dapp not found");
      }
    }
    return this.prisma.dappPromotion.update({
      where: { id },
      data: { ...dto },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.dappPromotion.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException("Promotion not found");
    }
    await this.prisma.dappPromotion.delete({ where: { id } });
    return { message: "Promotion deleted successfully" };
  }
}
