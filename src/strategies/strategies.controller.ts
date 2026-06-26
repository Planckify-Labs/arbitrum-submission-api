import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseFilters,
  Request,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { StrategiesService } from "./strategies.service";
import { CreateStrategyDto } from "./dto/create-strategy.dto";
import { UpdateStrategyDto } from "./dto/update-strategy.dto";
import { CrossChainQuoteDto } from "./dto/cross-chain-quote.dto";
import { DefiError, DefiErrorFilter } from "./errors/defi-error";

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
  constructor(private readonly strategiesService: StrategiesService) {}

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

  @Get("protocols")
  @ApiOperation({
    summary:
      "List curated protocol slugs available for the given tier (drives the onboarding whitelist picker)",
  })
  getProtocols(@Query("tier") tier?: string) {
    return this.strategiesService.getProtocols(tier);
  }

  @Get("positions")
  @ApiOperation({ summary: "Get user's strategy positions" })
  getPositions(@Request() req: AuthedRequest) {
    return this.strategiesService.getPositions(this.getWalletAddress(req));
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
      amountAtDeposit: string;
      amountAtDepositUsd: number;
      openTxHash?: string;
      goal?: string;
      targetDate?: string;
    },
  ) {
    return this.strategiesService.createPosition(this.getWalletAddress(req), {
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
  @ApiOperation({ summary: "Trigger a refresh for a specific position" })
  refreshPosition(
    @Request() req: AuthedRequest,
    @Param("id") id: string,
  ) {
    return this.strategiesService.refreshPosition(
      id,
      this.getWalletAddress(req),
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
