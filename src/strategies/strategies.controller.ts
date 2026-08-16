import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AssetPricesRequestDto } from "./dto/asset-prices.dto";
import { CreateStrategyDto } from "./dto/create-strategy.dto";
import { CrossChainQuoteDto } from "./dto/cross-chain-quote.dto";
import { UpdateStrategyDto } from "./dto/update-strategy.dto";
import { DefiError, DefiErrorFilter } from "./errors/defi-error";
import { RouterQuoteError, RouterQuoteService } from "./router-quote.service";
import { StrategiesService } from "./strategies.service";

interface AuthedRequest {
  user?: {
    id: string;
    walletAddress?: string;
  };
}

@ApiTags("strategies")
@Controller("strategies")
@UseGuards(JwtAuthGuard)
@UseFilters(DefiErrorFilter)
export class StrategiesController {
  constructor(
    private readonly strategiesService: StrategiesService,
    private readonly routerQuoteService: RouterQuoteService,
  ) {}

  private getWalletAddress(req: AuthedRequest): string {
    const walletAddress = req.user?.walletAddress;
    if (!walletAddress) {
      throw new DefiError("unauthorized", "Wallet address missing from JWT");
    }
    return walletAddress;
  }

  @Get()
  @ApiOperation({ summary: "Get current user strategy" })
  getStrategy(@Request() req: AuthedRequest) {
    return this.strategiesService.getStrategy(this.getWalletAddress(req));
  }

