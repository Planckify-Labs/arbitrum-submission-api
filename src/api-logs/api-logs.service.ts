import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SearchApiLogDto } from "./dto/api-log.dto";
import { CursorPaginationDto } from "../dto/common/pagination.dto";

@Injectable()
export class ApiLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;

    return await this.prisma.apiRequestLog.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      include: {
        user: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async search(
    searchParams: SearchApiLogDto,
    paginationDto: CursorPaginationDto,
  ) {
    const { cursor, take = 10 } = paginationDto;
    const { requestId, userId, service, endpoint, method, success } =
      searchParams;

    return await this.prisma.apiRequestLog.findMany({
      take,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      where: {
        ...(requestId && { requestId }),
        ...(userId && { userId }),
        ...(service && { service }),
        ...(endpoint && { endpoint }),
        ...(method && { method }),
        ...(typeof success === "boolean" && { success }),
      },
      include: {
        user: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  async findByRequestId(requestId: string) {
    const log = await this.prisma.apiRequestLog.findUnique({
      where: { requestId },
      include: {
        user: true,
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
      },
    });
  }
}
