import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { DappPromotionsService } from "./dapp-promotions.service";
import {
  CreateDappPromotionDto,
  UpdateDappPromotionDto,
} from "./dto/dapp-promotion.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ApiKey } from "src/decorators/api-key.decorator";
import { Public } from "src/decorators/public.decorator";

@ApiTags("dapp-promotions")
@Controller("dapp-promotions")
export class DappPromotionsController {
  constructor(private readonly promotionsService: DappPromotionsService) {}

  @Public()
  @ApiKey()
  @Get()
  findActive() {
    return this.promotionsService.findActive();
  }

  @Get("all")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  findAll() {
    return this.promotionsService.findAll();
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  create(@Body() dto: CreateDappPromotionDto) {
    return this.promotionsService.create(dto);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  update(@Param("id") id: string, @Body() dto: UpdateDappPromotionDto) {
    return this.promotionsService.update(id, dto);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  remove(@Param("id") id: string) {
    return this.promotionsService.remove(id);
  }
}
