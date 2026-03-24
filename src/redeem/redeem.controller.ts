import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiSecurity,
} from "@nestjs/swagger";
import { RedeemService } from "./redeem.service";
import { ExecuteRedeemDto } from "./dto/execute-redeem.dto";
import { RedeemHistoryQueryDto } from "./dto/redeem-history-query.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ApiKey } from "../decorators/api-key.decorator";

@Controller("redeem")
@ApiTags("redeem")
@ApiSecurity("api-key")
export class RedeemController {
  constructor(private readonly redeemService: RedeemService) {}

  @Post("execute")
  @UseGuards(JwtAuthGuard)
  @ApiKey()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Redeem a product using point balance" })
  executeRedeem(@Request() req, @Body() dto: ExecuteRedeemDto) {
    return this.redeemService.executeRedeem(req.user.id, dto);
  }

  @Get("history")
  @UseGuards(JwtAuthGuard)
  @ApiKey()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get redeem history for authenticated user" })
  getRedeemHistory(@Request() req, @Query() query: RedeemHistoryQueryDto) {
    return this.redeemService.getRedeemHistory(req.user.id, query);
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard)
  @ApiKey()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get full detail of a specific redemption including voucher code" })
  getRedeemById(@Request() req, @Param("id") id: string) {
    return this.redeemService.getRedeemById(req.user.id, id);
  }

  @Get(":id/status")
  @UseGuards(JwtAuthGuard)
  @ApiKey()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Poll the status of a specific redemption (lightweight)" })
  getRedeemStatus(@Request() req, @Param("id") id: string) {
    return this.redeemService.getRedeemStatus(req.user.id, id);
  }
}
