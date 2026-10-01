/**
 * `/swap/*` — standalone same-chain swap surface.
 *
 * Spec: docs/swap-capability-spec.md §7.1.
 */

import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import type { BridgeQuoteResult } from "../bridge/bridge.service";
import type { BridgeStatus } from "../bridge/types";
import { DefiErrorFilter } from "../strategies/errors/defi-error";
import { SwapQuoteDto, SwapStatusQueryDto } from "./dto/swap.dto";
import { SwapService } from "./swap.service";

@ApiTags("swap")
@Controller("swap")
@UseGuards(JwtAuthGuard)
@UseFilters(DefiErrorFilter)
export class SwapController {
  constructor(private readonly swapService: SwapService) {}

  @Post("quote")
  @ApiOperation({
    summary:
      "Quote a same-chain token swap. The route registry picks the venue.",
  })
  @ApiResponse({ status: 200, description: "Quote or a no-route explanation" })
  quote(@Body() dto: SwapQuoteDto): Promise<BridgeQuoteResult> {
    return this.swapService.quote(dto);
  }

  @Get("status")
  @ApiOperation({
    summary: "Check the status of a submitted swap.",
  })
  getStatus(@Query() query: SwapStatusQueryDto): Promise<BridgeStatus> {
    return this.swapService.status(query);
  }
}
