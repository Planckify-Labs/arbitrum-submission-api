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
import { AlchemyTokenMetadataClient } from "./alchemy-token-metadata.client";
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
  constructor(
    private readonly tokensService: TokensService,
    private readonly alchemyTokenMetadata: AlchemyTokenMetadataClient,
  ) {}

  /**
   * Token identity (symbol, logo, decimals) for one contract, for surfaces
   * that hold an address the token catalogue does not list — chiefly the dApp
   * approval sheet, which can be handed any ERC-20 on any supported chain.
   *
   * Declared above the `:id` route on purpose: Nest matches in declaration
   * order, so a later `@Get(":id")` would otherwise swallow "metadata".
   *
   * `decimals` is range-checked in `AlchemyTokenMetadataClient` before it
   * leaves here: a scale outside 0-36 cannot be real, and letting one through
   * would rescale an approval by orders of magnitude.
   *
   * Always answers with the full identity shape, nulls included. A caller
   * that has to distinguish "absent" from "missing key" is a caller that can
   * render an approval against a scale it never received.
   */
  @Get("metadata")
  @Public()
  @ApiKey()
  async metadata(
    @Query("chainId") chainId?: string,
    @Query("address") address?: string,
  ) {
    const parsedChainId = Number(chainId);
    if (!Number.isFinite(parsedChainId) || !address) {
      return { symbol: null, logo: null, decimals: null };
    }
    return this.alchemyTokenMetadata.getIdentity(parsedChainId, address);
  }

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
