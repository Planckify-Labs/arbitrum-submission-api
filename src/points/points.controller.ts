import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Request,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiSecurity } from "@nestjs/swagger";
import { PointsService } from "./points.service";
import { GetPointPriceQueryDto } from "./dto/get-point-price-query.dto";
import { CreatePointDepositDto } from "./dto/create-point-deposit.dto";
import { PointHistoryQueryDto } from "./dto/point-history-query.dto";
import { Public } from "../decorators/public.decorator";
import { ApiKey } from "../decorators/api-key.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@Controller("points")
@ApiTags("points")
@ApiSecurity("api-key")
export class PointsController {
  constructor(private readonly pointsService: PointsService) {}

  @Get("price")
  @Public()
  @ApiKey()
  @ApiOperation({ summary: "Get current point price for a token/currency pair" })
  getPointPrice(@Query() query: GetPointPriceQueryDto) {
    return this.pointsService.getPointPrice(query);
  }

  @Get("balance")
  @UseGuards(JwtAuthGuard)
  @ApiKey()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get authenticated user point balance" })
  getBalance(@Request() req) {
    return this.pointsService.getBalance(req.user.id);
  }

  @Post("deposit")
  @UseGuards(JwtAuthGuard)
  @ApiKey()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Submit a point deposit for on-chain verification" })
  createDeposit(@Request() req, @Body() dto: CreatePointDepositDto) {
    return this.pointsService.createDeposit(req.user.id, dto);
  }

  @Get("history")
  @UseGuards(JwtAuthGuard)
  @ApiKey()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get authenticated user point transaction ledger" })
  getHistory(@Request() req, @Query() query: PointHistoryQueryDto) {
    return this.pointsService.getHistory(req.user.id, query);
  }

  @Get("deposit/:id/status")
  @UseGuards(JwtAuthGuard)
  @ApiKey()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Poll the status of a specific point deposit" })
  getDepositStatus(@Request() req, @Param("id") id: string) {
    return this.pointsService.getDepositStatus(req.user.id, id);
  }

  @Get("summary")
  @UseGuards(JwtAuthGuard)
  @ApiKey()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get points summary", description: "Current balance, total earned/spent, and recent transactions." })
  @ApiResponse({ status: 200, description: "Points summary" })
  getPointsSummary(@Req() req: { user: { id: string } }) {
    return this.pointsService.getPointsSummary(req.user.id);
  }
}
