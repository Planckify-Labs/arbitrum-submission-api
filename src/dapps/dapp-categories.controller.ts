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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";

@ApiTags("dapp-categories")
@Controller("dapp-categories")
export class DappCategoriesController {
  constructor(private readonly dappCategoriesService: DappCategoriesService) {}

  @Get()
  @ApiOperation({ summary: "Get all dapp categories" })
  @ApiResponse({ status: 200, description: "List of all dapp categories" })
  findAll() {
    return this.dappCategoriesService.findAll();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a specific dapp category by ID" })
  @ApiResponse({ status: 200, description: "Dapp category details" })
  findOne(@Param("id") id: string) {
    return this.dappCategoriesService.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create a new dapp category (Admin only)" })
  @ApiResponse({
    status: 201,
    description: "Dapp category created successfully",
  })
  create(@Body() createDappCategoryDto: CreateDappCategoryDto) {
    return this.dappCategoriesService.create(createDappCategoryDto);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update a dapp category (Admin only)" })
  @ApiResponse({
    status: 200,
    description: "Dapp category updated successfully",
  })
  update(
    @Param("id") id: string,
    @Body() updateDappCategoryDto: UpdateDappCategoryDto,
  ) {
    return this.dappCategoriesService.update(id, updateDappCategoryDto);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete a dapp category (Admin only)" })
  @ApiResponse({
    status: 200,
    description: "Dapp category deleted successfully",
  })
  remove(@Param("id") id: string) {
    return this.dappCategoriesService.remove(id);
  }
}
