import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
  ApiQuery,
} from "@nestjs/swagger";
import { UserRole } from "@generated/prisma";
import { FlashSalesService } from "./flash-sales.service";
import { CreateFlashSaleDto, UpdateFlashSaleDto } from "./dto/flash-sale.dto";
import { Public } from "../decorators/public.decorator";
import { ApiKey } from "../decorators/api-key.decorator";
import { Roles } from "../decorators/roles.decorator";

@ApiTags("flash-sales")
@ApiSecurity("api-key")
@Controller("flash-sales")
export class FlashSalesController {
  constructor(private readonly flashSalesService: FlashSalesService) {}

  /**
   * Public endpoint for the home screen — returns currently active flash sales.
   * Requires a valid API key; JWT auth is skipped.
   */
  @Get()
  @Public()
  @ApiKey()
  @ApiOperation({ summary: "Get all currently active flash sales (home screen)" })
  @ApiResponse({
    status: 200,
    description: "List of active flash sales with computed savings and discount percent",
  })
  findActive() {
    return this.flashSalesService.findActive();
  }

  /**
   * Admin endpoint — returns all flash sales paginated.
   */
  @Get("admin")
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Admin: list all flash sales paginated" })
  @ApiQuery({ name: "page", required: false, type: Number, description: "Page number (1-based)" })
  @ApiResponse({ status: 200, description: "Paginated list of flash sales" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden — admin role required" })
  findAll(@Query("page") page?: string) {
    const pageNum = page ? parseInt(page, 10) : undefined;
    return this.flashSalesService.findAll(pageNum);
  }

  /**
   * Admin endpoint — returns a single flash sale by ID.
   */
  @Get(":id")
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Admin: get a single flash sale by ID" })
  @ApiResponse({ status: 200, description: "Flash sale found" })
  @ApiResponse({ status: 404, description: "Flash sale not found" })
  findOne(@Param("id") id: string) {
    return this.flashSalesService.findOne(id);
  }

  /**
   * Admin endpoint — creates a new flash sale.
   */
  @Post()
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Admin: create a new flash sale" })
  @ApiResponse({ status: 201, description: "Flash sale created successfully" })
  @ApiResponse({ status: 400, description: "Validation error or invalid date range" })
  create(@Body() dto: CreateFlashSaleDto) {
    return this.flashSalesService.create(dto);
  }

  /**
   * Admin endpoint — updates an existing flash sale.
   */
  @Put(":id")
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Admin: update a flash sale" })
  @ApiResponse({ status: 200, description: "Flash sale updated successfully" })
  @ApiResponse({ status: 400, description: "Validation error or invalid date range" })
  @ApiResponse({ status: 404, description: "Flash sale not found" })
  update(@Param("id") id: string, @Body() dto: UpdateFlashSaleDto) {
    return this.flashSalesService.update(id, dto);
  }

  /**
   * Admin endpoint — deletes a flash sale.
   */
  @Delete(":id")
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Admin: delete a flash sale" })
  @ApiResponse({ status: 204, description: "Flash sale deleted successfully" })
  @ApiResponse({ status: 404, description: "Flash sale not found" })
  remove(@Param("id") id: string) {
    return this.flashSalesService.remove(id);
  }
}
