import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { ApiKey } from "../decorators/api-key.decorator";
import { Public } from "../decorators/public.decorator";
import {
  ApiCreateToken,
  ApiDeleteToken,
  ApiGetTokenPublic,
  ApiGetTokensPublic,
  ApiSearchTokensPublic,
  ApiUpdateToken,
} from "../decorators/swagger/token.decorators";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import { AlchemyTokenMetadataClient } from "./alchemy-token-metadata.client";
import { CreateTokenDto } from "./dto/create-token.dto";
import { SearchTokenDto } from "./dto/search-token.dto";
import { UpdateTokenDto } from "./dto/update-token.dto";
import { TokenIconService } from "./token-icon.service";
import { TokensService } from "./tokens.service";

@Controller("tokens")
@ApiTags("tokens")
export class TokensController {
  constructor(
    private readonly tokensService: TokensService,
    private readonly alchemyTokenMetadata: AlchemyTokenMetadataClient,
    private readonly tokenIcon: TokenIconService,
  ) {}

  /**
   * The token's logo as a square PNG, for surfaces that can only decode a
   * bitmap from a bare URL — chiefly the transfer push notification, whose
   * large icon Android fetches with no headers and hands straight to
   * `BitmapFactory`. Whatever `Token.logoUrl` points at (SVG, JPEG, a CDN
   * that rejects the Dalvik UA) is fetched and normalised server-side by
   * `TokenIconService`; see that file for why.
   *
   * No `@ApiKey()` on purpose: the OS notification pipeline cannot send one.
   * The route leaks nothing beyond the logo that `GET /tokens/:id` already
   * serves, and answers 404 (never 500) when no icon can be built.
   */
  @Get(":id/icon.png")
  @Public()
  @ApiOperation({ summary: "Token logo as a 256x256 PNG (push-safe)" })
  @ApiParam({ name: "id", type: "string" })
  @ApiResponse({ status: 200, description: "image/png" })
  @ApiResponse({ status: 404, description: "No usable logo for this token" })
  async icon(@Param("id") id: string, @Res() res: Response) {
    const png = await this.tokenIcon.getIconPng(id);
    if (!png) {
      res
        .status(HttpStatus.NOT_FOUND)
        .setHeader("Cache-Control", "public, max-age=300")
        .end();
      return;
    }
    res
      .status(HttpStatus.OK)
      .setHeader("Content-Type", "image/png")
      .setHeader("Content-Length", String(png.length))
      .setHeader(
        "Cache-Control",
        "public, max-age=86400, stale-while-revalidate=604800",
      )
      .end(png);
  }

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
