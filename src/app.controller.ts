import { Controller, Get } from "@nestjs/common";
import { AppService } from "./app.service";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { Public } from "./decorators/public.decorator";

@Controller()
@ApiTags("app")
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get("health")
  @Public()
  @ApiOperation({ summary: "Health check endpoint" })
  @ApiResponse({ status: 200, description: "Service is healthy" })
  getHealth(): { status: string; timestamp: string } {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }
}
