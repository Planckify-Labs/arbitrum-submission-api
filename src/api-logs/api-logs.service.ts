import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SearchApiLogDto } from "./dto/api-log.dto";

@Injectable()
export class ApiLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return await this.prisma.apiRequestLog.findMany({
      include: {
        user: true,
        purchase: true,
      },
    });
  }

  async search(searchParams: SearchApiLogDto) {
    const {
      requestId,
      userId,
      purchaseId,
      service,
      endpoint,
      method,
      success,
    } = searchParams;

    return await this.prisma.apiRequestLog.findMany({
      where: {
        ...(requestId && { requestId }),
        ...(userId && { userId }),
        ...(purchaseId && { purchaseId }),
        ...(service && { service }),
        ...(endpoint && { endpoint }),
        ...(method && { method }),
        ...(typeof success === "boolean" && { success }),
      },
      include: {
        user: true,
        purchase: true,
      },
    });
  }

  async findByRequestId(requestId: string) {
    const log = await this.prisma.apiRequestLog.findUnique({
      where: { requestId },
      include: {
        user: true,
        purchase: true,
      },
    });

    if (!log) {
      throw new NotFoundException(
        `API log with request ID ${requestId} not found`,
      );
    }

    return log;
  }

  async findByUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return await this.prisma.apiRequestLog.findMany({
      where: { userId },
      include: {
        user: true,
        purchase: true,
      },
    });
  }

  async findByPurchase(purchaseId: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id: purchaseId },
    });

    if (!purchase) {
      throw new NotFoundException(`Purchase with ID ${purchaseId} not found`);
    }

    return await this.prisma.apiRequestLog.findMany({
      where: { purchaseId },
      include: {
        user: true,
        purchase: true,
      },
    });
  }
}
