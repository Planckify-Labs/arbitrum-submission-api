import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { UserRole } from "@generated/prisma";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { Roles } from "../../decorators/roles.decorator";
import {
  AdminMerchantsService,
  type AdminMerchantStatus,
} from "./admin-merchants.service";

const MERCHANT_STATUSES: AdminMerchantStatus[] = [
  "ACTIVE",
  "INACTIVE",
  "PENDING",
];

class ListAdminMerchantsQueryDto {
  @IsOptional()
  @IsIn(MERCHANT_STATUSES)
  status?: AdminMerchantStatus;

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

class UpdateAdminMerchantDto {
  @IsIn(MERCHANT_STATUSES)
  status!: AdminMerchantStatus;
}

@Controller("admin/merchants")
@ApiTags("admin-merchants")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminMerchantsController {
  constructor(private readonly service: AdminMerchantsService) {}

  @Get()
  async list(
    @Query() query: ListAdminMerchantsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { items, total } = await this.service.list({
      status: query.status,
      search: query.search,
      cursor: query.cursor,
      take: query.take,
      skip: query.skip,
    });
    res.setHeader("X-Total-Count", String(total));
    return items;
  }

  @Get(":id")
  async findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() body: UpdateAdminMerchantDto,
  ) {
    return this.service.updateStatus(id, body.status);
  }
}
