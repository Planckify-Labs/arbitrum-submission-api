import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RegionsService } from "./regions.service";
import { CreateRegionDto } from "./dto/create-region.dto";
import { UpdateRegionDto } from "./dto/update-region.dto";
import { CreateRegionTokenDto } from "./dto/create-region-token.dto";
import { UpdateRegionTokenDto } from "./dto/update-region-token.dto";
import { SearchRegionDto } from "./dto/search-region.dto";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import {
  ApiCreateRegion,
  ApiDeleteRegion,
  ApiGetRegion,
  ApiGetRegions,
  ApiUpdateRegion,
  ApiGetRegionTokens,
  ApiCreateRegionToken,
  ApiUpdateRegionToken,
  ApiDeleteRegionToken,
  ApiSearchRegions,
} from "../decorators/swagger/region.decorators";

@Controller("regions")
@ApiTags("regions")
export class RegionsController {
  constructor(private readonly regionsService: RegionsService) {}

  @Post()
  @ApiCreateRegion()
  create(@Body() createRegionDto: CreateRegionDto) {
    return this.regionsService.create(createRegionDto);
  }

  @Get()
  @ApiGetRegions()
  findAll(@Query() paginationDto: CursorPaginationDto) {
    return this.regionsService.findAll(paginationDto);
  }

  @Get("search")
  @ApiSearchRegions()
  search(
    @Query() searchParams: SearchRegionDto,
    @Query() paginationDto: CursorPaginationDto,
  ) {
    return this.regionsService.search(searchParams, paginationDto);
  }

  @Get(":id")
  @ApiGetRegion()
  findOne(@Param("id") id: string) {
    return this.regionsService.findOne(id);
  }

  @Patch(":id")
  @ApiUpdateRegion()
  update(@Param("id") id: string, @Body() updateRegionDto: UpdateRegionDto) {
    return this.regionsService.update(id, updateRegionDto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiDeleteRegion()
  remove(@Param("id") id: string) {
    return this.regionsService.remove(id);
  }

  @Get(":id/tokens")
  @ApiGetRegionTokens()
  findRegionTokens(
    @Param("id") id: string,
    @Query() paginationDto: CursorPaginationDto,
  ) {
    return this.regionsService.findRegionTokens(id, paginationDto);
  }

  @Post(":id/tokens")
  @ApiCreateRegionToken()
  addToken(
    @Param("id") id: string,
    @Body() createRegionTokenDto: CreateRegionTokenDto,
  ) {
    return this.regionsService.addToken(id, createRegionTokenDto);
  }

  @Patch(":id/tokens/:tokenId")
  @ApiUpdateRegionToken()
  updateToken(
    @Param("id") id: string,
    @Param("tokenId") tokenId: string,
    @Body() updateRegionTokenDto: UpdateRegionTokenDto,
  ) {
    return this.regionsService.updateToken(id, tokenId, updateRegionTokenDto);
  }

  @Delete(":id/tokens/:tokenId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiDeleteRegionToken()
  removeToken(@Param("id") id: string, @Param("tokenId") tokenId: string) {
    return this.regionsService.removeToken(id, tokenId);
  }
}
