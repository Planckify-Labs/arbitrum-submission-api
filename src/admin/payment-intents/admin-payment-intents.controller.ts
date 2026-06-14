import { Controller, Get, Param, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { UserRole } from "@generated/prisma";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { Roles } from "../../decorators/roles.decorator";
import {
  AdminPaymentIntentsService,
  type DashboardPaymentIntentStatus,
} from "./admin-payment-intents.service";

const STATUSES: DashboardPaymentIntentStatus[] = [
  "PENDING",
  "COMPLETED",
  "EXPIRED",
  "FAILED",
];

class ListAdminPaymentIntentsQueryDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: DashboardPaymentIntentStatus;

  @IsOptional()
  @IsString()
  merchantId?: string;

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;
}

@Controller("admin/pay/intents")
@ApiTags("admin-payment-intents")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminPaymentIntentsController {
  constructor(private readonly service: AdminPaymentIntentsService) {}

  @Get()
  async list(
    @Query() query: ListAdminPaymentIntentsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { items, total } = await this.service.list({
      status: query.status,
      merchantId: query.merchantId,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      search: query.search,
      cursor: query.cursor,
      take: query.take,
      skip: query.skip,
    });
    res.setHeader("X-Total-Count", String(total));
    return items;
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Get(":id/submissions")
  async submissions(
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { items, total } = await this.service.listSubmissions(id);
    res.setHeader("X-Total-Count", String(total));
    return items;
  }

  @Get(":id/payouts")
  async payouts(
    @Param("id") id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { items, total } = await this.service.listPayouts(id);
    res.setHeader("X-Total-Count", String(total));
    return items;
  }
}
