import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";

interface AuthenticatedRequest {
  user: {
    id: string;
    walletAddress: string;
  };
}
import { DappsService } from "./dapps.service";
import { CreateDappDto, UpdateDappDto } from "./dto/dapp.dto";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";

@ApiTags("dapps")
@Controller("dapps")
export class DappsController {
  constructor(private readonly dappsService: DappsService) {}

  @Get("all")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all dapps with pagination" })
  @ApiResponse({ status: 200, description: "List of all dapps" })
  @ApiResponse({
    status: 401,
    description: "Unauthorized - invalid or missing JWT token",
  })
  async findAll(
    @Query() paginationDto: CursorPaginationDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const userId = req.user.id;
    return await this.dappsService.findAll(paginationDto, userId);
  }

  @Get("popular")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get popular dapps with pagination" })
  @ApiResponse({ status: 200, description: "List of popular dapps" })
  @ApiResponse({
    status: 401,
    description: "Unauthorized - invalid or missing JWT token",
  })
  async findPopular(
    @Query() paginationDto: CursorPaginationDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const userId = req.user.id;
    return await this.dappsService.findPopular(paginationDto, userId);
  }

  @Get("sponsor")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get sponsored dapps with pagination" })
  @ApiResponse({ status: 200, description: "List of sponsored dapps" })
  @ApiResponse({
    status: 401,
    description: "Unauthorized - invalid or missing JWT token",
  })
  async findSponsored(
    @Query() paginationDto: CursorPaginationDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const userId = req.user.id;
    return await this.dappsService.findSponsored(paginationDto, userId);
  }

  @Get("favorites")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get user favorite dapps with pagination" })
  @ApiResponse({ status: 200, description: "List of user favorite dapps" })
  async findUserFavorites(
    @Query() paginationDto: CursorPaginationDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return await this.dappsService.findUserFavorites(
      req.user.id,
      paginationDto,
    );
  }

  @Get("category/:categoryId")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get dapps by category with pagination" })
  @ApiResponse({
    status: 200,
    description: "List of dapps in the specified category",
  })
  @ApiResponse({
    status: 401,
    description: "Unauthorized - invalid or missing JWT token",
  })
  @ApiResponse({ status: 404, description: "Category not found" })
  async findByCategory(
    @Param("categoryId") categoryId: string,
    @Query() paginationDto: CursorPaginationDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const userId = req.user.id;
    return await this.dappsService.findByCategory(
      categoryId,
      paginationDto,
      userId,
    );
  }

  @Post(":id/favorite")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Add dapp to favorites" })
  @ApiResponse({
    status: 201,
    description: "Dapp added to favorites successfully",
  })
  async addToFavorites(
    @Param("id") id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return await this.dappsService.addToFavorites(req.user.id, id);
  }

  @Delete(":id/favorite")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Remove dapp from favorites" })
  @ApiResponse({
    status: 200,
    description: "Dapp removed from favorites successfully",
  })
  async removeFromFavorites(
    @Param("id") id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return await this.dappsService.removeFromFavorites(req.user.id, id);
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get a specific dapp by ID" })
  @ApiResponse({ status: 200, description: "Dapp details" })
  @ApiResponse({
    status: 401,
    description: "Unauthorized - invalid or missing JWT token",
  })
  @ApiResponse({ status: 404, description: "Dapp not found" })
  async findOne(@Param("id") id: string, @Request() req: AuthenticatedRequest) {
    return await this.dappsService.findOne(id, req.user.id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create a new dapp (Admin only)" })
  @ApiResponse({ status: 201, description: "Dapp created successfully" })
  async create(@Body() createDappDto: CreateDappDto) {
    return await this.dappsService.create(createDappDto);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update a dapp (Admin only)" })
  @ApiResponse({ status: 200, description: "Dapp updated successfully" })
  async update(@Param("id") id: string, @Body() updateDappDto: UpdateDappDto) {
    return await this.dappsService.update(id, updateDappDto);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete a dapp (Admin only)" })
  @ApiResponse({ status: 200, description: "Dapp deleted successfully" })
  async remove(@Param("id") id: string) {
    return await this.dappsService.remove(id);
  }
}
