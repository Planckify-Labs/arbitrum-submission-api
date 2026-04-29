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
  Headers,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { ApiTags } from "@nestjs/swagger";
import { BlockchainsService } from "./blockchains.service";
import { CreateBlockchainDto } from "./dto/create-blockchain.dto";
import { UpdateBlockchainDto } from "./dto/update-blockchain.dto";
import { SearchBlockchainDto } from "./dto/search-blockchain.dto";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import { GetBlockchainsQueryDto } from "./dto/get-blockchains-query.dto";
import {
  ApiCreateBlockchain,
  ApiDeleteBlockchain,
  ApiUpdateBlockchain,
  ApiGetBlockchainsPublic,
  ApiSearchBlockchainsPublic,
  ApiGetBlockchainPublic,
} from "../decorators/swagger/blockchain.decorators";
import { Public } from "../decorators/public.decorator";
import { ApiKey } from "../decorators/api-key.decorator";

@Controller("blockchains")
@ApiTags("blockchains")
export class BlockchainsController {
  constructor(private readonly blockchainsService: BlockchainsService) {}

  @Post()
  @ApiCreateBlockchain()
  create(@Body() createBlockchainDto: CreateBlockchainDto) {
    return this.blockchainsService.create(createBlockchainDto);
  }

  /**
   * Enriched chain-config endpoint consumed by the mobile app (`useBlockchains()`).
   *
   * Spec ref: umkm-usdc-payout-spec.md §6.7, task 21. Returns per-chain core
   * fields PLUS Gateway / Paymaster / x402 contract coordinates PLUS the USDC
   * token row — everything mobile needs to build EIP-3009 typed-data at runtime
   * without hardcoding anything in env. Shape is additive over the legacy
   * paginated response; existing consumers that only read `id`, `name`,
   * `chainId`, `rpcUrl`, etc. keep working because those fields are still
   * present.
   *
   * - `?country=<iso>` narrows to chains a payer from that jurisdiction can
   *   settle on. Unknown country → empty array (not a 404).
   * - `If-None-Match` → `304 Not Modified` when the ETag matches. ETag rolls
   *   forward when any chain row's `updatedAt` bumps or the x402 snapshot
   *   refreshes.
   * - Cached in Valkey with 5-minute TTL; invalidated by any chain row update.
   */
  @Get()
  @Public()
  @ApiKey()
  @ApiGetBlockchainsPublic()
  async findAll(
    @Query() query: GetBlockchainsQueryDto,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { blockchains, etag } = await this.blockchainsService.getEnrichedConfig(
      query.country,
    );

    // Always advertise the ETag + cache policy so intermediaries and the
    // mobile HTTP cache can use it.
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "public, max-age=300"); // 5 minutes, matches Valkey TTL

    if (ifNoneMatch && ifNoneMatch === etag) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }

    return blockchains;
  }

  @Get("search")
  @Public()
  @ApiKey()
  @ApiSearchBlockchainsPublic()
  async search(
    @Query() searchParams: SearchBlockchainDto,
    @Query() paginationDto: CursorPaginationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { items, total } = await this.blockchainsService.search(
      searchParams,
      paginationDto,
    );
    res.setHeader("X-Total-Count", String(total));
    return items;
  }

  @Get(":id")
  @Public()
  @ApiKey()
  @ApiGetBlockchainPublic()
  findOne(@Param("id") id: string) {
    return this.blockchainsService.findOne(id);
  }

  @Put(":id")
  @ApiUpdateBlockchain()
  update(
    @Param("id") id: string,
    @Body() updateBlockchainDto: UpdateBlockchainDto,
  ) {
    return this.blockchainsService.update(id, updateBlockchainDto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiDeleteBlockchain()
  remove(@Param("id") id: string) {
    return this.blockchainsService.remove(id);
  }
}