  @Post()
  @ApiOperation({ summary: "Create a new user strategy" })
  createStrategy(
    @Request() req: AuthedRequest,
    @Body() dto: CreateStrategyDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new DefiError("unauthorized", "User ID missing from JWT");
    }
    return this.strategiesService.createStrategy(
      userId,
      this.getWalletAddress(req),
      dto,
    );
  }

  @Patch()
  @ApiOperation({ summary: "Update current user strategy" })
  updateStrategy(
    @Request() req: AuthedRequest,
    @Body() dto: UpdateStrategyDto,
  ) {
    return this.strategiesService.updateStrategy(
      this.getWalletAddress(req),
      dto,
    );
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete current user strategy" })
  async deleteStrategy(@Request() req: AuthedRequest) {
    await this.strategiesService.deleteStrategy(this.getWalletAddress(req));
  }

  @Get("opportunities")
  @ApiOperation({ summary: "Get available yield opportunities" })
  getOpportunities(
    @Request() req: AuthedRequest,
    @Query("tier") tier?: string,
    @Query("asset_symbol") assetSymbol?: string,
    @Query("chain_id") chainId?: string,
    @Query("namespace") namespace?: string,
    @Query("liquidity_profile") liquidityProfile?: string,
    @Query("amount_usd") amountUsd?: string,
  ) {
    const filter = {
      ...(tier ? { tier } : {}),
      ...(assetSymbol ? { assetSymbol } : {}),
      ...(chainId !== undefined && chainId !== ""
        ? { chainId: Number(chainId) }
        : {}),
      ...(namespace ? { namespace } : {}),
      ...(liquidityProfile ? { liquidityProfile } : {}),
      ...(amountUsd !== undefined && amountUsd !== ""
        ? { amountUsd: Number(amountUsd) }
        : {}),
    };
    return this.strategiesService.getOpportunities(
      this.getWalletAddress(req),
      filter,
    );
  }

  @Get("opportunities/:slug")
  @ApiOperation({ summary: "Get details for a specific opportunity" })
  getOpportunity(@Param("slug") slug: string) {
    return this.strategiesService.getOpportunity(slug);
  }

  @Get("pools/:poolId")
  @ApiOperation({
    summary:
      "Get a single opportunity by DeFiLlama poolId — the authoritative depositTarget the mobile executor re-fetches at deposit time (pool-level deposits spec §6)",
  })
  getPoolById(@Param("poolId") poolId: string) {
    return this.strategiesService.getPoolById(poolId);
  }

  @Get("protocols")
  @ApiOperation({
    summary:
      "List curated protocol slugs available for the given tier (drives the onboarding whitelist picker)",
  })
  getProtocols(@Query("tier") tier?: string) {
    return this.strategiesService.getProtocols(tier);
  }

  @Post("asset-prices")
  @ApiOperation({
    summary:
      "Batch USD spot price lookup (Alchemy Prices API proxy) — used to value DeFi positions and to snapshot amountAtDepositUsd. The only place Alchemy's key is used; the mobile client never calls Alchemy directly.",
  })
  getAssetPrices(@Body() dto: AssetPricesRequestDto) {
    return this.strategiesService
      .getAssetPrices(
        dto.queries.map((q) => ({
          chainId: q.chain_id,
          assetSymbol: q.asset_symbol,
          assetContract: q.asset_contract,
        })),
      )
      .then((results) =>
        results.map((r) => ({
          chain_id: r.chainId,
          asset_symbol: r.assetSymbol,
          asset_contract: r.assetContract ?? null,
          usd: r.usd,
        })),
      );
  }

  @Get("positions")
  @ApiOperation({ summary: "Get user's strategy positions" })
  getPositions(@Request() req: AuthedRequest) {
    const userId = req.user?.id;
    if (!userId) {
      throw new DefiError("unauthorized", "User ID missing from JWT");
    }
    return this.strategiesService.getPositions(userId, this.getWalletAddress(req));
  }

  @Post("positions")
  @ApiOperation({ summary: "Record a new strategy position" })
  createPosition(
    @Request() req: AuthedRequest,
    @Body()
    dto: {
      protocolSlug: string;
      chainId: number;
      namespace: string;
      assetSymbol: string;
      assetContract?: string;
      poolId?: string;
      amountAtDeposit: string;
      amountAtDepositUsd: number;
      openTxHash?: string;
      goal?: string;
      targetDate?: string;
    },
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new DefiError("unauthorized", "User ID missing from JWT");
    }
    return this.strategiesService.createPosition(userId, this.getWalletAddress(req), {
      ...dto,
      targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
    });
  }

  @Get("positions/:id")
  @ApiOperation({ summary: "Get details for a specific position" })
  getPosition(@Request() req: AuthedRequest, @Param("id") id: string) {
    return this.strategiesService.getPosition(id, this.getWalletAddress(req));
  }

  @Post("positions/:id/refresh")
  @ApiOperation({
    summary:
      "Persist a freshly-observed on-chain amount/USD value for a position (mobile does the live on-chain read + price lookup and reports it here)",
  })
  refreshPosition(
    @Request() req: AuthedRequest,
    @Param("id") id: string,
    @Body()
    dto?: { current_amount_raw?: string; current_amount_usd?: number },
  ) {
    return this.strategiesService.refreshPosition(
      id,
      this.getWalletAddress(req),
      dto
        ? {
            currentAmountRaw: dto.current_amount_raw,
            currentAmountUsd: dto.current_amount_usd,
          }
        : undefined,
    );
  }

  @Post("cross-chain/quote")
  @ApiOperation({
    summary:
      "Fetch a LI.FI bridge quote (prebuilt transactionRequest) for a cross-chain deposit",
  })
  @ApiResponse({ status: 200, description: "Quote returned" })
  quoteCrossChain(
    @Request() req: AuthedRequest,
    @Body() dto: CrossChainQuoteDto,
  ) {
    return this.strategiesService.quoteCrossChain(
      this.getWalletAddress(req),
      dto,
    );
  }

  @Post("router-quote")
  @ApiOperation({
    summary:
      "Proxy a router-calldata quote (Pendle) — the device never calls the protocol's API directly (expansion spec §6)",
  })
  @ApiResponse({ status: 200, description: "Verified quote returned" })
  async routerQuote(
    @Request() req: AuthedRequest,
    @Body()
    dto: {
      poolId: string;
      amountRaw: string;
      slippageBps: number;
      action?: "deposit" | "withdraw";
    },
  ) {
    // The quote's receiver is ALWAYS the caller's own wallet, taken from the
    // JWT rather than the body: a router quote made out to a third party is
    // precisely the thing the allowlist and decode assertions exist to stop.
    const receiver = this.getWalletAddress(req);
    try {
      return await this.routerQuoteService.quote({
        poolId: dto.poolId,
        receiver,
        amountRaw: dto.amountRaw,
        slippageBps: dto.slippageBps,
        action: dto.action ?? "deposit",
      });
    } catch (err) {
      // Curated code only — an upstream body never reaches the client.
      throw new DefiError(
        err instanceof RouterQuoteError ? err.code : "unknown",
        "router quote rejected",
      );
    }
  }

  @Get("cross-chain/status")
  @ApiOperation({
    summary: "Poll LI.FI status for a previously-submitted bridge tx hash",
  })
  getCrossChainStatus(
    @Query("from_chain_id") fromChainId: string,
    @Query("to_chain_id") toChainId: string,
    @Query("tx_hash") txHash: string,
  ) {
    const from = Number(fromChainId);
    const to = Number(toChainId);
    if (!Number.isFinite(from) || from <= 0) {
      throw new DefiError("unsupported_chain", "invalid from_chain_id");
    }
    if (!Number.isFinite(to) || to <= 0) {
      throw new DefiError("unsupported_chain", "invalid to_chain_id");
    }
    if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      throw new DefiError("network_error", "invalid tx_hash");
    }
    return this.strategiesService.getCrossChainStatus({
      fromChainId: from,
      toChainId: to,
      txHash,
    });
  }
}
