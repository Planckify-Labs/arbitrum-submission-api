import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { StatsService } from "./stats.service";
import { Roles } from "../decorators/roles.decorator";
import { UserRole } from "@generated/prisma";

@Controller("stats")
@ApiTags("stats")
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
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
