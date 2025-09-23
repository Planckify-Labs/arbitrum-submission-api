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
import { DappCategoriesService } from "./dapp-categories.service";
import {
  CreateDappCategoryDto,
  UpdateDappCategoryDto,
} from "./dto/dapp-category.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import {
  ApiGetAllDappCategories,
  ApiGetDappCategoryById,
  ApiCreateDappCategory,
  ApiUpdateDappCategory,
  ApiDeleteDappCategory,
} from "./decorators/dapp-categories-swagger.decorators";
import { ApiKey } from "src/decorators/api-key.decorator";
import { Public } from "src/decorators/public.decorator";

@ApiTags("dapp-categories")
@Controller("dapp-categories")
export class DappCategoriesController {
  constructor(private readonly dappCategoriesService: DappCategoriesService) {}

  @Public()
  @ApiKey()
  @Get()
  @ApiGetAllDappCategories()
  findAll() {
    return this.dappCategoriesService.findAll();
  }

  @Get(":id")
  @ApiGetDappCategoryById()
  findOne(@Param("id") id: string) {
    return this.dappCategoriesService.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiCreateDappCategory()
  create(@Body() createDappCategoryDto: CreateDappCategoryDto) {
    return this.dappCategoriesService.create(createDappCategoryDto);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiUpdateDappCategory()
  update(
    @Param("id") id: string,
    @Body() updateDappCategoryDto: UpdateDappCategoryDto,
  ) {
    return this.dappCategoriesService.update(id, updateDappCategoryDto);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiDeleteDappCategory()
  remove(@Param("id") id: string) {
    return this.dappCategoriesService.remove(id);
  }
}
