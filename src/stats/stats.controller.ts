import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { StatsService } from "./stats.service";

@Controller("stats")
@ApiTags("stats")
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get("dashboard")
  @ApiOperation({ summary: "Get dashboard statistics" })
  @ApiResponse({
    status: 200,
    description: "Returns aggregated dashboard statistics",
  })
  getDashboardStats() {
    return this.statsService.getDashboardStats();
  }
}
