import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { ApiTags } from "@nestjs/swagger";
import { TokensService } from "./tokens.service";
import { CreateTokenDto } from "./dto/create-token.dto";
import { UpdateTokenDto } from "./dto/update-token.dto";
import { SearchTokenDto } from "./dto/search-token.dto";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import {
  ApiCreateToken,
  ApiDeleteToken,
  ApiUpdateToken,
  ApiGetTokensPublic,
  ApiSearchTokensPublic,
  ApiGetTokenPublic,
} from "../decorators/swagger/token.decorators";
import { Public } from "../decorators/public.decorator";
import { ApiKey } from "../decorators/api-key.decorator";

@Controller("tokens")
@ApiTags("tokens")
export class TokensController {
  constructor(private readonly tokensService: TokensService) {}

  @Post()
  @ApiCreateToken()
  create(@Body() createTokenDto: CreateTokenDto) {
    return this.tokensService.create(createTokenDto);
  }

  @Get()
  @Public()
  @ApiKey()
  @ApiGetTokensPublic()
  async findAll(
    @Query() paginationDto: CursorPaginationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { items, total } = await this.tokensService.findAll(paginationDto);
    res.setHeader("X-Total-Count", String(total));
    return items;
  }

  @Get("search")
  @Public()
  @ApiKey()
  @ApiSearchTokensPublic()
  async search(
    @Query() searchParams: SearchTokenDto,
    @Query() paginationDto: CursorPaginationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { items, total } = await this.tokensService.search(
      searchParams,
      paginationDto,
    );
    res.setHeader("X-Total-Count", String(total));
    return items;
  }

  @Get(":id")
  @Public()
  @ApiKey()
  @ApiGetTokenPublic()
  findOne(@Param("id") id: string) {
    return this.tokensService.findOne(id);
  }

  @Put(":id")
  @ApiUpdateToken()
  update(@Param("id") id: string, @Body() updateTokenDto: UpdateTokenDto) {
    return this.tokensService.update(id, updateTokenDto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiDeleteToken()
  remove(@Param("id") id: string) {
    return this.tokensService.remove(id);
  }
}
