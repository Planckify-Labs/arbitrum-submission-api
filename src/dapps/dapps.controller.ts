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
import { ApiKey } from "../decorators/api-key.decorator";
import { ApiTags, ApiBearerAuth, ApiSecurity } from "@nestjs/swagger";
import {
  ApiGetAllDapps,
  ApiGetPopularDapps,
  ApiGetSponsoredDapps,
  ApiGetFavoriteDapps,
  ApiGetDappsByCategory,
  ApiAddToFavorites,
  ApiRemoveFromFavorites,
  ApiGetDappById,
  ApiCreateDapp,
  ApiUpdateDapp,
  ApiDeleteDapp,
} from "./decorators/swagger.decorators";
import { Public } from "src/decorators/public.decorator";

@ApiTags("dapps")
@Controller("dapps")
export class DappsController {
  constructor(private readonly dappsService: DappsService) {}

  @Get("all")
  @ApiGetAllDapps()
  async findAll(@Query() paginationDto: CursorPaginationDto) {
    return await this.dappsService.findAll(paginationDto);
  }

  @Public()
  @ApiKey()
  @Get("popular")
  @ApiGetPopularDapps()
  async findPopular(@Query() paginationDto: CursorPaginationDto) {
    return await this.dappsService.findPopular(paginationDto);
  }

  @Public()
  @ApiKey()
  @Get("sponsor")
  @ApiGetSponsoredDapps()
  async findSponsored(@Query() paginationDto: CursorPaginationDto) {
    return await this.dappsService.findSponsored(paginationDto);
  }

  @Get("favorites")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiGetFavoriteDapps()
  async findUserFavorites(
    @Query() paginationDto: CursorPaginationDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return await this.dappsService.findUserFavorites(
      req.user.id,
      paginationDto,
    );
  }

  @Public()
  @ApiKey()
  @Get("category/:categoryId")
  @ApiGetDappsByCategory()
  async findByCategory(
    @Param("categoryId") categoryId: string,
    @Query() paginationDto: CursorPaginationDto,
  ) {
    return await this.dappsService.findByCategory(categoryId, paginationDto);
  }

  @Post(":id/favorite")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiAddToFavorites()
  async addToFavorites(
    @Param("id") id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return await this.dappsService.addToFavorites(req.user.id, id);
  }

  @Delete(":id/favorite")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiRemoveFromFavorites()
  async removeFromFavorites(
    @Param("id") id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return await this.dappsService.removeFromFavorites(req.user.id, id);
  }

  @Public()
  @ApiKey()
  @Get(":id")
  @ApiGetDappById()
  async findOne(@Param("id") id: string) {
    return await this.dappsService.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiCreateDapp()
  async create(@Body() createDappDto: CreateDappDto) {
    return await this.dappsService.create(createDappDto);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiUpdateDapp()
  async update(@Param("id") id: string, @Body() updateDappDto: UpdateDappDto) {
    return await this.dappsService.update(id, updateDappDto);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiDeleteDapp()
  async remove(@Param("id") id: string) {
    return await this.dappsService.remove(id);
  }
}
